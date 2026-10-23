-- Retained customer billing terms are a distinct source from operational authorization conditions.
alter table d5o_hosted.customer_decision_evidence
  drop constraint customer_decision_evidence_purpose_check;
alter table d5o_hosted.customer_decision_evidence
  add constraint customer_decision_evidence_purpose_check
  check (purpose in ('package-acceptance','work-acceptance','service-authorization',
    'field-change-authorization','service-billing-terms'));

create table d5o_hosted.connected_service_billing_terms (
  workspace_id uuid not null references d5o_hosted.workspaces(id),
  parent_work_id uuid not null,
  request_id text not null,
  revision integer not null check (revision > 0),
  source_basis jsonb not null,
  source_digest text not null,
  terms jsonb not null,
  evidence_id uuid not null references d5o_hosted.customer_decision_evidence(id),
  evidence_checksum text not null,
  recorded_by uuid not null references auth.users(id),
  recorded_at timestamptz not null,
  primary key (workspace_id,parent_work_id,request_id),
  foreign key (parent_work_id,workspace_id)
    references d5o_hosted.work_records(id,workspace_id)
);
create table d5o_hosted.connected_service_billing_terms_events (
  workspace_id uuid not null,
  parent_work_id uuid not null,
  request_id text not null,
  revision integer not null,
  command_id text not null,
  actor_user_id uuid not null,
  membership_id uuid not null,
  source_digest text not null,
  snapshot jsonb not null,
  at timestamptz not null default now(),
  primary key (workspace_id,parent_work_id,request_id,revision),
  unique (workspace_id,command_id)
);
create table d5o_hosted.connected_service_billing_terms_receipts (
  workspace_id uuid not null,
  command_id text not null,
  parent_work_id uuid not null,
  actor_user_id uuid not null,
  fingerprint text not null,
  result jsonb not null,
  at timestamptz not null default now(),
  primary key (workspace_id,command_id)
);
alter table d5o_hosted.connected_service_billing_terms enable row level security;
alter table d5o_hosted.connected_service_billing_terms_events enable row level security;
alter table d5o_hosted.connected_service_billing_terms_receipts enable row level security;
revoke all on d5o_hosted.connected_service_billing_terms,
  d5o_hosted.connected_service_billing_terms_events,
  d5o_hosted.connected_service_billing_terms_receipts
  from public,anon,authenticated,service_role;

