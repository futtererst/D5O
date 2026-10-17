alter table d5o_hosted.purchase_authorities add column subcontract_enabled boolean not null default false;
alter table d5o_hosted.purchase_authorities drop constraint purchase_authorities_check;
alter table d5o_hosted.purchase_authorities add constraint purchase_authorities_purchasing_cap_minor_check check(purchasing_cap_minor>=0 and purchasing_cap_minor<=parent_cap_minor);
alter table d5o_hosted.purchase_authorities alter column bom_id drop not null;
-- Bounded fixed-price subcontract authority; supplier company is not a worker identity.
create table d5o_hosted.subcontract_companies (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references d5o_hosted.workspaces(id),
 name text not null check(length(trim(name)) between 4 and 200),
 contact_name text not null check(length(trim(contact_name)) between 3 and 200),
 contact_reference text not null check(length(trim(contact_reference)) between 5 and 300),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 unique(workspace_id,name)
);
create table d5o_hosted.subcontract_states (
 workspace_id uuid not null, work_id uuid not null, revision integer not null default 0,
 state jsonb not null default '{"allocations":[],"agreements":[],"variations":[],"deliverables":[],"invoices":[]}'::jsonb,
 primary key(workspace_id,work_id),
 foreign key(work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id)
);
create table d5o_hosted.subcontract_reservations (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null, work_id uuid not null,
 allocation_id uuid not null, agreement_id uuid not null, variation_id uuid,
 amount_minor bigint not null check(amount_minor<>0), currency text not null check(currency='USD'),
 source_digest text not null, approved_by uuid not null references auth.users(id),
 approved_at timestamptz not null default now(),
 unique(workspace_id,work_id,agreement_id,variation_id),
 foreign key(work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id)
);
create unique index subcontract_initial_reservation_once
 on d5o_hosted.subcontract_reservations(workspace_id,work_id,agreement_id)
 where variation_id is null;
create table d5o_hosted.subcontract_cost_links (
 workspace_id uuid not null, work_id uuid not null, reservation_id uuid references d5o_hosted.subcontract_reservations(id),
 invoice_id uuid, kind text not null check(kind in ('Committed','Incurred')),
 cost_id uuid not null unique references d5o_hosted.connected_job_costs(id),
 recorded_by uuid not null references auth.users(id), recorded_at timestamptz not null default now(),
 unique(workspace_id,work_id,reservation_id,kind),

 foreign key(work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id)
);
create table d5o_hosted.subcontract_events (
 workspace_id uuid not null,work_id uuid not null,revision integer not null,
 action text not null,command_id text not null,actor_user_id uuid not null references auth.users(id),
 membership_id uuid not null references d5o_hosted.memberships(id),subject_id uuid,
 basis jsonb not null,occurred_at timestamptz not null default now(),
 primary key(workspace_id,work_id,revision),unique(workspace_id,command_id)
);
create table d5o_hosted.subcontract_receipts (
 workspace_id uuid not null,command_id text not null,work_id uuid not null,
 actor_user_id uuid not null references auth.users(id),fingerprint text not null,result jsonb not null,
 primary key(workspace_id,command_id)
);
alter table d5o_hosted.subcontract_companies enable row level security;
alter table d5o_hosted.subcontract_states enable row level security;
alter table d5o_hosted.subcontract_reservations enable row level security;
alter table d5o_hosted.subcontract_cost_links enable row level security;
alter table d5o_hosted.subcontract_events enable row level security;
alter table d5o_hosted.subcontract_receipts enable row level security;
revoke all on d5o_hosted.subcontract_companies,d5o_hosted.subcontract_states,
 d5o_hosted.subcontract_reservations,d5o_hosted.subcontract_cost_links,
 d5o_hosted.subcontract_events,d5o_hosted.subcontract_receipts
 from public,anon,authenticated,service_role;

-- A single Work lock serializes all three categories. Existing PO and Design guards
-- continue to run; this additional guard includes subcontract commitments.
create function d5o_hosted.guard_combined_work_authority_v1() returns trigger
 language plpgsql volatile security definer set search_path='' as $$
declare ws uuid; w uuid; cap bigint; design_used bigint; po_used bigint; sub_used bigint;
 source jsonb;
begin
 ws:=new.workspace_id; w:=new.work_id;
 if tg_table_name='subcontract_reservations' then
  if new.amount_minor<0 then return new; end if;
 end if;
 if tg_table_name='design_spend_commitments' then
  if new.status<>'Approved' then return new; end if;
 end if;
 source:=d5o_hosted.purchase_basis_v1(ws,w);
 select parent_cap_minor into cap from d5o_hosted.purchase_authorities
  where workspace_id=ws and work_id=w and status='Approved'
   and source_digest=source->>'digest' and current_date between valid_from and valid_until
  order by created_at desc limit 1;
 if cap is null then
  if tg_table_name='subcontract_reservations' then
   raise exception 'current_work_economic_authority_required' using errcode='23514';
  end if;
  return new;
 end if;
 select coalesce(sum(amount_minor),0) into design_used from d5o_hosted.design_spend_commitments
  where workspace_id=ws and work_id=w and status='Approved';
 select coalesce(sum(amount_minor),0) into po_used from d5o_hosted.purchase_reservations
  where workspace_id=ws and work_id=w and status='Reserved';
 select coalesce(sum(amount_minor),0) into sub_used from d5o_hosted.subcontract_reservations
  where workspace_id=ws and work_id=w;
 if design_used+po_used+sub_used>cap then
  raise exception 'work_economic_cap_exceeded' using errcode='23514'; end if;
 return new;
