-- Require an independently reviewed, exact support document before accepting
-- support when the Work's pinned tenant policy enables documentation review.
-- The existing Operate command remains the writer and retains its receipts.
alter function public.d5o_hosted_operate_command_v1(
  text,text,text,jsonb,text,bigint,integer,integer)
  rename to d5o_hosted_operate_command_phase2f_prior_v1;
alter function public.d5o_hosted_operate_command_phase2f_prior_v1(
  text,text,text,jsonb,text,bigint,integer,integer) set schema d5o_hosted;
revoke all on function d5o_hosted.d5o_hosted_operate_command_phase2f_prior_v1(
  text,text,text,jsonb,text,bigint,integer,integer)
  from public,anon,authenticated,service_role;

create function public.d5o_hosted_operate_command_v1(
  p_workspace_key text,p_presentation_id text,p_action text,p_input jsonb,
  p_command_id text,p_expected_source_revision bigint,
  p_expected_deploy_revision integer,p_expected_operate_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace uuid;v_work d5o_hosted.work_records%rowtype;
  v_operate d5o_hosted.connected_operate_states%rowtype;
  v_deploy d5o_hosted.connected_deploy_states%rowtype;
  v_required boolean;v_turnover jsonb;v_basis jsonb;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null then
    raise exception 'operate_membership_required' using errcode='42501';
  end if;
  if p_action='accept-support' then
    select w.id into v_workspace from d5o_hosted.workspaces w
      join d5o_hosted.memberships m on m.workspace_id=w.id
      where w.workspace_key=p_workspace_key and w.status='active'
        and m.actor_user_id=v_actor and m.status='active'
        and m.role='operations_leader';
    if v_workspace is null then
      raise exception 'support_acceptance_authority_required' using errcode='42501';
    end if;
    select wr.* into v_work from d5o_hosted.work_records wr
      join d5o_hosted.work_identity_links l on l.workspace_id=wr.workspace_id
        and l.work_id=wr.id
      where wr.workspace_id=v_workspace and l.presentation_id=p_presentation_id
      for update of wr;
    if not found then raise exception 'connected_work_unavailable' using errcode='42501'; end if;
    -- A matching replay belongs to the existing receipt ledger and must keep
    -- the original result. The inner command validates actor and fingerprint.
    if not exists(select 1 from d5o_hosted.connected_operate_receipts
      where workspace_id=v_workspace and command_id=p_command_id) then
      select (wt#>>'{operateControls,requireDocumentationReview}')::boolean
        into v_required from d5o_hosted.configuration_versions c,
          lateral pg_catalog.jsonb_array_elements(
            c.manifest_json#>'{d5oPresentation,phaseContract,workTypes}') wt
        where c.id=v_work.configuration_version_id
          and wt->>'workTypeKey'=v_work.work_type_key;
      if not found then
        raise exception 'pinned_operate_policy_unavailable' using errcode='23514';
      end if;
      -- The field was introduced after earlier published versions. An absent
      -- optional field preserves their original acceptance contract.
      if coalesce(v_required,false) then
        select * into v_deploy from d5o_hosted.connected_deploy_states
          where workspace_id=v_workspace and work_id=v_work.id for share;
        select * into v_operate from d5o_hosted.connected_operate_states
          where workspace_id=v_workspace and work_id=v_work.id for update;
        if v_operate.decision_revision is distinct from p_expected_operate_revision
          or v_deploy.decision_revision is distinct from p_expected_deploy_revision then
          raise exception 'stale_operate_basis' using errcode='23505';
        end if;
        if v_deploy.state#>>'{workAcceptance,receipt}'<>'Accepted'
          or v_operate.state->'source' is null then
          raise exception 'exact_received_turnover_required' using errcode='23514';
        end if;
        for v_turnover in select value from pg_catalog.jsonb_array_elements(
          coalesce(v_deploy.state->'turnovers','[]'::jsonb)) loop
          if v_turnover->>'status'<>'Client accepted'
            or v_turnover->>'receipt'<>'Accepted' then
            raise exception 'support_document_review_required' using errcode='23514';
          end if;
          v_basis:=d5o_hosted.support_document_basis_v1(
            v_workspace,v_work.id,v_turnover->>'id','as-built');
          if v_basis is null or not exists(
            select 1 from pg_catalog.jsonb_array_elements(
              coalesce(v_operate.state->'documentationObligations','[]'::jsonb)) d
            where d->>'turnoverId'=v_turnover->>'id'
              and d->>'kind'='as-built' and d->>'status'='Reviewed'
              and d->'basis'=v_basis
          ) then raise exception 'support_document_review_required' using errcode='23514'; end if;
        end loop;
      end if;
    end if;
  end if;
  return d5o_hosted.d5o_hosted_operate_command_phase2f_prior_v1(
    p_workspace_key,p_presentation_id,p_action,p_input,p_command_id,
    p_expected_source_revision,p_expected_deploy_revision,p_expected_operate_revision);
end; $$;
revoke all on function public.d5o_hosted_operate_command_v1(
  text,text,text,jsonb,text,bigint,integer,integer)
  from public,anon,service_role;
grant execute on function public.d5o_hosted_operate_command_v1(
  text,text,text,jsonb,text,bigint,integer,integer) to authenticated;
