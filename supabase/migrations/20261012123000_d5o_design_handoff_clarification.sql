-- Returned Design handoffs may resubmit an explicit clarification against the unchanged awarded source.
-- Material source changes still require their own governed revision and all receipt checks remain.
create or replace function public.d5o_hosted_design_handoff_command_v1(
  p_workspace_key text,p_presentation_id text,p_action text,p_due_date text,
  p_reason text,p_command_id text,p_expected_source_revision bigint,
  p_expected_decision_revision integer,p_offer_revision integer,
  p_handoff_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
  v_member d5o_hosted.memberships%rowtype;v_work d5o_hosted.work_records%rowtype;
  v_state d5o_hosted.prototype_states%rowtype;
  v_estimate d5o_hosted.connected_estimate_states%rowtype;
  v_offer d5o_hosted.connected_offer_states%rowtype;
  v_handoff d5o_hosted.connected_design_handoffs%rowtype;
  v_receipt d5o_hosted.connected_design_handoff_receipts%rowtype;
  v_fingerprint text;v_source_digest text;v_record jsonb;v_selected jsonb;
  v_brief jsonb;v_next jsonb;v_result jsonb;v_now timestamptz:=now();
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or p_action not in ('submit-design-handoff','accept-design-handoff','return-design-handoff')
    or length(coalesce(p_command_id,'')) not between 8 and 120
    or p_expected_source_revision is null or p_expected_source_revision<1
    or p_expected_decision_revision is null or p_expected_decision_revision<0
    or p_offer_revision is null or p_offer_revision<1
    or p_handoff_revision is null or p_handoff_revision<1 then
    raise exception 'invalid_handoff_command' using errcode='22023'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor and status='active' for share;
  if not found or v_member.role not in ('admin','project_manager','operations_leader') then
    raise exception 'handoff_role_denied' using errcode='42501'; end if;
  select w.* into v_work from d5o_hosted.work_records w
    join d5o_hosted.work_identity_links l on l.work_id=w.id and l.workspace_id=w.workspace_id
    where w.workspace_id=v_workspace.id and l.presentation_id=p_presentation_id
    for update of w;
  if not found then raise exception 'connected_work_unavailable' using errcode='42501'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_workspace_key,
    p_presentation_id,p_action,p_due_date,trim(coalesce(p_reason,'')),
    p_expected_source_revision,p_expected_decision_revision,p_offer_revision,
    p_handoff_revision)::text);
  select * into v_receipt from d5o_hosted.connected_design_handoff_receipts
    where workspace_id=v_workspace.id and command_id=p_command_id;
  if found then
    if v_receipt.work_id<>v_work.id or v_receipt.actor_user_id<>v_actor
      or v_receipt.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_receipt.result;
  end if;
  select * into v_state from d5o_hosted.prototype_states
    where workspace_id=v_workspace.id and state_key='work' for share;
  select * into v_estimate from d5o_hosted.connected_estimate_states
    where workspace_id=v_workspace.id and work_id=v_work.id for share;
  select * into v_offer from d5o_hosted.connected_offer_states
    where workspace_id=v_workspace.id and work_id=v_work.id for share;
  select * into v_handoff from d5o_hosted.connected_design_handoffs
    where workspace_id=v_workspace.id and work_id=v_work.id for update;
  if v_state.revision is distinct from p_expected_source_revision
    or coalesce(v_handoff.decision_revision,0)<>p_expected_decision_revision
    or v_offer.offer_revision is distinct from p_offer_revision then
    raise exception 'stale_state' using errcode='23505'; end if;
  select item into v_record from pg_catalog.jsonb_array_elements(
    d5o_hosted.connected_customer_projection_v1(v_workspace.id,v_state.state_json)->'records') item
    where item->>'id'=p_presentation_id and item->>'canonicalWorkId'=v_work.id::text;
  if v_record is null or v_record->>'phaseConfigurationVersionId' is distinct from
      v_work.configuration_version_id::text
    or v_record#>>'{definition,status}' is distinct from 'Approved'
    or v_record#>>'{definition,developHandoff,status}' is distinct from 'accepted'
    or v_record#>>'{definition,developHandoff,revision}' is distinct from
      v_record#>>'{definition,revision}'
    or v_record#>>'{develop,review,status}' is distinct from 'Approved'
    or v_record#>>'{develop,review,revision}' is distinct from
      v_record#>>'{develop,revision}'
    or v_estimate.status is distinct from 'Approved'
    or v_offer.status is distinct from 'Submitted'
    or v_offer.estimate_revision<>v_estimate.estimate_revision
    or v_offer.proposal#>>'{submission,revision}' is distinct from p_offer_revision::text
    or v_offer.proposal#>'{submission,packageSnapshot}' is distinct from
      v_offer.proposal->'package'
    or v_offer.proposal->'responseEvents'->-1->>'status' is distinct from 'Awarded'
    or length(trim(coalesce(v_offer.proposal->'responseEvents'->-1->>'sourceReference','')))<5 then
    raise exception 'exact_awarded_basis_required' using errcode='23514'; end if;
  v_source_digest:=pg_catalog.md5(pg_catalog.jsonb_build_array(
    v_record->'definition',v_record->'develop',v_estimate.estimate,
    v_offer.proposal->'package',v_offer.proposal->'submission',
    v_offer.proposal->'responseEvents'->-1)::text);
  if p_action='submit-design-handoff' then
    if v_member.role not in ('admin','project_manager')
      or v_handoff.status in ('submitted','accepted')
      or p_handoff_revision<>coalesce(v_handoff.revision,0)+1
      or v_handoff.status='returned' and length(trim(coalesce(p_reason,''))) not between 20 and 2000
      or p_due_date is null or p_due_date !~ '^\d{4}-\d{2}-\d{2}$'
      or pg_catalog.to_char(p_due_date::date,'YYYY-MM-DD')<>p_due_date then
      raise exception 'handoff_submission_denied' using errcode='23514'; end if;
    select value into v_selected from pg_catalog.jsonb_array_elements(
      coalesce(v_record#>'{develop,options}','[]'::jsonb)) value
      where value->>'id'=v_record#>>'{develop,selectedOptionId}';
    if v_selected is null or v_selected->>'status'<>'Viable' then
      raise exception 'selected_solution_unavailable' using errcode='23514'; end if;
    v_brief:=pg_catalog.jsonb_build_object(
      'offerRevision',v_offer.offer_revision,
      'estimateRevision',v_estimate.estimate_revision,
      'definitionRevision',(v_record#>>'{definition,revision}')::integer,
      'configurationVersionId',v_work.configuration_version_id,
      'customerOutcome',v_record#>>'{definition,outcome}',
      'acceptance',v_record#>>'{definition,acceptance}',
      'offerScope',v_offer.proposal#>>'{package,scope}',
      'excludedScope',v_record#>>'{definition,excludedScope}',
      'deliveryApproach',v_record#>>'{definition,deliveryApproach}',
      'dependencies',v_record#>>'{definition,dependencies}',
      'risks',v_record#>>'{definition,risks}',
      'commercialTerms',v_offer.proposal#>>'{package,commercialTerms}',
      'awardBasis',v_offer.proposal->'responseEvents'->-1->>'details',
      'awardSourceReference',v_offer.proposal->'responseEvents'->-1->>'sourceReference',
      'develop',pg_catalog.jsonb_build_object(
        'solutionRevision',(v_record#>>'{develop,revision}')::integer,
        'selectedOption',v_record#>>'{develop,selectedOptionId}',
        'selectedOptionSnapshot',v_selected,
        'selectionRationale',v_record#>>'{develop,selectionRationale}',
        'policyId',v_estimate.estimate#>>'{detailed,evaluation,policyId}',
        'policyVersion',v_estimate.estimate#>'{detailed,evaluation,policyVersion}',
        'currency',v_estimate.estimate#>>'{detailed,input,currency}',
        'laborStrategy',v_record#>>'{develop,laborStrategy}',
        'procurementStrategy',v_record#>>'{develop,procurementStrategy}',
        'scheduleStrategy',v_record#>>'{develop,scheduleStrategy}',
        'safetyStrategy',v_record#>>'{develop,safetyStrategy}',
        'qualityStrategy',v_record#>>'{develop,qualityStrategy}',
        'riskMitigation',v_record#>>'{develop,riskMitigation}',
        'estimateSnapshot',v_estimate.estimate->'detailed',
        'offerSnapshot',v_offer.proposal->'package'));
    if v_handoff.status='returned' then
      v_brief:=v_brief||pg_catalog.jsonb_build_object(
        'correctionNote',trim(p_reason),
        'priorReturnReason',v_handoff.handoff->>'decisionNote',
        'priorReturnRevision',v_handoff.revision);
    end if;
    if length(trim(coalesce(v_brief->>'customerOutcome','')))=0
      or length(trim(coalesce(v_brief->>'acceptance','')))=0
      or length(trim(coalesce(v_brief->>'offerScope','')))=0
      or length(trim(coalesce(v_brief->>'deliveryApproach','')))=0 then
      raise exception 'handoff_brief_incomplete' using errcode='23514'; end if;
    v_next:=pg_catalog.jsonb_build_object('revision',p_handoff_revision,
      'status','submitted','brief',v_brief,'responseDueDate',p_due_date,
      'submittedAt',v_now,'submittedBy',v_record->>'owner',
      'submittedByActorId',v_actor,'submittedByMembershipId',v_member.id,
      'authorityRevision',coalesce(v_handoff.decision_revision,0)+1);
    if v_handoff.work_id is null then
      insert into d5o_hosted.connected_design_handoffs(workspace_id,work_id,
        revision,decision_revision,status,source_digest,handoff,submitted_by)
      values(v_workspace.id,v_work.id,p_handoff_revision,1,'submitted',
        v_source_digest,v_next,v_actor);
    else
      update d5o_hosted.connected_design_handoffs set
        revision=p_handoff_revision,decision_revision=decision_revision+1,
        status='submitted',source_digest=v_source_digest,handoff=v_next,
        submitted_by=v_actor,received_by=null,updated_at=v_now
        where workspace_id=v_workspace.id and work_id=v_work.id;
    end if;
  else
    if v_handoff.status<>'submitted' or v_handoff.revision<>p_handoff_revision
      or v_actor=v_handoff.submitted_by or v_member.role<>'operations_leader'
      or v_source_digest<>v_handoff.source_digest
      or length(trim(coalesce(p_reason,''))) not between 20 and 2000 then
      raise exception 'independent_current_receipt_required' using errcode='42501'; end if;
    v_next:=v_handoff.handoff||pg_catalog.jsonb_build_object(
      'status',case when p_action='accept-design-handoff' then 'accepted'
        else 'returned' end,'decidedAt',v_now,
      'decidedBy',v_actor,'decidedByActorId',v_actor,
      'decidedByMembershipId',v_member.id,'decisionNote',trim(p_reason),
      'authorityRevision',v_handoff.decision_revision+1);
    update d5o_hosted.connected_design_handoffs set
      decision_revision=decision_revision+1,
      status=case when p_action='accept-design-handoff' then 'accepted'
        else 'returned' end,handoff=v_next,received_by=v_actor,updated_at=v_now
      where workspace_id=v_workspace.id and work_id=v_work.id;
  end if;
  insert into d5o_hosted.connected_design_handoff_events(workspace_id,work_id,
    decision_revision,command_id,action,actor_user_id,membership_id,
    handoff_revision,source_digest,snapshot,reason)
  values(v_workspace.id,v_work.id,coalesce(v_handoff.decision_revision,0)+1,
    p_command_id,p_action,v_actor,v_member.id,p_handoff_revision,v_source_digest,
    v_next,trim(coalesce(p_reason,'')));
  v_result:=public.d5o_hosted_prototype_read_v1(p_workspace_key,'work');
  insert into d5o_hosted.connected_design_handoff_receipts(workspace_id,
    command_id,work_id,actor_user_id,fingerprint,result)
  values(v_workspace.id,p_command_id,v_work.id,v_actor,v_fingerprint,v_result);
  return v_result;
end; $$;
revoke all on function public.d5o_hosted_design_handoff_command_v1(
  text,text,text,text,text,text,bigint,integer,integer,integer)
  from public,anon,service_role;
grant execute on function public.d5o_hosted_design_handoff_command_v1(
  text,text,text,text,text,text,bigint,integer,integer,integer)
  to authenticated;
