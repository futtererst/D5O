-- A service billing disposition is independent of project Finance closeout and invoicing.
-- Only authenticated typed commands can create or review it.
create table d5o_hosted.connected_service_finance_states (
  workspace_id uuid not null references d5o_hosted.workspaces(id),
  parent_work_id uuid not null,
  request_id text not null,
  revision integer not null,
  basis jsonb not null,
  basis_digest text not null,
  status text not null check (status in ('Prepared','Ready for billing','Hold')),
  prepared_by uuid not null,
  prepared_at timestamptz not null,
  billing_terms_evidence_id uuid,
  billing_terms_statement text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_reason text,
  primary key (workspace_id,parent_work_id,request_id),
  foreign key (parent_work_id,workspace_id)
    references d5o_hosted.work_records(id,workspace_id)
);
create table d5o_hosted.connected_service_finance_events (
  workspace_id uuid not null,
  parent_work_id uuid not null,
  request_id text not null,
  revision integer not null,
  command_id text not null,
  action text not null,
  actor_user_id uuid not null,
  membership_id uuid not null,
  basis_digest text not null,
  snapshot jsonb not null,
  at timestamptz not null default now(),
  primary key (workspace_id,parent_work_id,request_id,revision),
  unique (workspace_id,command_id)
);
create table d5o_hosted.connected_service_finance_receipts (
  workspace_id uuid not null,
  command_id text not null,
  parent_work_id uuid not null,
  actor_user_id uuid not null,
  fingerprint text not null,
  result jsonb not null,
  at timestamptz not null default now(),
  primary key (workspace_id,command_id)
);
alter table d5o_hosted.connected_service_finance_states enable row level security;
alter table d5o_hosted.connected_service_finance_events enable row level security;
alter table d5o_hosted.connected_service_finance_receipts enable row level security;
revoke all on d5o_hosted.connected_service_finance_states,
  d5o_hosted.connected_service_finance_events,
  d5o_hosted.connected_service_finance_receipts
  from public,anon,authenticated,service_role;

