-- Phase 2C extends the hosted authorities. No pilot is enrolled by this migration.
create table d5o_hosted.capability_entitlements (
  workspace_id uuid not null references d5o_hosted.workspaces(id),
  capability_key text not null check (capability_key='connected_work'),
  granted boolean not null, effective_from timestamptz not null default now(),
  revision integer not null default 1 check (revision>0),
  changed_by uuid not null references auth.users(id), updated_at timestamptz not null default now(),
  primary key (workspace_id,capability_key)
);
create table d5o_hosted.capability_flags (
  workspace_id uuid not null references d5o_hosted.workspaces(id),
  capability_key text not null check (capability_key='connected_work'),
  enabled boolean not null, revision integer not null default 1 check (revision>0),
  changed_by uuid not null references auth.users(id), updated_at timestamptz not null default now(),
  primary key (workspace_id,capability_key)
);
alter table d5o_hosted.capability_entitlements enable row level security;
alter table d5o_hosted.capability_flags enable row level security;
revoke all on d5o_hosted.capability_entitlements,d5o_hosted.capability_flags from public,anon,authenticated,service_role;

-- Defaults preserve established pilots. New commercial tenants require an explicit
-- vendor grant and flag enablement. Both gates must pass; neither grants a role.
create function d5o_hosted.capability_available_v1(p_workspace_id uuid,p_key text)
returns boolean language sql stable security definer set search_path='' as $$
  select p_key='connected_work' and
    exists(select 1 from d5o_hosted.workspaces w where w.id=p_workspace_id and w.status='active')
    and (not exists(select 1 from d5o_hosted.tenant_provisioning p where p.workspace_id=p_workspace_id)
     or (exists(select 1 from d5o_hosted.capability_entitlements e
       where e.workspace_id=p_workspace_id and e.capability_key=p_key and e.granted
         and e.effective_from<=now())
      and exists(select 1 from d5o_hosted.capability_flags f
       where f.workspace_id=p_workspace_id and f.capability_key=p_key and f.enabled)
      and exists(select 1 from d5o_hosted.tenant_provisioning p
        where p.workspace_id=p_workspace_id and p.lifecycle='active')));
$$;
revoke all on function d5o_hosted.capability_available_v1(uuid,text) from public,anon,authenticated,service_role;

-- Existing sessions and service-role command paths hit the same row boundary.
-- Read-only queries, vendor recovery and audit reads remain available.
create function d5o_hosted.require_operational_tenant_v1() returns trigger
language plpgsql set search_path='' as $$
begin
  if exists(select 1 from d5o_hosted.tenant_provisioning p
    where p.workspace_id=new.workspace_id and p.lifecycle<>'active') then
    raise exception 'tenant_not_active' using errcode='42501'; end if;
  return new;
end $$;
create trigger phase2c_work_mutation_guard before insert or update on d5o_hosted.work_records
  for each row execute function d5o_hosted.require_operational_tenant_v1();
create trigger phase2c_prototype_mutation_guard before insert or update on d5o_hosted.prototype_states
  for each row execute function d5o_hosted.require_operational_tenant_v1();
create trigger phase2c_approval_mutation_guard before insert or update on d5o_hosted.service_approval_requests
  for each row execute function d5o_hosted.require_operational_tenant_v1();