end; $$;
revoke all on function d5o_hosted.guard_combined_work_authority_v1() from public,anon,authenticated,service_role;
create trigger combined_purchase_cap after insert on d5o_hosted.purchase_reservations
 for each row execute function d5o_hosted.guard_combined_work_authority_v1();
create trigger combined_subcontract_cap after insert on d5o_hosted.subcontract_reservations
 for each row execute function d5o_hosted.guard_combined_work_authority_v1();
create trigger combined_design_cap after update on d5o_hosted.design_spend_commitments
 for each row when (old.status is distinct from new.status)
 execute function d5o_hosted.guard_combined_work_authority_v1();

create function d5o_hosted.subcontract_document_v1(p_ws uuid,p_work uuid,p_id uuid) returns boolean
 language sql stable security definer set search_path='' as $$
 select exists(select 1 from d5o_hosted.graybar_documents d
  where d.id=p_id and d.workspace_id=p_ws and d.work_id=p_work
   and d.kind='other' and d.sha256 ~ '^[0-9a-f]{64}$' and d.byte_count>0);
$$;
revoke all on function d5o_hosted.subcontract_document_v1(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function public.d5o_subcontract_read_v1(p_workspace_key text,p_presentation_id text)
 returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); ws uuid; w uuid; s d5o_hosted.subcontract_states%rowtype;
 source jsonb; parent_id uuid; parent_cap bigint; design_used bigint; po_used bigint; sub_used bigint;
 alloc jsonb; alloc_cap bigint;
begin
 if current_setting('role',true)<>'authenticated' or actor is null then
  raise exception 'subcontract_scope_denied' using errcode='42501'; end if;
 select id into ws from d5o_hosted.workspaces where workspace_key=p_workspace_key and status='active';
 if not exists(select 1 from d5o_hosted.memberships where workspace_id=ws and actor_user_id=actor
  and status='active' and role in ('admin','project_manager','operations_leader','billing_commercial_lead')) then
  raise exception 'subcontract_scope_denied' using errcode='42501'; end if;
 select work_id into w from d5o_hosted.work_identity_links
  where workspace_id=ws and presentation_id=p_presentation_id;
 if w is null then raise exception 'subcontract_scope_denied' using errcode='42501'; end if;
 select * into s from d5o_hosted.subcontract_states where workspace_id=ws and work_id=w;
 source:=d5o_hosted.purchase_basis_v1(ws,w);
 select id,parent_cap_minor into parent_id,parent_cap from d5o_hosted.purchase_authorities
  where workspace_id=ws and work_id=w and status='Approved'
   and source_digest=source->>'digest' and current_date between valid_from and valid_until
  order by created_at desc limit 1;
 select coalesce(sum(amount_minor),0) into design_used from d5o_hosted.design_spend_commitments
  where workspace_id=ws and work_id=w and status='Approved';
 select coalesce(sum(amount_minor),0) into po_used from d5o_hosted.purchase_reservations
  where workspace_id=ws and work_id=w and status='Reserved';
 select coalesce(sum(amount_minor),0) into sub_used from d5o_hosted.subcontract_reservations
  where workspace_id=ws and work_id=w;
 select value into alloc from pg_catalog.jsonb_array_elements(coalesce(s.state->'allocations','[]'::jsonb))
  where value->>'status'='Approved' and value->>'parentAuthorityId'=parent_id::text
  order by (value->>'decidedAt')::timestamptz desc limit 1;
 alloc_cap:=(alloc->>'capMinor')::bigint;
 return pg_catalog.jsonb_build_object('revision',coalesce(s.revision,0),
  'state',coalesce(s.state,'{"allocations":[],"agreements":[],"variations":[],"deliverables":[],"invoices":[]}'::jsonb),
  'source',source,'parentAuthorityId',parent_id,'parentCapMinor',parent_cap,
  'designConsumedMinor',design_used,'purchaseConsumedMinor',po_used,'subcontractConsumedMinor',sub_used,
  'parentRemainingMinor',case when parent_cap is null then null else parent_cap-design_used-po_used-sub_used end,
  'subcontractCapMinor',alloc_cap,
  'subcontractRemainingMinor',case when alloc_cap is null then null else alloc_cap-sub_used end,
  'companies',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'id',id,'name',name,'contactName',contact_name,'contactReference',contact_reference) order by name)
   from d5o_hosted.subcontract_companies where workspace_id=ws),'[]'::jsonb),
  'reservations',coalesce((select pg_catalog.jsonb_agg(to_jsonb(r) order by approved_at)
   from d5o_hosted.subcontract_reservations r where workspace_id=ws and work_id=w),'[]'::jsonb),
  'costLinks',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'reservationId',l.reservation_id,'invoiceId',l.invoice_id,'kind',l.kind,
   'amountMinor',c.amount_minor,'costId',c.id,'reconcilesId',c.reconciles_id) order by l.recorded_at)
   from d5o_hosted.subcontract_cost_links l join d5o_hosted.connected_job_costs c on c.id=l.cost_id
   where l.workspace_id=ws and l.work_id=w),'[]'::jsonb));
end; $$;
revoke all on function public.d5o_subcontract_read_v1(text,text) from public,anon,service_role;
grant execute on function public.d5o_subcontract_read_v1(text,text) to authenticated;


