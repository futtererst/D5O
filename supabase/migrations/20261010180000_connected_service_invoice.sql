-- One fixed-fee, USD uncovered service invoice per accepted request cycle.
-- This ledger is separate from the original delivery Work Record's job-finance ledger.
create table d5o_hosted.connected_service_invoices (
  workspace_id uuid not null references d5o_hosted.workspaces(id),
  invoice_id uuid not null default pg_catalog.gen_random_uuid(),
  parent_work_id uuid not null,
  request_id text not null,
  request_cycle_at text not null,
  revision integer not null default 1 check (revision > 0),
  ledger_revision integer not null default 0 check (ledger_revision >= 0),
  status text not null check (status in ('Draft','In review','Returned','Reviewed','Issued')),
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency = 'USD'),
  source_basis jsonb not null,
  source_digest text not null,
  finance_revision integer not null,
  terms_revision integer not null,
  prepared_by uuid not null,
  prepared_at timestamptz not null default now(),
  submitted_at timestamptz,
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_reason text,
  invoice_number text,
  issued_by uuid,
  issued_at timestamptz,
  invoice_date date,
  due_date date,
  payment_terms text not null,
  issue_source text,
  issued_snapshot jsonb,
  primary key(workspace_id,invoice_id),
  unique(workspace_id,parent_work_id,request_id,request_cycle_at),
  unique(workspace_id,invoice_number),
  foreign key(parent_work_id,workspace_id)
    references d5o_hosted.work_records(id,workspace_id),
  check ((status='Issued')=(invoice_number is not null)),
  check (status<>'Issued' or
    (issued_by is not null and issued_at is not null and
     invoice_date is not null and due_date is not null and
     issue_source is not null and issued_snapshot is not null))
);
create index connected_service_invoices_parent_idx on
  d5o_hosted.connected_service_invoices(workspace_id,parent_work_id,request_id);
create table d5o_hosted.connected_service_invoice_payments (
  workspace_id uuid not null,
  invoice_id uuid not null,
  payment_id uuid not null default pg_catalog.gen_random_uuid(),
  amount_minor bigint not null check (amount_minor > 0),
  payment_date date not null,
  source_ref text not null,
  recorded_by uuid not null,
  recorded_at timestamptz not null default now(),
  primary key(workspace_id,payment_id),
  unique(workspace_id,invoice_id,source_ref),
  foreign key(workspace_id,invoice_id)
    references d5o_hosted.connected_service_invoices(workspace_id,invoice_id)
);
create table d5o_hosted.connected_service_invoice_events (
  workspace_id uuid not null,
  invoice_id uuid not null,
  event_id uuid not null default pg_catalog.gen_random_uuid(),
  command_id text not null,
  action text not null,
  actor_user_id uuid not null,
  membership_id uuid not null,
  revision integer not null,
  ledger_revision integer not null,
  snapshot jsonb not null,
  at timestamptz not null default now(),
  primary key(workspace_id,event_id),
  unique(workspace_id,command_id)
);
create table d5o_hosted.connected_service_invoice_receipts (
  workspace_id uuid not null,
  command_id text not null,
  parent_work_id uuid not null,
  actor_user_id uuid not null,
  fingerprint text not null,
  result jsonb not null,
  at timestamptz not null default now(),
  primary key(workspace_id,command_id)
);
alter table d5o_hosted.connected_service_invoices enable row level security;
alter table d5o_hosted.connected_service_invoice_payments enable row level security;
alter table d5o_hosted.connected_service_invoice_events enable row level security;
alter table d5o_hosted.connected_service_invoice_receipts enable row level security;
revoke all on d5o_hosted.connected_service_invoices,
  d5o_hosted.connected_service_invoice_payments,
  d5o_hosted.connected_service_invoice_events,
  d5o_hosted.connected_service_invoice_receipts
  from public,anon,authenticated,service_role;

