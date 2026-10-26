-- Existing authenticated recipients accept only their own initial-admin offer.
-- The ordinary Phase 2A invitation command still forbids admin assignment.
create function public.d5o_platform_initial_admin_accept_v1(p_workspace_key text,p_invitation_id text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
  v_provision d5o_hosted.tenant_provisioning%rowtype;
  v_offer d5o_hosted.admin_identity_requests%rowtype;v_email text;v_confirmed timestamptz;
  v_member d5o_hosted.memberships%rowtype;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null then
    raise exception 'invitation_accept_denied' using errcode='42501'; end if;
  select * into v_workspace from d5o_hosted.workspaces where workspace_key=p_workspace_key;
  select * into v_provision from d5o_hosted.tenant_provisioning
    where workspace_id=v_workspace.id for update;
  select * into v_offer from d5o_hosted.admin_identity_requests
    where workspace_id=v_workspace.id and command_id=p_invitation_id
      and provisioning_workspace_id=v_workspace.id and requested_role='admin' for update;
  select lower(email),email_confirmed_at into v_email,v_confirmed from auth.users where id=v_actor;
  if v_offer.command_id is null or v_provision.initial_invitation_id is distinct from p_invitation_id
    or v_provision.initial_admin_email is distinct from v_email or v_confirmed is null
    or v_offer.provider_user_id is distinct from v_actor then
    raise exception 'invitation_accept_denied' using errcode='42501'; end if;
  if v_offer.status='accepted' then
    return pg_catalog.jsonb_build_object('status','accepted','replay',true,'workspaceKey',p_workspace_key); end if;
  if v_offer.status='revoked' or v_offer.expires_at<=now() then
    raise exception 'invitation_expired' using errcode='23514'; end if;
  if v_offer.status not in ('existing_confirmed','provider_accepted') or
    v_provision.lifecycle not in ('awaiting_admin','failed') then
    raise exception 'invitation_not_ready' using errcode='23514'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'd5o-member:'||v_workspace.id::text||':'||v_actor::text,0));
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor for update;
  if found then
    if v_member.status<>'active' or v_member.role<>'admin' then
      raise exception 'membership_conflict' using errcode='23505'; end if;
  else
    insert into d5o_hosted.memberships(workspace_id,actor_user_id,role,status)
      values(v_workspace.id,v_actor,'admin','active');
  end if;
  update d5o_hosted.admin_identity_requests set status='accepted',accepted_at=now()
    where workspace_id=v_workspace.id and command_id=p_invitation_id;
  update d5o_hosted.tenant_provisioning set lifecycle='setup_required',revision=revision+1,
    failure_code=null,updated_at=now() where workspace_id=v_workspace.id;
  insert into d5o_hosted.platform_events(command_id,actor_user_id,workspace_id,template_version_id,
    action,reason,after_state) values('accept:'||p_invitation_id,v_actor,v_workspace.id,
    v_provision.template_version_id,'tenant.initial_admin_accept','Recipient accepted initial administrator offer',
    pg_catalog.jsonb_build_object('email',v_email,'role','admin'));
  return pg_catalog.jsonb_build_object('status','accepted','replay',false,'workspaceKey',p_workspace_key);
end $$;
revoke all on function public.d5o_platform_initial_admin_accept_v1(text,text) from public,anon,service_role;
grant execute on function public.d5o_platform_initial_admin_accept_v1(text,text) to authenticated;

