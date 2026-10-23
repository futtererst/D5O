-- Pilot membership assignment is separate from roster binding and from
-- configuration administration. No existing member is repurposed silently.
create table d5o_hosted.membership_assignment_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references d5o_hosted.workspaces(id),
  command_id text not null check (length(command_id) between 8 and 120),
  fingerprint text not null,
  actor_user_id uuid not null references auth.users(id),
  actor_membership_id uuid not null references d5o_hosted.memberships(id),
  target_user_id uuid not null references auth.users(id),
  previous_role text,
  assigned_role text not null,
  action text not null check (action in ('assigned', 'changed', 'reactivated')),
  occurred_at timestamptz not null default now(),
  unique (workspace_id, command_id)
);
alter table d5o_hosted.membership_assignment_events enable row level security;
revoke all on d5o_hosted.membership_assignment_events from public, anon, authenticated, service_role;

create function public.d5o_hosted_assign_member_v1(
  p_workspace_key text, p_admin_user_id uuid, p_admin_membership_id uuid,
  p_member_email text, p_role text, p_expected_role text, p_command_id text
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_workspace uuid;
  v_target uuid;
  v_member d5o_hosted.memberships%rowtype;
  v_prior_role text;
  v_action text;
  v_fingerprint text;
  v_replay d5o_hosted.membership_assignment_events%rowtype;
begin
  if current_setting('role', true) is distinct from 'service_role'
    or p_admin_user_id is null or p_admin_membership_id is null then
    raise exception 'server_admin_required' using errcode = '42501';
  end if;
  if p_workspace_key is null or p_member_email is null
    or length(trim(p_member_email)) not between 3 and 320
    or p_command_id is null or length(p_command_id) not between 8 and 120
    or p_role is null or p_role not in ('executive', 'operations_leader', 'business_development_lead',
      'project_manager', 'billing_commercial_lead', 'field_supervisor',
      'closeout_lead', 'read_only_auditor') then
    raise exception 'invalid_membership_assignment' using errcode = '22023';
  end if;
  select w.id into v_workspace from d5o_hosted.workspaces w
    join d5o_hosted.memberships m on m.workspace_id = w.id
    where w.workspace_key = p_workspace_key and w.status = 'active'
      and m.id = p_admin_membership_id and m.actor_user_id = p_admin_user_id
      and m.role = 'admin' and m.status = 'active';
  if v_workspace is null then raise exception 'admin_membership_required' using errcode = '42501'; end if;
  select u.id into v_target from auth.users u
    where lower(u.email) = lower(trim(p_member_email)) and u.email_confirmed_at is not null;
  if v_target is null then raise exception 'confirmed_member_missing' using errcode = '23503'; end if;
  if v_target = p_admin_user_id then raise exception 'self_assignment_denied' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('d5o-member:' || v_workspace::text || ':' || v_target::text, 0));
  v_fingerprint := pg_catalog.md5(lower(trim(p_member_email)) || ':' || p_role || ':' || coalesce(p_expected_role, 'new') || ':' || p_admin_user_id::text);
  select * into v_replay from d5o_hosted.membership_assignment_events
    where workspace_id = v_workspace and command_id = p_command_id;
  if found then
    if v_replay.fingerprint <> v_fingerprint or v_replay.target_user_id <> v_target then
      raise exception 'command_id_reused' using errcode = '23505';
    end if;
    return pg_catalog.jsonb_build_object('userId', v_target, 'role', v_replay.assigned_role, 'action', v_replay.action, 'replay', true);
  end if;
  select * into v_member from d5o_hosted.memberships
    where workspace_id = v_workspace and actor_user_id = v_target for update;
  if found then
    v_prior_role := v_member.role;
    if v_member.role = 'admin' or v_member.role = 'field_worker' then
      raise exception 'protected_membership' using errcode = '42501';
    end if;
    if v_member.role = p_role and v_member.status = 'active' then
      return pg_catalog.jsonb_build_object('userId', v_target, 'role', p_role, 'action', 'already_assigned');
    end if;
    if p_expected_role is distinct from v_member.role then
      raise exception 'stale_membership' using errcode = '23505';
    end if;
    v_action := case when v_member.status = 'suspended' and v_member.role = p_role then 'reactivated' else 'changed' end;
    update d5o_hosted.memberships set role = p_role, status = 'active' where id = v_member.id;
  else
    if p_expected_role is not null then raise exception 'stale_membership' using errcode = '23505'; end if;
    v_action := 'assigned';
    insert into d5o_hosted.memberships(workspace_id, actor_user_id, role, status)
      values(v_workspace, v_target, p_role, 'active');
  end if;
  insert into d5o_hosted.membership_assignment_events(workspace_id, command_id, fingerprint,
    actor_user_id, actor_membership_id, target_user_id, previous_role, assigned_role, action)
    values(v_workspace, p_command_id, v_fingerprint, p_admin_user_id,
      p_admin_membership_id, v_target, v_prior_role, p_role, v_action);
  return pg_catalog.jsonb_build_object('userId', v_target, 'role', p_role, 'action', v_action);
end; $$;
revoke all on function public.d5o_hosted_assign_member_v1(text,uuid,uuid,text,text,text,text) from public, anon, authenticated;
grant execute on function public.d5o_hosted_assign_member_v1(text,uuid,uuid,text,text,text,text) to service_role;

create function public.d5o_hosted_membership_access_v1(
  p_workspace_key text, p_admin_user_id uuid, p_admin_membership_id uuid
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_workspace uuid;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception 'server_admin_required' using errcode = '42501'; end if;
  select w.id into v_workspace from d5o_hosted.workspaces w
    join d5o_hosted.memberships m on m.workspace_id = w.id
    where w.workspace_key = p_workspace_key and w.status = 'active'
      and m.id = p_admin_membership_id and m.actor_user_id = p_admin_user_id
      and m.role = 'admin' and m.status = 'active';
  if v_workspace is null then raise exception 'admin_membership_required' using errcode = '42501'; end if;
  return coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'userId', m.actor_user_id, 'email', u.email, 'role', m.role, 'status', m.status)
    order by u.email) from d5o_hosted.memberships m join auth.users u on u.id = m.actor_user_id
    where m.workspace_id = v_workspace), '[]'::jsonb);
end; $$;
revoke all on function public.d5o_hosted_membership_access_v1(text,uuid,uuid) from public, anon, authenticated;
grant execute on function public.d5o_hosted_membership_access_v1(text,uuid,uuid) to service_role;