create function public.d5o_subcontract_command_v1(
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
     'deliveryRevision',delivery->>'agreementRevision',
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
    if delivery is null or invoice->>'companyId'<>agreement->>'companyId'
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
revoke all on function public.d5o_subcontract_command_v1(text,text,text,jsonb,text,integer,text)
 from public,anon,service_role;
grant execute on function public.d5o_subcontract_command_v1(text,text,text,jsonb,text,integer,text)
 to authenticated;


-- Finance classifies the approved reservation once and reconciles accepted claims
-- to its cost commitment; neither action changes economic authority consumption.
create function public.d5o_subcontract_cost_command_v1(
 p_workspace_key text,p_presentation_id text,p_action text,p_subject_id uuid,
 p_command_id text,p_expected_subcontract_revision integer,p_expected_finance_revision integer)
 returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); ws d5o_hosted.workspaces%rowtype; member d5o_hosted.memberships%rowtype;
 work d5o_hosted.work_records%rowtype; s d5o_hosted.subcontract_states%rowtype;
 f d5o_hosted.connected_job_finance_states%rowtype; prior d5o_hosted.subcontract_receipts%rowtype;
 reservation d5o_hosted.subcontract_reservations%rowtype; invoice jsonb; agreement jsonb;
 commit_row record; remaining bigint; capacity bigint; amount bigint; cost_id uuid;
 source text; fp text; ids jsonb:='[]'::jsonb; result jsonb;
begin
 if current_setting('role',true)<>'authenticated' or actor is null
  or p_action not in ('post-commitment','post-invoice') or p_subject_id is null
  or length(coalesce(p_command_id,'')) not between 8 and 120
  or p_expected_subcontract_revision is null or p_expected_finance_revision is null then
  raise exception 'invalid_subcontract_cost_command' using errcode='22023'; end if;
 select * into ws from d5o_hosted.workspaces where workspace_key=p_workspace_key and status='active';
 select * into member from d5o_hosted.memberships
  where workspace_id=ws.id and actor_user_id=actor and status='active' for share;
 select w.* into work from d5o_hosted.work_records w join d5o_hosted.work_identity_links l
  on l.workspace_id=w.workspace_id and l.work_id=w.id
  where w.workspace_id=ws.id and l.presentation_id=p_presentation_id for update of w;
 if member.id is null or member.role<>'billing_commercial_lead' or work.id is null then
  raise exception 'subcontract_cost_finance_role_required' using errcode='42501'; end if;
 if d5o_hosted.job_finance_award_v1(ws.id,work.id) is null then
  raise exception 'awarded_job_cost_basis_required' using errcode='23514'; end if;
 if exists(select 1 from d5o_hosted.connected_operate_states o
  where o.workspace_id=ws.id and o.work_id=work.id and o.state#>>'{finance,status}'='Closed') then
  raise exception 'finance_closed_requires_reopen' using errcode='23514'; end if;
 insert into d5o_hosted.connected_job_finance_states(workspace_id,work_id,currency)
  values(ws.id,work.id,'USD') on conflict do nothing;
 select * into s from d5o_hosted.subcontract_states
  where workspace_id=ws.id and work_id=work.id for update;
 select * into f from d5o_hosted.connected_job_finance_states
  where workspace_id=ws.id and work_id=work.id for update;
 fp:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_workspace_key,p_presentation_id,p_action,
  p_subject_id,p_expected_subcontract_revision,p_expected_finance_revision)::text);
 select * into prior from d5o_hosted.subcontract_receipts
  where workspace_id=ws.id and command_id=p_command_id;
 if found then
  if prior.work_id<>work.id or prior.actor_user_id<>actor or prior.fingerprint<>fp then
   raise exception 'command_reuse_conflict' using errcode='23505'; end if;
  return prior.result; end if;
 if s.revision is distinct from p_expected_subcontract_revision or
  f.revision<>p_expected_finance_revision then
  raise exception 'stale_subcontract_cost_source' using errcode='23505'; end if;
 if p_action='post-commitment' then
  select * into reservation from d5o_hosted.subcontract_reservations
   where id=p_subject_id and workspace_id=ws.id and work_id=work.id for update;
  if reservation.id is null or reservation.amount_minor<=0 or
   exists(select 1 from d5o_hosted.subcontract_cost_links
    where workspace_id=ws.id and work_id=work.id
     and reservation_id=reservation.id and kind='Committed') then
   raise exception 'subcontract_commitment_already_posted_or_invalid' using errcode='23505'; end if;
  select value into agreement from pg_catalog.jsonb_array_elements(s.state->'agreements')
   where value->>'id'=reservation.agreement_id::text and value->>'status'='Approved';
  if agreement is null then raise exception 'approved_subcontract_agreement_required' using errcode='23514'; end if;
  source:='Subcontract reservation '||reservation.id::text;
  insert into d5o_hosted.connected_job_costs(workspace_id,work_id,package_id,kind,category,
   amount_minor,cost_date,source,recorded_by)
  values(ws.id,work.id,nullif(agreement->>'packageId',''),'Committed','Subcontract',
   reservation.amount_minor,current_date,source,actor) returning id into cost_id;
  insert into d5o_hosted.subcontract_cost_links(workspace_id,work_id,reservation_id,kind,cost_id,recorded_by)
   values(ws.id,work.id,reservation.id,'Committed',cost_id,actor);
  ids:=ids||pg_catalog.jsonb_build_array(cost_id);
 else
  select value into invoice from pg_catalog.jsonb_array_elements(s.state->'invoices')
   where value->>'id'=p_subject_id::text and value->>'status'='Matched';
  if invoice is null or exists(select 1 from d5o_hosted.subcontract_cost_links
    where workspace_id=ws.id and work_id=work.id and invoice_id=p_subject_id and kind='Incurred') then
   raise exception 'matched_unposted_subcontract_invoice_required' using errcode='23514'; end if;
  select value into agreement from pg_catalog.jsonb_array_elements(s.state->'agreements')
   where value->>'id'=invoice->>'agreementId' and value->>'status'='Approved';
  if agreement is null then raise exception 'approved_subcontract_agreement_required' using errcode='23514'; end if;
  remaining:=(invoice->>'amountMinor')::bigint;
  for commit_row in select c.id,c.amount_minor from d5o_hosted.subcontract_cost_links l
   join d5o_hosted.subcontract_reservations r on r.id=l.reservation_id
   join d5o_hosted.connected_job_costs c on c.id=l.cost_id
   where l.workspace_id=ws.id and l.work_id=work.id and r.agreement_id=(invoice->>'agreementId')::uuid
    and l.kind='Committed' and r.amount_minor>0
   order by r.approved_at,r.id for update of c loop
   select commit_row.amount_minor-coalesce(sum(amount_minor),0) into capacity
    from d5o_hosted.connected_job_costs where reconciles_id=commit_row.id;
   amount:=least(remaining,capacity);
   if amount>0 then
    source:='Subcontract invoice '||p_subject_id::text||' commitment '||commit_row.id::text;
    insert into d5o_hosted.connected_job_costs(workspace_id,work_id,package_id,kind,category,
     amount_minor,cost_date,source,reconciles_id,recorded_by)
    values(ws.id,work.id,nullif(agreement->>'packageId',''),'Incurred','Subcontract',
     amount,current_date,source,commit_row.id,actor) returning id into cost_id;
    insert into d5o_hosted.subcontract_cost_links(workspace_id,work_id,invoice_id,kind,cost_id,recorded_by)
     values(ws.id,work.id,p_subject_id,'Incurred',cost_id,actor);
    ids:=ids||pg_catalog.jsonb_build_array(cost_id);
    remaining:=remaining-amount;
   end if;
   exit when remaining=0;
  end loop;
  if remaining<>0 then raise exception 'subcontract_invoice_commitment_reconciliation_invalid' using errcode='23514'; end if;
 end if;
 update d5o_hosted.connected_job_finance_states set revision=f.revision+1
  where workspace_id=ws.id and work_id=work.id;
 result:=pg_catalog.jsonb_build_object('action',p_action,'financeRevision',f.revision+1,
  'subcontractRevision',s.revision,'costIds',ids);
 insert into d5o_hosted.connected_job_finance_events(workspace_id,work_id,revision,command_id,
  actor_user_id,membership_id,action,result)
 values(ws.id,work.id,f.revision+1,p_command_id,actor,member.id,p_action||'-subcontract',result);
 insert into d5o_hosted.subcontract_receipts(workspace_id,command_id,work_id,actor_user_id,fingerprint,result)
 values(ws.id,p_command_id,work.id,actor,fp,result);
 return result;
