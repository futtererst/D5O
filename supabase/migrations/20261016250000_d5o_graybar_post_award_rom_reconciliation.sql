-- An independently authorized ROM can be reconciled after a separate customer
-- award without reopening budget acknowledgment or Design authorization.
-- Exact Define, solution, estimate, offer and ROM authority revisions still bind
-- the recorded difference; the award does not rewrite the approved ROM.
create or replace function public.d5o_hosted_rom_design_command_v1(
  p_workspace_key text,p_presentation_id text,p_action text,p_basis jsonb,
  p_command_id text,p_expected_source_revision bigint,
  p_expected_decision_revision integer,p_estimate_revision integer,p_offer_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
  v_member d5o_hosted.memberships%rowtype;v_work d5o_hosted.work_records%rowtype;
  v_source d5o_hosted.prototype_states%rowtype;
  v_define d5o_hosted.connected_define_states%rowtype;
  v_solution d5o_hosted.connected_solution_states%rowtype;
  v_estimate d5o_hosted.connected_estimate_states%rowtype;
  v_offer d5o_hosted.connected_offer_states%rowtype;
  v_current d5o_hosted.connected_rom_design_states%rowtype;
  v_receipt d5o_hosted.connected_rom_design_receipts%rowtype;
  v_fingerprint text;v_result jsonb;v_next jsonb;v_item jsonb;
  v_now timestamptz:=now();v_revision integer;v_design_role text;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or p_action not in ('record-budget-ack','authorize-design','record-reconciliation')
    or pg_catalog.jsonb_typeof(p_basis)<>'object'
    or length(coalesce(p_command_id,'')) not between 8 and 120
    or p_expected_source_revision is null or p_expected_source_revision<1
    or p_expected_decision_revision is null or p_expected_decision_revision<0
    or p_estimate_revision is null or p_estimate_revision<1
    or p_offer_revision is null or p_offer_revision<1 then
    raise exception 'invalid_rom_design_command' using errcode='22023'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor and status='active'
    for share;
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  select w.* into v_work from d5o_hosted.work_records w
    join d5o_hosted.work_identity_links l on l.work_id=w.id and l.workspace_id=w.workspace_id
    where w.workspace_id=v_workspace.id and l.presentation_id=p_presentation_id
    for update of w;
  if not found then raise exception 'connected_work_unavailable' using errcode='42501'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_workspace_key,
    p_presentation_id,p_action,p_basis,p_expected_source_revision,
    p_expected_decision_revision,p_estimate_revision,p_offer_revision)::text);
  select * into v_receipt from d5o_hosted.connected_rom_design_receipts
    where workspace_id=v_workspace.id and command_id=p_command_id;
  if found then
    if v_receipt.work_id<>v_work.id or v_receipt.actor_user_id<>v_actor
      or v_receipt.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_receipt.result;
  end if;
  select * into v_source from d5o_hosted.prototype_states
    where workspace_id=v_workspace.id and state_key='work' for share;
  select * into v_current from d5o_hosted.connected_rom_design_states
    where workspace_id=v_workspace.id and work_id=v_work.id for update;
  if v_source.revision is distinct from p_expected_source_revision or
    coalesce(v_current.decision_revision,0)<>p_expected_decision_revision then
    raise exception 'stale_state' using errcode='23505'; end if;
  select * into v_define from d5o_hosted.connected_define_states
    where workspace_id=v_workspace.id and work_id=v_work.id for share;
  select * into v_solution from d5o_hosted.connected_solution_states
    where workspace_id=v_workspace.id and work_id=v_work.id for share;
  select * into v_estimate from d5o_hosted.connected_estimate_states
    where workspace_id=v_workspace.id and work_id=v_work.id for share;
  select * into v_offer from d5o_hosted.connected_offer_states
    where workspace_id=v_workspace.id and work_id=v_work.id for share;
  if v_define.status is distinct from 'Approved' or
    v_define.projection#>>'{developHandoff,status}' is distinct from 'accepted' or
    v_solution.status is distinct from 'Approved' or
    v_estimate.status is distinct from 'Approved' or
    v_estimate.estimate#>>'{detailed,input,estimateMaturity}' is distinct from 'ROM' or
    v_estimate.definition_revision is distinct from v_define.definition_revision or
    v_estimate.solution_digest is distinct from v_solution.source_digest or
    v_estimate.estimate_revision<>p_estimate_revision or
    v_offer.status is distinct from 'Submitted' or
    v_offer.offer_revision<>p_offer_revision or
    v_offer.estimate_revision<>p_estimate_revision or
    v_offer.proposal#>>'{submission,revision}' is distinct from p_offer_revision::text or
    (p_action<>'record-reconciliation' and v_offer.proposal->'responseEvents'->-1->>'status' in ('Awarded','Not awarded')) then
    raise exception 'current_communicated_rom_required' using errcode='23514'; end if;
  if p_action='record-budget-ack' then
    if v_member.role not in ('admin','project_manager') or
      (v_member.role='project_manager' and v_work.created_by<>v_actor) or
      v_current.work_id is not null
      or length(trim(coalesce(p_basis->>'sourceReference',''))) not between 5 and 500
      or length(trim(coalesce(p_basis->>'customerStatement',''))) not between 10 and 2000
      or length(trim(coalesce(p_basis->>'customerRepresentative',''))) not between 3 and 200 then
      raise exception 'budget_ack_basis_invalid' using errcode='42501'; end if;
    v_next:=pg_catalog.jsonb_build_object('sourceReference',p_basis->>'sourceReference',
      'customerStatement',p_basis->>'customerStatement',
      'customerRepresentative',p_basis->>'customerRepresentative',
      'estimateRevision',p_estimate_revision,'offerRevision',p_offer_revision,
      'recordedAt',v_now,'recordedByActorId',v_actor,'recordedByMembershipId',v_member.id);
    insert into d5o_hosted.connected_rom_design_states(workspace_id,work_id,
      decision_revision,estimate_revision,offer_revision,definition_revision,
      solution_digest,status,acknowledgment,prepared_by)
    values(v_workspace.id,v_work.id,1,p_estimate_revision,p_offer_revision,
      v_define.definition_revision,v_solution.source_digest,'Acknowledged',v_next,v_actor);
  elsif p_action='authorize-design' then
    v_design_role:=v_estimate.estimate#>>'{detailed,policySnapshot,proposalApproverRole}';
    if v_current.status<>'Acknowledged' or v_actor=v_current.prepared_by
      or v_design_role not in ('admin','operations_leader')
      or v_member.role<>v_design_role
      or v_current.estimate_revision<>p_estimate_revision
      or v_current.offer_revision<>p_offer_revision
      or v_current.definition_revision<>v_define.definition_revision
      or v_current.solution_digest<>v_solution.source_digest
      or length(trim(coalesce(p_basis->>'authorizedExtent',''))) not between 10 and 2000
      or length(trim(coalesce(p_basis->>'fundingSource',''))) not between 5 and 500
      or length(trim(coalesce(p_basis->>'sourceReference',''))) not between 5 and 500
      or coalesce(p_basis->>'spendCapMinor','') !~ '^[0-9]+$' then
      raise exception 'independent_design_authority_required' using errcode='42501'; end if;
    v_next:=pg_catalog.jsonb_build_object('authorizedExtent',p_basis->>'authorizedExtent',
      'fundingSource',p_basis->>'fundingSource',
      'sourceReference',p_basis->>'sourceReference',
      'spendCapMinor',(p_basis->>'spendCapMinor')::bigint,
      'currency',v_estimate.estimate#>>'{detailed,input,currency}',
      'estimateRevision',p_estimate_revision,'offerRevision',p_offer_revision,
      'authorizedAt',v_now,'authorizedByActorId',v_actor,
      'authorizedByMembershipId',v_member.id,
      'limits','Detailed Design only; no award, purchase, crew publication or field start');
    update d5o_hosted.connected_rom_design_states set decision_revision=decision_revision+1,
      status='Design authorized',design_authorization=v_next,authorized_by=v_actor,updated_at=v_now
      where workspace_id=v_workspace.id and work_id=v_work.id;
  else
    if v_current.status<>'Design authorized' or
      v_member.role not in ('admin','project_manager','operations_leader') or
      v_current.estimate_revision<>p_estimate_revision or
      v_current.offer_revision<>p_offer_revision or
      v_current.definition_revision<>v_define.definition_revision or
      v_current.solution_digest<>v_solution.source_digest or
      pg_catalog.jsonb_typeof(p_basis->'differences')<>'array' or
      pg_catalog.jsonb_array_length(p_basis->'differences') not between 1 and 100 then
      raise exception 'current_design_authorization_required' using errcode='23514'; end if;
    for v_item in select value from pg_catalog.jsonb_array_elements(p_basis->'differences') loop
      if length(trim(coalesce(v_item->>'romLineId','')))=0 or
        not exists(select 1 from pg_catalog.jsonb_array_elements(
          v_estimate.estimate#>'{detailed,input,lines}') line
          where line->>'id'=v_item->>'romLineId') or
        coalesce(v_item->>'designQuantity','') !~ '^[0-9]+(\.[0-9]+)?$' or
        length(trim(coalesce(v_item->>'designUnit','')))=0 or
        v_item->>'cause' not in ('Customer scope change','Estimating assumption resolved',
          'Technical solution change','Estimating omission/correction') or
        length(trim(coalesce(v_item->>'explanation','')))<10 then
        raise exception 'design_difference_invalid' using errcode='23514'; end if;
    end loop;
    v_next:=pg_catalog.jsonb_build_object('differences',p_basis->'differences',
      'sourceReference',p_basis->>'sourceReference','recordedAt',v_now,
      'recordedByActorId',v_actor,'estimateRevision',p_estimate_revision,
      'offerRevision',p_offer_revision,
      'position','Design difference only; changes require separate commercial authority');
    update d5o_hosted.connected_rom_design_states set decision_revision=decision_revision+1,
      reconciliation=reconciliation||pg_catalog.jsonb_build_array(v_next),updated_at=v_now
      where workspace_id=v_workspace.id and work_id=v_work.id;
  end if;
  select * into v_current from d5o_hosted.connected_rom_design_states
    where workspace_id=v_workspace.id and work_id=v_work.id;
  v_revision:=v_current.decision_revision;
  insert into d5o_hosted.connected_rom_design_events(workspace_id,work_id,
    decision_revision,command_id,action,actor_user_id,membership_id,snapshot)
  values(v_workspace.id,v_work.id,v_revision,p_command_id,p_action,v_actor,v_member.id,
    pg_catalog.to_jsonb(v_current));
  v_result:=public.d5o_hosted_rom_design_read_v1(p_workspace_key,p_presentation_id);
  insert into d5o_hosted.connected_rom_design_receipts(workspace_id,command_id,
    work_id,actor_user_id,fingerprint,result)
  values(v_workspace.id,p_command_id,v_work.id,v_actor,v_fingerprint,v_result);
  return v_result;
end; $$;
revoke all on function public.d5o_hosted_rom_design_command_v1(
  text,text,text,jsonb,text,bigint,integer,integer,integer)
  from public,anon,service_role;
grant execute on function public.d5o_hosted_rom_design_command_v1(
  text,text,text,jsonb,text,bigint,integer,integer,integer) to authenticated;
