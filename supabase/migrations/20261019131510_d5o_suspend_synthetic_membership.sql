-- Suspend a non-protected pilot membership without deleting its identity or decisions.
alter table d5o_hosted.membership_assignment_events
  drop constraint membership_assignment_events_action_check;
alter table d5o_hosted.membership_assignment_events
  add constraint membership_assignment_events_action_check
  check (action in ('assigned', 'changed', 'reactivated', 'suspended'));

create function public.d5o_hosted_suspend_member_v1(
  p_workspace_key text, p_admin_user_id uuid, p_admin_membership_id uuid,
  p_member_email text, p_expected_role text, p_command_id text
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_workspace uuid;
  v_target uuid;
  v_member d5o_hosted.memberships%rowtype;
  v_replay d5o_hosted.membership_assignment_events%rowtype;
  v_fingerprint text;
begin
  if current_setting('role', true) is distinct from 'service_role'
    or p_admin_user_id is null or p_admin_membership_id is null then
    raise exception 'server_admin_required' using errcode = '42501';
  end if;
  if p_workspace_key is null or p_member_email is null
    or length(trim(p_member_email)) not between 3 and 320
    or p_expected_role is null
    or p_command_id is null or length(p_command_id) not between 8 and 120 then
    raise exception 'invalid_membership_suspension' using errcode = '22023';
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
  if v_target = p_admin_user_id then raise exception 'self_suspension_denied' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('d5o-member:' || v_workspace::text || ':' || v_target::text, 0));
  v_fingerprint := pg_catalog.md5('suspend:' || lower(trim(p_member_email)) || ':' || p_expected_role || ':' || p_admin_user_id::text);
  select * into v_replay from d5o_hosted.membership_assignment_events
    where workspace_id = v_workspace and command_id = p_command_id;
  if found then
    if v_replay.fingerprint <> v_fingerprint or v_replay.target_user_id <> v_target
      or v_replay.action <> 'suspended' then
      raise exception 'command_id_reused' using errcode = '23505';
    end if;
    return pg_catalog.jsonb_build_object('userId', v_target, 'role', v_replay.assigned_role,
      'action', 'suspended', 'replay', true);
  end if;
  select * into v_member from d5o_hosted.memberships
    where workspace_id = v_workspace and actor_user_id = v_target for update;
  if not found or v_member.role is distinct from p_expected_role
    or v_member.status is distinct from 'active' then
    raise exception 'stale_membership' using errcode = '23505';
  end if;
  if v_member.role in ('admin', 'field_worker') then
    raise exception 'protected_membership' using errcode = '42501';
  end if;
  update d5o_hosted.memberships set status = 'suspended' where id = v_member.id;
  insert into d5o_hosted.membership_assignment_events(workspace_id, command_id, fingerprint,
    actor_user_id, actor_membership_id, target_user_id, previous_role, assigned_role, action)
    values(v_workspace, p_command_id, v_fingerprint, p_admin_user_id,
      p_admin_membership_id, v_target, v_member.role, v_member.role, 'suspended');
  return pg_catalog.jsonb_build_object('userId', v_target, 'role', v_member.role, 'action', 'suspended');
end; $$;
revoke all on function public.d5o_hosted_suspend_member_v1(text,uuid,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.d5o_hosted_suspend_member_v1(text,uuid,uuid,text,text,text) to service_role;

-- An empty synthetic trial needs one ordinary administrator before the
-- administrator-facing membership screen can be used. This is a one-time,
-- service-only bootstrap, not an impersonated decision by an existing admin.
create table d5o_hosted.synthetic_beta_admin_bootstrap (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references d5o_hosted.workspaces(id),
  target_user_id uuid not null references auth.users(id),
  target_email text not null,
  operator_label text not null,
  reason text not null,
  command_id text not null unique,
  occurred_at timestamptz not null default now(),
  unique (workspace_id)
);
alter table d5o_hosted.synthetic_beta_admin_bootstrap enable row level security;
revoke all on d5o_hosted.synthetic_beta_admin_bootstrap from public, anon, authenticated, service_role;

create function public.d5o_hosted_bootstrap_synthetic_admin_v1(
  p_workspace_key text, p_target_email text, p_operator_label text,
  p_reason text, p_command_id text
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_workspace uuid;
  v_target uuid;
  v_prior d5o_hosted.synthetic_beta_admin_bootstrap%rowtype;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception 'server_operator_required' using errcode = '42501';
  end if;
  if p_workspace_key is distinct from 'rybex'
    or lower(trim(coalesce(p_target_email, ''))) !~ '^[^@[:space:]]+@example[.]test$'
    or length(trim(coalesce(p_operator_label, ''))) not between 3 and 120
    or length(trim(coalesce(p_reason, ''))) not between 12 and 500
    or length(coalesce(p_command_id, '')) not between 8 and 120 then
    raise exception 'invalid_beta_bootstrap' using errcode = '22023';
  end if;
  select id into v_workspace from d5o_hosted.workspaces
    where workspace_key = p_workspace_key and status = 'active' for update;
  if v_workspace is null then raise exception 'workspace_missing' using errcode = '23503'; end if;
  select * into v_prior from d5o_hosted.synthetic_beta_admin_bootstrap
    where workspace_id = v_workspace;
  if found then
    if v_prior.command_id = p_command_id and v_prior.target_email = lower(trim(p_target_email))
      and v_prior.operator_label = trim(p_operator_label) and v_prior.reason = trim(p_reason) then
      return pg_catalog.jsonb_build_object('userId', v_prior.target_user_id, 'replay', true);
    end if;
    raise exception 'beta_admin_already_bootstrapped' using errcode = '23505';
  end if;
  if exists (select 1 from d5o_hosted.work_records where workspace_id = v_workspace)
    or exists (select 1 from d5o_hosted.configuration_versions cv
      join d5o_hosted.configuration_tenants ct on ct.id = cv.tenant_id
      where ct.workspace_id = v_workspace) then
    raise exception 'beta_bootstrap_requires_empty_workspace' using errcode = '23505';
  end if;
  select id into v_target from auth.users where lower(email) = lower(trim(p_target_email))
    and email_confirmed_at is not null;
  if v_target is null then raise exception 'confirmed_member_missing' using errcode = '23503'; end if;
  if exists (select 1 from d5o_hosted.memberships
    where workspace_id = v_workspace and actor_user_id = v_target) then
    raise exception 'target_already_member' using errcode = '23505';
  end if;
  insert into d5o_hosted.memberships(workspace_id, actor_user_id, role, status)
    values (v_workspace, v_target, 'admin', 'active');
  insert into d5o_hosted.synthetic_beta_admin_bootstrap(
    workspace_id, target_user_id, target_email, operator_label, reason, command_id)
    values (v_workspace, v_target, lower(trim(p_target_email)), trim(p_operator_label),
      trim(p_reason), p_command_id);
  return pg_catalog.jsonb_build_object('userId', v_target, 'role', 'admin', 'action', 'synthetic_beta_bootstrap');
end; $$;
revoke all on function public.d5o_hosted_bootstrap_synthetic_admin_v1(text,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.d5o_hosted_bootstrap_synthetic_admin_v1(text,text,text,text,text)
  to service_role;