end; $$;
revoke all on function public.d5o_subcontract_cost_command_v1(text,text,text,uuid,text,integer,integer)
 from public,anon,service_role;
grant execute on function public.d5o_subcontract_cost_command_v1(text,text,text,uuid,text,integer,integer)
 to authenticated;


-- Queue cards are read projections only; every command repeats membership/source checks.
create function public.d5o_subcontract_actions_v1(p_workspace_key text) returns jsonb
 language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); ws uuid; role_name text; row_item record; s jsonb; item jsonb;
 out_items jsonb:='[]'::jsonb; parent_id uuid; source jsonb; action_kind text;
begin
 if current_setting('role',true)<>'authenticated' or actor is null then
  raise exception 'subcontract_scope_denied' using errcode='42501'; end if;
 select id into ws from d5o_hosted.workspaces where workspace_key=p_workspace_key and status='active';
 select role into role_name from d5o_hosted.memberships
  where workspace_id=ws and actor_user_id=actor and status='active';
 if role_name is null then raise exception 'subcontract_scope_denied' using errcode='42501'; end if;
 for row_item in select w.id,w.created_by,l.presentation_id,w.title,coalesce(s.revision,0) revision,
   coalesce(s.state,'{"allocations":[],"agreements":[],"variations":[],"deliverables":[],"invoices":[]}'::jsonb) state
  from d5o_hosted.work_records w join d5o_hosted.work_identity_links l
   on l.workspace_id=w.workspace_id and l.work_id=w.id

  left join d5o_hosted.subcontract_states s on s.workspace_id=w.workspace_id and s.work_id=w.id
  where w.workspace_id=ws loop
  s:=row_item.state;
  source:=d5o_hosted.purchase_basis_v1(ws,row_item.id);
  select id into parent_id from d5o_hosted.purchase_authorities
   where workspace_id=ws and work_id=row_item.id and status='Approved' and subcontract_enabled
    and source_digest=source->>'digest' and current_date between valid_from and valid_until
   order by created_at desc limit 1;
  if parent_id is null then continue; end if;
  if role_name='project_manager' and row_item.created_by=actor then
   if not exists(select 1 from pg_catalog.jsonb_array_elements(s->'allocations')
     where value->>'status' in ('Prepared','Approved') and value->>'parentAuthorityId'=parent_id::text) then
    out_items:=out_items||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
     'kind','Prepare subcontract allocation','phase','Procurement','focus','subcontract-allocation',
     'workId',row_item.presentation_id,'revision',row_item.revision,'decisionId','','title',row_item.title,
     'ownership','Assigned project manager','blocker',null));
   elsif exists(select 1 from pg_catalog.jsonb_array_elements(s->'allocations')
     where value->>'status'='Approved' and value->>'parentAuthorityId'=parent_id::text)
    and not exists(select 1 from pg_catalog.jsonb_array_elements(s->'agreements')
     where value->>'status' in ('Prepared','Approved')) then
    out_items:=out_items||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
     'kind','Prepare subcontract agreement','phase','Procurement','focus','subcontract-agreement',
     'workId',row_item.presentation_id,'revision',row_item.revision,'decisionId','','title',row_item.title,
     'ownership','Assigned project manager','blocker',null));
   end if;
  end if;
  for item in select value from pg_catalog.jsonb_array_elements(s->'allocations') loop
   if item->>'status'='Prepared' and role_name='admin' and item->>'preparedBy'<>actor::text then
    out_items:=out_items||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
     'kind','Review subcontract allocation','phase','Procurement','focus','subcontract-review-allocation',
     'workId',row_item.presentation_id,'revision',row_item.revision,'decisionId',item->>'id',
     'title',row_item.title,'ownership','Independent administrator','blocker',null));
   end if;
  end loop;
  for item in select value from pg_catalog.jsonb_array_elements(s->'agreements') loop
   if item->>'status'='Prepared' and role_name='admin' and item->>'preparedBy'<>actor::text then
    out_items:=out_items||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
     'kind','Review subcontract agreement','phase','Procurement','focus','subcontract-review-agreement',
     'workId',row_item.presentation_id,'revision',row_item.revision,'decisionId',item->>'id',
     'title',row_item.title,'ownership','Independent administrator','blocker',null));
   end if;
  end loop;
  for item in select value from pg_catalog.jsonb_array_elements(s->'variations') loop
   if item->>'status'='Prepared' and role_name='admin' and item->>'preparedBy'<>actor::text then
    out_items:=out_items||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
     'kind','Review subcontract variation','phase','Procurement','focus','subcontract-review-variation',
     'workId',row_item.presentation_id,'revision',row_item.revision,'decisionId',item->>'id',
     'title',row_item.title,'ownership','Independent administrator','blocker',null));
   end if;
  end loop;
  for item in select value from pg_catalog.jsonb_array_elements(s->'deliverables') loop
   if item->>'status'='Submitted' and role_name in ('operations_leader','admin')
    and item->>'submittedBy'<>actor::text then
    out_items:=out_items||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
     'kind','Review subcontract deliverable','phase','Procurement','focus','subcontract-review-deliverable',
     'workId',row_item.presentation_id,'revision',row_item.revision,'decisionId',item->>'id',
     'title',row_item.title,'ownership','Independent Operations receiver','blocker',null));
   end if;
  end loop;
  if role_name='project_manager' and row_item.created_by=actor then
   for item in select value from pg_catalog.jsonb_array_elements(s->'agreements')
    where value->>'status'='Approved' loop
    if (item->>'revisedMinor')::bigint>coalesce((select sum((value->>'amountMinor')::bigint)
      from pg_catalog.jsonb_array_elements(s->'deliverables')
      where value->>'agreementId'=item->>'id' and value->>'status'='Accepted'),0)
      and not exists(select 1 from pg_catalog.jsonb_array_elements(s->'deliverables')
       where value->>'agreementId'=item->>'id' and value->>'status'='Submitted') then
     out_items:=out_items||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'kind','Submit subcontract deliverable','phase','Procurement','focus','subcontract-delivery',
      'workId',row_item.presentation_id,'revision',row_item.revision,'decisionId',item->>'id',
      'title',row_item.title,'ownership','Assigned project manager','blocker',null));
    end if;
   end loop;
  end if;
  if role_name='billing_commercial_lead' then
   for item in select value from pg_catalog.jsonb_array_elements(s->'deliverables')
    where value->>'status'='Accepted' loop
    if (item->>'amountMinor')::bigint>coalesce((select sum((value->>'amountMinor')::bigint)
      from pg_catalog.jsonb_array_elements(s->'invoices')
      where value->>'deliverableId'=item->>'id' and value->>'status' in ('Review','Matched')),0) then
     out_items:=out_items||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'kind','Record subcontract supplier invoice','phase','Finance','focus','subcontract-invoice',
      'workId',row_item.presentation_id,'revision',row_item.revision,'decisionId',item->>'id',
      'title',row_item.title,'ownership','Finance','blocker',null));
    end if;
   end loop;
   for item in select to_jsonb(r) from d5o_hosted.subcontract_reservations r
    where r.workspace_id=ws and r.work_id=row_item.id and r.amount_minor>0 loop
    if not exists(select 1 from d5o_hosted.subcontract_cost_links
      where workspace_id=ws and work_id=row_item.id and reservation_id=(item->>'id')::uuid
       and kind='Committed') then
     out_items:=out_items||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'kind','Post subcontract commitment','phase','Finance','focus','subcontract-cost-commitment',
      'workId',row_item.presentation_id,'revision',row_item.revision,'decisionId',item->>'id',
      'title',row_item.title,'ownership','Finance','blocker',null));
    end if;
   end loop;
  end if;  for item in select value from pg_catalog.jsonb_array_elements(s->'invoices') loop
   if item->>'status'='Review' and role_name='admin' and item->>'recordedBy'<>actor::text then
    out_items:=out_items||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
     'kind','Review subcontract invoice','phase','Finance','focus','subcontract-review-invoice',
     'workId',row_item.presentation_id,'revision',row_item.revision,'decisionId',item->>'id',
     'title',row_item.title,'ownership','Independent Finance reviewer','blocker',null));
   elsif item->>'status'='Matched' and role_name='billing_commercial_lead' and not exists(
    select 1 from d5o_hosted.subcontract_cost_links where workspace_id=ws and work_id=row_item.id
     and invoice_id=(item->>'id')::uuid and kind='Incurred') then
    out_items:=out_items||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
     'kind','Post subcontract incurred cost','phase','Finance','focus','subcontract-cost-invoice',
     'workId',row_item.presentation_id,'revision',row_item.revision,'decisionId',item->>'id',
     'title',row_item.title,'ownership','Finance','blocker',null));
   end if;
  end loop;
 end loop;
 return out_items;
