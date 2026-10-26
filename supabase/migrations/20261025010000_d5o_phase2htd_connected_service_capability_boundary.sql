-- Phase 2H-TD: the customer adapter already gates connected_work, but direct
-- authenticated RPC calls could mutate Operate while its rollout flag was off.
-- Guard the public connected-service command boundary. Existing pilots retain
-- the Phase 2C default; provisioned tenants require an explicit grant and flag.
create function d5o_hosted.require_connected_service_capability_v1(p_workspace_key text)
returns uuid language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null then
    raise exception 'connected_service_forbidden' using errcode='42501';
  end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active' for share;
  if not found or not exists(select 1 from d5o_hosted.memberships m
    where m.workspace_id=v_workspace.id and m.actor_user_id=v_actor
      and m.status='active') then
    raise exception 'connected_service_forbidden' using errcode='42501';
  end if;
  -- Lock current vendor decisions through the protected transition. If a
  -- disable races with this command, one operation finishes before the other.
  perform 1 from d5o_hosted.capability_entitlements e
    where e.workspace_id=v_workspace.id and e.capability_key='connected_work' for share;
  perform 1 from d5o_hosted.capability_flags f
    where f.workspace_id=v_workspace.id and f.capability_key='connected_work' for share;
  if not d5o_hosted.capability_available_v1(v_workspace.id,'connected_work') then
    raise exception 'connected_work_unavailable' using errcode='42501';
  end if;
  return v_workspace.id;
end $$;
revoke all on function d5o_hosted.require_connected_service_capability_v1(text)
  from public,anon,authenticated,service_role;

alter function public.d5o_hosted_operate_command_v1(
  text,text,text,jsonb,text,bigint,integer,integer)
  rename to d5o_hosted_operate_command_pre_capability_v1;
alter function public.d5o_hosted_operate_command_pre_capability_v1(
  text,text,text,jsonb,text,bigint,integer,integer) set schema d5o_hosted;
revoke all on function d5o_hosted.d5o_hosted_operate_command_pre_capability_v1(
  text,text,text,jsonb,text,bigint,integer,integer)
  from public,anon,authenticated,service_role;