create function public.d5o_platform_lifecycle_command_v1(
  p_workspace_key text,p_action text,p_expected_revision integer,p_command_id text,p_reason text
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
  v_provision d5o_hosted.tenant_provisioning%rowtype;
  v_fp text;v_prior d5o_hosted.platform_command_receipts%rowtype;v_result jsonb;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null or not exists
    (select 1 from d5o_hosted.platform_administrators
      where actor_user_id=v_actor and status='active') then
    raise exception 'platform_administrator_required' using errcode='42501'; end if;
  if p_action not in ('suspend','reactivate') or p_expected_revision is null
    or length(coalesce(p_command_id,'')) not between 8 and 120
    or length(trim(coalesce(p_reason,''))) not between 8 and 500 then
    raise exception 'invalid_lifecycle_command' using errcode='22023'; end if;
  v_fp:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_workspace_key,p_action,
    p_expected_revision,trim(p_reason))::text);
  select * into v_prior from d5o_hosted.platform_command_receipts where command_id=p_command_id;
  if found then
    if v_prior.actor_user_id<>v_actor or v_prior.fingerprint<>v_fp then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_prior.result; end if;
  select * into v_workspace from d5o_hosted.workspaces where workspace_key=p_workspace_key for update;
  if not found then raise exception 'tenant_not_found' using errcode='23514'; end if;
  select * into v_provision from d5o_hosted.tenant_provisioning
    where workspace_id=v_workspace.id for update;
  if not found or v_provision.revision<>p_expected_revision
    or (p_action='suspend' and (v_provision.lifecycle<>'active' or v_workspace.status<>'active'))
    or (p_action='reactivate' and (v_provision.lifecycle<>'suspended' or v_workspace.status<>'disabled')) then
    raise exception 'stale_lifecycle_state' using errcode='23505'; end if;
  if p_action='reactivate' and (v_provision.failure_code is not null or not exists
    (select 1 from d5o_hosted.memberships m where m.workspace_id=v_workspace.id
      and m.status='active' and m.role='admin') or not exists
    (select 1 from d5o_hosted.configuration_versions v
      join d5o_hosted.configuration_tenants t on t.id=v.tenant_id
      where t.workspace_id=v_workspace.id and v.status='published'
        and v.effective_from<=now() and (v.effective_to is null or v.effective_to>now()))) then
    raise exception 'reactivation_not_ready' using errcode='23514'; end if;
  update d5o_hosted.tenant_provisioning set
    lifecycle=case when p_action='suspend' then 'suspended' else 'active' end,
    revision=revision+1,updated_at=now() where workspace_id=v_workspace.id;
  update d5o_hosted.workspaces set status=case when p_action='suspend' then 'disabled' else 'active' end
    where id=v_workspace.id;
  v_result:=pg_catalog.jsonb_build_object('workspaceKey',p_workspace_key,
    'lifecycle',case when p_action='suspend' then 'suspended' else 'active' end,
    'revision',p_expected_revision+1);
  insert into d5o_hosted.platform_events(command_id,actor_user_id,workspace_id,
    action,reason,before_state,after_state)
    values(p_command_id,v_actor,v_workspace.id,'tenant.'||p_action,trim(p_reason),
      pg_catalog.jsonb_build_object('lifecycle',v_provision.lifecycle,'revision',v_provision.revision),v_result);
  insert into d5o_hosted.platform_command_receipts(command_id,actor_user_id,fingerprint,result)
    values(p_command_id,v_actor,v_fp,v_result);
  return v_result;
end $$;
revoke all on function public.d5o_platform_lifecycle_command_v1(text,text,integer,text,text)
  from public,anon,service_role;
grant execute on function public.d5o_platform_lifecycle_command_v1(text,text,integer,text,text)
  to authenticated;

create function public.d5o_platform_capability_command_v1(
  p_workspace_key text,p_kind text,p_enabled boolean,p_expected_revision integer,
  p_command_id text,p_reason text
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
  v_fp text;v_prior d5o_hosted.platform_command_receipts%rowtype;
  v_revision integer;v_result jsonb;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null or not exists
    (select 1 from d5o_hosted.platform_administrators
      where actor_user_id=v_actor and status='active') then
    raise exception 'platform_administrator_required' using errcode='42501'; end if;
  if p_kind not in ('entitlement','flag') or p_enabled is null
    or p_expected_revision is null or p_expected_revision<0
    or length(coalesce(p_command_id,'')) not between 8 and 120
    or length(trim(coalesce(p_reason,''))) not between 8 and 500 then
    raise exception 'invalid_capability_command' using errcode='22023'; end if;
  v_fp:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_workspace_key,p_kind,p_enabled,
    p_expected_revision,trim(p_reason))::text);
  select * into v_prior from d5o_hosted.platform_command_receipts where command_id=p_command_id;
  if found then
    if v_prior.actor_user_id<>v_actor or v_prior.fingerprint<>v_fp then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_prior.result; end if;
  select * into v_workspace from d5o_hosted.workspaces where workspace_key=p_workspace_key for update;
  if not found or not exists(select 1 from d5o_hosted.tenant_provisioning
    where workspace_id=v_workspace.id) then
    raise exception 'capability_tenant_unavailable' using errcode='23514'; end if;
  if p_kind='entitlement' then
    select revision into v_revision from d5o_hosted.capability_entitlements
      where workspace_id=v_workspace.id and capability_key='connected_work' for update;
  else
    select revision into v_revision from d5o_hosted.capability_flags
      where workspace_id=v_workspace.id and capability_key='connected_work' for update;
  end if;
  if coalesce(v_revision,0)<>p_expected_revision then
    raise exception 'stale_capability_revision' using errcode='23505'; end if;
  if p_kind='entitlement' then
    insert into d5o_hosted.capability_entitlements(workspace_id,capability_key,granted,changed_by)
      values(v_workspace.id,'connected_work',p_enabled,v_actor)
      on conflict(workspace_id,capability_key) do update set granted=excluded.granted,
        changed_by=excluded.changed_by,revision=d5o_hosted.capability_entitlements.revision+1,
        updated_at=now();
  else
    insert into d5o_hosted.capability_flags(workspace_id,capability_key,enabled,changed_by)
      values(v_workspace.id,'connected_work',p_enabled,v_actor)
      on conflict(workspace_id,capability_key) do update set enabled=excluded.enabled,
        changed_by=excluded.changed_by,revision=d5o_hosted.capability_flags.revision+1,
        updated_at=now();
  end if;
  v_result:=pg_catalog.jsonb_build_object('workspaceKey',p_workspace_key,
    'capability','connected_work','kind',p_kind,'enabled',p_enabled,
    'revision',p_expected_revision+1,
    'available',d5o_hosted.capability_available_v1(v_workspace.id,'connected_work'));
  insert into d5o_hosted.platform_events(command_id,actor_user_id,workspace_id,
    action,reason,before_state,after_state)
    values(p_command_id,v_actor,v_workspace.id,'capability.'||p_kind,trim(p_reason),
      pg_catalog.jsonb_build_object('revision',p_expected_revision),v_result);
  insert into d5o_hosted.platform_command_receipts(command_id,actor_user_id,fingerprint,result)
    values(p_command_id,v_actor,v_fp,v_result);
  return v_result;