end; $$;
revoke all on function public.d5o_subcontract_actions_v1(text) from public,anon,service_role;
grant execute on function public.d5o_subcontract_actions_v1(text) to authenticated;



create or replace function public.d5o_purchase_authority_read_v1(p_workspace_key text,p_presentation_id text) returns jsonb
 language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); ws uuid; w uuid; source jsonb; rev integer;
 design_used bigint; purchase_used bigint; sub_used bigint; parent_cap bigint; purchase_cap bigint;
begin
 if current_setting('role',true)<>'authenticated' or actor is null then raise exception 'workspace_forbidden' using errcode='42501'; end if;
 select id into ws from d5o_hosted.workspaces where workspace_key=p_workspace_key and status='active';
 if not exists(select 1 from d5o_hosted.memberships where workspace_id=ws and actor_user_id=actor
  and status='active' and role in ('admin','project_manager','operations_leader','billing_commercial_lead'))
  then raise exception 'workspace_forbidden' using errcode='42501'; end if;
 select work_id into w from d5o_hosted.work_identity_links where workspace_id=ws and presentation_id=p_presentation_id;
 if w is null then raise exception 'connected_work_unavailable' using errcode='42501'; end if;
 select revision into rev from d5o_hosted.purchase_authority_positions where workspace_id=ws and work_id=w;
 source:=d5o_hosted.purchase_basis_v1(ws,w);
 select coalesce(sum(amount_minor),0) into design_used from d5o_hosted.design_spend_commitments
  where workspace_id=ws and work_id=w and status='Approved';
 select coalesce(sum(amount_minor),0) into purchase_used from d5o_hosted.purchase_reservations
  where workspace_id=ws and work_id=w and status='Reserved';
 select coalesce(sum(amount_minor),0) into sub_used from d5o_hosted.subcontract_reservations where workspace_id=ws and work_id=w;
 select parent_cap_minor,purchasing_cap_minor into parent_cap,purchase_cap
  from d5o_hosted.purchase_authorities where workspace_id=ws and work_id=w and status='Approved'
   and source_digest=source->>'digest' and current_date between valid_from and valid_until
  order by created_at desc limit 1;
 return pg_catalog.jsonb_build_object('revision',coalesce(rev,0),'source',source,
  'legacyPurchaseHold',exists(select 1 from d5o_hosted.graybar_states g
   cross join lateral pg_catalog.jsonb_array_elements(coalesce(g.state->'orders','[]'::jsonb)) historical
   where g.workspace_id=ws and g.work_id=w
    and historical->>'status' in ('Approved','Test submitted','Acknowledged')
    and not exists(select 1 from d5o_hosted.purchase_reservations r
     where r.workspace_id=ws and r.work_id=w and r.order_id=historical->>'id')),
  'currentBomId',(select state#>>'{bom,id}' from d5o_hosted.graybar_states
    where workspace_id=ws and work_id=w and state#>>'{bom,status}'='Approved'),
  'designCommittedMinor',design_used,'purchaseReservedMinor',purchase_used,'subcontractReservedMinor',sub_used,
  'parentCapMinor',parent_cap,'purchaseCapMinor',purchase_cap,
  'parentRemainingMinor',case when parent_cap is null then null else parent_cap-design_used-purchase_used-sub_used end,
  'purchaseRemainingMinor',case when purchase_cap is null then null else purchase_cap-purchase_used end,
  'authorities',coalesce((select pg_catalog.jsonb_agg(to_jsonb(a) order by a.created_at)
    from d5o_hosted.purchase_authorities a where a.workspace_id=ws and a.work_id=w),'[]'::jsonb),
  'reservations',coalesce((select pg_catalog.jsonb_agg(to_jsonb(r) order by r.approved_at)
    from d5o_hosted.purchase_reservations r where r.workspace_id=ws and r.work_id=w),'[]'::jsonb));
end; $$;

create trigger combined_parent_authority_cap after update of status on d5o_hosted.purchase_authorities
 for each row when (new.status='Approved' and old.status is distinct from new.status)
 execute function d5o_hosted.guard_combined_work_authority_v1();



create or replace function public.d5o_purchase_authority_command_v1(
 p_workspace_key text,p_presentation_id text,p_action text,p_input jsonb,p_command_id text,
 p_expected_revision integer,p_expected_source_digest text) returns jsonb
 language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); ws d5o_hosted.workspaces%rowtype; member d5o_hosted.memberships%rowtype;
 work d5o_hosted.work_records%rowtype; pos d5o_hosted.purchase_authority_positions%rowtype;
 authority d5o_hosted.purchase_authorities%rowtype; prior d5o_hosted.purchase_authorities%rowtype;
 receipt d5o_hosted.purchase_authority_receipts%rowtype; source jsonb; fp text; result jsonb;
 next_rev integer; subject uuid; design_used bigint; purchase_used bigint; current_bom jsonb;