create function public.d5o_hosted_service_invoice_read_v1(
  p_workspace_key text,p_parent_presentation_id text,p_request_id text
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_workspace uuid;v_parent uuid;v_invoice d5o_hosted.connected_service_invoices%rowtype;
  v_basis jsonb;v_fin d5o_hosted.connected_service_finance_states%rowtype;
  v_paid bigint;v_payments jsonb;v_events jsonb;
begin
  if current_setting('role',true)<>'authenticated' or auth.uid() is null then
    raise exception 'service_invoice_auth_required' using errcode='42501'; end if;
  select w.id,l.work_id into v_workspace,v_parent
    from d5o_hosted.workspaces w
    join d5o_hosted.memberships m on m.workspace_id=w.id
      and m.actor_user_id=auth.uid() and m.status='active'
    join d5o_hosted.work_identity_links l on l.workspace_id=w.id
      and l.presentation_id=p_parent_presentation_id and l.parent_work_id is null
    where w.workspace_key=p_workspace_key and w.status='active'
      and m.role in ('project_manager','billing_commercial_lead',
        'operations_leader','admin','executive');
  if v_parent is null then
    raise exception 'service_invoice_scope_forbidden' using errcode='42501'; end if;
  v_basis:=d5o_hosted.current_service_finance_basis_v1(v_workspace,v_parent,p_request_id);
  select * into v_fin from d5o_hosted.connected_service_finance_states
    where workspace_id=v_workspace and parent_work_id=v_parent and request_id=p_request_id;
  select * into v_invoice from d5o_hosted.connected_service_invoices
    where workspace_id=v_workspace and parent_work_id=v_parent
      and request_id=p_request_id
    order by prepared_at desc limit 1;
  if v_invoice.invoice_id is not null then
    select coalesce(sum(amount_minor),0) into v_paid
      from d5o_hosted.connected_service_invoice_payments
      where workspace_id=v_workspace and invoice_id=v_invoice.invoice_id;
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(p) order by p.recorded_at),'[]'::jsonb)
      into v_payments from d5o_hosted.connected_service_invoice_payments p
      where p.workspace_id=v_workspace and p.invoice_id=v_invoice.invoice_id;
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(e) order by e.at),'[]'::jsonb)
      into v_events from d5o_hosted.connected_service_invoice_events e
      where e.workspace_id=v_workspace and e.invoice_id=v_invoice.invoice_id;
  end if;
  return pg_catalog.jsonb_build_object(
    'invoice',case when v_invoice.invoice_id is null then null else pg_catalog.to_jsonb(v_invoice) end,
    'payments',coalesce(v_payments,'[]'::jsonb),
    'history',coalesce(v_events,'[]'::jsonb),
    'invoicedMinor',case when v_invoice.status='Issued' then v_invoice.amount_minor else 0 end,
    'paidMinor',coalesce(v_paid,0),
    'outstandingMinor',case when v_invoice.status='Issued' then
      v_invoice.amount_minor-coalesce(v_paid,0) else 0 end,
    'sourceCurrent',v_invoice.invoice_id is not null
      and v_invoice.source_digest=pg_catalog.md5(v_basis::text)
      and v_fin.status='Ready for billing'
      and v_fin.basis_digest=pg_catalog.md5(v_basis::text)
      and v_invoice.finance_revision=v_fin.revision);
end; $$;
revoke all on function public.d5o_hosted_service_invoice_read_v1(text,text,text)
  from public,anon,service_role;
grant execute on function public.d5o_hosted_service_invoice_read_v1(text,text,text)
  to authenticated;

