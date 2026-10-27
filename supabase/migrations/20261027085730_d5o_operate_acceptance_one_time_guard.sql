-- One accepted support responsibility per connected Work. Keep the prior
-- command's receipt validation so an exact command replay remains idempotent.
alter function public.d5o_hosted_operate_command_v1(
  text,text,text,jsonb,text,bigint,integer,integer)
  rename to d5o_hosted_operate_command_phase2hvc_prior_v1;
alter function public.d5o_hosted_operate_command_phase2hvc_prior_v1(
  text,text,text,jsonb,text,bigint,integer,integer) set schema d5o_hosted;
revoke all on function d5o_hosted.d5o_hosted_operate_command_phase2hvc_prior_v1(
  text,text,text,jsonb,text,bigint,integer,integer)
  from public,anon,authenticated,service_role;

create function public.d5o_hosted_operate_command_v1(
  p_workspace_key text,p_presentation_id text,p_action text,p_input jsonb,
  p_command_id text,p_expected_source_revision bigint,
  p_expected_deploy_revision integer,p_expected_operate_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace uuid;v_work uuid;v_state jsonb;
  v_source_revision bigint;v_deploy_revision integer;v_operate_revision integer;
begin
  -- Preserve the existing public capability boundary before the one-time
  -- support guard, including its 42501 denial when rollout is disabled.
  perform d5o_hosted.require_connected_service_capability_v1(p_workspace_key);
  if p_action='accept-support' then
    if current_setting('role',true)<>'authenticated' or v_actor is null then
      raise exception 'support_acceptance_authority_required' using errcode='42501';
    end if;
    select w.id into v_workspace from d5o_hosted.workspaces w
      join d5o_hosted.memberships m on m.workspace_id=w.id
      where w.workspace_key=p_workspace_key and w.status='active'
        and m.actor_user_id=v_actor and m.status='active'
        and m.role='operations_leader';
    if v_workspace is null then
      raise exception 'support_acceptance_authority_required' using errcode='42501';
    end if;
    select wr.id into v_work from d5o_hosted.work_records wr
      join d5o_hosted.work_identity_links l on l.workspace_id=wr.workspace_id
        and l.work_id=wr.id
      where wr.workspace_id=v_workspace and l.presentation_id=p_presentation_id
      for update of wr;
    if v_work is null then
      raise exception 'connected_work_unavailable' using errcode='42501';
    end if;
    -- The underlying command checks the actor and fingerprint of an existing
    -- receipt. Only a genuinely new command is subject to the one-time guard.
    if not exists(select 1 from d5o_hosted.connected_operate_receipts
      where workspace_id=v_workspace and command_id=p_command_id) then
      select revision into v_source_revision from d5o_hosted.prototype_states
        where workspace_id=v_workspace and state_key='work' for share;
      select decision_revision into v_deploy_revision from d5o_hosted.connected_deploy_states
        where workspace_id=v_workspace and work_id=v_work for share;
      select state,decision_revision into v_state,v_operate_revision
        from d5o_hosted.connected_operate_states
        where workspace_id=v_workspace and work_id=v_work for update;
      if v_state->'support' is not null then
        if v_source_revision is distinct from p_expected_source_revision
          or v_deploy_revision is distinct from p_expected_deploy_revision
          or v_operate_revision is distinct from p_expected_operate_revision then
          raise exception 'stale_operate_basis' using errcode='23505';
        end if;
        raise exception 'support_already_accepted' using errcode='23514';
      end if;
    end if;
  end if;
  return d5o_hosted.d5o_hosted_operate_command_phase2hvc_prior_v1(
    p_workspace_key,p_presentation_id,p_action,p_input,p_command_id,
    p_expected_source_revision,p_expected_deploy_revision,p_expected_operate_revision);
end; $$;
revoke all on function public.d5o_hosted_operate_command_v1(
  text,text,text,jsonb,text,bigint,integer,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.d5o_hosted_operate_command_v1(
  text,text,text,jsonb,text,bigint,integer,integer) to authenticated;