begin
 if current_setting('role',true)<>'authenticated' or actor is null
  or p_action not in ('prepare','approve','return','revoke')
  or pg_catalog.jsonb_typeof(p_input)<>'object' or length(coalesce(p_command_id,'')) not between 8 and 120
  or p_expected_revision is null or p_expected_revision<0 then
  raise exception 'invalid_purchase_authority_command' using errcode='22023'; end if;
 select * into ws from d5o_hosted.workspaces where workspace_key=p_workspace_key and status='active';
 select * into member from d5o_hosted.memberships where workspace_id=ws.id and actor_user_id=actor and status='active' for share;
 select w.* into work from d5o_hosted.work_records w join d5o_hosted.work_identity_links l
  on l.workspace_id=w.workspace_id and l.work_id=w.id
  where w.workspace_id=ws.id and l.presentation_id=p_presentation_id for update of w;
 if member.id is null or work.id is null then raise exception 'workspace_forbidden' using errcode='42501'; end if;
 fp:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_workspace_key,p_presentation_id,p_action,p_input,p_expected_revision,p_expected_source_digest)::text);
 select * into receipt from d5o_hosted.purchase_authority_receipts where workspace_id=ws.id and command_id=p_command_id;
 if found then
  if receipt.work_id<>work.id or receipt.actor_user_id<>actor or receipt.fingerprint<>fp then
   raise exception 'command_reuse_conflict' using errcode='23505'; end if;
  return receipt.result; end if;
 insert into d5o_hosted.purchase_authority_positions(workspace_id,work_id) values(ws.id,work.id) on conflict do nothing;
 select * into pos from d5o_hosted.purchase_authority_positions where workspace_id=ws.id and work_id=work.id for update;
 if pos.revision<>p_expected_revision then raise exception 'stale_purchase_authority_revision' using errcode='23505'; end if;
 source:=d5o_hosted.purchase_basis_v1(ws.id,work.id);
 if p_action<>'revoke' and (source is null or source->>'digest' is distinct from p_expected_source_digest) then
  raise exception 'purchase_authority_source_changed' using errcode='23514'; end if;
 if p_action='prepare' then
  if member.role<>'project_manager' or work.created_by<>actor then
   raise exception 'purchase_authority_preparer_required' using errcode='42501'; end if;
  if coalesce(p_input->>'parentCapMinor','') !~ '^[1-9][0-9]*$'
   or coalesce(p_input->>'purchaseCapMinor','') !~ '^(0|[1-9][0-9]*)$'
   or coalesce(p_input->>'validFrom','') !~ '^\d{4}-\d{2}-\d{2}$'
   or coalesce(p_input->>'validUntil','') !~ '^\d{4}-\d{2}-\d{2}$'
   or length(trim(coalesce(p_input->>'purchasingEntity',''))) not between 4 and 200
   or length(trim(coalesce(p_input->>'graybarAccountReference',''))) not between 3 and 200
   or length(trim(coalesce(p_input->>'scope',''))) not between 10 and 2000
   or length(trim(coalesce(p_input->>'fundingSource',''))) not between 8 and 1000
   or length(trim(coalesce(p_input->>'sourceReference',''))) not between 5 and 500
   or length(trim(coalesce(p_input->>'conditions',''))) < 10 then
   raise exception 'purchase_authority_basis_invalid' using errcode='22023'; end if;
  if ((p_input->>'purchaseCapMinor')::bigint=0 and coalesce((p_input->>'subcontractEnabled')::boolean,false)=false)
   or (p_input->>'purchaseCapMinor')::bigint>(p_input->>'parentCapMinor')::bigint
   or (p_input->>'validFrom')::date>(p_input->>'validUntil')::date
   or (p_input->>'validUntil')::date<current_date then
   raise exception 'purchase_authority_cap_or_dates_invalid' using errcode='23514'; end if;
  select state->'bom' into current_bom from d5o_hosted.graybar_states
   where workspace_id=ws.id and work_id=work.id for share;
  if (p_input->>'purchaseCapMinor')::bigint>0 and current_bom->>'status' is distinct from 'Approved' then raise exception 'approved_design_bom_required' using errcode='23514'; end if;
  if exists(select 1 from d5o_hosted.graybar_states g
   cross join lateral pg_catalog.jsonb_array_elements(coalesce(g.state->'orders','[]'::jsonb)) historical
   where g.workspace_id=ws.id and g.work_id=work.id
    and historical->>'status' in ('Approved','Test submitted','Acknowledged')
    and not exists(select 1 from d5o_hosted.purchase_reservations r
     where r.workspace_id=ws.id and r.work_id=work.id and r.order_id=historical->>'id')) then
   raise exception 'legacy_purchase_transition_required' using errcode='23514'; end if;
  if exists(select 1 from d5o_hosted.purchase_authorities where workspace_id=ws.id and work_id=work.id
   and status='Approved' and source_digest=source->>'digest' and valid_until>=current_date) then
   raise exception 'active_purchase_authority_exists' using errcode='23514'; end if;
  if p_input ? 'supersedesId' then
   select * into prior from d5o_hosted.purchase_authorities where id=(p_input->>'supersedesId')::uuid
    and workspace_id=ws.id and work_id=work.id;
   if prior.id is null or not (prior.status in ('Returned','Revoked')
    or prior.status='Approved' and prior.valid_until<current_date) then
    raise exception 'returned_revoked_or_expired_authority_required' using errcode='23514'; end if;
  end if;
  insert into d5o_hosted.purchase_authorities(workspace_id,work_id,status,parent_cap_minor,purchasing_cap_minor,subcontract_enabled,
   currency,purchasing_entity,graybar_account_reference,bom_id,scope,conditions,funding_source,source_reference,valid_from,valid_until,source_digest,source_snapshot,
   prepared_by,supersedes_id)
   values(ws.id,work.id,'Prepared',(p_input->>'parentCapMinor')::bigint,(p_input->>'purchaseCapMinor')::bigint,coalesce((p_input->>'subcontractEnabled')::boolean,false),
    'USD',trim(p_input->>'purchasingEntity'),trim(p_input->>'graybarAccountReference'),
    current_bom->>'id',trim(p_input->>'scope'),trim(p_input->>'conditions'),trim(p_input->>'fundingSource'),
    trim(p_input->>'sourceReference'),(p_input->>'validFrom')::date,(p_input->>'validUntil')::date,
    source->>'digest',source,actor,prior.id) returning * into authority;
 else
  if member.role<>'admin' then raise exception 'independent_purchasing_authority_required' using errcode='42501'; end if;
  select * into authority from d5o_hosted.purchase_authorities
   where id=(p_input->>'authorityId')::uuid and workspace_id=ws.id and work_id=work.id for update;
  if authority.id is null or length(trim(coalesce(p_input->>'reason',''))) < 10 then
   raise exception 'purchase_authority_and_reason_required' using errcode='23514'; end if;
  if p_action='revoke' then
   if authority.status<>'Approved' then raise exception 'approved_purchase_authority_required' using errcode='23514'; end if;
  elsif authority.status<>'Prepared' or authority.prepared_by=actor then
   raise exception 'independent_purchasing_authority_required' using errcode='42501';
  end if;
  if p_action='approve' then
   select state->'bom' into current_bom from d5o_hosted.graybar_states
    where workspace_id=ws.id and work_id=work.id for share;
   if authority.purchasing_cap_minor>0 and (authority.bom_id is distinct from current_bom->>'id' or current_bom->>'status' is distinct from 'Approved') then
    raise exception 'purchase_authority_bom_changed' using errcode='23514'; end if;
   if authority.source_digest<>source->>'digest' or authority.valid_until<current_date
    or exists(select 1 from d5o_hosted.purchase_authorities where workspace_id=ws.id and work_id=work.id
     and status='Approved' and source_digest=source->>'digest' and valid_until>=current_date) then
    raise exception 'purchase_authority_stale_or_duplicate' using errcode='23514'; end if;
   select coalesce(sum(amount_minor),0) into design_used from d5o_hosted.design_spend_commitments
    where workspace_id=ws.id and work_id=work.id and status='Approved';
   select coalesce(sum(amount_minor),0) into purchase_used from d5o_hosted.purchase_reservations
    where workspace_id=ws.id and work_id=work.id and status='Reserved';
   if design_used+purchase_used>authority.parent_cap_minor or purchase_used>authority.purchasing_cap_minor then
    raise exception 'purchase_authority_below_existing_commitments' using errcode='23514'; end if;
  end if;
  update d5o_hosted.purchase_authorities set status=case p_action when 'approve' then 'Approved'
   when 'return' then 'Returned' else 'Revoked' end,
   reviewed_by=actor,review_note=trim(p_input->>'reason'),decided_at=now() where id=authority.id;
 end if;
 subject:=authority.id; next_rev:=pos.revision+1;
 update d5o_hosted.purchase_authority_positions set revision=next_rev,updated_at=now()
  where workspace_id=ws.id and work_id=work.id;
 insert into d5o_hosted.purchase_authority_events(workspace_id,work_id,revision,action,command_id,actor_user_id,
  membership_id,subject_id,basis) values(ws.id,work.id,next_rev,p_action,p_command_id,actor,member.id,subject,
   pg_catalog.jsonb_build_object('input',p_input,'source',source));
 result:=pg_catalog.jsonb_build_object('revision',next_rev,'action',p_action,'subjectId',subject,
  'status',case p_action when 'prepare' then 'Prepared' when 'approve' then 'Approved'
   when 'return' then 'Returned' else 'Revoked' end);
 insert into d5o_hosted.purchase_authority_receipts(workspace_id,command_id,work_id,actor_user_id,fingerprint,result)
  values(ws.id,p_command_id,work.id,actor,fp,result);
 return result;
end; $$;
