-- One tenant-scoped workforce source for planning and booking validation.
-- Unbound people may be planned, but only a confirmed bound account can be booked.
alter table d5o_hosted.connected_crew_profiles
  drop constraint connected_crew_profiles_pkey;
alter table d5o_hosted.connected_crew_profiles
  alter column actor_user_id drop not null,
  add column id uuid not null default pg_catalog.gen_random_uuid(),
  add column display_name text,
  add column revision integer not null default 1 check (revision > 0);
update d5o_hosted.connected_crew_profiles
  set display_name=person where display_name is null;
alter table d5o_hosted.connected_crew_profiles
  alter column display_name set not null,
  add constraint connected_crew_profiles_pkey primary key (workspace_id,id),
  add constraint connected_crew_profiles_actor_key unique (workspace_id,actor_user_id),
  add constraint connected_crew_profiles_display_check
    check (length(trim(display_name)) between 2 and 120);

create table d5o_hosted.connected_workforce_states (
  workspace_id uuid primary key references d5o_hosted.workspaces(id),
  revision integer not null default 0 check (revision >= 0)
);
create table d5o_hosted.connected_workforce_commands (
  workspace_id uuid not null references d5o_hosted.workspaces(id),
  command_id text not null,
  actor_user_id uuid not null references auth.users(id),
  membership_id uuid not null references d5o_hosted.memberships(id),
  action text not null,
  fingerprint text not null,
  result jsonb not null,
  occurred_at timestamptz not null default now(),
  primary key (workspace_id,command_id)
);
alter table d5o_hosted.connected_workforce_states enable row level security;
alter table d5o_hosted.connected_workforce_commands enable row level security;
revoke all on d5o_hosted.connected_workforce_states,
  d5o_hosted.connected_workforce_commands from public,anon,authenticated,service_role;
-- Retire the older profile writer: it required binding first and had no source revision.
revoke execute on function public.d5o_hosted_crew_profile_command_v1(
  text,text,text[],numeric,text) from authenticated;
revoke execute on function public.d5o_hosted_bind_worker_v1(
  text,uuid,uuid,text,text) from service_role;

create function public.d5o_hosted_workforce_read_v1(p_workspace_key text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_workspace uuid;v_role text;v_revision integer;
begin
  if current_setting('role',true)<>'authenticated' or auth.uid() is null then
    raise exception 'membership_required' using errcode='42501'; end if;
  select w.id,m.role into v_workspace,v_role from d5o_hosted.workspaces w
    join d5o_hosted.memberships m on m.workspace_id=w.id
    where w.workspace_key=p_workspace_key and w.status='active'
      and m.actor_user_id=auth.uid() and m.status='active';
  if v_workspace is null or v_role='field_worker' then
    raise exception 'workforce_scope_denied' using errcode='42501'; end if;
  select revision into v_revision from d5o_hosted.connected_workforce_states
    where workspace_id=v_workspace;
  return pg_catalog.jsonb_build_object(
    'revision',coalesce(v_revision,0),
    'people',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',p.id,'person',p.person,'displayName',p.display_name,
      'qualifications',p.qualifications,'weeklyCapacityHours',p.weekly_capacity_hours,
      'active',p.active,'profileRevision',p.revision,
      'bound',coalesce(b.active and m.status='active' and m.role='field_worker',false),
      'workerUserId',case when v_role='admin' then p.actor_user_id else null end,
      'email',case when v_role='admin' then u.email else null end
    ) order by p.display_name) from d5o_hosted.connected_crew_profiles p
      left join d5o_hosted.crew_bindings b on b.workspace_id=p.workspace_id
        and b.actor_user_id=p.actor_user_id and b.person=p.person
      left join d5o_hosted.memberships m on m.workspace_id=p.workspace_id
        and m.actor_user_id=p.actor_user_id
      left join auth.users u on u.id=p.actor_user_id
      where p.workspace_id=v_workspace),'[]'::jsonb));
end; $$;
revoke all on function public.d5o_hosted_workforce_read_v1(text)
  from public,anon,service_role;
grant execute on function public.d5o_hosted_workforce_read_v1(text)
  to authenticated;

