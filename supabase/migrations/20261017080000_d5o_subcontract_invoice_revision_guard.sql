-- Forward-only correction: pending supplier-invoice match must retain its exact agreement revision.
-- Historical matched invoices and posted costs are not rewritten.
create or replace function public.d5o_subcontract_command_v1(
 p_workspace_key text,p_presentation_id text,p_action text,p_input jsonb,p_command_id text,
 p_expected_revision integer,p_expected_source_digest text) returns jsonb
 language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); ws d5o_hosted.workspaces%rowtype; member d5o_hosted.memberships%rowtype;
 work d5o_hosted.work_records%rowtype; position d5o_hosted.subcontract_states%rowtype;
 old_receipt d5o_hosted.subcontract_receipts%rowtype; payload_state jsonb; source jsonb; fp text;
 parent d5o_hosted.purchase_authorities%rowtype; allocation jsonb; agreement jsonb; variation jsonb;
 delivery jsonb; invoice jsonb; prior_item jsonb; company d5o_hosted.subcontract_companies%rowtype;
 subject uuid; doc uuid; new_item jsonb; result jsonb; status text; array_key text; next_rev integer;
 amount bigint; delta bigint; sub_used bigint; accepted bigint; invoiced bigint; existing_cost bigint;
begin
 if current_setting('role',true)<>'authenticated' or actor is null
  or p_action not in ('register-company','prepare-allocation','review-allocation',
   'prepare-agreement','review-agreement','prepare-variation','review-variation',
   'submit-deliverable','review-deliverable','record-invoice','review-invoice')
  or pg_catalog.jsonb_typeof(p_input)<>'object'
  or length(coalesce(p_command_id,'')) not between 8 and 120
  or p_expected_revision is null or p_expected_revision<0 then
  raise exception 'invalid_subcontract_command' using errcode='22023'; end if;
 select * into ws from d5o_hosted.workspaces where workspace_key=p_workspace_key and d5o_hosted.workspaces.status='active';
 select * into member from d5o_hosted.memberships
  where workspace_id=ws.id and actor_user_id=actor and d5o_hosted.memberships.status='active' for share;
 select w.* into work from d5o_hosted.work_records w join d5o_hosted.work_identity_links l
  on l.workspace_id=w.workspace_id and l.work_id=w.id
  where w.workspace_id=ws.id and l.presentation_id=p_presentation_id for update of w;
 if member.id is null or work.id is null then raise exception 'subcontract_scope_denied' using errcode='42501'; end if;
 fp:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_workspace_key,p_presentation_id,p_action,p_input,
  p_expected_revision,p_expected_source_digest)::text);
 select * into old_receipt from d5o_hosted.subcontract_receipts
  where workspace_id=ws.id and command_id=p_command_id;
 if found then
  if old_receipt.work_id<>work.id or old_receipt.actor_user_id<>actor or old_receipt.fingerprint<>fp then
   raise exception 'command_reuse_conflict' using errcode='23505'; end if;
  return old_receipt.result; end if;
 insert into d5o_hosted.subcontract_states(workspace_id,work_id) values(ws.id,work.id) on conflict do nothing;
 select * into position from d5o_hosted.subcontract_states
  where workspace_id=ws.id and work_id=work.id for update;
 if position.revision<>p_expected_revision then
  raise exception 'stale_subcontract_revision' using errcode='23505'; end if;
 payload_state:=position.state;
 source:=d5o_hosted.purchase_basis_v1(ws.id,work.id);
 if source is null or source->>'digest' is distinct from p_expected_source_digest then
  raise exception 'subcontract_source_changed' using errcode='23514'; end if;
 select * into parent from d5o_hosted.purchase_authorities
  where workspace_id=ws.id and work_id=work.id and d5o_hosted.purchase_authorities.status='Approved'
   and source_digest=source->>'digest' and current_date between valid_from and valid_until
  order by created_at desc limit 1 for update;
 if parent.id is null then
  raise exception 'current_work_economic_authority_required' using errcode='23514'; end if;
 if p_action<>'register-company' and not parent.subcontract_enabled then
  raise exception 'subcontract_category_not_authorized' using errcode='23514'; end if;
 if p_action='register-company' then
  if member.role not in ('admin','project_manager') then
   raise exception 'subcontract_company_preparer_required' using errcode='42501'; end if;
  insert into d5o_hosted.subcontract_companies(workspace_id,name,contact_name,contact_reference,created_by)
  values(ws.id,trim(p_input->>'name'),trim(p_input->>'contactName'),
   trim(p_input->>'contactReference'),actor) returning * into company;
  subject:=company.id; array_key:='companies'; status:='Recorded';
 elsif p_action='prepare-allocation' then
  if member.role<>'project_manager' or work.created_by<>actor then
   raise exception 'subcontract_allocation_preparer_required' using errcode='42501'; end if;
  if coalesce(p_input->>'capMinor','') !~ '^[1-9][0-9]*$'
   or length(trim(coalesce(p_input->>'scope',''))) < 12
   or length(trim(coalesce(p_input->>'conditions',''))) < 10
   or length(trim(coalesce(p_input->>'sourceReference',''))) < 8 then
   raise exception 'subcontract_allocation_basis_invalid' using errcode='22023'; end if;
  amount:=(p_input->>'capMinor')::bigint;
  if amount>parent.parent_cap_minor then raise exception 'subcontract_sublimit_invalid' using errcode='23514'; end if;
  if exists(select 1 from pg_catalog.jsonb_array_elements(payload_state->'allocations') x
   where x->>'status'='Approved' and x->>'parentAuthorityId'=parent.id::text) then
   raise exception 'active_subcontract_allocation_exists' using errcode='23514'; end if;
  subject:=gen_random_uuid(); array_key:='allocations'; status:='Prepared';
  new_item:=pg_catalog.jsonb_build_object('id',subject,'status',status,'capMinor',amount,
   'currency','USD','scope',trim(p_input->>'scope'),'conditions',trim(p_input->>'conditions'),
   'sourceReference',trim(p_input->>'sourceReference'),'parentAuthorityId',parent.id,
   'sourceDigest',source->>'digest','preparedBy',actor,'preparedAt',now(),
   'supersedesId',p_input->>'supersedesId');
  payload_state:=pg_catalog.jsonb_set(payload_state,'{allocations}',payload_state->'allocations'||pg_catalog.jsonb_build_array(new_item));
 elsif p_action='review-allocation' then
  if member.role<>'admin' then raise exception 'independent_subcontract_authority_required' using errcode='42501'; end if;
  select value into allocation from pg_catalog.jsonb_array_elements(payload_state->'allocations')
   where value->>'id'=p_input->>'allocationId';
  if allocation is null or allocation->>'status'<>'Prepared' or allocation->>'preparedBy'=actor::text
   or allocation->>'parentAuthorityId'<>parent.id::text
   or allocation->>'sourceDigest'<>source->>'digest'
   or p_input->>'decision' not in ('Approved','Returned')
   or length(trim(coalesce(p_input->>'reason','')))<10 then
   raise exception 'independent_subcontract_authority_required' using errcode='23514'; end if;
  if p_input->>'decision'='Approved' then
   select coalesce(sum(amount_minor),0) into sub_used from d5o_hosted.subcontract_reservations
    where workspace_id=ws.id and work_id=work.id;
   if sub_used>(allocation->>'capMinor')::bigint then
    raise exception 'subcontract_sublimit_below_commitments' using errcode='23514'; end if;
  end if;
  subject:=(allocation->>'id')::uuid; array_key:='allocations'; status:=p_input->>'decision';
  new_item:=allocation||pg_catalog.jsonb_build_object('status',status,'reviewedBy',actor,
   'decidedAt',now(),'reviewReason',trim(p_input->>'reason'));
  payload_state:=pg_catalog.jsonb_set(payload_state,'{allocations}',(select pg_catalog.jsonb_agg(
   case when value->>'id'=subject::text then new_item else value end)
   from pg_catalog.jsonb_array_elements(payload_state->'allocations')));
 else
  select value into allocation from pg_catalog.jsonb_array_elements(payload_state->'allocations')
   where value->>'status'='Approved' and value->>'parentAuthorityId'=parent.id::text
   order by (value->>'decidedAt')::timestamptz desc limit 1;
  if allocation is null or allocation->>'sourceDigest'<>source->>'digest' then
   raise exception 'approved_subcontract_allocation_required' using errcode='23514'; end if;
  select coalesce(sum(amount_minor),0) into sub_used from d5o_hosted.subcontract_reservations
   where workspace_id=ws.id and work_id=work.id;
  if p_action='prepare-agreement' then
   if member.role<>'project_manager' or work.created_by<>actor then
    raise exception 'subcontract_agreement_preparer_required' using errcode='42501'; end if;
   if coalesce(p_input->>'amountMinor','') !~ '^[1-9][0-9]*$'
    or length(trim(coalesce(p_input->>'agreementReference','')))<8
    or length(trim(coalesce(p_input->>'scope','')))<12
    or length(trim(coalesce(p_input->>'exclusions','')))<4
    or length(trim(coalesce(p_input->>'deliverables','')))<8
    or length(trim(coalesce(p_input->>'acceptanceCriteria','')))<10
    or length(trim(coalesce(p_input->>'scheduleBasis','')))<8
    or length(trim(coalesce(p_input->>'milestoneBasis','')))<8
    or coalesce(p_input->>'documentId','') !~ '^[0-9a-f-]{36}$' then
    raise exception 'subcontract_agreement_basis_invalid' using errcode='22023'; end if;
   amount:=(p_input->>'amountMinor')::bigint;
   if amount>(allocation->>'capMinor')::bigint-sub_used then
    raise exception 'subcontract_sublimit_exceeded' using errcode='23514'; end if;
   select * into company from d5o_hosted.subcontract_companies
    where id=(p_input->>'companyId')::uuid and workspace_id=ws.id;
   doc:=(p_input->>'documentId')::uuid;
   if company.id is null or not d5o_hosted.subcontract_document_v1(ws.id,work.id,doc) then
    raise exception 'retained_subcontract_company_document_required' using errcode='23514'; end if;
   if nullif(trim(coalesce(p_input->>'packageId','')),'') is not null and
    not exists(select 1 from d5o_hosted.connected_package_states
     where workspace_id=ws.id and work_id=work.id and package_id=p_input->>'packageId') then
    raise exception 'exact_subcontract_package_required' using errcode='23514'; end if;
   if nullif(p_input->>'supersedesId','') is not null then
    select value into prior_item from pg_catalog.jsonb_array_elements(payload_state->'agreements')
     where value->>'id'=p_input->>'supersedesId' and value->>'status'='Returned';
    if prior_item is null then raise exception 'returned_subcontract_agreement_required' using errcode='23514'; end if;
   end if;
   subject:=gen_random_uuid(); array_key:='agreements'; status:='Prepared';
   new_item:=p_input||pg_catalog.jsonb_build_object('id',subject,'status',status,
    'currency','USD','amountMinor',amount,'revisedMinor',amount,'allocationId',allocation->>'id',
    'parentAuthorityId',parent.id,'sourceDigest',source->>'digest',
    'documentSha256',(select sha256 from d5o_hosted.graybar_documents where id=doc),
    'preparedBy',actor,'preparedAt',now(),'revision',1);
   payload_state:=pg_catalog.jsonb_set(payload_state,'{agreements}',payload_state->'agreements'||pg_catalog.jsonb_build_array(new_item));
  elsif p_action='review-agreement' then
   if member.role<>'admin' then raise exception 'independent_subcontract_approval_required' using errcode='42501'; end if;
   select value into agreement from pg_catalog.jsonb_array_elements(payload_state->'agreements')
    where value->>'id'=p_input->>'agreementId';
   if agreement is null or agreement->>'status'<>'Prepared' or agreement->>'preparedBy'=actor::text
    or agreement->>'allocationId'<>allocation->>'id'
    or agreement->>'sourceDigest'<>source->>'digest'
    or p_input->>'decision' not in ('Approved','Returned')
    or length(trim(coalesce(p_input->>'reason','')))<10 then
    raise exception 'independent_subcontract_approval_required' using errcode='23514'; end if;
   if p_input->>'decision'='Approved' then
    amount:=(agreement->>'amountMinor')::bigint;
    if amount>(allocation->>'capMinor')::bigint-sub_used then
     raise exception 'subcontract_sublimit_exceeded' using errcode='23514'; end if;
    if not d5o_hosted.subcontract_document_v1(ws.id,work.id,(agreement->>'documentId')::uuid) or
     (select sha256 from d5o_hosted.graybar_documents where id=(agreement->>'documentId')::uuid)
       <>agreement->>'documentSha256' then
     raise exception 'subcontract_document_changed' using errcode='23514'; end if;
    insert into d5o_hosted.subcontract_reservations(workspace_id,work_id,allocation_id,
     agreement_id,amount_minor,currency,source_digest,approved_by)
    values(ws.id,work.id,(allocation->>'id')::uuid,(agreement->>'id')::uuid,
     amount,'USD',source->>'digest',actor);
   end if;
   subject:=(agreement->>'id')::uuid; array_key:='agreements'; status:=p_input->>'decision';
   new_item:=agreement||pg_catalog.jsonb_build_object('status',status,'reviewedBy',actor,
    'decidedAt',now(),'reviewReason',trim(p_input->>'reason'));
   payload_state:=pg_catalog.jsonb_set(payload_state,'{agreements}',(select pg_catalog.jsonb_agg(
    case when value->>'id'=subject::text then new_item else value end)
    from pg_catalog.jsonb_array_elements(payload_state->'agreements')));
  elsif p_action in ('prepare-variation','review-variation','submit-deliverable','review-deliverable','record-invoice','review-invoice') then
   select value into agreement from pg_catalog.jsonb_array_elements(payload_state->'agreements')
    where value->>'id'=p_input->>'agreementId' and value->>'status'='Approved';
   if agreement is null or agreement->>'sourceDigest'<>source->>'digest'
    or agreement->>'allocationId'<>allocation->>'id' then
    raise exception 'current_subcontract_agreement_required' using errcode='23514'; end if;
   if p_action='prepare-variation' then
    if member.role<>'project_manager' or work.created_by<>actor then
     raise exception 'subcontract_variation_preparer_required' using errcode='42501'; end if;
    if coalesce(p_input->>'deltaMinor','') !~ '^-?[1-9][0-9]*$'
     or length(trim(coalesce(p_input->>'scopeDifference','')))<10
     or length(trim(coalesce(p_input->>'scheduleImpact','')))<5
     or length(trim(coalesce(p_input->>'rationale','')))<10
     or coalesce(p_input->>'documentId','') !~ '^[0-9a-f-]{36}$' then
     raise exception 'subcontract_variation_basis_invalid' using errcode='22023'; end if;
    doc:=(p_input->>'documentId')::uuid;
    if not d5o_hosted.subcontract_document_v1(ws.id,work.id,doc) then
     raise exception 'retained_subcontract_variation_required' using errcode='23514'; end if;
    if nullif(p_input->>'supersedesId','') is not null then
     select value into prior_item from pg_catalog.jsonb_array_elements(payload_state->'variations')
      where value->>'id'=p_input->>'supersedesId' and value->>'agreementId'=agreement->>'id'
       and value->>'status'='Returned';
     if prior_item is null then raise exception 'returned_subcontract_variation_required' using errcode='23514'; end if;
    end if;
    subject:=gen_random_uuid(); array_key:='variations'; status:='Prepared';
    new_item:=p_input||pg_catalog.jsonb_build_object('id',subject,'status',status,
     'baseAgreementRevision',coalesce(agreement->>'revision','1'),'sourceDigest',source->>'digest',
     'documentSha256',(select sha256 from d5o_hosted.graybar_documents where id=doc),
     'preparedBy',actor,'preparedAt',now(),'revision',1);
    payload_state:=pg_catalog.jsonb_set(payload_state,'{variations}',payload_state->'variations'||pg_catalog.jsonb_build_array(new_item));
   elsif p_action='review-variation' then
    if member.role<>'admin' then raise exception 'independent_subcontract_approval_required' using errcode='42501'; end if;
    select value into variation from pg_catalog.jsonb_array_elements(payload_state->'variations')
     where value->>'id'=p_input->>'variationId' and value->>'agreementId'=agreement->>'id';
    if variation is null or variation->>'status'<>'Prepared' or variation->>'preparedBy'=actor::text
     or variation->>'sourceDigest'<>source->>'digest'
     or variation->>'baseAgreementRevision'<>coalesce(agreement->>'revision','1')
     or p_input->>'decision' not in ('Approved','Returned')
     or length(trim(coalesce(p_input->>'reason','')))<10 then
     raise exception 'independent_subcontract_approval_required' using errcode='23514'; end if;
    if p_input->>'decision'='Approved' then
     delta:=(variation->>'deltaMinor')::bigint;
     if delta>0 and delta>(allocation->>'capMinor')::bigint-sub_used then
      raise exception 'subcontract_sublimit_exceeded' using errcode='23514'; end if;
     if (agreement->>'revisedMinor')::bigint+delta<=0 then
      raise exception 'subcontract_reduction_invalid' using errcode='23514'; end if;
     select coalesce(sum((value->>'amountMinor')::bigint),0) into accepted
      from pg_catalog.jsonb_array_elements(payload_state->'deliverables')
      where value->>'agreementId'=agreement->>'id' and value->>'status'='Accepted';
     select coalesce(sum((value->>'amountMinor')::bigint),0) into invoiced
      from pg_catalog.jsonb_array_elements(payload_state->'invoices')
      where value->>'agreementId'=agreement->>'id' and value->>'status'='Matched';
     if delta<0 and ((agreement->>'revisedMinor')::bigint+delta<greatest(accepted,invoiced)
      or exists(select 1 from d5o_hosted.subcontract_cost_links l
       join d5o_hosted.subcontract_reservations r on r.id=l.reservation_id
       where r.agreement_id=(agreement->>'id')::uuid and l.kind='Committed')) then
      raise exception 'subcontract_reduction_requires_cost_reconciliation' using errcode='23514'; end if;
     if not d5o_hosted.subcontract_document_v1(ws.id,work.id,(variation->>'documentId')::uuid) or
      (select sha256 from d5o_hosted.graybar_documents where id=(variation->>'documentId')::uuid)
       <>variation->>'documentSha256' then
      raise exception 'subcontract_document_changed' using errcode='23514'; end if;
     insert into d5o_hosted.subcontract_reservations(workspace_id,work_id,allocation_id,
      agreement_id,variation_id,amount_minor,currency,source_digest,approved_by)
     values(ws.id,work.id,(allocation->>'id')::uuid,(agreement->>'id')::uuid,
      (variation->>'id')::uuid,delta,'USD',source->>'digest',actor);
     agreement:=agreement||pg_catalog.jsonb_build_object('revisedMinor',(agreement->>'revisedMinor')::bigint+delta,
      'revision',coalesce((agreement->>'revision')::integer,1)+1);
     payload_state:=pg_catalog.jsonb_set(payload_state,'{agreements}',(select pg_catalog.jsonb_agg(
      case when value->>'id'=agreement->>'id' then agreement else value end)
      from pg_catalog.jsonb_array_elements(payload_state->'agreements')));
    end if;
    subject:=(variation->>'id')::uuid; array_key:='variations'; status:=p_input->>'decision';
    new_item:=variation||pg_catalog.jsonb_build_object('status',status,'reviewedBy',actor,
     'decidedAt',now(),'reviewReason',trim(p_input->>'reason'));
    payload_state:=pg_catalog.jsonb_set(payload_state,'{variations}',(select pg_catalog.jsonb_agg(
     case when value->>'id'=subject::text then new_item else value end)
     from pg_catalog.jsonb_array_elements(payload_state->'variations')));
   elsif p_action='submit-deliverable' then
    if member.role<>'project_manager' or work.created_by<>actor then
     raise exception 'subcontract_delivery_recorder_required' using errcode='42501'; end if;
    if coalesce(p_input->>'amountMinor','') !~ '^[1-9][0-9]*$'
     or length(trim(coalesce(p_input->>'description','')))<10
     or coalesce(p_input->>'documentId','') !~ '^[0-9a-f-]{36}$' then
     raise exception 'subcontract_delivery_basis_invalid' using errcode='22023'; end if;
    doc:=(p_input->>'documentId')::uuid;
    if not d5o_hosted.subcontract_document_v1(ws.id,work.id,doc) then
     raise exception 'retained_subcontract_deliverable_required' using errcode='23514'; end if;
    amount:=(p_input->>'amountMinor')::bigint;
    select coalesce(sum((value->>'amountMinor')::bigint),0) into accepted
     from pg_catalog.jsonb_array_elements(payload_state->'deliverables')
     where value->>'agreementId'=agreement->>'id' and value->>'status'='Accepted';
    if amount+accepted>(agreement->>'revisedMinor')::bigint then
     raise exception 'subcontract_delivery_exceeds_agreement' using errcode='23514'; end if;
    if nullif(p_input->>'supersedesId','') is not null then
     select value into prior_item from pg_catalog.jsonb_array_elements(payload_state->'deliverables')
      where value->>'id'=p_input->>'supersedesId' and value->>'agreementId'=agreement->>'id'
       and value->>'status'='Returned';
     if prior_item is null then raise exception 'returned_subcontract_deliverable_required' using errcode='23514'; end if;
    end if;
    subject:=gen_random_uuid(); array_key:='deliverables'; status:='Submitted';
    new_item:=p_input||pg_catalog.jsonb_build_object('id',subject,'status',status,
     'amountMinor',amount,'agreementRevision',coalesce((agreement->>'revision')::integer,1),
     'documentSha256',(select sha256 from d5o_hosted.graybar_documents where id=doc),
     'submittedBy',actor,'submittedAt',now());
    payload_state:=pg_catalog.jsonb_set(payload_state,'{deliverables}',payload_state->'deliverables'||pg_catalog.jsonb_build_array(new_item));
   elsif p_action='review-deliverable' then
    if member.role not in ('operations_leader','admin') then
     raise exception 'independent_subcontract_receipt_required' using errcode='42501'; end if;
    select value into delivery from pg_catalog.jsonb_array_elements(payload_state->'deliverables')
     where value->>'id'=p_input->>'deliverableId' and value->>'agreementId'=agreement->>'id';
    if delivery is null or delivery->>'status'<>'Submitted' or delivery->>'submittedBy'=actor::text
     or p_input->>'decision' not in ('Accepted','Returned')
     or length(trim(coalesce(p_input->>'reason','')))<10 then
     raise exception 'independent_subcontract_receipt_required' using errcode='23514'; end if;
    if delivery->>'agreementRevision'<>coalesce(agreement->>'revision','1')
     or not d5o_hosted.subcontract_document_v1(ws.id,work.id,(delivery->>'documentId')::uuid)
     or (select sha256 from d5o_hosted.graybar_documents where id=(delivery->>'documentId')::uuid)
       <>delivery->>'documentSha256' then
     raise exception 'subcontract_delivery_source_changed' using errcode='23514'; end if;
    if p_input->>'decision'='Accepted' then
     select coalesce(sum((value->>'amountMinor')::bigint),0) into accepted
      from pg_catalog.jsonb_array_elements(payload_state->'deliverables')
      where value->>'agreementId'=agreement->>'id' and value->>'status'='Accepted';
     if accepted+(delivery->>'amountMinor')::bigint>(agreement->>'revisedMinor')::bigint then
      raise exception 'subcontract_delivery_exceeds_agreement' using errcode='23514'; end if;
    end if;
    subject:=(delivery->>'id')::uuid; array_key:='deliverables'; status:=p_input->>'decision';
    new_item:=delivery||pg_catalog.jsonb_build_object('status',status,'reviewedBy',actor,
     'decidedAt',now(),'reviewReason',trim(p_input->>'reason'));
    payload_state:=pg_catalog.jsonb_set(payload_state,'{deliverables}',(select pg_catalog.jsonb_agg(
     case when value->>'id'=subject::text then new_item else value end)
     from pg_catalog.jsonb_array_elements(payload_state->'deliverables')));
   elsif p_action='record-invoice' then
    if member.role<>'billing_commercial_lead' then
     raise exception 'subcontract_finance_role_required' using errcode='42501'; end if;
    select value into delivery from pg_catalog.jsonb_array_elements(payload_state->'deliverables')
     where value->>'id'=p_input->>'deliverableId' and value->>'agreementId'=agreement->>'id'
      and value->>'status'='Accepted';
    if delivery is null or coalesce(p_input->>'amountMinor','') !~ '^[1-9][0-9]*$'
     or length(trim(coalesce(p_input->>'invoiceNumber','')))<5
     or coalesce(p_input->>'documentId','') !~ '^[0-9a-f-]{36}$' then
     raise exception 'accepted_subcontract_delivery_required' using errcode='23514'; end if;
    if exists(select 1 from pg_catalog.jsonb_array_elements(payload_state->'invoices')
     where value->>'invoiceNumber'=p_input->>'invoiceNumber'
      and value->>'companyId'=agreement->>'companyId') then
     raise exception 'duplicate_subcontract_invoice' using errcode='23505'; end if;
    doc:=(p_input->>'documentId')::uuid;
    if not d5o_hosted.subcontract_document_v1(ws.id,work.id,doc) then
     raise exception 'retained_subcontract_invoice_required' using errcode='23514'; end if;
    amount:=(p_input->>'amountMinor')::bigint;
    select coalesce(sum((value->>'amountMinor')::bigint),0) into invoiced
     from pg_catalog.jsonb_array_elements(payload_state->'invoices')
     where value->>'deliverableId'=delivery->>'id' and value->>'status' in ('Review','Matched');
    if amount+invoiced>(delivery->>'amountMinor')::bigint then
     raise exception 'subcontract_invoice_exceeds_accepted_delivery' using errcode='23514'; end if;
    subject:=gen_random_uuid(); array_key:='invoices'; status:='Review';
    new_item:=p_input||pg_catalog.jsonb_build_object('id',subject,'status',status,
     'companyId',agreement->>'companyId','currency','USD','amountMinor',amount,
     'deliveryRevision',delivery->>'agreementRevision','agreementRevision',coalesce(agreement->>'revision','1'),
     'documentSha256',(select sha256 from d5o_hosted.graybar_documents where id=doc),
     'recordedBy',actor,'recordedAt',now());
    payload_state:=pg_catalog.jsonb_set(payload_state,'{invoices}',payload_state->'invoices'||pg_catalog.jsonb_build_array(new_item));
   elsif p_action='review-invoice' then
    if member.role not in ('admin','billing_commercial_lead') then
     raise exception 'independent_subcontract_invoice_review_required' using errcode='42501'; end if;
    select value into invoice from pg_catalog.jsonb_array_elements(payload_state->'invoices')
     where value->>'id'=p_input->>'invoiceId' and value->>'agreementId'=agreement->>'id';
    if invoice is null or invoice->>'status'<>'Review' or invoice->>'recordedBy'=actor::text
     or p_input->>'decision' not in ('Matched','Hold')
     or length(trim(coalesce(p_input->>'reason','')))<10 then
     raise exception 'independent_subcontract_invoice_review_required' using errcode='23514'; end if;
    select value into delivery from pg_catalog.jsonb_array_elements(payload_state->'deliverables')
     where value->>'id'=invoice->>'deliverableId' and value->>'status'='Accepted';
    if delivery is null or invoice->>'agreementRevision' is distinct from coalesce(agreement->>'revision','1')
     or invoice->>'companyId'<>agreement->>'companyId'
     or not d5o_hosted.subcontract_document_v1(ws.id,work.id,(invoice->>'documentId')::uuid)
     or (select sha256 from d5o_hosted.graybar_documents where id=(invoice->>'documentId')::uuid)
      <>invoice->>'documentSha256' then
     raise exception 'subcontract_invoice_source_changed' using errcode='23514'; end if;
    subject:=(invoice->>'id')::uuid; array_key:='invoices'; status:=p_input->>'decision';
    new_item:=invoice||pg_catalog.jsonb_build_object('status',status,'reviewedBy',actor,
     'decidedAt',now(),'reviewReason',trim(p_input->>'reason'));
    payload_state:=pg_catalog.jsonb_set(payload_state,'{invoices}',(select pg_catalog.jsonb_agg(
     case when value->>'id'=subject::text then new_item else value end)
     from pg_catalog.jsonb_array_elements(payload_state->'invoices')));
   end if;
  end if;
 end if;
 next_rev:=position.revision+1;
 update d5o_hosted.subcontract_states set revision=next_rev,state=payload_state
  where workspace_id=ws.id and work_id=work.id;
 insert into d5o_hosted.subcontract_events(workspace_id,work_id,revision,action,command_id,
  actor_user_id,membership_id,subject_id,basis)
 values(ws.id,work.id,next_rev,p_action,p_command_id,actor,member.id,subject,
  pg_catalog.jsonb_build_object('input',p_input,'source',source,'status',status));
 result:=pg_catalog.jsonb_build_object('revision',next_rev,'action',p_action,
  'subjectId',subject,'status',status);
 insert into d5o_hosted.subcontract_receipts(workspace_id,command_id,work_id,actor_user_id,fingerprint,result)
 values(ws.id,p_command_id,work.id,actor,fp,result);
 return result;
end; $$;