create function public.d5o_platform_invitation_finish_v1(
  p_workspace_key text,p_invitation_id text,p_vendor_user_id uuid,
  p_status text,p_provider_user_id uuid
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_workspace uuid;v_offer d5o_hosted.admin_identity_requests%rowtype;
begin
  if current_setting('role',true)<>'service_role' or p_status not in
    ('provider_accepted','provider_rejected','uncertain') or not exists
    (select 1 from d5o_hosted.platform_administrators where actor_user_id=p_vendor_user_id and status='active') then
    raise exception 'platform_administrator_required' using errcode='42501'; end if;
  select id into v_workspace from d5o_hosted.workspaces where workspace_key=p_workspace_key;
  select * into v_offer from d5o_hosted.admin_identity_requests
    where workspace_id=v_workspace and command_id=p_invitation_id
      and provisioning_workspace_id=v_workspace and actor_user_id=p_vendor_user_id for update;
  if v_offer.command_id is null then raise exception 'invitation_missing' using errcode='23503'; end if;
  if v_offer.status<>'pending' then
    if v_offer.status<>p_status or v_offer.provider_user_id is distinct from p_provider_user_id then
      raise exception 'invitation_result_conflict' using errcode='23505'; end if;
    return pg_catalog.jsonb_build_object('status',p_status,'replay',true); end if;
  update d5o_hosted.admin_identity_requests set status=p_status,provider_user_id=p_provider_user_id,
    resolved_at=now(),provider_message='Provider outcome; mailbox delivery unverified'
    where workspace_id=v_workspace and command_id=p_invitation_id;
  if p_status<>'provider_accepted' then
    update d5o_hosted.tenant_provisioning set lifecycle='failed',failure_code='invitation_delivery',
      revision=revision+1,updated_at=now() where workspace_id=v_workspace;
  end if;
  insert into d5o_hosted.platform_events(command_id,actor_user_id,workspace_id,
    action,reason,after_state) values('delivery:'||p_invitation_id,p_vendor_user_id,v_workspace,
    'tenant.invitation_delivery','Provider dispatch outcome',
    pg_catalog.jsonb_build_object('status',p_status));
  return pg_catalog.jsonb_build_object('status',p_status,'replay',false);
end $$;
revoke all on function public.d5o_platform_invitation_finish_v1(text,text,uuid,text,uuid)
  from public,anon,authenticated;
grant execute on function public.d5o_platform_invitation_finish_v1(text,text,uuid,text,uuid)
  to service_role;

-- Customer-visible readiness uses the same hosted organization and config rows.
create function public.d5o_hosted_onboarding_read_v1(p_workspace_key text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
  v_provision d5o_hosted.tenant_provisioning%rowtype;v_config d5o_hosted.configuration_versions%rowtype;
  v_admin boolean;v_profile boolean;v_policy boolean;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null then
    raise exception 'admin_membership_required' using errcode='42501'; end if;
  select w.* into v_workspace from d5o_hosted.workspaces w join d5o_hosted.memberships m
    on m.workspace_id=w.id and m.actor_user_id=v_actor and m.role='admin' and m.status='active'
    where w.workspace_key=p_workspace_key and w.status='active';
  if not found then raise exception 'admin_membership_required' using errcode='42501'; end if;
  select * into v_provision from d5o_hosted.tenant_provisioning where workspace_id=v_workspace.id;
  if not found then raise exception 'onboarding_unavailable' using errcode='23503'; end if;
  select v.* into v_config from d5o_hosted.configuration_versions v
    join d5o_hosted.configuration_tenants t on t.id=v.tenant_id
    where t.workspace_id=v_workspace.id and v.status='published'
      and v.effective_from<=now() and (v.effective_to is null or v.effective_to>now());
  v_admin:=exists(select 1 from d5o_hosted.memberships where workspace_id=v_workspace.id
    and actor_user_id=v_actor and role='admin' and status='active');
  v_profile:=length(trim(coalesce(v_workspace.legal_name,'')))>=2 and
    length(trim(coalesce(v_workspace.display_name,'')))>=2 and
    v_workspace.primary_contact_email is not null;
  v_policy:=v_config.id is not null and
    v_config.manifest_json#>>'{serviceWorkApproval,currency}'=v_workspace.default_currency and
    v_config.manifest_json#>>'{serviceWorkApproval,comparison}'='greater_than' and
    v_config.manifest_json#>>'{serviceWorkApproval,unavailableBehavior}'='block' and
    (v_config.manifest_json#>>'{serviceWorkApproval,thresholdMinor}') ~ '^[0-9]{1,12}$';
  return pg_catalog.jsonb_build_object('workspaceKey',p_workspace_key,
    'displayName',v_workspace.display_name,'lifecycle',v_provision.lifecycle,
    'revision',v_provision.revision,'configurationVersion',v_config.version_number,
    'required',pg_catalog.jsonb_build_object('organizationProfile',v_profile,
      'initialAdministrator',v_admin,'publishedConfiguration',v_config.id is not null,
      'serviceApprovalPolicy',v_policy),
    'recommended',pg_catalog.jsonb_build_object(
      'businessUnits',(select count(*) from d5o_hosted.org_units where workspace_id=v_workspace.id and status='active'),
      'locations',(select count(*) from d5o_hosted.org_locations where workspace_id=v_workspace.id and status='active'),
      'teams',(select count(*) from d5o_hosted.org_teams where workspace_id=v_workspace.id and status='active')),
    'optional',pg_catalog.jsonb_build_object('additionalMembers',
      (select count(*) from d5o_hosted.memberships where workspace_id=v_workspace.id and status='active' and actor_user_id<>v_actor)),
    'ready',v_admin and v_profile and v_policy and v_provision.failure_code is null);
end $$;
revoke all on function public.d5o_hosted_onboarding_read_v1(text) from public,anon,service_role;
grant execute on function public.d5o_hosted_onboarding_read_v1(text) to authenticated;

create function public.d5o_hosted_onboarding_ready_v1(
  p_workspace_key text,p_expected_revision integer,p_command_id text,p_reason text
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace uuid;v_provision d5o_hosted.tenant_provisioning%rowtype;
  v_read jsonb;v_fp text;v_prior d5o_hosted.platform_command_receipts%rowtype;v_result jsonb;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null or
    length(coalesce(p_command_id,'')) not between 8 and 120 or
    length(trim(coalesce(p_reason,''))) not between 8 and 500 then
    raise exception 'onboarding_denied' using errcode='42501'; end if;
  select w.id into v_workspace from d5o_hosted.workspaces w join d5o_hosted.memberships m
    on m.workspace_id=w.id where w.workspace_key=p_workspace_key and m.actor_user_id=v_actor
      and m.role='admin' and m.status='active';
  if v_workspace is null then raise exception 'admin_membership_required' using errcode='42501'; end if;
  select * into v_provision from d5o_hosted.tenant_provisioning where workspace_id=v_workspace for update;
  v_fp:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_workspace_key,p_expected_revision,trim(p_reason))::text);
  select * into v_prior from d5o_hosted.platform_command_receipts where command_id=p_command_id;
  if found then
    if v_prior.actor_user_id<>v_actor or v_prior.fingerprint<>v_fp then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_prior.result; end if;
  if v_provision.lifecycle<>'setup_required' or v_provision.revision<>p_expected_revision then
    raise exception 'stale_onboarding' using errcode='23505'; end if;
  v_read:=public.d5o_hosted_onboarding_read_v1(p_workspace_key);
  if v_read->>'ready'<>'true' then raise exception 'onboarding_incomplete' using errcode='23514'; end if;
  update d5o_hosted.tenant_provisioning set lifecycle='ready',revision=revision+1,
    updated_at=now() where workspace_id=v_workspace;
  v_result:=pg_catalog.jsonb_build_object('lifecycle','ready','revision',p_expected_revision+1);
  insert into d5o_hosted.platform_events(command_id,actor_user_id,workspace_id,
    action,reason,after_state) values(p_command_id,v_actor,v_workspace,'tenant.ready',trim(p_reason),v_result);
  insert into d5o_hosted.platform_command_receipts(command_id,actor_user_id,fingerprint,result)
    values(p_command_id,v_actor,v_fp,v_result);
  return v_result;
end $$;
revoke all on function public.d5o_hosted_onboarding_ready_v1(text,integer,text,text)
  from public,anon,service_role;
grant execute on function public.d5o_hosted_onboarding_ready_v1(text,integer,text,text) to authenticated;

create function public.d5o_platform_activate_v1(
  p_workspace_key text,p_expected_revision integer,p_command_id text,p_reason text
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace uuid;v_provision d5o_hosted.tenant_provisioning%rowtype;
  v_fp text;v_prior d5o_hosted.platform_command_receipts%rowtype;v_result jsonb;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null or not exists
    (select 1 from d5o_hosted.platform_administrators where actor_user_id=v_actor and status='active') then
    raise exception 'platform_administrator_required' using errcode='42501'; end if;
  if length(coalesce(p_command_id,'')) not between 8 and 120 or
    length(trim(coalesce(p_reason,''))) not between 8 and 500 then
    raise exception 'invalid_activation' using errcode='22023'; end if;
  v_fp:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_workspace_key,p_expected_revision,trim(p_reason))::text);
  select * into v_prior from d5o_hosted.platform_command_receipts where command_id=p_command_id;
  if found then
    if v_prior.actor_user_id<>v_actor or v_prior.fingerprint<>v_fp then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_prior.result; end if;
  select id into v_workspace from d5o_hosted.workspaces where workspace_key=p_workspace_key;
  select * into v_provision from d5o_hosted.tenant_provisioning where workspace_id=v_workspace for update;
  if v_provision.lifecycle<>'ready' or v_provision.revision<>p_expected_revision or
    v_provision.failure_code is not null or not exists
      (select 1 from d5o_hosted.workspaces w where w.id=v_workspace and w.status='active'
        and length(trim(coalesce(w.legal_name,'')))>=2
        and length(trim(coalesce(w.display_name,'')))>=2
        and w.primary_contact_email is not null) or not exists
      (select 1 from d5o_hosted.memberships m join auth.users u on u.id=m.actor_user_id
        where m.workspace_id=v_workspace and m.role='admin' and m.status='active'
          and lower(u.email)=v_provision.initial_admin_email) or not exists
      (select 1 from d5o_hosted.configuration_versions v join d5o_hosted.configuration_tenants t
        on t.id=v.tenant_id where t.workspace_id=v_workspace and v.status='published'
          and v.effective_from<=now() and (v.effective_to is null or v.effective_to>now())
          and v.manifest_json#>>'{serviceWorkApproval,currency}'=
            (select default_currency from d5o_hosted.workspaces where id=v_workspace)
          and v.manifest_json#>>'{serviceWorkApproval,comparison}'='greater_than'
          and v.manifest_json#>>'{serviceWorkApproval,unavailableBehavior}'='block'
          and (v.manifest_json#>>'{serviceWorkApproval,thresholdMinor}') ~ '^[0-9]{1,12}$') then
    raise exception 'activation_not_ready' using errcode='23514'; end if;
  update d5o_hosted.tenant_provisioning set lifecycle='active',revision=revision+1,
    activated_at=now(),updated_at=now() where workspace_id=v_workspace;
  v_result:=pg_catalog.jsonb_build_object('workspaceKey',p_workspace_key,'lifecycle','active',
    'revision',p_expected_revision+1);
  insert into d5o_hosted.platform_events(command_id,actor_user_id,workspace_id,
    action,reason,after_state) values(p_command_id,v_actor,v_workspace,'tenant.activate',trim(p_reason),v_result);
  insert into d5o_hosted.platform_command_receipts(command_id,actor_user_id,fingerprint,result)
    values(p_command_id,v_actor,v_fp,v_result);
  return v_result;
end $$;
revoke all on function public.d5o_platform_activate_v1(text,integer,text,text)
  from public,anon,service_role;
grant execute on function public.d5o_platform_activate_v1(text,integer,text,text) to authenticated;
