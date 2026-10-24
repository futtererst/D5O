-- Qualification validity belongs to the existing tenant-owned workforce profile.
-- Missing dates retain the prior indefinite-validity contract for historical profiles.
alter table d5o_hosted.connected_crew_profiles
  add column qualification_expires_on jsonb not null default '{}'::jsonb
    check (pg_catalog.jsonb_typeof(qualification_expires_on)='object');

create or replace function public.d5o_hosted_workforce_expiry_command_v1(
  p_workspace_key text,p_profile_id uuid,p_qualification text,p_expires_on date,
  p_command_id text,p_expected_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace uuid;v_member d5o_hosted.memberships%rowtype;
  v_state d5o_hosted.connected_workforce_states%rowtype;
  v_profile d5o_hosted.connected_crew_profiles%rowtype;
  v_prior d5o_hosted.connected_workforce_commands%rowtype;
  v_fingerprint text;v_result jsonb;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or p_profile_id is null or length(coalesce(p_qualification,'')) not between 2 and 100
    or p_expires_on is null or length(coalesce(p_command_id,'')) not between 8 and 120
    or p_expected_revision is null or p_expected_revision<0 then
    raise exception 'invalid_qualification_validity_command' using errcode='22023'; end if;
  select w.id into v_workspace from d5o_hosted.workspaces w
    where w.workspace_key=p_workspace_key and w.status='active';
  select * into v_member from d5o_hosted.memberships m
    where m.workspace_id=v_workspace and m.actor_user_id=v_actor
      and m.status='active' and m.role='admin' for share;
  if v_workspace is null or v_member.id is null then
    raise exception 'admin_workforce_required' using errcode='42501'; end if;
  select * into v_state from d5o_hosted.connected_workforce_states
    where workspace_id=v_workspace for update;
  if not found then raise exception 'workforce_state_missing' using errcode='23503'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_workspace_key,
    p_profile_id,p_qualification,p_expires_on,p_expected_revision)::text);
  select * into v_prior from d5o_hosted.connected_workforce_commands
    where workspace_id=v_workspace and command_id=p_command_id;
  if found then
    if v_prior.actor_user_id<>v_actor or v_prior.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_prior.result; end if;
  if v_state.revision<>p_expected_revision then
    raise exception 'stale_workforce' using errcode='23505'; end if;
  select * into v_profile from d5o_hosted.connected_crew_profiles
    where workspace_id=v_workspace and id=p_profile_id for update;
  if not found or not (p_qualification=any(v_profile.qualifications)) then
    raise exception 'profile_qualification_missing' using errcode='23503'; end if;
  update d5o_hosted.connected_crew_profiles
    set qualification_expires_on=qualification_expires_on ||
      pg_catalog.jsonb_build_object(p_qualification,p_expires_on::text),revision=revision+1
    where workspace_id=v_workspace and id=p_profile_id;
  update d5o_hosted.connected_workforce_states set revision=revision+1
    where workspace_id=v_workspace;
  v_result:=pg_catalog.jsonb_build_object('profileId',p_profile_id,
    'qualification',p_qualification,'expiresOn',p_expires_on,
    'revision',v_state.revision+1);
  insert into d5o_hosted.connected_workforce_commands(
    workspace_id,command_id,actor_user_id,membership_id,action,fingerprint,result)
    values(v_workspace,p_command_id,v_actor,v_member.id,'set-qualification-expiry',
      v_fingerprint,v_result);
  return v_result;
end; $$;
revoke all on function public.d5o_hosted_workforce_expiry_command_v1(
  text,uuid,text,date,text,integer) from public,anon,service_role;
grant execute on function public.d5o_hosted_workforce_expiry_command_v1(
  text,uuid,text,date,text,integer) to authenticated;

create or replace function public.d5o_hosted_workforce_read_v1(p_workspace_key text)
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
      'qualifications',p.qualifications,'qualificationExpiresOn',p.qualification_expires_on,
      'weeklyCapacityHours',p.weekly_capacity_hours,
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

create or replace function d5o_hosted.crew_booking_eligibility_v1(
  p_workspace uuid,p_state jsonb,p_assignment jsonb
) returns void language plpgsql volatile security definer set search_path='' as $$
declare v_item jsonb;v_profile d5o_hosted.connected_crew_profiles%rowtype;
  v_person text;v_hours numeric;v_used numeric;v_shift text;v_required text;
  v_start integer;v_end integer;v_duration integer;v_overnight boolean;
  v_assignment jsonb;v_booking_date date;