create function public.d5o_hosted_workforce_command_v1(
  p_workspace_key text,p_action text,p_input jsonb,
  p_command_id text,p_expected_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace uuid;v_member d5o_hosted.memberships%rowtype;
  v_state d5o_hosted.connected_workforce_states%rowtype;
  v_prior d5o_hosted.connected_workforce_commands%rowtype;
  v_profile d5o_hosted.connected_crew_profiles%rowtype;
  v_worker uuid;v_email text;v_person text;v_name text;v_quals text[];
  v_capacity numeric;v_id uuid;v_fingerprint text;v_result jsonb;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or p_action not in ('save-person','bind-person','set-active')
    or pg_catalog.jsonb_typeof(p_input)<>'object'
    or length(coalesce(p_command_id,'')) not between 8 and 120
    or p_expected_revision is null or p_expected_revision<0 then
    raise exception 'invalid_workforce_command' using errcode='22023'; end if;
  select w.id into v_workspace from d5o_hosted.workspaces w
    where w.workspace_key=p_workspace_key and w.status='active';
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace and actor_user_id=v_actor
      and status='active' and role='admin' for share;
  if v_workspace is null or v_member.id is null then raise exception 'admin_workforce_required' using errcode='42501'; end if;
  insert into d5o_hosted.connected_workforce_states(workspace_id) values(v_workspace)
    on conflict do nothing;
  select * into v_state from d5o_hosted.connected_workforce_states
    where workspace_id=v_workspace for update;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(
    p_workspace_key,p_action,p_input,p_expected_revision)::text);
  select * into v_prior from d5o_hosted.connected_workforce_commands
    where workspace_id=v_workspace and command_id=p_command_id;
  if found then
    if v_prior.actor_user_id<>v_actor or v_prior.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_prior.result; end if;
  if v_state.revision<>p_expected_revision then
    raise exception 'stale_workforce' using errcode='23505'; end if;

  if p_action='save-person' then
    v_person:=trim(coalesce(p_input->>'person',''));
    v_name:=trim(coalesce(p_input->>'displayName',''));
    v_capacity:=(p_input->>'weeklyCapacityHours')::numeric;
    select pg_catalog.array_agg(distinct trim(value)) into v_quals
      from pg_catalog.jsonb_array_elements_text(p_input->'qualifications');
    if length(v_person) not between 2 and 120
      or length(v_name) not between 2 and 120
      or cardinality(v_quals) not between 1 and 20
      or exists(select 1 from unnest(v_quals) q where length(q) not between 2 and 100)
      or v_capacity<=0 or v_capacity>80 then
      raise exception 'invalid_workforce_profile' using errcode='22023'; end if;
    if nullif(p_input->>'id','') is not null then
      v_id:=(p_input->>'id')::uuid;
      select * into v_profile from d5o_hosted.connected_crew_profiles
        where workspace_id=v_workspace and id=v_id for update;
      if not found or v_profile.person<>v_person then
        raise exception 'stable_person_identity_required' using errcode='23514'; end if;
      update d5o_hosted.connected_crew_profiles set display_name=v_name,
        qualifications=v_quals,weekly_capacity_hours=v_capacity,
        active=coalesce((p_input->>'active')::boolean,active),revision=revision+1
        where workspace_id=v_workspace and id=v_id;
      if p_input ? 'active' and v_profile.actor_user_id is not null then
        update d5o_hosted.crew_bindings set active=(p_input->>'active')::boolean
          where workspace_id=v_workspace and actor_user_id=v_profile.actor_user_id;
      end if;
    else
      insert into d5o_hosted.connected_crew_profiles(
        workspace_id,person,display_name,qualifications,weekly_capacity_hours)
        values(v_workspace,v_person,v_name,v_quals,v_capacity)
        returning id into v_id;
    end if;
  else
    v_id:=(p_input->>'id')::uuid;
    select * into v_profile from d5o_hosted.connected_crew_profiles
      where workspace_id=v_workspace and id=v_id for update;
    if not found then raise exception 'person_missing' using errcode='23503'; end if;
    if p_action='set-active' then
      update d5o_hosted.connected_crew_profiles set active=(p_input->>'active')::boolean,
        revision=revision+1 where workspace_id=v_workspace and id=v_id;
      if v_profile.actor_user_id is not null then
        update d5o_hosted.crew_bindings set active=(p_input->>'active')::boolean
          where workspace_id=v_workspace and actor_user_id=v_profile.actor_user_id;
      end if;
    else
      v_email:=lower(trim(coalesce(p_input->>'email','')));
      select id into v_worker from auth.users
        where lower(email)=v_email and email_confirmed_at is not null;
      if v_worker is null then raise exception 'confirmed_account_missing' using errcode='23503'; end if;
      if v_worker=v_actor or not v_profile.active or
        (v_profile.actor_user_id is not null and v_profile.actor_user_id<>v_worker) then
        raise exception 'worker_binding_conflict' using errcode='23505'; end if;
      if exists(select 1 from d5o_hosted.memberships
        where workspace_id=v_workspace and actor_user_id=v_worker
          and role<>'field_worker') or exists(select 1 from d5o_hosted.crew_bindings
        where workspace_id=v_workspace and
          (actor_user_id=v_worker or person=v_profile.person)
          and (actor_user_id<>v_worker or person<>v_profile.person)) then
        raise exception 'worker_binding_conflict' using errcode='23505'; end if;
      insert into d5o_hosted.memberships(workspace_id,actor_user_id,role,status)
        values(v_workspace,v_worker,'field_worker','active')
        on conflict(workspace_id,actor_user_id) do update set status='active'
          where d5o_hosted.memberships.role='field_worker';
      insert into d5o_hosted.crew_bindings(workspace_id,actor_user_id,person,active)
        values(v_workspace,v_worker,v_profile.person,true)
        on conflict(workspace_id,actor_user_id) do update set active=true;
      update d5o_hosted.connected_crew_profiles set actor_user_id=v_worker,
        revision=revision+1 where workspace_id=v_workspace and id=v_id;
      insert into d5o_hosted.crew_binding_events(
        workspace_id,actor_user_id,worker_user_id,person,action)
        values(v_workspace,v_actor,v_worker,v_profile.person,'bound');
    end if;
  end if;
  update d5o_hosted.connected_workforce_states set revision=revision+1
    where workspace_id=v_workspace;
  select pg_catalog.jsonb_build_object('id',id,'person',person,
    'displayName',display_name,'qualifications',qualifications,
    'weeklyCapacityHours',weekly_capacity_hours,'active',active,
    'profileRevision',revision,'workerUserId',actor_user_id)
    into v_result from d5o_hosted.connected_crew_profiles
    where workspace_id=v_workspace and id=v_id;
  v_result:=v_result||pg_catalog.jsonb_build_object('revision',v_state.revision+1);
  insert into d5o_hosted.connected_workforce_commands(
    workspace_id,command_id,actor_user_id,membership_id,action,fingerprint,result)
    values(v_workspace,p_command_id,v_actor,v_member.id,p_action,v_fingerprint,v_result);
  return v_result;
