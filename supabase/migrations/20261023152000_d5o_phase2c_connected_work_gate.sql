-- Keep the existing connected command as the sole writer. This wrapper checks
-- the active tenant gates and the selected published manifest in the same
-- transaction before the preserved business implementation runs.
alter function public.d5o_hosted_create_connected_work_v1(
  text,text,bigint,bigint,uuid,text,text,text,text,text,uuid,uuid,jsonb)
  rename to d5o_hosted_create_connected_work_core_v1;
revoke all on function public.d5o_hosted_create_connected_work_core_v1(
  text,text,bigint,bigint,uuid,text,text,text,text,text,uuid,uuid,jsonb)
  from public,anon,authenticated,service_role;

create function public.d5o_hosted_create_connected_work_v1(
  p_workspace_key text,p_command_id text,p_expected_work_revision bigint,
  p_expected_catalog_revision bigint,p_configuration_version_id uuid,
  p_work_type_key text,p_title text,p_customer text,p_site text,
  p_owner text,p_actor_user_id uuid,p_membership_id uuid,
  p_initial_discovery jsonb
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_workspace d5o_hosted.workspaces%rowtype;
  v_version d5o_hosted.configuration_versions%rowtype;
  v_retry boolean;
begin
  if current_setting('role',true) is distinct from 'service_role'
    or p_actor_user_id is null or p_membership_id is null then
    raise exception 'server_command_required' using errcode='42501'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active' for share;
  if not found or exists(select 1 from d5o_hosted.tenant_provisioning p
      where p.workspace_id=v_workspace.id and p.lifecycle<>'active') then
    raise exception 'tenant_not_active' using errcode='42501'; end if;
  if not d5o_hosted.capability_available_v1(v_workspace.id,'connected_work') then
    raise exception 'capability_unavailable' using errcode='42501'; end if;
  select exists(select 1 from d5o_hosted.connected_create_receipts
    where workspace_id=v_workspace.id and command_id=p_command_id) into v_retry;
  select v.* into v_version from d5o_hosted.configuration_versions v
    join d5o_hosted.configuration_tenants t on t.id=v.tenant_id
    where v.id=p_configuration_version_id and t.workspace_id=v_workspace.id
      and (v.status='published' or (v_retry and v.status='superseded'));
  if not found then raise exception 'configuration_unavailable' using errcode='42501'; end if;
  if coalesce((v_version.manifest_json#>>'{discoverIntake,requireInitialDiscovery}')::boolean,false)
    and p_initial_discovery is null then
    raise exception 'discover_intake_required' using errcode='23514'; end if;
  return public.d5o_hosted_create_connected_work_core_v1(
    p_workspace_key,p_command_id,p_expected_work_revision,p_expected_catalog_revision,
    p_configuration_version_id,p_work_type_key,p_title,p_customer,p_site,
    p_owner,p_actor_user_id,p_membership_id,p_initial_discovery);
end $$;
revoke all on function public.d5o_hosted_create_connected_work_v1(
  text,text,bigint,bigint,uuid,text,text,text,text,text,uuid,uuid,jsonb)
  from public,anon,authenticated;
grant execute on function public.d5o_hosted_create_connected_work_v1(
  text,text,bigint,bigint,uuid,text,text,text,text,text,uuid,uuid,jsonb)
  to service_role;