begin
  v_shift:=p_assignment->>'shift';
  if coalesce(v_shift,'') !~ '^\d\d:\d\d[–-]\d\d:\d\d$' then
    raise exception 'invalid_booking_shift' using errcode='23514'; end if;
  v_start:=left(v_shift,2)::integer*60+substring(v_shift from 4 for 2)::integer;
  v_end:=substring(v_shift from 7 for 2)::integer*60+right(v_shift,2)::integer;
  if v_start>=1440 or v_end>=1440 or substring(v_shift from 4 for 2)::integer>=60
    or right(v_shift,2)::integer>=60 then
    raise exception 'invalid_booking_shift' using errcode='23514'; end if;
  v_overnight:=v_end<=v_start;
  v_duration:=v_end-v_start+case when v_overnight then 1440 else 0 end;
  if v_duration<1 or v_duration>960 then
    raise exception 'invalid_booking_shift' using errcode='23514'; end if;
  v_hours:=(v_duration-case when v_duration>=360 then 30 else 0 end)::numeric/60;
  v_booking_date:=(p_assignment->>'date')::date;
  select d.value->>'qualification' into v_required
    from d5o_hosted.work_identity_links l
    join d5o_hosted.connected_design_states ds
      on ds.workspace_id=l.workspace_id and ds.work_id=l.work_id
    cross join lateral pg_catalog.jsonb_array_elements(
      coalesce(ds.state->'demands','[]'::jsonb)) d
    where l.workspace_id=p_workspace and l.presentation_id=p_assignment->>'workId'
      and d.value->>'packageId'=p_assignment->>'packageId' limit 1;
  if coalesce(v_required,'')='' then
    raise exception 'current_demand_coverage_required' using errcode='23514'; end if;
  for v_item in select value from pg_catalog.jsonb_array_elements(p_assignment->'people') loop
    v_person:=v_item#>>'{}';
    select * into v_profile from d5o_hosted.connected_crew_profiles
      where workspace_id=p_workspace and person=v_person and active;
    if not found or v_profile.actor_user_id is null
      or not (v_required=any(v_profile.qualifications))
      or not exists(select 1 from d5o_hosted.crew_bindings b
        join d5o_hosted.memberships m on m.workspace_id=b.workspace_id
          and m.actor_user_id=b.actor_user_id and m.status='active' and m.role='field_worker'
        where b.workspace_id=p_workspace and b.actor_user_id=v_profile.actor_user_id
          and b.person=v_person and b.active) then
      raise exception 'qualified_bound_worker_required' using errcode='23514'; end if;
    if (v_profile.qualification_expires_on ? v_required) and
      (v_profile.qualification_expires_on->>v_required)::date <
        (v_booking_date+case when v_overnight then 1 else 0 end) then
      raise exception 'worker_qualification_expired' using errcode='23514'; end if;
    if exists(select 1 from pg_catalog.jsonb_array_elements(
        coalesce(p_state->'availabilityBlocks','[]'::jsonb)) b
        where b->>'person'=v_person and (
          b->>'date'=p_assignment->>'date' or
          v_overnight and b->>'date'=to_char(v_booking_date+1,'YYYY-MM-DD'))) then
      raise exception 'worker_unavailable_for_shift' using errcode='23514'; end if;
    v_used:=0;
    for v_assignment in select a from pg_catalog.jsonb_array_elements(
      coalesce(p_state->'assignments','[]'::jsonb)) a
      where a->>'id'<>p_assignment->>'id'
        and (a->>'week')::integer=(p_assignment->>'week')::integer
        and a->'people' ? v_person loop
      v_shift:=v_assignment->>'shift';
      if coalesce(v_shift,'') !~ '^\d\d:\d\d[–-]\d\d:\d\d$' then
        raise exception 'invalid_existing_booking_shift' using errcode='23514'; end if;
      v_start:=left(v_shift,2)::integer*60+substring(v_shift from 4 for 2)::integer;
      v_end:=substring(v_shift from 7 for 2)::integer*60+right(v_shift,2)::integer;
      v_duration:=v_end-v_start+case when v_end<=v_start then 1440 else 0 end;
      if v_duration<1 or v_duration>960 then
        raise exception 'invalid_existing_booking_shift' using errcode='23514'; end if;
      v_used:=v_used+(v_duration-case when v_duration>=360 then 30 else 0 end)::numeric/60;
    end loop;
    if v_used+v_hours>v_profile.weekly_capacity_hours then
      raise exception 'worker_weekly_capacity_exceeded' using errcode='23514'; end if;
  end loop;
end; $$;
revoke all on function d5o_hosted.crew_booking_eligibility_v1(uuid,jsonb,jsonb)
  from public,anon,authenticated,service_role;

-- The public crew entry point accumulated labor and binding wrappers. Check
-- current qualification validity at its outermost boundary, in the same
-- transaction as the underlying booking/publication command.
alter function public.d5o_hosted_crew_command_v1(text,text,jsonb,text,integer)
  rename to d5o_hosted_crew_command_pre_expiry_v1;