create function public.d5o_hosted_service_invoice_command_v1(
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
        or coalesce(v_basis#>>'{billingTerms,paymentTerms}','') not in
          ('Net 30 days from invoice','Due on receipt of invoice')
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
      v_due_date:=v_invoice_date+case when v_terms='Net 30 days from invoice'
        then 30 else 0 end;
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
revoke all on function public.d5o_hosted_service_invoice_command_v1(
  text,text,text,text,jsonb,text,bigint,integer,integer,integer,integer,
  text,integer,integer) from public,anon,service_role;
grant execute on function public.d5o_hosted_service_invoice_command_v1(
  text,text,text,text,jsonb,text,bigint,integer,integer,integer,integer,
  text,integer,integer) to authenticated;

-- Extend the existing role queue from authoritative invoice and payment records.
-- Service commercial and Finance queue positions are projections of committed
-- request and decision state. They never confer command authority.
create or replace function public.d5o_hosted_service_actions_v1(p_workspace_key text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid(); v_workspace uuid; v_member d5o_hosted.memberships%rowtype;
  v_row record; v_request jsonb; v_estimate jsonb; v_auth jsonb; v_fin jsonb;
  v_cycle text; v_kind text; v_status text; v_blocker text; v_role text;
  v_child text; v_actionable boolean; v_ownership text; v_items jsonb:='[]'::jsonb;
  v_customer text;
  v_inv d5o_hosted.connected_service_invoices%rowtype;v_paid bigint;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null then
    raise exception 'membership_required' using errcode='42501'; end if;
  select id into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace and actor_user_id=v_actor and status='active';
  if v_member.id is null then raise exception 'queue_scope_denied' using errcode='42501'; end if;
  if v_member.role not in ('project_manager','billing_commercial_lead',
    'operations_leader','admin','executive') then return v_items; end if;
  for v_row in
    select l.work_id,l.presentation_id,w.title,o.state
    from d5o_hosted.connected_operate_states o
    join d5o_hosted.work_identity_links l on l.workspace_id=o.workspace_id
      and l.work_id=o.work_id and l.parent_work_id is null
    join d5o_hosted.work_records w on w.workspace_id=o.workspace_id and w.id=o.work_id
    where o.workspace_id=v_workspace
    order by w.created_at desc,l.presentation_id
  loop
    select item->>'customer' into v_customer
      from d5o_hosted.prototype_states p,
        lateral pg_catalog.jsonb_array_elements(coalesce(p.state_json->'records','[]'::jsonb)) item
      where p.workspace_id=v_workspace and p.state_key='work'
        and item->>'id'=v_row.presentation_id limit 1;
    for v_request in select item from pg_catalog.jsonb_array_elements(
      coalesce(v_row.state->'requests','[]'::jsonb)) item
    loop
      if coalesce(v_request->>'coverage','') not in ('Chargeable','Partially covered') then continue; end if;
      v_cycle:=coalesce(v_request->>'reopenedAt',v_request->>'reportedAt');
      v_estimate:=v_request->'serviceEstimate';
      v_auth:=v_request->'serviceAuthorization';
      v_fin:=null; v_inv:=null; v_child:=null; v_kind:=null; v_status:=null; v_blocker:=null;
      v_role:=null;
      select job->>'workId' into v_child
        from pg_catalog.jsonb_array_elements(coalesce(v_row.state->'jobs','[]'::jsonb)) job
        where job->>'requestId'=v_request->>'id'
          and job->>'requestCycleAt'=v_cycle
          and coalesce(v_request->'currentCycleJobIds','[]'::jsonb) ? (job->>'id')
        order by job->>'createdAt' desc limit 1;
      if v_estimate is null or v_estimate->>'requestCycleAt' is distinct from v_cycle
        or v_estimate->>'status' not in ('Approved','Pricing review') then
        v_kind:='Service pricing';v_role:='project_manager';
        v_status:=coalesce(v_estimate->>'status','Missing');
        v_blocker:='Prepare and submit a current-cycle estimate for uncovered scope.';
      elsif v_estimate->>'status'='Pricing review' then
        v_kind:='Service pricing review';
        v_role:=v_estimate#>>'{policySnapshot,pricingApproverRole}';
        v_status:='Pricing review';
        v_blocker:='Independent review of the submitted estimate revision is pending.';
      elsif v_auth is null or v_auth->>'estimateRevision' is distinct from v_estimate->>'revision'
        or v_auth->>'amountMinor' is distinct from v_estimate#>>'{evaluation,proposedPriceMinor}'
        or v_auth->>'currency' is distinct from v_estimate#>>'{evaluation,currency}' then
        v_kind:='Customer service authorization';v_role:='operations_leader';
        v_status:='Awaiting customer source';
        v_blocker:='Record the retained customer decision for this approved estimate.';
      elsif v_request->>'coverage'='Partially covered' and v_request->>'status'='Closed' then
        v_fin:=public.d5o_hosted_service_finance_read_v1(
          p_workspace_key,v_row.presentation_id,v_request->>'id');
        select * into v_inv from d5o_hosted.connected_service_invoices
          where workspace_id=v_workspace and parent_work_id=v_row.work_id
            and request_id=v_request->>'id'
          order by prepared_at desc limit 1;
        if v_inv.status='Issued' then
          select coalesce(sum(amount_minor),0) into v_paid
            from d5o_hosted.connected_service_invoice_payments
            where workspace_id=v_workspace and invoice_id=v_inv.invoice_id;
          if v_paid<v_inv.amount_minor then
            v_kind:='Service payment recording';v_role:='billing_commercial_lead';
            v_status:='Issued · receivable';
            v_blocker:='Retained invoice '||v_inv.invoice_number||' has '||
              ((v_inv.amount_minor-v_paid)::numeric/100)::text||' USD outstanding. Record only a sourced payment fact.';
          else
            v_kind:='Service invoice paid';v_role:='billing_commercial_lead';
            v_status:='Paid in full';v_blocker:='Invoice and payment events remain available for review.';
          end if;
        elsif v_inv.status='Reviewed' then
          v_kind:='Service invoice issuance';v_role:='billing_commercial_lead';
          v_status:='Reviewed';
          v_blocker:='Record issuance only while the exact reviewed Finance and service sources remain current.';
        elsif v_inv.status='In review' then
          v_kind:='Service invoice review';v_role:='billing_commercial_lead';
          v_status:='In review';
          v_blocker:='Independently review the submitted USD fixed-fee invoice and its retained terms.';
        elsif v_inv.status in ('Draft','Returned') then
          v_kind:='Service invoice preparation';v_role:='project_manager';
          v_status:=v_inv.status;
          v_blocker:='Submit or correct the exact uncovered-scope draft for Finance review.';
        elsif v_fin->'basis'->>'eligibleForFinanceReview' is distinct from 'true' then
          v_kind:='Service Finance source';v_role:='project_manager';
          v_status:='Source changed';
          v_blocker:='Reconcile the current service execution and commercial source before preparation.';
        elsif (v_fin->>'decisionCurrent')='true'
          and v_fin#>>'{decision,status}'='Ready for billing' then
          v_kind:='Service invoice drafting';v_role:='project_manager';
          v_status:='Ready for billing';
          v_blocker:='Draft one invoice for the exact approved USD uncovered fixed fee.';
        elsif (v_fin->>'decisionCurrent')='true'
          and v_fin#>>'{decision,status}'='Prepared' then
          v_kind:='Service Finance review';v_role:='billing_commercial_lead';
          v_status:='Prepared';
          v_blocker:='Review the exact prepared basis independently; retained billing terms are required for Ready.';
        elsif (v_fin->>'decisionCurrent')='true'
          and v_fin#>>'{decision,status}'='Hold' then
          v_kind:='Service terms follow-up';v_role:='project_manager';
          v_status:='Finance Hold';
          v_blocker:=coalesce(v_fin#>>'{decision,review_reason}',
            'Finance requires a current retained billing-terms source.');
        else
          v_kind:=case when v_fin->>'decision' is null then 'Service Finance preparation'
            else 'Service Finance reassessment' end;
          v_role:='project_manager';
          v_status:=case when v_fin->>'decision' is null then 'Not prepared'
            else 'Historical decision' end;
          v_blocker:=case when v_fin->>'decision' is null then
            'Prepare the current service basis for independent Finance review.'
            else 'The source changed; prepare a new basis before Finance can rely on the historical decision.' end;
        end if;
      end if;
      if v_kind is null then continue; end if;
      v_actionable:=v_member.role=v_role and not (
        v_kind='Service Finance review' and
        v_fin#>>'{decision,prepared_by}'=v_actor::text)
        and v_kind<>'Service invoice paid' and
        not (v_kind='Service invoice review' and v_inv.prepared_by=v_actor) and
        not (v_kind='Service pricing review' and
          v_estimate->>'submittedByActorId'=v_actor::text);
      v_ownership:=case when v_kind='Service invoice paid' then 'Information only'
        when v_actionable then 'Available to your role'
        else 'Waiting on another role' end;
      v_items:=v_items||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'kind',v_kind,'workId',v_row.presentation_id,'workTitle',v_row.title,
        'requestId',v_request->>'id','requestTitle',v_request->>'title',
        'customer',v_customer,'childWorkId',v_child,
        'requestCycleAt',v_cycle,'coverage',v_request->>'coverage',
        'requestStatus',v_request->>'status','revision',
          coalesce(v_inv.revision,(v_fin->>'revision')::integer,(v_estimate->>'revision')::integer,0),
        'status',v_status,'blocker',v_blocker,'responsibleRole',v_role,
        'actionable',v_actionable,'ownership',v_ownership,
        'dueDate',case when v_inv.status='Issued' then v_inv.due_date::text else null end,'serviceResolutionDueAt',v_request->>'resolutionDueAt',
        'panel',case when v_kind like 'Service Finance%' or v_kind in
          ('Service terms follow-up','Service invoice drafting','Service invoice preparation',
            'Service invoice review','Service invoice issuance','Service payment recording','Service invoice paid') then 'finance' else 'pricing' end));
    end loop;
  end loop;
  return v_items;
end; $$;
revoke all on function public.d5o_hosted_service_actions_v1(text) from public,anon,service_role;
grant execute on function public.d5o_hosted_service_actions_v1(text) to authenticated;