end; $$;
revoke all on function public.d5o_hosted_workforce_command_v1(
  text,text,jsonb,text,integer) from public,anon,service_role;
grant execute on function public.d5o_hosted_workforce_command_v1(
  text,text,jsonb,text,integer) to authenticated;


-- Stable queue ownership for canonical Work; labels in a draft are not identity.
create function public.d5o_hosted_work_queue_identity_v1(p_workspace_key text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace uuid;v_role text;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null then
    raise exception 'membership_required' using errcode='42501'; end if;
  select w.id,m.role into v_workspace,v_role from d5o_hosted.workspaces w
    join d5o_hosted.memberships m on m.workspace_id=w.id
    where w.workspace_key=p_workspace_key and w.status='active'
      and m.actor_user_id=v_actor and m.status='active';
  if v_workspace is null or v_role='field_worker' then
    raise exception 'queue_scope_denied' using errcode='42501'; end if;
  return pg_catalog.jsonb_build_object('actorId',v_actor,'role',v_role,
    'ownedIds',coalesce((select pg_catalog.jsonb_agg(l.presentation_id)
      from d5o_hosted.work_records r
      join d5o_hosted.work_identity_links l
        on l.workspace_id=r.workspace_id and l.work_id=r.id
      where r.workspace_id=v_workspace and r.created_by=v_actor),'[]'::jsonb));
end; $$;
revoke all on function public.d5o_hosted_work_queue_identity_v1(text)
  from public,anon,service_role;
grant execute on function public.d5o_hosted_work_queue_identity_v1(text)
  to authenticated;