revoke all on function public.d5o_hosted_crew_command_pre_expiry_v1(text,text,jsonb,text,integer)
  from public,anon,authenticated,service_role;
create function public.d5o_hosted_crew_command_v1(
  p_workspace_key text,p_action text,p_input jsonb,p_command_id text,p_expected_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_workspace uuid;v_role text;v_schedule d5o_hosted.connected_schedule_states%rowtype;
  v_assignment jsonb;
begin
  if current_setting('role',true)<>'authenticated' or auth.uid() is null then
    raise exception 'crew_membership_required' using errcode='42501'; end if;
  select w.id,m.role into v_workspace,v_role from d5o_hosted.workspaces w
    join d5o_hosted.memberships m on m.workspace_id=w.id
    where w.workspace_key=p_workspace_key and w.status='active'
      and m.actor_user_id=auth.uid() and m.status='active';
  if v_workspace is null then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  if p_action in ('save-booking','publish-week') then
    if v_role not in ('admin','project_manager','operations_leader') then
      raise exception 'scheduling_authority_required' using errcode='42501'; end if;
    if exists(select 1 from d5o_hosted.connected_schedule_receipts
      where workspace_id=v_workspace and command_id=p_command_id) then
      return public.d5o_hosted_crew_command_pre_expiry_v1(
        p_workspace_key,p_action,p_input,p_command_id,p_expected_revision); end if;
    select * into v_schedule from d5o_hosted.connected_schedule_states
      where workspace_id=v_workspace for update;
    if found then
      if p_action='save-booking' then
        v_assignment:=p_input->'assignment';
        if pg_catalog.jsonb_typeof(v_assignment)='object'
          and pg_catalog.jsonb_typeof(v_assignment->'people')='array' then
          perform d5o_hosted.crew_booking_eligibility_v1(
            v_workspace,v_schedule.state,v_assignment); end if;
      else
        for v_assignment in select a from pg_catalog.jsonb_array_elements(
          coalesce(v_schedule.state->'assignments','[]'::jsonb)) a
          where (a->>'week')::integer=(p_input->>'week')::integer loop
          perform d5o_hosted.crew_booking_eligibility_v1(
            v_workspace,v_schedule.state,v_assignment);
        end loop;
      end if;
    end if;
  end if;
  return public.d5o_hosted_crew_command_pre_expiry_v1(
    p_workspace_key,p_action,p_input,p_command_id,p_expected_revision);
end; $$;
revoke all on function public.d5o_hosted_crew_command_v1(text,text,jsonb,text,integer)
  from public,anon,service_role;
grant execute on function public.d5o_hosted_crew_command_v1(text,text,jsonb,text,integer)
  to authenticated;

-- Enforce the same rule at the state write boundary as well. Legacy RPC
-- wrappers may be cached by PostgREST under their original function OID;
-- this trigger closes that route and any future writer in the same transaction.
create function d5o_hosted.enforce_crew_qualification_expiry_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_assignment jsonb;
begin
  if tg_op='INSERT' or new.state->'assignments' is distinct from old.state->'assignments'
    or new.state->'publications' is distinct from old.state->'publications' then
    for v_assignment in select value from pg_catalog.jsonb_array_elements(
      coalesce(new.state->'assignments','[]'::jsonb)) loop
      perform d5o_hosted.crew_booking_eligibility_v1(
        new.workspace_id,new.state,v_assignment);
    end loop;
  end if;
  return new;
end; $$;
revoke all on function d5o_hosted.enforce_crew_qualification_expiry_v1()
  from public,anon,authenticated,service_role;
create trigger connected_schedule_qualification_expiry_guard
  before insert or update on d5o_hosted.connected_schedule_states
  for each row execute function d5o_hosted.enforce_crew_qualification_expiry_v1();

-- Keep the existing audited membership command authoritative. A customer admin
-- may suspend/remove a bound field worker, but cannot change that worker's role.
do $$
declare v_definition text;v_old text:=
  'or v_before->>''role'' in (''admin'',''field_worker'')';
begin
  select pg_catalog.pg_get_functiondef(
    'public.d5o_hosted_org_admin_command_v1(text,text,uuid,jsonb,integer,text,text)'::regprocedure)
    into v_definition;
  if pg_catalog.strpos(v_definition,v_old)=0 then
    raise exception 'org_membership_contract_changed'; end if;
  v_definition:=pg_catalog.replace(v_definition,v_old,
    'or v_before->>''role''=''admin'' or (v_before->>''role''=''field_worker'' and p_action=''member.role'')');
  execute v_definition;
end $$;
