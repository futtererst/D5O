-- An isolated D5O administrator can bind an existing, confirmed Auth user
-- to one synthetic crew identity. No legacy Rybex membership is inherited.
create table d5o_hosted.crew_binding_events (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  workspace_id uuid not null references d5o_hosted.workspaces(id),
  actor_user_id uuid not null references auth.users(id),
  worker_user_id uuid not null references auth.users(id),
  person text not null,
  action text not null check (action in ('bound', 'reactivated')),
  at timestamptz not null default now()
);
alter table d5o_hosted.crew_binding_events enable row level security;
revoke all on d5o_hosted.crew_binding_events from public, anon, authenticated;

create function public.d5o_hosted_worker_access_v1(
  p_workspace_key text, p_admin_user_id uuid, p_admin_membership_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_workspace uuid;
begin
  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role' then
    raise exception 'server_admin_required' using errcode = '42501'; end if;
  select w.id into v_workspace from d5o_hosted.workspaces w
    join d5o_hosted.memberships m on m.workspace_id = w.id
    where w.workspace_key = p_workspace_key and w.status = 'active'
      and m.id = p_admin_membership_id and m.actor_user_id = p_admin_user_id
      and m.role = 'admin' and m.status = 'active';
  if v_workspace is null then raise exception 'admin_membership_required' using errcode = '42501'; end if;
  return coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'person', b.person, 'email', u.email, 'active', b.active, 'userId', b.actor_user_id)
    order by b.person) from d5o_hosted.crew_bindings b
    join auth.users u on u.id = b.actor_user_id
    where b.workspace_id = v_workspace), '[]'::jsonb);
end; $$;

create function public.d5o_hosted_bind_worker_v1(
  p_workspace_key text, p_admin_user_id uuid, p_admin_membership_id uuid,
  p_worker_email text, p_person text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_workspace uuid; v_worker uuid; v_membership d5o_hosted.memberships%rowtype;
  v_binding d5o_hosted.crew_bindings%rowtype; v_action text;
begin
  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role' then
    raise exception 'server_admin_required' using errcode = '42501'; end if;
  if p_person is null or length(trim(p_person)) not between 2 and 120
    or p_worker_email is null or length(trim(p_worker_email)) not between 3 and 320 then
    raise exception 'invalid_worker_identity' using errcode = '22023'; end if;
  select w.id into v_workspace from d5o_hosted.workspaces w
    join d5o_hosted.memberships m on m.workspace_id = w.id
    where w.workspace_key = p_workspace_key and w.status = 'active'
      and m.id = p_admin_membership_id and m.actor_user_id = p_admin_user_id
      and m.role = 'admin' and m.status = 'active';
  if v_workspace is null then raise exception 'admin_membership_required' using errcode = '42501'; end if;
  select u.id into v_worker from auth.users u
    where lower(u.email) = lower(trim(p_worker_email)) and u.email_confirmed_at is not null;
  if v_worker is null then raise exception 'confirmed_worker_missing' using errcode = '23503'; end if;
  if v_worker = p_admin_user_id then raise exception 'worker_separation_required' using errcode = '42501'; end if;
  select * into v_membership from d5o_hosted.memberships
    where workspace_id = v_workspace and actor_user_id = v_worker for update;
  if found and v_membership.role <> 'field_worker' then
    raise exception 'existing_role_conflict' using errcode = '23505'; end if;
  select * into v_binding from d5o_hosted.crew_bindings
    where workspace_id = v_workspace and (actor_user_id = v_worker or person = trim(p_person)) for update;
  if found and (v_binding.actor_user_id <> v_worker or v_binding.person <> trim(p_person)) then
    raise exception 'crew_identity_conflict' using errcode = '23505'; end if;
  if found and v_binding.active and v_membership.status = 'active' then
    return pg_catalog.jsonb_build_object('person', trim(p_person), 'workerUserId', v_worker, 'action', 'already_bound');
  end if;
  if not found then v_action := 'bound'; else v_action := 'reactivated'; end if;
  insert into d5o_hosted.memberships(workspace_id, actor_user_id, role, status)
    values(v_workspace, v_worker, 'field_worker', 'active')
    on conflict(workspace_id, actor_user_id) do update set status = 'active'
      where d5o_hosted.memberships.role = 'field_worker';
  insert into d5o_hosted.crew_bindings(workspace_id, actor_user_id, person, active)
    values(v_workspace, v_worker, trim(p_person), true)
    on conflict(workspace_id, actor_user_id) do update set active = true;
  insert into d5o_hosted.crew_binding_events(workspace_id, actor_user_id, worker_user_id, person, action)
    values(v_workspace, p_admin_user_id, v_worker, trim(p_person), v_action);
  return pg_catalog.jsonb_build_object('person', trim(p_person), 'workerUserId', v_worker, 'action', v_action);
end; $$;
revoke all on function public.d5o_hosted_worker_access_v1(text,uuid,uuid) from public, anon, authenticated;
revoke all on function public.d5o_hosted_bind_worker_v1(text,uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.d5o_hosted_worker_access_v1(text,uuid,uuid) to service_role;
grant execute on function public.d5o_hosted_bind_worker_v1(text,uuid,uuid,text,text) to service_role;