create function d5o_hosted.current_service_finance_basis_v1(
  p_workspace uuid,p_parent uuid,p_request_id text
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_operate jsonb;v_request jsonb;v_agreement jsonb;v_job jsonb;
  v_service d5o_hosted.connected_service_work%rowtype;
  v_handoff d5o_hosted.connected_design_handoffs%rowtype;
  v_design d5o_hosted.connected_design_states%rowtype;
  v_deploy d5o_hosted.connected_deploy_states%rowtype;
  v_doc d5o_hosted.customer_decision_evidence%rowtype;
  v_release jsonb;v_acceptance jsonb;v_estimate jsonb;v_authorization jsonb;
  v_cycle text;v_hours numeric;v_quantity numeric;v_scope_current boolean:=false;
  v_eligible boolean:=false;
begin
  select state into v_operate from d5o_hosted.connected_operate_states
    where workspace_id=p_workspace and work_id=p_parent;
  select item into v_request from pg_catalog.jsonb_array_elements(
    coalesce(v_operate->'requests','[]'::jsonb)) item
    where item->>'id'=p_request_id;
  if v_request is null then
    raise exception 'service_request_missing' using errcode='23503';
  end if;
  v_cycle:=coalesce(v_request->>'reopenedAt',v_request->>'reportedAt');
  select item into v_agreement from pg_catalog.jsonb_array_elements(
    coalesce(v_operate->'agreements','[]'::jsonb)) item
    where item->>'id'=v_request->>'agreementId'
      and item->'assetIds' ? (v_request->>'assetId');
  select item into v_job from pg_catalog.jsonb_array_elements(
    coalesce(v_operate->'jobs','[]'::jsonb)) item
    where item->>'requestId'=p_request_id
      and item->>'requestCycleAt'=v_cycle
      and coalesce(v_request->'currentCycleJobIds','[]'::jsonb) ? (item->>'id')
    order by item->>'createdAt' desc limit 1;
  select * into v_service from d5o_hosted.connected_service_work
    where workspace_id=p_workspace and parent_work_id=p_parent
      and request_id=p_request_id and asset_id=v_request->>'assetId'
      and presentation_id=v_job->>'workId';
  select * into v_handoff from d5o_hosted.connected_design_handoffs
    where workspace_id=p_workspace and work_id=v_service.work_id;
  select * into v_design from d5o_hosted.connected_design_states
    where workspace_id=p_workspace and work_id=v_service.work_id;
  select * into v_deploy from d5o_hosted.connected_deploy_states
    where workspace_id=p_workspace and work_id=v_service.work_id;
  v_estimate:=v_request->'serviceEstimate';
  v_authorization:=v_request->'serviceAuthorization';
  select * into v_doc from d5o_hosted.customer_decision_evidence
    where workspace_id=p_workspace and work_id=p_parent
      and id=case when (v_authorization#>>'{customerEvidence,id}') ~
        '^[0-9a-f-]{36}$' then (v_authorization#>>'{customerEvidence,id}')::uuid
        else null end
      and purpose='service-authorization' and scope_id=p_request_id
      and scope_revision=(v_estimate->>'revision')::integer
      and checksum_sha256=v_authorization#>>'{customerEvidence,checksumSha256}';
  v_acceptance:=v_deploy.state->'workAcceptance';
  select item into v_release from pg_catalog.jsonb_array_elements(
    coalesce(v_design.state->'releases','[]'::jsonb)) item
    where item->>'status'='Accepted'
      and coalesce(v_acceptance->'releaseIds','[]'::jsonb) ? (item->>'id')
    order by (item->>'packageRevision')::integer desc limit 1;
  select sum((r->>'laborHours')::numeric) into v_hours
    from pg_catalog.jsonb_array_elements(coalesce(v_deploy.state->'reports','[]'::jsonb)) r
    where r->>'status'='Reviewed' and r->>'releaseId'=v_release->>'id'
      and exists(select 1 from pg_catalog.jsonb_array_elements(
        coalesce(v_deploy.state->'completions','[]'::jsonb)) c
        where c->>'status'='Reviewed' and c->>'releaseId'=v_release->>'id'
          and c->'reportIds' ? (r->>'id'));
  select sum((c->>'reviewedQuantity')::numeric) into v_quantity
    from pg_catalog.jsonb_array_elements(coalesce(v_deploy.state->'completions','[]'::jsonb)) c
    where c->>'status'='Reviewed' and c->>'releaseId'=v_release->>'id';
  if v_acceptance->>'receipt'='Accepted' then
    v_scope_current:=d5o_hosted.current_work_acceptance_scope_v1(
      p_workspace,v_service.work_id,v_acceptance,true);
  end if;
  v_eligible:=coalesce(
    v_request->>'coverage'='Partially covered'
    and v_request->>'status'='Closed'
    and v_job->>'status'='Completed'
    and v_job->>'requestCycleAt'=v_cycle
    and v_estimate->>'status'='Approved'
    and v_estimate->>'requestCycleAt'=v_cycle
    and v_authorization->>'estimateRevision'=v_estimate->>'revision'
    and v_authorization->>'amountMinor'=v_estimate#>>'{evaluation,proposedPriceMinor}'
    and v_authorization->>'currency'=v_estimate#>>'{evaluation,currency}'
    and v_agreement->>'status'='Active'
    and v_agreement->>'revision' is not null
    and v_handoff.status='accepted' and v_handoff.source_kind='service'
    and v_handoff.handoff#>>'{brief,source,requestCycleAt}'=v_cycle
    and v_release->>'sourceKind'='service'
    and v_release->>'sourceHandoffRevision'=v_handoff.revision::text
    and v_acceptance->>'receipt'='Accepted'
    and v_job->>'workAcceptanceId'=v_acceptance->>'id'
    and v_scope_current and v_hours is not null and v_quantity is not null
    and v_doc.id is not null,false);
  return pg_catalog.jsonb_build_object(
    'requestId',p_request_id,'requestCycleAt',v_cycle,'requestStatus',v_request->>'status',
    'coverage',v_request->>'coverage','assetId',v_request->>'assetId',
    'agreementId',v_agreement->>'id','agreementRevision',v_agreement->>'revision',
    'agreementName',v_agreement->>'name','agreementSource',v_agreement->>'source',
    'agreementIncludes',v_agreement->>'includes','agreementExcludes',v_agreement->>'excludes',
    'jobId',v_job->>'id','jobStatus',v_job->>'status',
    'childWorkId',v_service.work_id,'childPresentationId',v_service.presentation_id,
    'estimateRevision',v_estimate->>'revision','estimateStatus',v_estimate->>'status',
    'policyId',v_estimate#>>'{policySnapshot,id}',
    'policyVersion',v_estimate#>>'{policySnapshot,version}',
    'uncoveredAmountMinor',v_authorization->>'amountMinor',
    'currency',v_authorization->>'currency',
    'authorizationEvidenceId',v_doc.id,
    'authorizationChecksum',v_doc.checksum_sha256,
    'customerAuthorizationSource',v_authorization->>'source',
    'authorizationConditions',v_authorization->>'conditions',
    'coveredScope',v_handoff.handoff#>>'{brief,coveredScope}',
    'uncoveredScope',v_handoff.handoff#>>'{brief,uncoveredScope}',
    'serviceBasisRevision',v_handoff.revision,
    'serviceBasisDigest',v_handoff.source_digest,
    'releaseId',v_release->>'id','packageRevision',v_release->>'packageRevision',
    'designRevision',v_design.decision_revision,
    'deployRevision',v_deploy.decision_revision,
    'workAcceptanceId',v_acceptance->>'id',
    'workAcceptanceRevision',v_acceptance->>'revision',
    'reviewedQuantity',v_quantity,'reviewedHours',v_hours,
    'eligibleForFinanceReview',v_eligible,
    'billingTermsKnown',length(trim(coalesce(v_authorization->>'conditions','')))>0,
    'invoiceStatus','Unknown','paymentStatus','Unknown',
    'actualCostStatus','Unknown');
end; $$;
revoke all on function d5o_hosted.current_service_finance_basis_v1(uuid,uuid,text)
  from public,anon,authenticated,service_role;

create function public.d5o_hosted_service_finance_read_v1(
  p_workspace_key text,p_parent_presentation_id text,p_request_id text
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_workspace uuid;v_parent uuid;v_basis jsonb;
  v_decision d5o_hosted.connected_service_finance_states%rowtype;
  v_history jsonb;v_work_revision bigint;v_operate_revision integer;
begin
  if current_setting('role',true)<>'authenticated' or auth.uid() is null then
    raise exception 'service_finance_auth_required' using errcode='42501'; end if;
  select w.id,l.work_id into v_workspace,v_parent
    from d5o_hosted.workspaces w
    join d5o_hosted.memberships m on m.workspace_id=w.id
      and m.actor_user_id=auth.uid() and m.status='active'
    join d5o_hosted.work_identity_links l on l.workspace_id=w.id
      and l.presentation_id=p_parent_presentation_id and l.parent_work_id is null
    where w.workspace_key=p_workspace_key and w.status='active'
      and m.role in ('project_manager','billing_commercial_lead',
        'operations_leader','admin','executive');
  if v_parent is null then raise exception 'service_finance_scope_forbidden' using errcode='42501'; end if;
  v_basis:=d5o_hosted.current_service_finance_basis_v1(v_workspace,v_parent,p_request_id);
  select revision into v_work_revision from d5o_hosted.prototype_states
    where workspace_id=v_workspace and state_key='work';
  select decision_revision into v_operate_revision
    from d5o_hosted.connected_operate_states
    where workspace_id=v_workspace and work_id=v_parent;
  select * into v_decision from d5o_hosted.connected_service_finance_states
    where workspace_id=v_workspace and parent_work_id=v_parent and request_id=p_request_id;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'revision',e.revision,'action',e.action,'actorId',e.actor_user_id,
    'at',e.at,'snapshot',e.snapshot) order by e.revision),'[]'::jsonb)
    into v_history from d5o_hosted.connected_service_finance_events e
    where e.workspace_id=v_workspace and e.parent_work_id=v_parent
      and e.request_id=p_request_id;
  return pg_catalog.jsonb_build_object(
    'basis',v_basis,'basisDigest',pg_catalog.md5(v_basis::text),
    'decision',case when v_decision.parent_work_id is null then null else
      pg_catalog.to_jsonb(v_decision) end,
    'decisionCurrent',v_decision.parent_work_id is not null and
      v_decision.basis_digest=pg_catalog.md5(v_basis::text),
    'revision',coalesce(v_decision.revision,0),
    'workRevision',v_work_revision,'operateRevision',v_operate_revision,
    'history',v_history);
end; $$;
revoke all on function public.d5o_hosted_service_finance_read_v1(text,text,text)
  from public,anon,service_role;
grant execute on function public.d5o_hosted_service_finance_read_v1(text,text,text)
  to authenticated;

create function public.d5o_hosted_service_finance_command_v1(
  p_workspace_key text,p_parent_presentation_id text,p_request_id text,
  p_action text,p_input jsonb,p_command_id text,
  p_expected_work_revision bigint,p_expected_operate_revision integer,
  p_expected_design_revision integer,p_expected_deploy_revision integer,
  p_expected_finance_revision integer,p_expected_basis_digest text
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
  v_member d5o_hosted.memberships%rowtype;v_parent d5o_hosted.work_records%rowtype;
  v_raw d5o_hosted.prototype_states%rowtype;
  v_operate d5o_hosted.connected_operate_states%rowtype;
  v_current d5o_hosted.connected_service_finance_states%rowtype;
  v_receipt d5o_hosted.connected_service_finance_receipts%rowtype;
  v_basis jsonb;v_digest text;v_fingerprint text;v_next jsonb;v_result jsonb;
  v_child uuid;
  v_revision integer;v_note text:=trim(coalesce(p_input->>'note',''));
  v_terms text:=nullif(trim(coalesce(p_input->>'billingTermsStatement','')),'');
  v_terms_id uuid;v_now timestamptz:=now();
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or p_action not in ('prepare','review-ready','review-hold')
    or pg_catalog.jsonb_typeof(p_input)<>'object'
    or length(coalesce(p_command_id,'')) not between 8 and 120
    or p_expected_work_revision is null or p_expected_operate_revision is null
    or p_expected_design_revision is null or p_expected_deploy_revision is null
    or p_expected_finance_revision is null
    or length(coalesce(p_expected_basis_digest,''))<>32 then
    raise exception 'invalid_service_finance_command' using errcode='22023'; end if;
  if nullif(p_input->>'billingTermsEvidenceId','') is not null then
    if (p_input->>'billingTermsEvidenceId') !~ '^[0-9a-f-]{36}$' then
      raise exception 'invalid_billing_terms_evidence' using errcode='22023'; end if;
    v_terms_id:=(p_input->>'billingTermsEvidenceId')::uuid;
  end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('d5o-connected:'||v_workspace.id::text,0));
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor and status='active' for share;
  if not found or p_action='prepare' and v_member.role<>'project_manager'
    or p_action<>'prepare' and v_member.role<>'billing_commercial_lead' then
    raise exception 'service_finance_role_required' using errcode='42501'; end if;
  select w.* into v_parent from d5o_hosted.work_records w
    join d5o_hosted.work_identity_links l on l.workspace_id=w.workspace_id
      and l.work_id=w.id and l.parent_work_id is null
    where w.workspace_id=v_workspace.id and l.presentation_id=p_parent_presentation_id
    for update of w;
  if not found then raise exception 'canonical_parent_required' using errcode='23503'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(
    p_workspace_key,p_parent_presentation_id,p_request_id,p_action,p_input,
    p_expected_work_revision,p_expected_operate_revision,p_expected_design_revision,
    p_expected_deploy_revision,p_expected_finance_revision,p_expected_basis_digest)::text);
  select * into v_receipt from d5o_hosted.connected_service_finance_receipts
    where workspace_id=v_workspace.id and command_id=p_command_id;
  if found then
    if v_receipt.parent_work_id<>v_parent.id or v_receipt.actor_user_id<>v_actor
      or v_receipt.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_receipt.result; end if;
  select * into v_raw from d5o_hosted.prototype_states
    where workspace_id=v_workspace.id and state_key='work' for share;
  select * into v_operate from d5o_hosted.connected_operate_states
    where workspace_id=v_workspace.id and work_id=v_parent.id for share;
  select s.work_id into v_child from d5o_hosted.connected_service_work s
    where s.workspace_id=v_workspace.id and s.parent_work_id=v_parent.id
      and s.request_id=p_request_id for share;
  if v_child is null then
    raise exception 'service_finance_execution_incomplete' using errcode='23514'; end if;
  perform 1 from d5o_hosted.work_records
    where workspace_id=v_workspace.id and id=v_child for share;
  perform 1 from d5o_hosted.connected_design_handoffs
    where workspace_id=v_workspace.id and work_id=v_child for share;
  perform 1 from d5o_hosted.connected_design_states
    where workspace_id=v_workspace.id and work_id=v_child for share;
  perform 1 from d5o_hosted.connected_deploy_states
    where workspace_id=v_workspace.id and work_id=v_child for share;
  select * into v_current from d5o_hosted.connected_service_finance_states
    where workspace_id=v_workspace.id and parent_work_id=v_parent.id
      and request_id=p_request_id for update;
  v_basis:=d5o_hosted.current_service_finance_basis_v1(
    v_workspace.id,v_parent.id,p_request_id);
  v_digest:=pg_catalog.md5(v_basis::text);
  if v_raw.revision is distinct from p_expected_work_revision
    or v_operate.decision_revision is distinct from p_expected_operate_revision
    or (v_basis->>'designRevision')::integer is distinct from p_expected_design_revision
    or (v_basis->>'deployRevision')::integer is distinct from p_expected_deploy_revision
    or coalesce(v_current.revision,0)<>p_expected_finance_revision
    or v_digest<>p_expected_basis_digest then
    raise exception 'stale_service_finance_basis' using errcode='23505'; end if;
  if v_basis->>'eligibleForFinanceReview'<>'true' then
    raise exception 'service_finance_execution_incomplete' using errcode='23514'; end if;
  v_revision:=coalesce(v_current.revision,0)+1;
  if p_action='prepare' then
    if length(v_note)<15 or (v_terms is null)<>(v_terms_id is null)
      or v_terms is not null and length(v_terms)<20
      or v_terms is not null and v_terms is distinct from
        nullif(trim(coalesce(v_basis->>'authorizationConditions','')),'')
      or v_terms_id is not null and v_terms_id::text<>v_basis->>'authorizationEvidenceId' then
      raise exception 'service_finance_preparation_invalid' using errcode='23514'; end if;
    v_next:=pg_catalog.jsonb_build_object('status','Prepared','revision',v_revision,
      'basis',v_basis,'basisDigest',v_digest,'preparedBy',v_actor,
      'preparedAt',v_now,'billingTermsEvidenceId',v_terms_id,
      'billingTermsStatement',v_terms,'note',v_note);
  else
    if v_current.status<>'Prepared' or v_current.basis_digest<>v_digest
      or v_current.prepared_by=v_actor or length(v_note)<20 then
      raise exception 'independent_service_finance_review_required' using errcode='42501'; end if;
    if p_action='review-ready' and (v_basis->>'billingTermsKnown'<>'true'
      or v_current.billing_terms_evidence_id is null
      or length(coalesce(v_current.billing_terms_statement,''))<20) then
      raise exception 'service_billing_terms_missing' using errcode='23514'; end if;
    v_next:=pg_catalog.jsonb_build_object(
      'status',case when p_action='review-ready' then 'Ready for billing' else 'Hold' end,
      'revision',v_revision,'basis',v_basis,'basisDigest',v_digest,
      'preparedBy',v_current.prepared_by,'preparedAt',v_current.prepared_at,
      'billingTermsEvidenceId',v_current.billing_terms_evidence_id,
      'billingTermsStatement',v_current.billing_terms_statement,
      'reviewedBy',v_actor,'reviewedAt',v_now,'reviewReason',v_note);
  end if;
  insert into d5o_hosted.connected_service_finance_states(
    workspace_id,parent_work_id,request_id,revision,basis,basis_digest,status,
    prepared_by,prepared_at,billing_terms_evidence_id,billing_terms_statement,
    reviewed_by,reviewed_at,review_reason)
  values(v_workspace.id,v_parent.id,p_request_id,v_revision,v_basis,v_digest,
    v_next->>'status',(v_next->>'preparedBy')::uuid,
    (v_next->>'preparedAt')::timestamptz,
    nullif(v_next->>'billingTermsEvidenceId','')::uuid,
    v_next->>'billingTermsStatement',
    nullif(v_next->>'reviewedBy','')::uuid,
    nullif(v_next->>'reviewedAt','')::timestamptz,v_next->>'reviewReason')
  on conflict(workspace_id,parent_work_id,request_id) do update set
    revision=excluded.revision,basis=excluded.basis,
    basis_digest=excluded.basis_digest,status=excluded.status,
    prepared_by=excluded.prepared_by,prepared_at=excluded.prepared_at,
    billing_terms_evidence_id=excluded.billing_terms_evidence_id,
    billing_terms_statement=excluded.billing_terms_statement,
    reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at,
    review_reason=excluded.review_reason;
  insert into d5o_hosted.connected_service_finance_events(
    workspace_id,parent_work_id,request_id,revision,command_id,action,
    actor_user_id,membership_id,basis_digest,snapshot)
  values(v_workspace.id,v_parent.id,p_request_id,v_revision,p_command_id,p_action,
    v_actor,v_member.id,v_digest,v_next);
  v_result:=pg_catalog.jsonb_build_object('basis',v_basis,'basisDigest',v_digest,
    'decision',v_next,'decisionCurrent',true,'revision',v_revision);
  insert into d5o_hosted.connected_service_finance_receipts(
    workspace_id,command_id,parent_work_id,actor_user_id,fingerprint,result)
  values(v_workspace.id,p_command_id,v_parent.id,v_actor,v_fingerprint,v_result);
  return v_result;
end; $$;
revoke all on function public.d5o_hosted_service_finance_command_v1(
  text,text,text,text,jsonb,text,bigint,integer,integer,integer,integer,text)
  from public,anon,service_role;
grant execute on function public.d5o_hosted_service_finance_command_v1(
  text,text,text,text,jsonb,text,bigint,integer,integer,integer,integer,text)
  to authenticated;