end $$;
revoke all on function public.d5o_platform_capability_command_v1(text,text,boolean,integer,text,text)
  from public,anon,service_role;
grant execute on function public.d5o_platform_capability_command_v1(text,text,boolean,integer,text,text)
  to authenticated;

create function public.d5o_hosted_capability_read_v1(p_workspace_key text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null then
    raise exception 'workspace_forbidden' using errcode='42501'; end if;
  select * into v_workspace from d5o_hosted.workspaces where workspace_key=p_workspace_key;
  if not found or not exists(select 1 from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor and status='active') then
    raise exception 'workspace_forbidden' using errcode='42501'; end if;
  return pg_catalog.jsonb_build_object('connectedWork',
    v_workspace.status='active' and d5o_hosted.capability_available_v1(v_workspace.id,'connected_work'));
end $$;
revoke all on function public.d5o_hosted_capability_read_v1(text) from public,anon,service_role;
grant execute on function public.d5o_hosted_capability_read_v1(text) to authenticated;

-- Vendor directory exposes separate entitlement and flag decisions.
create or replace function public.d5o_platform_provisioning_directory_v1() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null or not exists
    (select 1 from d5o_hosted.platform_administrators where actor_user_id=v_actor and status='active') then
    raise exception 'platform_administrator_required' using errcode='42501'; end if;
  return coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'workspaceId',w.id,'workspaceKey',w.workspace_key,'name',w.display_name,'legalName',w.legal_name,
    'country',p.country,'timeZone',w.time_zone,'currency',w.default_currency,
    'status',coalesce(p.lifecycle,w.status),'revision',p.revision,
    'templateName',t.name,'templateVersion',tv.version_number,
    'templateVersionId',tv.id,'initialAdministrator',p.initial_admin_email,
    'invitationId',p.initial_invitation_id,'invitationStatus',i.status,
    'invitationExpiresAt',i.expires_at,'configurationVersion',v.version_number,
    'configurationVersionId',v.id,'serviceApproval',v.manifest_json->'serviceWorkApproval',
    'connectedWorkEntitlement',(select e.granted from d5o_hosted.capability_entitlements e
      where e.workspace_id=w.id and e.capability_key='connected_work'),
    'connectedWorkEntitlementRevision',coalesce((select e.revision from d5o_hosted.capability_entitlements e
      where e.workspace_id=w.id and e.capability_key='connected_work'),0),
    'connectedWorkFlag',(select f.enabled from d5o_hosted.capability_flags f
      where f.workspace_id=w.id and f.capability_key='connected_work'),
    'connectedWorkFlagRevision',coalesce((select f.revision from d5o_hosted.capability_flags f
      where f.workspace_id=w.id and f.capability_key='connected_work'),0),
    'connectedWorkAvailable',d5o_hosted.capability_available_v1(w.id,'connected_work'),
    'createdAt',w.created_at,'failureCode',p.failure_code,
    'audit',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'action',e.action,'actorUserId',e.actor_user_id,'occurredAt',e.occurred_at,
      'reason',e.reason) order by e.occurred_at desc) from d5o_hosted.platform_events e
      where e.workspace_id=w.id),'[]'::jsonb)) order by w.created_at desc)
    from d5o_hosted.workspaces w
    left join d5o_hosted.tenant_provisioning p on p.workspace_id=w.id
    left join d5o_hosted.configuration_template_versions tv on tv.id=p.template_version_id
    left join d5o_hosted.configuration_templates t on t.id=tv.template_id
    left join d5o_hosted.admin_identity_requests i on i.workspace_id=w.id and i.command_id=p.initial_invitation_id
    left join d5o_hosted.configuration_tenants ct on ct.workspace_id=w.id and ct.status='active'
    left join d5o_hosted.configuration_versions v on v.tenant_id=ct.id and v.status='published'
      and v.effective_from<=now() and (v.effective_to is null or v.effective_to>now())),'[]'::jsonb);
end $$;
revoke all on function public.d5o_platform_provisioning_directory_v1() from public,anon,service_role;
grant execute on function public.d5o_platform_provisioning_directory_v1() to authenticated;