create function public.d5o_hosted_operate_command_v1(
  p_workspace_key text,p_presentation_id text,p_action text,p_input jsonb,
  p_command_id text,p_expected_source_revision bigint,
  p_expected_deploy_revision integer,p_expected_operate_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
begin
  perform d5o_hosted.require_connected_service_capability_v1(p_workspace_key);
  return d5o_hosted.d5o_hosted_operate_command_pre_capability_v1(
    p_workspace_key,p_presentation_id,p_action,p_input,p_command_id,
    p_expected_source_revision,p_expected_deploy_revision,p_expected_operate_revision);
end $$;
revoke all on function public.d5o_hosted_operate_command_v1(
  text,text,text,jsonb,text,bigint,integer,integer) from public,anon,service_role;
grant execute on function public.d5o_hosted_operate_command_v1(
  text,text,text,jsonb,text,bigint,integer,integer) to authenticated;

alter function public.d5o_hosted_service_pricing_command_v1(
  text,text,text,text,jsonb,text,bigint,integer)
  rename to d5o_hosted_service_pricing_command_pre_capability_v1;
alter function public.d5o_hosted_service_pricing_command_pre_capability_v1(
  text,text,text,text,jsonb,text,bigint,integer) set schema d5o_hosted;
revoke all on function d5o_hosted.d5o_hosted_service_pricing_command_pre_capability_v1(
  text,text,text,text,jsonb,text,bigint,integer)
  from public,anon,authenticated,service_role;
create function public.d5o_hosted_service_pricing_command_v1(
  p_workspace_key text,p_parent_presentation_id text,p_request_id text,
  p_action text,p_input jsonb,p_command_id text,p_expected_work_revision bigint,
  p_expected_operate_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
begin
  perform d5o_hosted.require_connected_service_capability_v1(p_workspace_key);
  return d5o_hosted.d5o_hosted_service_pricing_command_pre_capability_v1(
    p_workspace_key,p_parent_presentation_id,p_request_id,p_action,p_input,
    p_command_id,p_expected_work_revision,p_expected_operate_revision);
end $$;
revoke all on function public.d5o_hosted_service_pricing_command_v1(
  text,text,text,text,jsonb,text,bigint,integer) from public,anon,service_role;
grant execute on function public.d5o_hosted_service_pricing_command_v1(
  text,text,text,text,jsonb,text,bigint,integer) to authenticated;

alter function public.d5o_hosted_connected_service_approval_command_v1(
  text,text,text,text,text)
  rename to d5o_hosted_connected_service_approval_pre_capability_v1;
alter function public.d5o_hosted_connected_service_approval_pre_capability_v1(
  text,text,text,text,text) set schema d5o_hosted;
revoke all on function d5o_hosted.d5o_hosted_connected_service_approval_pre_capability_v1(
  text,text,text,text,text) from public,anon,authenticated,service_role;
create function public.d5o_hosted_connected_service_approval_command_v1(
  p_workspace_key text,p_parent_presentation_id text,p_request_id text,
  p_action text,p_command_id text
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
begin
  perform d5o_hosted.require_connected_service_capability_v1(p_workspace_key);
  return d5o_hosted.d5o_hosted_connected_service_approval_pre_capability_v1(
    p_workspace_key,p_parent_presentation_id,p_request_id,p_action,p_command_id);
end $$;
revoke all on function public.d5o_hosted_connected_service_approval_command_v1(
  text,text,text,text,text) from public,anon,service_role;
grant execute on function public.d5o_hosted_connected_service_approval_command_v1(
  text,text,text,text,text) to authenticated;

alter function public.d5o_hosted_service_job_command_v1(
  text,text,text,date,text,text,bigint,bigint,integer)
  rename to d5o_hosted_service_job_command_pre_capability_v1;
alter function public.d5o_hosted_service_job_command_pre_capability_v1(
  text,text,text,date,text,text,bigint,bigint,integer) set schema d5o_hosted;
revoke all on function d5o_hosted.d5o_hosted_service_job_command_pre_capability_v1(
  text,text,text,date,text,text,bigint,bigint,integer)
  from public,anon,authenticated,service_role;
create function public.d5o_hosted_service_job_command_v1(
  p_workspace_key text,p_parent_presentation_id text,p_request_id text,
  p_due_date date,p_owner text,p_command_id text,p_expected_work_revision bigint,
  p_expected_catalog_revision bigint,p_expected_operate_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
begin
  perform d5o_hosted.require_connected_service_capability_v1(p_workspace_key);
  return d5o_hosted.d5o_hosted_service_job_command_pre_capability_v1(
    p_workspace_key,p_parent_presentation_id,p_request_id,p_due_date,p_owner,
    p_command_id,p_expected_work_revision,p_expected_catalog_revision,
    p_expected_operate_revision);
end $$;
revoke all on function public.d5o_hosted_service_job_command_v1(
  text,text,text,date,text,text,bigint,bigint,integer) from public,anon,service_role;
grant execute on function public.d5o_hosted_service_job_command_v1(
  text,text,text,date,text,text,bigint,bigint,integer) to authenticated;

-- The trusted server creates the related executable Work through this service
-- role RPC. It must honor the same vendor availability decision before the
-- existing actor, membership, approval and receipt checks run.
alter function public.d5o_hosted_create_related_work_v1(
  text,text,text,text,bigint,bigint,jsonb,jsonb,uuid,uuid)
  rename to d5o_hosted_create_related_work_pre_capability_v1;
alter function public.d5o_hosted_create_related_work_pre_capability_v1(
  text,text,text,text,bigint,bigint,jsonb,jsonb,uuid,uuid) set schema d5o_hosted;
revoke all on function d5o_hosted.d5o_hosted_create_related_work_pre_capability_v1(
  text,text,text,text,bigint,bigint,jsonb,jsonb,uuid,uuid)
  from public,anon,authenticated,service_role;
create function public.d5o_hosted_create_related_work_v1(
  p_workspace_key text,p_command_id text,p_action text,
  p_parent_presentation_id text,p_expected_work_revision bigint,
  p_expected_catalog_revision bigint,p_parent_after jsonb,p_child jsonb,
  p_actor_user_id uuid,p_membership_id uuid
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_workspace uuid;
begin
  if p_action='create-job' then
    if current_setting('role',true)<>'service_role' then
      raise exception 'connected_service_forbidden' using errcode='42501';
    end if;
    select id into v_workspace from d5o_hosted.workspaces
      where workspace_key=p_workspace_key and status='active' for share;
    if v_workspace is null then
      raise exception 'connected_service_forbidden' using errcode='42501';
    end if;
    perform 1 from d5o_hosted.capability_entitlements
      where workspace_id=v_workspace and capability_key='connected_work' for share;
    perform 1 from d5o_hosted.capability_flags
      where workspace_id=v_workspace and capability_key='connected_work' for share;
    if not d5o_hosted.capability_available_v1(v_workspace,'connected_work') then
      raise exception 'connected_work_unavailable' using errcode='42501';
    end if;
  end if;
  return d5o_hosted.d5o_hosted_create_related_work_pre_capability_v1(
    p_workspace_key,p_command_id,p_action,p_parent_presentation_id,
    p_expected_work_revision,p_expected_catalog_revision,p_parent_after,p_child,
    p_actor_user_id,p_membership_id);
end $$;
revoke all on function public.d5o_hosted_create_related_work_v1(
  text,text,text,text,bigint,bigint,jsonb,jsonb,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.d5o_hosted_create_related_work_v1(
  text,text,text,text,bigint,bigint,jsonb,jsonb,uuid,uuid) to service_role;
