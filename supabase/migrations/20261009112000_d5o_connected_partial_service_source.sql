-- Preserve the covered path while accepting an exact reviewed pricing and customer basis for partial coverage.
create or replace function d5o_hosted.current_service_source_v1(
  p_workspace uuid,p_work uuid
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_child d5o_hosted.connected_service_work%rowtype;
  v_parent d5o_hosted.connected_operate_states%rowtype;
  v_work d5o_hosted.work_records%rowtype;
  v_request jsonb;v_asset jsonb;v_agreement jsonb;v_job jsonb;v_estimate jsonb;v_auth jsonb;v_pricing jsonb;
  v_cycle text;
begin
  select * into v_child from d5o_hosted.connected_service_work
    where workspace_id=p_workspace and work_id=p_work;
  select * into v_work from d5o_hosted.work_records
    where workspace_id=p_workspace and id=p_work;
  if v_child.work_id is null or v_work.id is null then
    raise exception 'canonical_service_work_required' using errcode='23514'; end if;
  select * into v_parent from d5o_hosted.connected_operate_states
    where workspace_id=p_workspace and work_id=v_child.parent_work_id;
  if v_parent.work_id is null or v_parent.state#>>'{activation,status}'<>'Active' then
    raise exception 'active_support_required' using errcode='23514'; end if;
  select item into v_request from pg_catalog.jsonb_array_elements(v_parent.state->'requests') item
    where item->>'id'=v_child.request_id;
  select item into v_asset from pg_catalog.jsonb_array_elements(v_parent.state->'assets') item
    where item->>'id'=v_child.asset_id and item->>'status'='Supported';
  v_cycle:=coalesce(v_request->>'reopenedAt',v_request->>'reportedAt');
  select item into v_job from pg_catalog.jsonb_array_elements(v_parent.state->'jobs') item
    where item->>'workId'=v_child.presentation_id
      and item->>'requestId'=v_child.request_id
      and item->>'requestCycleAt'=v_cycle
      and item->>'status'='Generated';
  if v_request is null or v_asset is null or v_job is null
    or v_request->>'status' not in ('Triaged','In progress')
    or v_request->>'coverage' not in ('Covered','Partially covered')
    or v_request->>'assetId'<>v_child.asset_id
    or not (coalesce(v_request->'currentCycleJobIds','[]'::jsonb) ? (v_job->>'id'))
    or v_child.work_projection#>>'{serviceSource,requestCycleAt}' is distinct from v_cycle then
    raise exception 'current_covered_service_cycle_required' using errcode='23514'; end if;
  select item into v_agreement from pg_catalog.jsonb_array_elements(v_parent.state->'agreements') item
    where item->>'id'=v_request->>'agreementId' and item->>'status'='Active'
      and item->'assetIds' ? v_child.asset_id;
  if v_agreement is null or v_agreement->>'kind'='No coverage'
    or not (v_agreement->'serviceCategories' ? (v_request->>'serviceCategory'))
    or (v_request->>'coverage'='Covered' and (
      v_agreement->>'laborCovered'<>'true' or v_agreement->>'partsCovered'<>'true'
      or v_agreement->>'travelCovered'<>'true'))
    or (v_agreement->>'effectiveFrom')::date>current_date
    or (v_agreement->>'effectiveTo')::date<current_date then
    raise exception 'current_structured_coverage_required' using errcode='23514'; end if;
  if v_request->>'coverage'='Partially covered' then
    v_estimate:=v_request->'serviceEstimate';
    v_auth:=v_request->'serviceAuthorization';
    if v_estimate->>'status'<>'Approved' or v_estimate->>'requestCycleAt'<>v_cycle
      or v_auth->>'estimateRevision' is distinct from v_estimate->>'revision'
      or v_auth->>'amountMinor' is distinct from v_estimate#>>'{evaluation,proposedPriceMinor}'
      or v_auth->>'currency' is distinct from v_estimate#>>'{evaluation,currency}'
      or length(coalesce(v_auth->>'source',''))<10 then
      raise exception 'exact_partial_customer_authorization_required' using errcode='23514'; end if;
    v_pricing:=pg_catalog.jsonb_build_object('estimateRevision',v_estimate->>'revision',
      'policyId',v_estimate#>>'{policySnapshot,id}',
      'policyVersion',v_estimate#>>'{policySnapshot,version}',
      'currency',v_auth->>'currency','amountMinor',v_auth->>'amountMinor',
      'customerAuthorizationSource',v_auth->>'source',
      'uncoveredScope',v_estimate#>>'{input,lines,0,description}');
  end if;
  return pg_catalog.jsonb_build_object(
    'kind','service','canonicalWorkId',v_work.id,'presentationId',v_child.presentation_id,
    'parentWorkId',v_child.parent_work_id,'requestId',v_child.request_id,
    'requestCycleAt',v_cycle,'assetId',v_child.asset_id,
    'configurationVersionId',v_work.configuration_version_id,
    'configurationDigest',v_work.configuration_digest,
    'request',pg_catalog.jsonb_build_object('id',v_request->>'id',
      'title',v_request->>'title','description',v_request->>'description',
      'impact',v_request->>'impact','serviceCategory',v_request->>'serviceCategory',
      'coverage',v_request->>'coverage','agreementId',v_request->>'agreementId',
      'cycle',v_cycle),
    'asset',pg_catalog.jsonb_build_object('id',v_asset->>'id',
      'name',v_asset->>'name','kind',v_asset->>'kind',
      'location',v_asset->>'location','documentation',v_asset->>'documentation'),
    'agreement',v_agreement,'pricing',v_pricing);
end; $$;
create or replace function public.d5o_hosted_service_basis_command_v1(
  p_workspace_key text,p_presentation_id text,p_action text,p_input jsonb,
  p_command_id text,p_expected_work_revision bigint,
  p_expected_operate_revision integer,p_expected_decision_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
  v_member d5o_hosted.memberships%rowtype;v_work d5o_hosted.work_records%rowtype;
  v_service d5o_hosted.connected_service_work%rowtype;
  v_raw d5o_hosted.prototype_states%rowtype;
  v_parent d5o_hosted.connected_operate_states%rowtype;
  v_handoff d5o_hosted.connected_design_handoffs%rowtype;
  v_receipt d5o_hosted.connected_design_handoff_receipts%rowtype;
  v_source jsonb;v_basis jsonb;v_brief jsonb;v_next jsonb;
  v_digest text;v_fingerprint text;v_result jsonb;
  v_revision integer;v_now timestamptz:=now();v_reason text:=trim(coalesce(p_input->>'reason',''));
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or p_action not in ('save-service-basis','revise-service-basis',
      'submit-service-basis','accept-service-basis','return-service-basis')
    or pg_catalog.jsonb_typeof(p_input)<>'object'
    or length(coalesce(p_command_id,'')) not between 8 and 120
    or p_expected_work_revision is null or p_expected_work_revision<1
    or p_expected_operate_revision is null or p_expected_operate_revision<1
    or p_expected_decision_revision is null or p_expected_decision_revision<0 then
    raise exception 'invalid_service_basis_command' using errcode='22023'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('d5o-connected:'||v_workspace.id::text,0));
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor and status='active' for share;
  if not found or v_member.role not in ('project_manager','operations_leader') then
    raise exception 'service_basis_role_denied' using errcode='42501'; end if;
  select w.* into v_work from d5o_hosted.work_records w
    join d5o_hosted.work_identity_links l on l.workspace_id=w.workspace_id and l.work_id=w.id
    where w.workspace_id=v_workspace.id and l.presentation_id=p_presentation_id
      and l.relation_kind='service_visit' for update of w;
  if not found then raise exception 'service_work_unavailable' using errcode='23503'; end if;
  select * into v_service from d5o_hosted.connected_service_work
    where workspace_id=v_workspace.id and work_id=v_work.id for share;
  if not found then raise exception 'service_source_unavailable' using errcode='23503'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(
    p_workspace_key,p_presentation_id,p_action,p_input,p_expected_work_revision,
    p_expected_operate_revision,p_expected_decision_revision)::text);
  select * into v_receipt from d5o_hosted.connected_design_handoff_receipts
    where workspace_id=v_workspace.id and command_id=p_command_id;
  if found then
    if v_receipt.work_id<>v_work.id or v_receipt.actor_user_id<>v_actor
      or v_receipt.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_receipt.result; end if;
  select * into v_raw from d5o_hosted.prototype_states
    where workspace_id=v_workspace.id and state_key='work' for share;
  select * into v_parent from d5o_hosted.connected_operate_states
    where workspace_id=v_workspace.id and work_id=v_service.parent_work_id for share;
  select * into v_handoff from d5o_hosted.connected_design_handoffs
    where workspace_id=v_workspace.id and work_id=v_work.id for update;
  if v_raw.revision is distinct from p_expected_work_revision
    or v_parent.decision_revision is distinct from p_expected_operate_revision
    or coalesce(v_handoff.decision_revision,0)<>p_expected_decision_revision
    or v_handoff.work_id is not null and v_handoff.source_kind<>'service' then
    raise exception 'stale_service_basis' using errcode='23505'; end if;
  v_source:=d5o_hosted.current_service_source_v1(v_workspace.id,v_work.id);
  v_digest:=pg_catalog.md5(v_source::text);
  if p_action in ('save-service-basis','revise-service-basis') then
    if v_member.role<>'project_manager'
      or p_action='revise-service-basis' and v_handoff.status<>'accepted'
      or p_action='save-service-basis' and v_handoff.status not in ('draft','returned')
      or exists(select 1 from d5o_hosted.connected_design_states d,
        lateral pg_catalog.jsonb_array_elements(coalesce(d.state->'releases','[]'::jsonb)) r
        where d.workspace_id=v_workspace.id and d.work_id=v_work.id
          and r->>'status' in ('Awaiting receipt','Accepted')) then
      raise exception 'service_basis_revision_denied' using errcode='23514'; end if;
    if length(trim(coalesce(p_input->>'scope','')))<20
      or length(trim(coalesce(p_input->>'completionCriteria','')))<15
      or length(trim(coalesce(p_input->>'verification','')))<15
      or length(trim(coalesce(p_input->>'coverageRationale','')))<20
      or length(trim(coalesce(p_input->>'safety','')))<10
      or length(trim(coalesce(p_input->>'access','')))<10
      or length(trim(coalesce(p_input->>'resources','')))<10
      or p_input->>'serviceCategory' is distinct from
        v_source#>>'{request,serviceCategory}' then
      raise exception 'service_scope_and_coverage_basis_required' using errcode='23514'; end if;
    if v_source#>>'{request,coverage}'='Partially covered' and
      (length(trim(coalesce(p_input->>'coveredScope','')))<20
        or length(trim(coalesce(p_input->>'uncoveredScope','')))<20
        or p_input->>'uncoveredScope' is distinct from v_source#>>'{pricing,uncoveredScope}') then
      raise exception 'partial_scope_price_boundary_required' using errcode='23514'; end if;
    v_revision:=coalesce(v_handoff.revision,0)+1;
    v_brief:=pg_catalog.jsonb_build_object(
      'sourceKind','service','source',v_source,'scope',trim(p_input->>'scope'),
      'exclusions',trim(coalesce(p_input->>'exclusions','')),
      'completionCriteria',trim(p_input->>'completionCriteria'),
      'verification',trim(p_input->>'verification'),
      'coverageRationale',trim(p_input->>'coverageRationale'),
      'coveredScope',trim(coalesce(p_input->>'coveredScope','')),
      'uncoveredScope',trim(coalesce(p_input->>'uncoveredScope','')),
      'safety',trim(p_input->>'safety'),'access',trim(p_input->>'access'),
      'resources',trim(p_input->>'resources'),
      'serviceCategory',p_input->>'serviceCategory',
      'configurationVersionId',v_work.configuration_version_id);
    v_next:=pg_catalog.jsonb_build_object('id',gen_random_uuid(),
      'revision',v_revision,'status','draft','sourceKind','service',
      'brief',v_brief,'submittedBy',v_actor,'authorityRevision',
      p_expected_decision_revision+1,'updatedAt',v_now);
    if v_handoff.work_id is null then
      insert into d5o_hosted.connected_design_handoffs(
        workspace_id,work_id,revision,decision_revision,status,source_digest,
        handoff,submitted_by,source_kind)
      values(v_workspace.id,v_work.id,v_revision,1,'draft',v_digest,v_next,v_actor,'service');
    else
      update d5o_hosted.connected_design_handoffs set
        revision=v_revision,decision_revision=decision_revision+1,status='draft',
        source_digest=v_digest,handoff=v_next,submitted_by=v_actor,
        received_by=null,updated_at=v_now
      where workspace_id=v_workspace.id and work_id=v_work.id;
    end if;
  elsif p_action='submit-service-basis' then
    if v_member.role<>'project_manager' or v_handoff.status<>'draft'
      or v_handoff.submitted_by<>v_actor or v_handoff.source_digest<>v_digest
      or length(v_reason)<15 then
      raise exception 'service_basis_submission_denied' using errcode='23514'; end if;
    v_revision:=v_handoff.revision;
    v_next:=v_handoff.handoff||pg_catalog.jsonb_build_object(
      'status','submitted','submittedAt',v_now,
      'authorityRevision',v_handoff.decision_revision+1);
    update d5o_hosted.connected_design_handoffs set status='submitted',
      decision_revision=decision_revision+1,handoff=v_next,updated_at=v_now
      where workspace_id=v_workspace.id and work_id=v_work.id;
  else
    if v_member.role<>'operations_leader' or v_handoff.status<>'submitted'
      or v_handoff.submitted_by=v_actor or v_handoff.source_digest<>v_digest
      or length(v_reason)<20 then
      raise exception 'independent_current_service_review_required' using errcode='42501'; end if;
    v_revision:=v_handoff.revision;
    v_next:=v_handoff.handoff||pg_catalog.jsonb_build_object(
      'status',case when p_action='accept-service-basis' then 'accepted' else 'returned' end,
      'receivedAt',v_now,'receivedByActorId',v_actor,
      'reviewReason',v_reason,'authorityRevision',v_handoff.decision_revision+1);
    update d5o_hosted.connected_design_handoffs set
      status=v_next->>'status',decision_revision=decision_revision+1,
      handoff=v_next,received_by=v_actor,updated_at=v_now
      where workspace_id=v_workspace.id and work_id=v_work.id;
  end if;
  insert into d5o_hosted.connected_design_handoff_events(workspace_id,work_id,
    decision_revision,command_id,action,actor_user_id,membership_id,
    handoff_revision,source_digest,snapshot,reason)
  values(v_workspace.id,v_work.id,p_expected_decision_revision+1,p_command_id,
    p_action,v_actor,v_member.id,v_revision,v_digest,v_next,v_reason);
  v_result:=public.d5o_hosted_prototype_read_v1(p_workspace_key,'work');
  insert into d5o_hosted.connected_design_handoff_receipts(workspace_id,command_id,
    work_id,actor_user_id,fingerprint,result)
  values(v_workspace.id,p_command_id,v_work.id,v_actor,v_fingerprint,v_result);
  return v_result;
end; $$;
create or replace function public.d5o_hosted_service_job_command_v1(
  p_workspace_key text,p_parent_presentation_id text,p_request_id text,
  p_due_date date,p_owner text,p_command_id text,p_expected_work_revision bigint,
  p_expected_catalog_revision bigint,p_expected_operate_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
  v_member d5o_hosted.memberships%rowtype;v_parent d5o_hosted.work_records%rowtype;
  v_work d5o_hosted.prototype_states%rowtype;v_catalog d5o_hosted.prototype_states%rowtype;
  v_operate d5o_hosted.connected_operate_states%rowtype;
  v_receipt d5o_hosted.connected_create_receipts%rowtype;
  v_parent_raw jsonb;v_request jsonb;v_asset jsonb;v_child jsonb;
  v_catalog_child jsonb;v_after_operate jsonb;
  v_job jsonb;v_fingerprint text;v_result jsonb;v_child_id uuid:=gen_random_uuid();
  v_job_id uuid:=gen_random_uuid();v_alias text;v_type d5o_hosted.configuration_work_types%rowtype;
  v_now timestamptz:=now();v_request_cycle text;v_estimate jsonb;v_auth jsonb;v_pricing jsonb;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or p_request_id is null or p_command_id is null or length(p_command_id) not between 8 and 120
    or p_due_date is null or p_due_date<current_date
    or length(trim(coalesce(p_owner,''))) not between 3 and 120
    or p_expected_work_revision is null or p_expected_catalog_revision is null
    or p_expected_operate_revision is null then
    raise exception 'invalid_service_job_command' using errcode='22023'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('d5o-connected:'||v_workspace.id::text,0));
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor and status='active' for share;
  if not found or v_member.role not in ('project_manager','operations_leader') then
    raise exception 'service_job_authority_required' using errcode='42501'; end if;
  select w.* into v_parent from d5o_hosted.work_records w
    join d5o_hosted.work_identity_links l on l.workspace_id=w.workspace_id and l.work_id=w.id
    where w.workspace_id=v_workspace.id and l.presentation_id=p_parent_presentation_id
      and l.parent_work_id is null for update of w;
  if not found then raise exception 'canonical_parent_required' using errcode='23503'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(
    p_workspace_key,p_parent_presentation_id,p_request_id,p_due_date,p_owner)::text);
  select * into v_receipt from d5o_hosted.connected_create_receipts
    where workspace_id=v_workspace.id and command_id=p_command_id;
  if found then
    if v_receipt.actor_user_id<>v_actor or v_receipt.request_fingerprint<>v_fingerprint
      then raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_receipt.result; end if;
  select * into v_work from d5o_hosted.prototype_states
    where workspace_id=v_workspace.id and state_key='work' for update;
  select * into v_catalog from d5o_hosted.prototype_states
    where workspace_id=v_workspace.id and state_key='catalog' for update;
  select * into v_operate from d5o_hosted.connected_operate_states
    where workspace_id=v_workspace.id and work_id=v_parent.id for update;
  if v_work.revision is distinct from p_expected_work_revision
    or v_catalog.revision is distinct from p_expected_catalog_revision
    or v_operate.decision_revision is distinct from p_expected_operate_revision then
    raise exception 'stale_service_job_basis' using errcode='23505'; end if;
  select item into v_parent_raw from pg_catalog.jsonb_array_elements(v_work.state_json->'records') item
    where item->>'id'=p_parent_presentation_id and item->>'canonicalWorkId'=v_parent.id::text;
  if v_parent_raw is null or v_parent_raw->>'phaseConfigurationVersionId'
      is distinct from v_parent.configuration_version_id::text
    or v_operate.state#>>'{activation,status}'<>'Active' then
    raise exception 'active_canonical_support_required' using errcode='23514'; end if;
  select item into v_request from pg_catalog.jsonb_array_elements(v_operate.state->'requests') item
    where item->>'id'=p_request_id and item->>'status' in ('Triaged','In progress');
  if v_request is null then raise exception 'triaged_request_required' using errcode='23514'; end if;
  if v_request->>'coverage' not in ('Covered','Partially covered') then
    raise exception 'authoritative_service_pricing_required' using errcode='23514'; end if;
  if v_request->>'coverage'='Partially covered' then
    v_estimate:=v_request->'serviceEstimate';
    v_auth:=v_request->'serviceAuthorization';
    if v_estimate->>'status'<>'Approved'
      or v_estimate->>'requestCycleAt' is distinct from
        coalesce(v_request->>'reopenedAt',v_request->>'reportedAt')
      or v_auth->>'estimateRevision' is distinct from v_estimate->>'revision'
      or v_auth->>'amountMinor' is distinct from v_estimate#>>'{evaluation,proposedPriceMinor}'
      or v_auth->>'currency' is distinct from v_estimate#>>'{evaluation,currency}' then
      raise exception 'exact_partial_customer_authorization_required' using errcode='23514'; end if;
    v_pricing:=pg_catalog.jsonb_build_object('estimateRevision',(v_estimate->>'revision')::integer,
      'policyId',v_estimate#>>'{policySnapshot,id}',
      'policyVersion',(v_estimate#>>'{policySnapshot,version}')::integer,
      'currency',v_auth->>'currency','amountMinor',(v_auth->>'amountMinor')::bigint,
      'customerAuthorizationSource',v_auth->>'source');
  end if;
  select item into v_asset from pg_catalog.jsonb_array_elements(v_operate.state->'assets') item
    where item->>'id'=v_request->>'assetId' and item->>'status'='Supported';
  if v_asset is null then raise exception 'supported_asset_required' using errcode='23514'; end if;
  v_request_cycle:=coalesce(v_request->>'reopenedAt',v_request->>'reportedAt');
  if exists(select 1 from pg_catalog.jsonb_array_elements(v_operate.state->'jobs') item
    where item->>'requestId'=p_request_id and item->>'requestCycleAt'=v_request_cycle
      and item->>'dueDate'=p_due_date::text and item->>'status'<>'Cancelled') then
    raise exception 'duplicate_service_visit' using errcode='23505'; end if;
  select * into v_type from d5o_hosted.configuration_work_types
    where configuration_version_id=v_parent.configuration_version_id
      and display_name='Lifecycle service' and status='active';
  if not found or not exists(select 1 from d5o_hosted.configuration_create_rights
      where configuration_version_id=v_parent.configuration_version_id
        and work_type_key=v_type.work_type_key and workspace_role=v_member.role) then
    raise exception 'service_work_type_right_unavailable' using errcode='42501'; end if;
  v_alias:=p_workspace_key||'-'||pg_catalog.replace(v_child_id::text,'-','');
  v_job:=pg_catalog.jsonb_build_object('id',v_job_id,'workId',v_alias,
    'assetIds',pg_catalog.jsonb_build_array(v_asset->>'id'),'requestId',p_request_id,
    'requestCycleAt',v_request_cycle,'dueDate',p_due_date,'status','Generated',
    'evidence','[]'::jsonb,'createdAt',v_now,'createdByActorId',v_actor);
  v_child:=pg_catalog.jsonb_build_object('id',v_alias,'canonicalWorkId',v_child_id,
    'workspace',p_workspace_key,'title',(v_request->>'title')||' · '||(v_asset->>'name'),
    'type',v_type.display_name,'customer',v_parent_raw->>'customer',
    'site',v_parent_raw->>'site','stage','Design','owner',trim(p_owner),
    'nextAction','Prepare and approve service execution basis before Design release',
    'progress',0,'value',case when v_pricing is null then 'Covered service obligation' else 'Partially covered service · priced uncovered scope' end,'status','attention',
    'proof','[]'::jsonb,'blockers','[]'::jsonb,
    'history',pg_catalog.jsonb_build_array(v_now::text||' · Service visit created from accepted support; field execution is not authorized.'),
    'phaseConfigurationVersionId',v_parent.configuration_version_id,
    'serviceSource',pg_catalog.jsonb_build_object('parentWorkId',p_parent_presentation_id,
      'assetIds',pg_catalog.jsonb_build_array(v_asset->>'id'),'requestId',p_request_id,
      'requestCycleAt',v_request_cycle,'coverage',v_request->>'coverage',
      'pricing',v_pricing));
  v_catalog_child:=v_child-'serviceSource'||pg_catalog.jsonb_build_object(
    'createdAt',v_now,'createdBy',v_actor);
  insert into d5o_hosted.work_records(id,workspace_id,configuration_tenant_id,
    configuration_version_id,configuration_digest,work_type_key,title,created_by)
  values(v_child_id,v_workspace.id,v_parent.configuration_tenant_id,
    v_parent.configuration_version_id,v_parent.configuration_digest,v_type.work_type_key,
    v_child->>'title',v_actor);
  insert into d5o_hosted.work_identity_links(workspace_id,work_id,presentation_id,
    parent_work_id,relation_kind)
  values(v_workspace.id,v_child_id,v_alias,v_parent.id,'service_visit');
  insert into d5o_hosted.connected_service_work(workspace_id,work_id,parent_work_id,
    presentation_id,request_id,asset_id,work_projection,catalog_projection)
  values(v_workspace.id,v_child_id,v_parent.id,v_alias,p_request_id,
    v_asset->>'id',v_child,v_catalog_child);
  v_request:=v_request||pg_catalog.jsonb_build_object('status','In progress',
    'jobIds',coalesce(v_request->'jobIds','[]'::jsonb)||pg_catalog.jsonb_build_array(v_job_id),
    'currentCycleJobIds',coalesce(v_request->'currentCycleJobIds','[]'::jsonb)
      ||pg_catalog.jsonb_build_array(v_job_id));
  v_after_operate:=pg_catalog.jsonb_set(v_operate.state,'{requests}',
    (select pg_catalog.jsonb_agg(case when item->>'id'=p_request_id then v_request
      else item end order by ordinal) from pg_catalog.jsonb_array_elements(v_operate.state->'requests')
      with ordinality as entries(item,ordinal)));
  v_after_operate:=pg_catalog.jsonb_set(v_after_operate,'{jobs}',
    v_operate.state->'jobs'||pg_catalog.jsonb_build_array(v_job));
  v_after_operate:=v_after_operate||pg_catalog.jsonb_build_object(
    'authorityRevision',v_operate.decision_revision+1,
    'events',v_operate.state->'events'||pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('id',gen_random_uuid(),'commandId',p_command_id,
        'fingerprint',v_fingerprint,'at',v_now,'actorId',v_actor,
        'membershipId',v_member.id,'action','create-job','detail',v_alias)));
  update d5o_hosted.connected_operate_states set decision_revision=decision_revision+1,
    state=v_after_operate,updated_at=v_now where workspace_id=v_workspace.id and work_id=v_parent.id;
  insert into d5o_hosted.connected_operate_events(workspace_id,work_id,decision_revision,
    command_id,action,actor_user_id,membership_id,deploy_revision,snapshot)
  values(v_workspace.id,v_parent.id,v_operate.decision_revision+1,p_command_id,
    'create-job',v_actor,v_member.id,
    (select decision_revision from d5o_hosted.connected_deploy_states
      where workspace_id=v_workspace.id and work_id=v_parent.id),v_after_operate);
  insert into d5o_hosted.work_events(workspace_id,work_id,event_type,record_version,
    actor_user_id,membership_id,authority_role,configuration_version_id,
    configuration_digest,payload) values(v_workspace.id,v_child_id,'work_created',1,
    v_actor,v_member.id,v_member.role,v_parent.configuration_version_id,
    v_parent.configuration_digest,pg_catalog.jsonb_build_object('parentWorkId',v_parent.id,
      'relationKind','service_visit','presentationId',v_alias,'requestId',p_request_id,
      'requestCycleAt',v_request_cycle,'commandId',p_command_id));
  v_result:=pg_catalog.jsonb_build_object('workId',v_child_id,'presentationId',v_alias,
    'parentWorkId',v_parent.id,'jobId',v_job_id,'workRevision',v_work.revision,
    'catalogRevision',v_catalog.revision,'operateRevision',v_operate.decision_revision+1);
  insert into d5o_hosted.connected_create_receipts(workspace_id,command_id,
    actor_user_id,request_fingerprint,work_id,result)
  values(v_workspace.id,p_command_id,v_actor,v_fingerprint,v_child_id,v_result);
  return v_result;
end; $$;