-- This projection intentionally excludes Finance disposition and the terms row.
-- It is the exact source to which both the document and the terms decision bind.
create function d5o_hosted.service_billing_terms_source_v1(
  p_workspace uuid,p_parent uuid,p_request_id text
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare b jsonb;
begin
  b:=d5o_hosted.current_service_finance_basis_v1(p_workspace,p_parent,p_request_id);
  return pg_catalog.jsonb_build_object(
    'requestId',b->'requestId','requestCycleAt',b->'requestCycleAt',
    'coverage',b->'coverage','assetId',b->'assetId',
    'agreementId',b->'agreementId','agreementRevision',b->'agreementRevision',
    'childWorkId',b->'childWorkId','estimateRevision',b->'estimateRevision',
    'uncoveredAmountMinor',b->'uncoveredAmountMinor','currency',b->'currency',
    'authorizationEvidenceId',b->'authorizationEvidenceId',
    'authorizationChecksum',b->'authorizationChecksum',
    'coveredScope',b->'coveredScope','uncoveredScope',b->'uncoveredScope',
    'serviceBasisRevision',b->'serviceBasisRevision',
    'serviceBasisDigest',b->'serviceBasisDigest',
    'releaseId',b->'releaseId','packageRevision',b->'packageRevision',
    'designRevision',b->'designRevision','deployRevision',b->'deployRevision',
    'workAcceptanceId',b->'workAcceptanceId',
    'workAcceptanceRevision',b->'workAcceptanceRevision',
    'reviewedQuantity',b->'reviewedQuantity','reviewedHours',b->'reviewedHours',
    'eligibleForFinanceReview',b->'eligibleForFinanceReview');
end; $$;
revoke all on function d5o_hosted.service_billing_terms_source_v1(uuid,uuid,text)
  from public,anon,authenticated,service_role;

-- The existing private-object route calls this server-only registration function.
-- Reject caller-supplied basis that does not equal the current canonical source.
create or replace function public.d5o_hosted_register_customer_decision_evidence_v1(
  p_workspace_key text,p_presentation_id text,p_evidence_id uuid,
  p_purpose text,p_scope_id text,p_scope_revision integer,p_basis jsonb,
  p_checksum_sha256 text,p_filename text,p_uploader_id uuid
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_workspace d5o_hosted.workspaces%rowtype;
  v_work d5o_hosted.work_records%rowtype;
  v_member d5o_hosted.memberships%rowtype;
  v_object storage.objects%rowtype;v_path text;v_source jsonb;
begin
  if current_setting('role',true)<>'service_role' or p_evidence_id is null
    or p_purpose not in ('package-acceptance','work-acceptance','service-authorization',
      'field-change-authorization','service-billing-terms')
    or p_scope_revision<1 or pg_catalog.jsonb_typeof(p_basis)<>'object'
    or p_checksum_sha256 !~ '^[0-9a-f]{64}$' or p_uploader_id is null then
    raise exception 'invalid_customer_evidence_registration' using errcode='42501'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  select w.* into v_work from d5o_hosted.work_records w
    join d5o_hosted.work_identity_links l on l.workspace_id=w.workspace_id and l.work_id=w.id
    where w.workspace_id=v_workspace.id and l.presentation_id=p_presentation_id;
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=p_uploader_id and status='active';
  if v_work.id is null or v_member.id is null or v_member.role not in
    ('project_manager','operations_leader','field_supervisor') then
    raise exception 'customer_evidence_scope_denied' using errcode='42501'; end if;
  if p_purpose='service-billing-terms' then
    if v_member.role<>'project_manager' then
      raise exception 'service_billing_terms_role_required' using errcode='42501'; end if;
    v_source:=d5o_hosted.service_billing_terms_source_v1(
      v_workspace.id,v_work.id,p_scope_id);
    if v_source->>'eligibleForFinanceReview'<>'true'
      or p_scope_revision is distinct from (v_source->>'estimateRevision')::integer
      or p_basis is distinct from v_source then
      raise exception 'stale_service_billing_terms_source' using errcode='23505'; end if;
  end if;
  v_path:=p_workspace_key||'/'||pg_catalog.encode(
    extensions.digest(p_presentation_id,'sha256'),'hex')||'/customer-decisions/'||p_evidence_id::text;
  select * into v_object from storage.objects
    where bucket_id='d5o-deploy-evidence' and name=v_path;
  if v_object.id is null or v_object.metadata->>'mimetype'<>'application/pdf'
    or (v_object.metadata->>'size')::bigint not between 1 and 10485760 then
    raise exception 'customer_evidence_object_missing' using errcode='23514'; end if;
  insert into d5o_hosted.customer_decision_evidence(
    id,workspace_id,work_id,presentation_id,purpose,scope_id,scope_revision,basis,
    object_path,storage_object_id,storage_updated_at,checksum_sha256,size_bytes,
    mime_type,filename,uploaded_by)
  values(p_evidence_id,v_workspace.id,v_work.id,p_presentation_id,p_purpose,
    p_scope_id,p_scope_revision,p_basis,v_path,v_object.id,v_object.updated_at,
    p_checksum_sha256,(v_object.metadata->>'size')::bigint,'application/pdf',
    left(p_filename,200),p_uploader_id);
  return pg_catalog.jsonb_build_object('evidenceId',p_evidence_id,
    'checksumSha256',p_checksum_sha256,'sizeBytes',(v_object.metadata->>'size')::bigint);
end; $$;
revoke all on function public.d5o_hosted_register_customer_decision_evidence_v1(
  text,text,uuid,text,text,integer,jsonb,text,text,uuid)
  from public,anon,authenticated;
grant execute on function public.d5o_hosted_register_customer_decision_evidence_v1(
  text,text,uuid,text,text,integer,jsonb,text,text,uuid) to service_role;

create function public.d5o_hosted_service_billing_terms_command_v1(
  p_workspace_key text,p_parent_presentation_id text,p_request_id text,
  p_input jsonb,p_command_id text,p_expected_work_revision bigint,
  p_expected_operate_revision integer,p_expected_design_revision integer,
  p_expected_deploy_revision integer,p_expected_terms_revision integer,
  p_expected_source_digest text
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
  v_member d5o_hosted.memberships%rowtype;v_parent d5o_hosted.work_records%rowtype;
  v_raw d5o_hosted.prototype_states%rowtype;
  v_operate d5o_hosted.connected_operate_states%rowtype;
  v_current d5o_hosted.connected_service_billing_terms%rowtype;
  v_receipt d5o_hosted.connected_service_billing_terms_receipts%rowtype;
  v_source jsonb;v_digest text;v_fingerprint text;v_doc jsonb;
  v_terms jsonb;v_result jsonb;v_revision integer;v_child uuid;
  v_evidence_id text:=trim(coalesce(p_input->>'evidenceId',''));
  v_basis text:=trim(coalesce(p_input->>'billingBasis',''));
  v_trigger text:=trim(coalesce(p_input->>'billingTrigger',''));
  v_payment text:=trim(coalesce(p_input->>'paymentTerms',''));
  v_party text:=trim(coalesce(p_input->>'customerParty',''));
  v_organization text:=trim(coalesce(p_input->>'customerOrganization',''));
  v_role text:=trim(coalesce(p_input->>'customerRole',''));
  v_authority text:=trim(coalesce(p_input->>'authorityBasis',''));
  v_note text:=trim(coalesce(p_input->>'note',''));
  v_now timestamptz:=now();
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or pg_catalog.jsonb_typeof(p_input)<>'object'
    or length(coalesce(p_command_id,'')) not between 8 and 120
    or p_expected_work_revision is null or p_expected_operate_revision is null
    or p_expected_design_revision is null or p_expected_deploy_revision is null
    or p_expected_terms_revision is null
    or length(coalesce(p_expected_source_digest,''))<>32
    or v_evidence_id !~ '^[0-9a-f-]{36}$'
    or p_input - 'evidenceId' - 'billingBasis' - 'billingTrigger'
      - 'paymentTerms' - 'customerParty' - 'customerOrganization'
      - 'customerRole' - 'authorityBasis' - 'note' <> '{}'::jsonb
    or v_basis<>'Fixed fee for approved uncovered scope'
    or v_trigger<>'Accepted service scope'
    or v_payment !~* '^(Net [0-9]{1,3} days from invoice|Due on receipt of invoice)$'
    or length(v_party)<5 or length(v_organization)<5 or length(v_role)<5
    or length(v_authority)<15 or length(v_note)<15 then
    raise exception 'invalid_service_billing_terms_command' using errcode='22023'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('d5o-connected:'||v_workspace.id::text,0));
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor
      and status='active' for share;
  if not found or v_member.role<>'project_manager' then
    raise exception 'service_billing_terms_role_required' using errcode='42501'; end if;
  select w.* into v_parent from d5o_hosted.work_records w
    join d5o_hosted.work_identity_links l on l.workspace_id=w.workspace_id
      and l.work_id=w.id and l.parent_work_id is null
    where w.workspace_id=v_workspace.id and l.presentation_id=p_parent_presentation_id
    for update of w;
  if not found then raise exception 'canonical_parent_required' using errcode='23503'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(
    p_workspace_key,p_parent_presentation_id,p_request_id,p_input,p_expected_work_revision,
    p_expected_operate_revision,p_expected_design_revision,p_expected_deploy_revision,
    p_expected_terms_revision,p_expected_source_digest)::text);
  select * into v_receipt from d5o_hosted.connected_service_billing_terms_receipts
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
  perform 1 from d5o_hosted.work_records
    where workspace_id=v_workspace.id and id=v_child for share;
  perform 1 from d5o_hosted.connected_design_handoffs
    where workspace_id=v_workspace.id and work_id=v_child for share;
  perform 1 from d5o_hosted.connected_design_states
    where workspace_id=v_workspace.id and work_id=v_child for share;
  perform 1 from d5o_hosted.connected_deploy_states
    where workspace_id=v_workspace.id and work_id=v_child for share;
  select * into v_current from d5o_hosted.connected_service_billing_terms
    where workspace_id=v_workspace.id and parent_work_id=v_parent.id
      and request_id=p_request_id for update;
  v_source:=d5o_hosted.service_billing_terms_source_v1(
    v_workspace.id,v_parent.id,p_request_id);
  v_digest:=pg_catalog.md5(v_source::text);
  if v_raw.revision is distinct from p_expected_work_revision
    or v_operate.decision_revision is distinct from p_expected_operate_revision
    or (v_source->>'designRevision')::integer is distinct from p_expected_design_revision
    or (v_source->>'deployRevision')::integer is distinct from p_expected_deploy_revision
    or coalesce(v_current.revision,0)<>p_expected_terms_revision
    or v_digest<>p_expected_source_digest then
    raise exception 'stale_service_billing_terms_source' using errcode='23505'; end if;
  if v_source->>'eligibleForFinanceReview'<>'true'
    or v_source->>'coverage'<>'Partially covered'
    or v_source->>'uncoveredAmountMinor' !~ '^[0-9]+$'
    or (v_source->>'uncoveredAmountMinor')::bigint<1
    or v_source->>'currency'<>'USD' then
    raise exception 'unsupported_service_billing_terms_basis' using errcode='23514'; end if;
  v_doc:=d5o_hosted.require_customer_decision_evidence_v1(
    v_workspace.id,v_parent.id,v_evidence_id,'service-billing-terms',
    p_request_id,(v_source->>'estimateRevision')::integer,v_source);
  v_revision:=coalesce(v_current.revision,0)+1;
  v_terms:=pg_catalog.jsonb_build_object(
    'billingBasis',v_basis,'billingTrigger',v_trigger,'paymentTerms',v_payment,
    'customerParty',v_party,'customerOrganization',v_organization,
    'customerRole',v_role,'authorityBasis',v_authority,'note',v_note,
    'requestCycleAt',v_source->>'requestCycleAt',
    'childWorkId',v_source->>'childWorkId',
    'coveredScope',v_source->>'coveredScope',
    'uncoveredScope',v_source->>'uncoveredScope',
    'uncoveredAmountMinor',v_source->>'uncoveredAmountMinor',
    'currency',v_source->>'currency',
    'recordedBy',v_actor,'recordedAt',v_now);
  insert into d5o_hosted.connected_service_billing_terms(
    workspace_id,parent_work_id,request_id,revision,source_basis,source_digest,
    terms,evidence_id,evidence_checksum,recorded_by,recorded_at)
  values(v_workspace.id,v_parent.id,p_request_id,v_revision,v_source,v_digest,
    v_terms,(v_doc->>'id')::uuid,v_doc->>'checksumSha256',v_actor,v_now)
  on conflict(workspace_id,parent_work_id,request_id) do update set
    revision=excluded.revision,source_basis=excluded.source_basis,
    source_digest=excluded.source_digest,terms=excluded.terms,
    evidence_id=excluded.evidence_id,evidence_checksum=excluded.evidence_checksum,
    recorded_by=excluded.recorded_by,recorded_at=excluded.recorded_at;
  v_result:=pg_catalog.jsonb_build_object('revision',v_revision,
    'sourceDigest',v_digest,'terms',v_terms,'evidence',v_doc);
  insert into d5o_hosted.connected_service_billing_terms_events(
    workspace_id,parent_work_id,request_id,revision,command_id,actor_user_id,
    membership_id,source_digest,snapshot)
  values(v_workspace.id,v_parent.id,p_request_id,v_revision,p_command_id,
    v_actor,v_member.id,v_digest,v_result);
  insert into d5o_hosted.connected_service_billing_terms_receipts(
    workspace_id,command_id,parent_work_id,actor_user_id,fingerprint,result)
  values(v_workspace.id,p_command_id,v_parent.id,v_actor,v_fingerprint,v_result);
  return v_result;
end; $$;
revoke all on function public.d5o_hosted_service_billing_terms_command_v1(
  text,text,text,jsonb,text,bigint,integer,integer,integer,integer,text)
  from public,anon,service_role;
grant execute on function public.d5o_hosted_service_billing_terms_command_v1(
  text,text,text,jsonb,text,bigint,integer,integer,integer,integer,text)
  to authenticated;

-- Existing Finance actions now consume only explicit retained terms. The old
-- authenticated entry point is replaced so it cannot regain the text inference.
create or replace function d5o_hosted.current_service_finance_basis_v1(
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
  v_core jsonb;v_source jsonb;
  v_terms d5o_hosted.connected_service_billing_terms%rowtype;
  v_terms_doc d5o_hosted.customer_decision_evidence%rowtype;
  v_terms_object storage.objects%rowtype;
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
  v_core:=pg_catalog.jsonb_build_object(
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
    'billingTermsKnown',false,
    'invoiceStatus','Unknown','paymentStatus','Unknown',
    'actualCostStatus','Unknown');
  v_source:=pg_catalog.jsonb_build_object(
    'requestId',v_core->'requestId',
    'requestCycleAt',v_core->'requestCycleAt',
    'coverage',v_core->'coverage',
    'assetId',v_core->'assetId',
    'agreementId',v_core->'agreementId',
    'agreementRevision',v_core->'agreementRevision',
    'childWorkId',v_core->'childWorkId',
    'estimateRevision',v_core->'estimateRevision',
    'uncoveredAmountMinor',v_core->'uncoveredAmountMinor',
    'currency',v_core->'currency',
    'authorizationEvidenceId',v_core->'authorizationEvidenceId',
    'authorizationChecksum',v_core->'authorizationChecksum',
    'coveredScope',v_core->'coveredScope',
    'uncoveredScope',v_core->'uncoveredScope',
    'serviceBasisRevision',v_core->'serviceBasisRevision',
    'serviceBasisDigest',v_core->'serviceBasisDigest',
    'releaseId',v_core->'releaseId',
    'packageRevision',v_core->'packageRevision',
    'designRevision',v_core->'designRevision',
    'deployRevision',v_core->'deployRevision',
    'workAcceptanceId',v_core->'workAcceptanceId',
    'workAcceptanceRevision',v_core->'workAcceptanceRevision',
    'reviewedQuantity',v_core->'reviewedQuantity',
    'reviewedHours',v_core->'reviewedHours',
    'eligibleForFinanceReview',v_core->'eligibleForFinanceReview');
  select * into v_terms from d5o_hosted.connected_service_billing_terms
    where workspace_id=p_workspace and parent_work_id=p_parent
      and request_id=p_request_id and source_basis=v_source;
  if v_terms.parent_work_id is not null then
    select * into v_terms_doc from d5o_hosted.customer_decision_evidence
      where id=v_terms.evidence_id and workspace_id=p_workspace
        and work_id=p_parent and purpose='service-billing-terms'
        and scope_id=p_request_id
        and scope_revision=(v_core->>'estimateRevision')::integer
        and basis=v_source and checksum_sha256=v_terms.evidence_checksum;
    select * into v_terms_object from storage.objects
      where bucket_id='d5o-deploy-evidence'
        and name=v_terms_doc.object_path;
    if v_terms_doc.id is null or v_terms_object.id is distinct from
        v_terms_doc.storage_object_id or v_terms_object.updated_at is distinct from
        v_terms_doc.storage_updated_at or
        (v_terms_object.metadata->>'size')::bigint is distinct from
        v_terms_doc.size_bytes then
      v_terms:=null;
    end if;
  end if;
  return v_core || pg_catalog.jsonb_build_object(
    'billingTermsKnown',v_terms.parent_work_id is not null,
    'billingTermsRevision',v_terms.revision,
    'billingTermsEvidenceId',v_terms.evidence_id,
    'billingTermsChecksum',v_terms.evidence_checksum,
    'billingTerms',v_terms.terms,
    'billingTermsRecordedBy',v_terms.recorded_by,
    'billingTermsRecordedAt',v_terms.recorded_at,
    'billingTermsStatement',case when v_terms.parent_work_id is not null then
      (v_terms.terms->>'billingBasis')||'; '||
      (v_terms.terms->>'billingTrigger')||'; '||
      (v_terms.terms->>'paymentTerms') else null end);
end; $$;

create or replace function public.d5o_hosted_service_finance_command_v1(
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
    if length(v_note)<15
      or (v_terms is null)<>(v_terms_id is null)
      or (v_basis->>'billingTermsKnown'='true' and
        (v_terms is distinct from v_basis->>'billingTermsStatement'
          or v_terms_id::text is distinct from v_basis->>'billingTermsEvidenceId'))
      or (v_basis->>'billingTermsKnown'<>'true' and v_terms is not null) then
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
      or length(coalesce(v_current.billing_terms_statement,''))<20
      or v_current.billing_terms_evidence_id::text is distinct from
        v_basis->>'billingTermsEvidenceId'
      or v_current.billing_terms_statement is distinct from
        v_basis->>'billingTermsStatement') then
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

create or replace function public.d5o_hosted_service_finance_read_v1(
  p_workspace_key text,p_parent_presentation_id text,p_request_id text
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_workspace uuid;v_parent uuid;v_basis jsonb;
  v_decision d5o_hosted.connected_service_finance_states%rowtype;
  v_history jsonb;v_work_revision bigint;v_operate_revision integer;
  v_source jsonb;v_terms_revision integer;
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
  v_source:=d5o_hosted.service_billing_terms_source_v1(v_workspace,v_parent,p_request_id);
  select revision into v_terms_revision from d5o_hosted.connected_service_billing_terms
    where workspace_id=v_workspace and parent_work_id=v_parent and request_id=p_request_id;
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
    'termsSource',v_source,'termsSourceDigest',pg_catalog.md5(v_source::text),
    'termsRevision',coalesce(v_terms_revision,0),
    'decision',case when v_decision.parent_work_id is null then null else
      pg_catalog.to_jsonb(v_decision) end,
    'decisionCurrent',v_decision.parent_work_id is not null and
      v_decision.basis_digest=pg_catalog.md5(v_basis::text),
    'revision',coalesce(v_decision.revision,0),
    'workRevision',v_work_revision,'operateRevision',v_operate_revision,
    'history',v_history);
end; $$;

create function public.d5o_hosted_service_billing_terms_evidence_list_v1(
  p_workspace_key text,p_presentation_id text,p_request_id text
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_workspace uuid;v_parent uuid;v_source jsonb;
begin
  if current_setting('role',true)<>'service_role' then
    raise exception 'server_only' using errcode='42501'; end if;
  select w.id,l.work_id into v_workspace,v_parent
    from d5o_hosted.workspaces w
    join d5o_hosted.work_identity_links l on l.workspace_id=w.id
      and l.presentation_id=p_presentation_id and l.parent_work_id is null
    where w.workspace_key=p_workspace_key and w.status='active';
  if v_parent is null then raise exception 'canonical_parent_required' using errcode='23503'; end if;
  v_source:=d5o_hosted.service_billing_terms_source_v1(
    v_workspace,v_parent,p_request_id);
  return coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',e.id,'filename',e.filename,'checksumSha256',e.checksum_sha256,
      'currentSource',e.basis=v_source,
      'uploadedAt',e.uploaded_at,'uploadedBy',e.uploaded_by)
      order by e.uploaded_at desc)
    from d5o_hosted.customer_decision_evidence e
    join storage.objects o on o.id=e.storage_object_id and o.name=e.object_path
    where e.workspace_id=v_workspace and e.work_id=v_parent
      and e.purpose='service-billing-terms' and e.scope_id=p_request_id
      and o.updated_at=e.storage_updated_at
      and (o.metadata->>'size')::bigint=e.size_bytes),'[]'::jsonb);
end; $$;
revoke all on function public.d5o_hosted_service_billing_terms_evidence_list_v1(
  text,text,text) from public,anon,authenticated;
grant execute on function public.d5o_hosted_service_billing_terms_evidence_list_v1(
  text,text,text) to service_role;
