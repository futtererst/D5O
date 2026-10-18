-- Preserve the documented fixed-fee/accepted-service billing model while allowing its
-- already-supported Net-day terms to issue an invoice with the corresponding due date.
-- Historical invoices and their issued snapshots remain unchanged.

create function d5o_hosted.service_invoice_due_date_v1(
  p_invoice_date date,p_payment_terms text
) returns date language plpgsql immutable set search_path='' as $$
begin
  if p_invoice_date is null or p_payment_terms is null or
    p_payment_terms !~ '^(Net [1-9][0-9]{0,2} days from invoice|Due on receipt of invoice)$' then
    raise exception 'unsupported_service_payment_terms' using errcode='22023';
  end if;
  return p_invoice_date + case when p_payment_terms='Due on receipt of invoice'
    then 0 else pg_catalog.substring(p_payment_terms,
      '^Net ([1-9][0-9]{0,2}) days from invoice$')::integer end;
end; $$;
revoke all on function d5o_hosted.service_invoice_due_date_v1(date,text)
  from public,anon,authenticated,service_role;

create or replace function public.d5o_hosted_service_billing_terms_command_v1(
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
    or v_payment !~ '^(Net [1-9][0-9]{0,2} days from invoice|Due on receipt of invoice)$'
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

create or replace function public.d5o_hosted_service_invoice_command_v1(
  p_workspace_key text,p_parent_presentation_id text,p_request_id text,
  p_action text,p_input jsonb,p_command_id text,
  p_expected_work_revision bigint,p_expected_operate_revision integer,
  p_expected_design_revision integer,p_expected_deploy_revision integer,
  p_expected_finance_revision integer,p_expected_basis_digest text,
  p_expected_invoice_revision integer,p_expected_ledger_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
  v_member d5o_hosted.memberships%rowtype;v_parent d5o_hosted.work_records%rowtype;
  v_invoice d5o_hosted.connected_service_invoices%rowtype;
  v_fin d5o_hosted.connected_service_finance_states%rowtype;
  v_receipt d5o_hosted.connected_service_invoice_receipts%rowtype;
  v_basis jsonb;v_digest text;v_fingerprint text;v_result jsonb;
  v_raw_revision bigint;v_operate_revision integer;v_paid bigint:=0;
  v_now timestamptz:=now();v_note text:=trim(coalesce(p_input->>'note',''));
  v_source text:=trim(coalesce(p_input->>'source',''));
  v_amount bigint;v_invoice_id uuid;v_payment_id uuid;
  v_payment_date date;v_invoice_date date;v_due_date date;
  v_terms text;v_cycle text;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or p_action not in ('draft','submit','return','revise','review','issue','record-payment')
    or pg_catalog.jsonb_typeof(p_input)<>'object'
    or length(coalesce(p_command_id,'')) not between 8 and 120
    or p_expected_invoice_revision is null or p_expected_ledger_revision is null
    or p_expected_invoice_revision<0 or p_expected_ledger_revision<0 then
    raise exception 'invalid_service_invoice_command' using errcode='22023'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('d5o-connected:'||v_workspace.id::text,0));
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor and status='active' for share;
  if not found or (p_action in ('draft','submit','revise') and v_member.role<>'project_manager')
    or (p_action in ('return','review','issue','record-payment')
      and v_member.role<>'billing_commercial_lead') then
    raise exception 'service_invoice_role_required' using errcode='42501'; end if;
  select w.* into v_parent from d5o_hosted.work_records w
    join d5o_hosted.work_identity_links l on l.workspace_id=w.workspace_id
      and l.work_id=w.id and l.parent_work_id is null
    where w.workspace_id=v_workspace.id and l.presentation_id=p_parent_presentation_id
    for update of w;
  if not found then raise exception 'canonical_parent_required' using errcode='23503'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(
    p_workspace_key,p_parent_presentation_id,p_request_id,p_action,p_input,
    p_expected_work_revision,p_expected_operate_revision,p_expected_design_revision,
    p_expected_deploy_revision,p_expected_finance_revision,p_expected_basis_digest,
    p_expected_invoice_revision,p_expected_ledger_revision)::text);
  select * into v_receipt from d5o_hosted.connected_service_invoice_receipts
    where workspace_id=v_workspace.id and command_id=p_command_id;
  if found then
    if v_receipt.parent_work_id<>v_parent.id or v_receipt.actor_user_id<>v_actor
      or v_receipt.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_receipt.result;
  end if;
  select * into v_invoice from d5o_hosted.connected_service_invoices
    where workspace_id=v_workspace.id and parent_work_id=v_parent.id
      and request_id=p_request_id
    order by prepared_at desc limit 1 for update;
  if p_action<>'draft' and v_invoice.invoice_id is null then
    raise exception 'service_invoice_missing' using errcode='23503'; end if;
  if coalesce(v_invoice.revision,0)<>p_expected_invoice_revision
    or coalesce(v_invoice.ledger_revision,0)<>p_expected_ledger_revision then
    raise exception 'stale_service_invoice_revision' using errcode='23505'; end if;
  if p_action='record-payment' then
    if v_invoice.status<>'Issued' then
      raise exception 'issued_service_invoice_required' using errcode='23514'; end if;
    if length(v_source)<12 or coalesce(p_input->>'paymentDate','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or coalesce(p_input->>'amountMinor','') !~ '^[1-9][0-9]{0,12}$' then
      raise exception 'invalid_payment_source_or_amount' using errcode='22023'; end if;
    v_amount:=(p_input->>'amountMinor')::bigint;
    v_payment_date:=(p_input->>'paymentDate')::date;
    if v_payment_date<v_invoice.invoice_date or v_payment_date>current_date+1 then
      raise exception 'payment_date_invalid' using errcode='23514'; end if;
    select coalesce(sum(amount_minor),0) into v_paid
      from d5o_hosted.connected_service_invoice_payments
      where workspace_id=v_workspace.id and invoice_id=v_invoice.invoice_id;
    if v_amount>v_invoice.amount_minor-v_paid then
      raise exception 'service_invoice_overpayment' using errcode='23514'; end if;
    insert into d5o_hosted.connected_service_invoice_payments(
      workspace_id,invoice_id,amount_minor,payment_date,source_ref,recorded_by)
    values(v_workspace.id,v_invoice.invoice_id,v_amount,v_payment_date,v_source,v_actor)
    returning payment_id into v_payment_id;
    update d5o_hosted.connected_service_invoices set ledger_revision=ledger_revision+1
      where workspace_id=v_workspace.id and invoice_id=v_invoice.invoice_id;
    v_result:=pg_catalog.jsonb_build_object('invoiceId',v_invoice.invoice_id,
      'invoiceNumber',v_invoice.invoice_number,'status','Issued',
      'revision',v_invoice.revision,'ledgerRevision',v_invoice.ledger_revision+1,
      'paymentId',v_payment_id,'paymentMinor',v_amount,
      'paidMinor',v_paid+v_amount,
      'outstandingMinor',v_invoice.amount_minor-v_paid-v_amount);
  else
    select revision into v_raw_revision from d5o_hosted.prototype_states
      where workspace_id=v_workspace.id and state_key='work' for share;
    select decision_revision into v_operate_revision
      from d5o_hosted.connected_operate_states
      where workspace_id=v_workspace.id and work_id=v_parent.id for share;
    -- Hold the exact child and source rows through decision evaluation. All
    -- connected mutations also take the workspace transaction lock.
    perform 1 from d5o_hosted.connected_service_work s
      where s.workspace_id=v_workspace.id and s.parent_work_id=v_parent.id
        and s.request_id=p_request_id for share;
    perform 1 from d5o_hosted.work_records w
      where w.workspace_id=v_workspace.id and w.id in
        (select s.work_id from d5o_hosted.connected_service_work s
         where s.workspace_id=v_workspace.id and s.parent_work_id=v_parent.id
           and s.request_id=p_request_id) for share;
    perform 1 from d5o_hosted.connected_design_handoffs h
      where h.workspace_id=v_workspace.id and h.work_id in
        (select s.work_id from d5o_hosted.connected_service_work s
         where s.workspace_id=v_workspace.id and s.parent_work_id=v_parent.id
           and s.request_id=p_request_id) for share;
    perform 1 from d5o_hosted.connected_design_states d
      where d.workspace_id=v_workspace.id and d.work_id in
        (select s.work_id from d5o_hosted.connected_service_work s
         where s.workspace_id=v_workspace.id and s.parent_work_id=v_parent.id
           and s.request_id=p_request_id) for share;
    perform 1 from d5o_hosted.connected_deploy_states d
      where d.workspace_id=v_workspace.id and d.work_id in
        (select s.work_id from d5o_hosted.connected_service_work s
         where s.workspace_id=v_workspace.id and s.parent_work_id=v_parent.id
           and s.request_id=p_request_id) for share;
    perform 1 from d5o_hosted.connected_service_billing_terms t
      where t.workspace_id=v_workspace.id and t.parent_work_id=v_parent.id
        and t.request_id=p_request_id for share;
    perform 1 from d5o_hosted.customer_decision_evidence e
      where e.workspace_id=v_workspace.id and e.work_id=v_parent.id
        and e.scope_id=p_request_id
        and e.purpose in ('service-authorization','service-billing-terms')
      for share;
    perform 1 from storage.objects o
      where o.bucket_id='d5o-deploy-evidence' and o.name in
        (select e.object_path from d5o_hosted.customer_decision_evidence e
         where e.workspace_id=v_workspace.id and e.work_id=v_parent.id
           and e.scope_id=p_request_id
           and e.purpose in ('service-authorization','service-billing-terms'))
      for share;
    v_basis:=d5o_hosted.current_service_finance_basis_v1(
      v_workspace.id,v_parent.id,p_request_id);
    v_digest:=pg_catalog.md5(v_basis::text);
    select * into v_fin from d5o_hosted.connected_service_finance_states
      where workspace_id=v_workspace.id and parent_work_id=v_parent.id
        and request_id=p_request_id for share;
    if v_raw_revision is distinct from p_expected_work_revision
      or v_operate_revision is distinct from p_expected_operate_revision
      or (v_basis->>'designRevision')::integer is distinct from p_expected_design_revision
      or (v_basis->>'deployRevision')::integer is distinct from p_expected_deploy_revision
      or coalesce(v_fin.revision,0)<>p_expected_finance_revision
      or v_digest<>p_expected_basis_digest then
      raise exception 'stale_service_invoice_source' using errcode='23505'; end if;
    v_cycle:=v_basis->>'requestCycleAt';
    if v_invoice.invoice_id is not null
      and v_invoice.request_cycle_at<>v_cycle then
      raise exception 'prior_cycle_invoice_retained' using errcode='23514'; end if;
    if p_action not in ('return','revise') and
      (v_fin.status is distinct from 'Ready for billing'
        or v_fin.basis_digest is distinct from v_digest
        or v_basis->>'eligibleForFinanceReview' is distinct from 'true'
        or v_basis->>'billingTermsKnown' is distinct from 'true'
        or v_basis->>'currency' is distinct from 'USD'
        or coalesce(v_basis->>'uncoveredAmountMinor','') !~ '^[1-9][0-9]{0,12}$'
        or v_basis#>>'{billingTerms,billingBasis}' is distinct from 'Fixed fee for approved uncovered scope'
        or v_basis#>>'{billingTerms,billingTrigger}' is distinct from 'Accepted service scope'
        or coalesce(v_basis#>>'{billingTerms,paymentTerms}','') !~
          '^(Net [1-9][0-9]{0,2} days from invoice|Due on receipt of invoice)$'
        or v_fin.billing_terms_evidence_id::text is distinct from
          v_basis->>'billingTermsEvidenceId') then
      raise exception 'current_fixed_fee_service_basis_required' using errcode='23514'; end if;
    v_amount:=(v_basis->>'uncoveredAmountMinor')::bigint;
    v_terms:=v_basis#>>'{billingTerms,paymentTerms}';
    if p_action='draft' then
      if v_invoice.invoice_id is not null or length(v_note)<12 then
        raise exception 'service_invoice_already_reserved_or_invalid' using errcode='23514'; end if;
      insert into d5o_hosted.connected_service_invoices(
        workspace_id,parent_work_id,request_id,request_cycle_at,status,
        amount_minor,currency,source_basis,source_digest,finance_revision,
        terms_revision,prepared_by,payment_terms,review_reason)
      values(v_workspace.id,v_parent.id,p_request_id,v_cycle,'Draft',
        v_amount,'USD',v_basis,v_digest,v_fin.revision,
        (v_basis->>'billingTermsRevision')::integer,v_actor,v_terms,v_note)
      returning * into v_invoice;
    elsif p_action='revise' then
      if v_invoice.status not in ('Returned','Draft') or v_invoice.prepared_by<>v_actor
        or length(v_note)<12 then
        raise exception 'returned_service_invoice_required' using errcode='23514'; end if;
      update d5o_hosted.connected_service_invoices set
        revision=revision+1,status='Draft',source_basis=v_basis,
        source_digest=v_digest,finance_revision=v_fin.revision,
        terms_revision=(v_basis->>'billingTermsRevision')::integer,
        amount_minor=v_amount,payment_terms=v_terms,
        review_reason=v_note,reviewed_by=null,reviewed_at=null
      where workspace_id=v_workspace.id and invoice_id=v_invoice.invoice_id
      returning * into v_invoice;
    elsif p_action='submit' then
      if v_invoice.status<>'Draft' or v_invoice.prepared_by<>v_actor
        or v_invoice.source_digest<>v_digest
        or v_invoice.finance_revision<>v_fin.revision
        or v_invoice.amount_minor<>v_amount or length(v_note)<12 then
        raise exception 'current_service_invoice_draft_required' using errcode='23514'; end if;
      update d5o_hosted.connected_service_invoices set
        revision=revision+1,status='In review',submitted_at=v_now,review_reason=v_note
      where workspace_id=v_workspace.id and invoice_id=v_invoice.invoice_id
      returning * into v_invoice;
    elsif p_action='return' then
      if v_invoice.status not in ('In review','Reviewed') or v_invoice.prepared_by=v_actor
        or length(v_note)<12 then
        raise exception 'independent_invoice_return_required' using errcode='42501'; end if;
      update d5o_hosted.connected_service_invoices set
        revision=revision+1,status='Returned',reviewed_by=v_actor,
        reviewed_at=v_now,review_reason=v_note
      where workspace_id=v_workspace.id and invoice_id=v_invoice.invoice_id
      returning * into v_invoice;
    elsif p_action='review' then
      if v_invoice.status<>'In review' or v_invoice.prepared_by=v_actor
        or v_invoice.source_digest<>v_digest
        or v_invoice.finance_revision<>v_fin.revision
        or v_invoice.amount_minor<>v_amount or length(v_note)<12 then
        raise exception 'independent_current_invoice_review_required' using errcode='42501'; end if;
      update d5o_hosted.connected_service_invoices set
        revision=revision+1,status='Reviewed',reviewed_by=v_actor,
        reviewed_at=v_now,review_reason=v_note
      where workspace_id=v_workspace.id and invoice_id=v_invoice.invoice_id
      returning * into v_invoice;
    elsif p_action='issue' then
      if v_invoice.status<>'Reviewed'
        or v_invoice.source_digest<>v_digest
        or v_invoice.finance_revision<>v_fin.revision
        or v_invoice.amount_minor<>v_amount
        or v_invoice.reviewed_by is null
        or v_invoice.reviewed_by=v_invoice.prepared_by
        or length(v_source)<12
        or coalesce(p_input->>'invoiceDate','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception 'reviewed_current_service_invoice_required' using errcode='23514'; end if;
      v_invoice_date:=(p_input->>'invoiceDate')::date;
      if v_invoice_date>current_date+1 or v_invoice_date<current_date-30 then
        raise exception 'invoice_date_invalid' using errcode='23514'; end if;
      v_due_date:=d5o_hosted.service_invoice_due_date_v1(v_invoice_date,v_terms);
      update d5o_hosted.connected_service_invoices set
        revision=revision+1,status='Issued',
        invoice_number='SVC-'||upper(substr(v_invoice.invoice_id::text,1,12)),
        issued_by=v_actor,issued_at=v_now,invoice_date=v_invoice_date,
        due_date=v_due_date,issue_source=v_source,
        issued_snapshot=pg_catalog.jsonb_build_object(
          'requestId',p_request_id,'requestCycleAt',v_cycle,
          'invoiceId',v_invoice.invoice_id,
          'invoiceNumber','SVC-'||upper(substr(v_invoice.invoice_id::text,1,12)),
          'amountMinor',v_amount,
          'currency','USD','paymentTerms',v_terms,'dueDate',v_due_date,
          'sourceBasis',v_basis,'sourceDigest',v_digest,
          'financeRevision',v_fin.revision,'issuedBy',v_actor,
          'issuedAt',v_now,'invoiceDate',v_invoice_date,'issueSource',v_source)
      where workspace_id=v_workspace.id and invoice_id=v_invoice.invoice_id
      returning * into v_invoice;
    end if;
    v_result:=pg_catalog.jsonb_build_object('invoiceId',v_invoice.invoice_id,
      'invoiceNumber',v_invoice.invoice_number,'status',v_invoice.status,
      'revision',v_invoice.revision,'ledgerRevision',v_invoice.ledger_revision,
      'amountMinor',v_invoice.amount_minor,'currency',v_invoice.currency,
      'dueDate',v_invoice.due_date,'sourceDigest',v_invoice.source_digest);
  end if;
  v_invoice_id:=v_invoice.invoice_id;
  insert into d5o_hosted.connected_service_invoice_events(
    workspace_id,invoice_id,command_id,action,actor_user_id,membership_id,
    revision,ledger_revision,snapshot)
  values(v_workspace.id,v_invoice_id,p_command_id,p_action,v_actor,v_member.id,
    (v_result->>'revision')::integer,(v_result->>'ledgerRevision')::integer,
    v_result||pg_catalog.jsonb_build_object('note',v_note,'source',v_source));
  insert into d5o_hosted.connected_service_invoice_receipts(
    workspace_id,command_id,parent_work_id,actor_user_id,fingerprint,result)
  values(v_workspace.id,p_command_id,v_parent.id,v_actor,v_fingerprint,v_result);
  return v_result;
end; $$;
