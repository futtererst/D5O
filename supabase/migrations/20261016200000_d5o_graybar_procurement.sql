-- Graybar document-led procurement remains separate from customer pricing and execution authority.
create table d5o_hosted.graybar_documents (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, work_id uuid not null,
  kind text not null check(kind in ('quote','specification','acknowledgment','delivery','supplier_invoice','other')),
  filename text not null, media_type text not null,
  storage_path text not null unique, sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
  byte_count bigint not null check(byte_count>0 and byte_count<=20000000),
  uploaded_by uuid not null references auth.users(id), uploaded_at timestamptz not null default now(),
  unique(workspace_id,work_id,id),
  foreign key(work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id)
);
-- A stable product is distinct from a dated, account-specific distributor offer.
create table d5o_hosted.graybar_products (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null,
  graybar_sku text not null, manufacturer text, manufacturer_part_number text,
  first_description text not null, first_quote_document_id uuid not null references d5o_hosted.graybar_documents(id),
  created_at timestamptz not null default now(), unique(workspace_id,graybar_sku)
);
create table d5o_hosted.graybar_document_extractions (
  document_id uuid not null references d5o_hosted.graybar_documents(id), version integer not null check(version>0),
  extraction jsonb not null check(jsonb_typeof(extraction)='object'), accepted_by uuid references auth.users(id),
  created_at timestamptz not null default now(), primary key(document_id,version)
);
create table d5o_hosted.graybar_states (
  workspace_id uuid not null,work_id uuid not null,revision integer not null check(revision>0),
  state jsonb not null check(jsonb_typeof(state)='object'),updated_at timestamptz not null default now(),
  primary key(workspace_id,work_id),foreign key(work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id)
);
create table d5o_hosted.graybar_events (
  workspace_id uuid not null,work_id uuid not null,revision integer not null,
  command_id text not null,action text not null,actor_user_id uuid not null references auth.users(id),
  membership_id uuid not null references d5o_hosted.memberships(id),
  source jsonb not null,state jsonb not null,occurred_at timestamptz not null default now(),
  primary key(workspace_id,work_id,revision),unique(workspace_id,command_id),
  foreign key(work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id)
);
create table d5o_hosted.graybar_receipts (
  workspace_id uuid not null,command_id text not null,work_id uuid not null,
  actor_user_id uuid not null references auth.users(id),fingerprint text not null,result jsonb not null,
  primary key(workspace_id,command_id),foreign key(work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id)
);
alter table d5o_hosted.graybar_documents enable row level security;
alter table d5o_hosted.graybar_products enable row level security;
alter table d5o_hosted.graybar_document_extractions enable row level security;
alter table d5o_hosted.graybar_states enable row level security;
alter table d5o_hosted.graybar_events enable row level security;
alter table d5o_hosted.graybar_receipts enable row level security;
revoke all on d5o_hosted.graybar_documents,d5o_hosted.graybar_states,d5o_hosted.graybar_events,d5o_hosted.graybar_receipts from public,anon,authenticated,service_role;
revoke all on d5o_hosted.graybar_products from public,anon,authenticated,service_role;
revoke all on d5o_hosted.graybar_document_extractions from public,anon,authenticated,service_role;

create function public.d5o_graybar_read_v1(p_workspace_key text,p_presentation_id text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace uuid;v_work uuid;v_state d5o_hosted.graybar_states%rowtype;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  select id into v_workspace from d5o_hosted.workspaces where workspace_key=p_workspace_key and status='active';
  if not exists(select 1 from d5o_hosted.memberships where workspace_id=v_workspace and actor_user_id=v_actor and status='active' and role<>'field_worker') then
    raise exception 'workspace_forbidden' using errcode='42501'; end if;
  select work_id into v_work from d5o_hosted.work_identity_links where workspace_id=v_workspace and presentation_id=p_presentation_id;
  if v_work is null then raise exception 'connected_work_unavailable' using errcode='42501'; end if;
  select * into v_state from d5o_hosted.graybar_states where workspace_id=v_workspace and work_id=v_work;
  return jsonb_build_object('revision',coalesce(v_state.revision,0),
    'state',coalesce(v_state.state,'{"quotes":[],"assessments":[],"bom":null,"orders":[],"shipments":[],"receipts":[],"supplierInvoices":[],"returns":[],"credits":[],"installed":[]}'::jsonb),
    'documents',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'kind',d.kind,'filename',d.filename,'sha256',d.sha256,'byteCount',d.byte_count,'uploadedAt',d.uploaded_at,'uploadedBy',d.uploaded_by) order by d.uploaded_at)
      from d5o_hosted.graybar_documents d where d.workspace_id=v_workspace and d.work_id=v_work),'[]'::jsonb));
end; $$;
revoke all on function public.d5o_graybar_read_v1(text,text) from public,anon,service_role;
grant execute on function public.d5o_graybar_read_v1(text,text) to authenticated;

-- Only the server custody route calls this after writing and re-reading private bytes.
create function public.d5o_graybar_register_document_v1(
  p_workspace_key text,p_presentation_id text,p_kind text,p_filename text,p_media_type text,
  p_storage_path text,p_sha256 text,p_byte_count bigint,p_actor uuid,p_extraction jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_workspace uuid;v_work uuid;v_id uuid;
begin
  if current_setting('role',true)<>'service_role' or p_actor is null or p_kind not in ('quote','specification','acknowledgment','delivery','supplier_invoice','other')
    or p_sha256 !~ '^[0-9a-f]{64}$' or p_byte_count<1 or p_byte_count>20000000
    or length(trim(p_filename)) not between 1 and 240 or length(trim(p_storage_path)) not between 10 and 600
    or jsonb_typeof(p_extraction)<>'object' or length(coalesce(p_extraction->>'method',''))<8 then
    raise exception 'document_registration_forbidden' using errcode='42501'; end if;
  select id into v_workspace from d5o_hosted.workspaces where workspace_key=p_workspace_key and status='active';
  select work_id into v_work from d5o_hosted.work_identity_links where workspace_id=v_workspace and presentation_id=p_presentation_id;
  if v_work is null or not exists(select 1 from d5o_hosted.memberships where workspace_id=v_workspace and actor_user_id=p_actor and status='active'
    and role in ('admin','project_manager','operations_leader','billing_commercial_lead')) then
    raise exception 'document_registration_forbidden' using errcode='42501'; end if;
  insert into d5o_hosted.graybar_documents(workspace_id,work_id,kind,filename,media_type,storage_path,sha256,byte_count,uploaded_by)
    values(v_workspace,v_work,p_kind,p_filename,p_media_type,p_storage_path,p_sha256,p_byte_count,p_actor) returning id into v_id;
  insert into d5o_hosted.graybar_document_extractions(document_id,version,extraction)
    values(v_id,1,p_extraction);
  return v_id;
end; $$;
revoke all on function public.d5o_graybar_register_document_v1(text,text,text,text,text,text,text,bigint,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.d5o_graybar_register_document_v1(text,text,text,text,text,text,text,bigint,uuid,jsonb) to service_role;

create function public.d5o_graybar_command_v1(p_workspace_key text,p_presentation_id text,p_action text,
  p_input jsonb,p_command_id text,p_expected_revision integer)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
  v_member d5o_hosted.memberships%rowtype;v_work d5o_hosted.work_records%rowtype;
  v_current d5o_hosted.graybar_states%rowtype;v_receipt d5o_hosted.graybar_receipts%rowtype;
  v_define d5o_hosted.connected_define_states%rowtype;v_design d5o_hosted.connected_design_states%rowtype;
  v_deploy d5o_hosted.connected_deploy_states%rowtype;
  v_estimate d5o_hosted.connected_estimate_states%rowtype;
  v_operate d5o_hosted.connected_operate_states%rowtype;v_operate_state jsonb;v_asset jsonb;v_deploy_revision integer;
  v_state jsonb;v_result jsonb;v_source jsonb:='{}'::jsonb;v_item jsonb;v_line jsonb;
  v_quote jsonb;v_bom jsonb;v_order jsonb;v_order_lines jsonb;v_receipt_item jsonb;v_invoice jsonb;
  v_product d5o_hosted.graybar_products%rowtype;v_quote_lines jsonb;
  v_fingerprint text;v_revision integer;v_total bigint;v_sum bigint;v_quantity numeric;
  v_doc uuid;v_id text;v_now timestamptz:=now();v_count integer;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null or p_action not in
    ('accept-quote','assess-product','prepare-bom','approve-bom','prepare-po','approve-po',
     'record-test-submission','record-acknowledgment','record-shipment','record-receipt',
     'record-supplier-invoice','review-supplier-invoice','record-return','record-credit','handoff-installed')
    or jsonb_typeof(p_input)<>'object' or length(coalesce(p_command_id,'')) not between 8 and 120
    or p_expected_revision is null or p_expected_revision<0 then
    raise exception 'invalid_graybar_command' using errcode='22023'; end if;
  select * into v_workspace from d5o_hosted.workspaces where workspace_key=p_workspace_key and status='active';
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  select * into v_member from d5o_hosted.memberships where workspace_id=v_workspace.id and actor_user_id=v_actor and status='active' for share;
  if not found or v_member.role='field_worker' then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  select w.* into v_work from d5o_hosted.work_records w join d5o_hosted.work_identity_links l on l.workspace_id=w.workspace_id and l.work_id=w.id
    where w.workspace_id=v_workspace.id and l.presentation_id=p_presentation_id for update of w;
  if not found then raise exception 'connected_work_unavailable' using errcode='42501'; end if;
  v_fingerprint:=md5(jsonb_build_array(p_workspace_key,p_presentation_id,p_action,p_input,p_expected_revision)::text);
  select * into v_receipt from d5o_hosted.graybar_receipts where workspace_id=v_workspace.id and command_id=p_command_id;
  if found then
    if v_receipt.work_id<>v_work.id or v_receipt.actor_user_id<>v_actor or v_receipt.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_receipt.result;
  end if;
  select * into v_current from d5o_hosted.graybar_states where workspace_id=v_workspace.id and work_id=v_work.id for update;
  if coalesce(v_current.revision,0)<>p_expected_revision then raise exception 'stale_state' using errcode='23505'; end if;
  v_state:=coalesce(v_current.state,'{"quotes":[],"assessments":[],"bom":null,"orders":[],"shipments":[],"receipts":[],"supplierInvoices":[],"returns":[],"credits":[],"installed":[]}'::jsonb);
  select * into v_define from d5o_hosted.connected_define_states where workspace_id=v_workspace.id and work_id=v_work.id for share;
  select * into v_design from d5o_hosted.connected_design_states where workspace_id=v_workspace.id and work_id=v_work.id for share;
  select * into v_estimate from d5o_hosted.connected_estimate_states where workspace_id=v_workspace.id and work_id=v_work.id for share;
  if p_action in ('prepare-bom','approve-bom','prepare-po','approve-po','record-test-submission') then
    select * into v_deploy from d5o_hosted.connected_deploy_states
      where workspace_id=v_workspace.id and work_id=v_work.id for share;
    if v_deploy.state#>>'{workAcceptance,receipt}'='Accepted' then
      raise exception 'accepted_work_requires_separate_amendment' using errcode='23514'; end if;
  end if;
  if p_action='accept-quote' then
    if v_member.role not in ('admin','project_manager','billing_commercial_lead')
      or v_define.status is distinct from 'Approved' or v_define.projection#>>'{developHandoff,status}' is distinct from 'accepted' then
      raise exception 'approved_define_and_preparer_required' using errcode='42501'; end if;
    if coalesce(p_input->>'quoteNumber','')='' or coalesce(p_input->>'quoteRevision','')=''
      or coalesce(p_input->>'accountReference','')='' or p_input->>'currency'<> 'USD'
      or coalesce(p_input->>'quotedAt','') !~ '^\d{4}-\d{2}-\d{2}$'
      or coalesce(p_input->>'expiresAt','') !~ '^\d{4}-\d{2}-\d{2}$'
      or jsonb_typeof(p_input->'lines')<>'array' or jsonb_array_length(p_input->'lines')=0 then
      raise exception 'quote_header_invalid' using errcode='23514'; end if;
    v_doc:=(p_input->>'documentId')::uuid;
    if not exists(select 1 from d5o_hosted.graybar_documents where workspace_id=v_workspace.id and work_id=v_work.id and id=v_doc and kind='quote') then
      raise exception 'retained_quote_document_required' using errcode='23514'; end if;
    if exists(select 1 from jsonb_array_elements(v_state->'quotes') q where q->>'quoteNumber'=p_input->>'quoteNumber'
      and q->>'quoteRevision'=p_input->>'quoteRevision') then raise exception 'duplicate_quote_revision' using errcode='23505'; end if;
    if exists(select 1 from jsonb_array_elements(v_state->'quotes') q where q->>'documentId'=p_input->>'documentId') then
      raise exception 'duplicate_quote_document' using errcode='23505'; end if;
    if exists(select 1 from jsonb_array_elements(v_state->'quotes') q
      join d5o_hosted.graybar_documents prior on prior.workspace_id=v_workspace.id and prior.work_id=v_work.id
        and prior.id=(q->>'documentId')::uuid
      join d5o_hosted.graybar_documents incoming on incoming.id=v_doc
      where prior.sha256=incoming.sha256) then
      raise exception 'duplicate_quote_bytes' using errcode='23505'; end if;
    if exists(select 1 from (select l->>'lineNumber' as n,count(*) as c from jsonb_array_elements(p_input->'lines') l group by l->>'lineNumber') x
      where x.n is null or x.n='' or x.c>1) then raise exception 'duplicate_quote_line' using errcode='23514'; end if;
    v_sum:=0;v_quote_lines:='[]'::jsonb;
    for v_line in select value from jsonb_array_elements(p_input->'lines') loop
      if coalesce(v_line->>'graybarSku','')='' or coalesce(v_line->>'description','')=''
        or coalesce(v_line->>'unit','')='' or coalesce(v_line->>'quantity','') !~ '^\d+(\.\d{1,3})?$'
        or (v_line->>'quantity')::numeric<=0 or coalesce(v_line->>'packSize','') !~ '^\d+(\.\d{1,3})?$'
        or (v_line->>'packSize')::numeric<=0 or v_line->>'priceBasis' not in ('each','pack','length')
        or coalesce(v_line->>'unitPriceMinor','') !~ '^\d+$' or coalesce(v_line->>'extendedMinor','') !~ '^\d+$'
        or (v_line->>'extendedMinor')::bigint<>round((v_line->>'quantity')::numeric/(v_line->>'packSize')::numeric*(v_line->>'unitPriceMinor')::bigint)::bigint then
        raise exception 'quote_line_arithmetic_or_unit_invalid' using errcode='23514'; end if;
      v_sum:=v_sum+(v_line->>'extendedMinor')::bigint;
      select * into v_product from d5o_hosted.graybar_products
        where workspace_id=v_workspace.id and graybar_sku=v_line->>'graybarSku' for update;
      if found then
        if (nullif(v_product.manufacturer,'') is not null and nullif(v_line->>'manufacturer','') is not null
            and v_product.manufacturer<>v_line->>'manufacturer')
          or (nullif(v_product.manufacturer_part_number,'') is not null and nullif(v_line->>'manufacturerPartNumber','') is not null
            and v_product.manufacturer_part_number<>v_line->>'manufacturerPartNumber') then
          raise exception 'product_identity_conflict' using errcode='23514'; end if;
      else
        insert into d5o_hosted.graybar_products(workspace_id,graybar_sku,manufacturer,manufacturer_part_number,
          first_description,first_quote_document_id)
          values(v_workspace.id,v_line->>'graybarSku',nullif(v_line->>'manufacturer',''),
            nullif(v_line->>'manufacturerPartNumber',''),v_line->>'description',v_doc)
          returning * into v_product;
      end if;
      v_quote_lines:=v_quote_lines||jsonb_build_array(v_line||jsonb_build_object('productId',v_product.id));
    end loop;
    if coalesce(p_input->>'freightMinor','') !~ '^\d+$' or coalesce(p_input->>'totalMinor','') !~ '^\d+$'
      or v_sum+(p_input->>'freightMinor')::bigint<>(p_input->>'totalMinor')::bigint then
      raise exception 'quote_total_mismatch' using errcode='23514'; end if;
    v_id:=gen_random_uuid()::text;
    v_item:=p_input||jsonb_build_object('id',v_id,'lines',v_quote_lines,'defineRevision',v_define.definition_revision,
      'acceptedBy',v_actor,'acceptedAt',v_now,'channel','document','status','Accepted');
    v_state:=jsonb_set(v_state,'{quotes}',v_state->'quotes'||jsonb_build_array(v_item));
    update d5o_hosted.graybar_document_extractions set accepted_by=v_actor
      where document_id=v_doc and version=1 and accepted_by is null;
    v_source:=jsonb_build_object('defineRevision',v_define.definition_revision,'documentId',v_doc);
  elsif p_action='assess-product' then
    if v_member.role not in ('admin','operations_leader') then raise exception 'technical_reviewer_required' using errcode='42501'; end if;
    select value into v_quote from jsonb_array_elements(v_state->'quotes') where value->>'id'=p_input->>'quoteId';
    if v_quote is null or v_quote->>'defineRevision'<>v_define.definition_revision::text
      or v_quote->>'acceptedBy'=v_actor::text or p_input->>'result' not in ('Meets','Alternative','Insufficient evidence','Fails')
      or coalesce(p_input->>'requirementId','')='' or coalesce(p_input->>'rationale','')='' or coalesce(p_input->>'specificationSource','')='' then
      raise exception 'product_assessment_invalid' using errcode='23514'; end if;
    if not exists(select 1 from d5o_hosted.graybar_documents where workspace_id=v_workspace.id and work_id=v_work.id
      and id=(p_input->>'specificationDocumentId')::uuid and kind in ('specification','quote')) then
      raise exception 'retained_specification_required' using errcode='23514'; end if;
    if not exists(select 1 from jsonb_array_elements(v_quote->'lines') where value->>'lineNumber'=p_input->>'lineNumber')
      or not exists(select 1 from jsonb_array_elements(coalesce(v_define.projection#>'{scopeControl,requirements}','[]'::jsonb))
        where value->>'id'=p_input->>'requirementId') then raise exception 'product_requirement_mismatch' using errcode='23514'; end if;
    if exists(select 1 from jsonb_array_elements(v_state->'assessments') a where a->>'quoteId'=p_input->>'quoteId'
      and a->>'lineNumber'=p_input->>'lineNumber' and a->>'requirementId'=p_input->>'requirementId') then
      raise exception 'assessment_already_recorded' using errcode='23505'; end if;
    v_item:=p_input||jsonb_build_object('id',gen_random_uuid(),'defineRevision',v_define.definition_revision,'reviewedBy',v_actor,'reviewedAt',v_now);
    v_state:=jsonb_set(v_state,'{assessments}',v_state->'assessments'||jsonb_build_array(v_item));
    v_source:=jsonb_build_object('quoteId',p_input->>'quoteId','defineRevision',v_define.definition_revision);
  elsif p_action='prepare-bom' then
    if v_member.role not in ('admin','project_manager') or v_design.work_id is null
      or v_estimate.status is distinct from 'Approved' or v_define.status is distinct from 'Approved'
      or jsonb_typeof(p_input->'lines')<>'array' or jsonb_array_length(p_input->'lines')=0 then
      raise exception 'current_design_and_rom_required' using errcode='23514'; end if;
    if v_state->'bom' is not null and v_state#>>'{bom,status}'='Approved' then
      raise exception 'approved_bom_locked' using errcode='23514'; end if;
    if exists(select 1 from (select l->>'materialId' as id,count(*) c from jsonb_array_elements(p_input->'lines') l group by l->>'materialId') x
      where x.id is null or x.c>1) then raise exception 'duplicate_bom_allocation' using errcode='23514'; end if;
    for v_line in select value from jsonb_array_elements(p_input->'lines') loop
      select value into v_item from jsonb_array_elements(coalesce(v_design.state->'packages','[]'::jsonb))
        where value->>'packageId'=v_line->>'packageId' and value->>'revision'=v_line->>'packageRevision'
          and value->>'status' in ('In review','Approved');
      if v_item is null or v_item->>'commercialDisposition'='Assessment required'
        or not exists(select 1 from jsonb_array_elements(coalesce(v_item->'materialLines','[]'::jsonb)) m
        where m->>'id'=v_line->>'materialId' and m->>'item'=v_line->>'item'
          and m->>'unit'=v_line->>'unit' and m->>'quantity'=v_line->>'quantity') then
        raise exception 'bom_design_line_mismatch' using errcode='23514'; end if;
      select value into v_quote from jsonb_array_elements(v_state->'quotes') where value->>'id'=v_line->>'quoteId';
      if v_quote is null or v_quote->>'defineRevision'<>v_define.definition_revision::text
        or not exists(select 1 from jsonb_array_elements(v_quote->'lines') q where q->>'lineNumber'=v_line->>'lineNumber'
          and q->>'unit'=v_line->>'unit' and q->>'description'=v_line->>'item')
        or not exists(select 1 from jsonb_array_elements(v_state->'assessments') a
          where a->>'quoteId'=v_line->>'quoteId' and a->>'lineNumber'=v_line->>'lineNumber' and a->>'result'='Meets') then
        raise exception 'bom_quote_or_assessment_invalid' using errcode='23514'; end if;
      if coalesce(v_line->>'supplyResponsibility','') not in ('Rybex','Customer') or
        coalesce(v_line->>'requiredDate','') !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'bom_supply_basis_invalid' using errcode='23514'; end if;
    end loop;
    if exists(select 1 from jsonb_array_elements(coalesce(v_design.state->'packages','[]'::jsonb)) p
      cross join lateral jsonb_array_elements(coalesce(p->'materialLines','[]'::jsonb)) m
      where exists(select 1 from jsonb_array_elements(coalesce(v_design.state->'releases','[]'::jsonb)) r
        where r->>'packageId'=p->>'packageId' and r->>'packageRevision'=p->>'revision' and r->>'status'='Accepted')
      and not exists(select 1 from jsonb_array_elements(p_input->'lines') l where l->>'materialId'=m->>'id')) then
      raise exception 'bom_released_material_missing' using errcode='23514'; end if;
    v_bom:=jsonb_build_object('id',gen_random_uuid(),'status','Prepared','designRevision',v_design.decision_revision,
      'defineRevision',v_define.definition_revision,'estimateRevision',v_estimate.estimate_revision,
      'lines',p_input->'lines','preparedBy',v_actor,'preparedAt',v_now,'romDifference',coalesce(p_input->>'romDifference',''),
      'unpricedDifferences',coalesce(p_input->>'unpricedDifferences',''));
    v_state:=jsonb_set(v_state,'{bom}',v_bom);
    v_source:=jsonb_build_object('designRevision',v_design.decision_revision,'estimateRevision',v_estimate.estimate_revision);
  elsif p_action='approve-bom' then
    v_bom:=v_state->'bom';
    if v_member.role not in ('admin','operations_leader') or v_bom->>'status'<>'Prepared'
      or v_bom->>'preparedBy'=v_actor::text or v_bom->>'designRevision'<>v_design.decision_revision::text
      or v_bom->>'estimateRevision'<>v_estimate.estimate_revision::text
      or v_bom->>'defineRevision'<>v_define.definition_revision::text
      or coalesce(p_input->>'reviewNote','')='' then
      raise exception 'independent_current_bom_review_required' using errcode='42501'; end if;
    v_bom:=v_bom||jsonb_build_object('status','Approved','approvedBy',v_actor,'approvedAt',v_now,'reviewNote',p_input->>'reviewNote');
    v_state:=jsonb_set(v_state,'{bom}',v_bom);
    v_source:=jsonb_build_object('bomId',v_bom->>'id','designRevision',v_design.decision_revision);
  elsif p_action='prepare-po' then
    v_bom:=v_state->'bom';
    if v_member.role not in ('admin','project_manager') or v_bom->>'status'<>'Approved'
      or v_bom->>'designRevision'<>v_design.decision_revision::text
      or v_bom->>'defineRevision'<>v_define.definition_revision::text
      or v_bom->>'estimateRevision'<>v_estimate.estimate_revision::text
      or jsonb_typeof(p_input->'lines')<>'array' or jsonb_array_length(p_input->'lines')=0
      or coalesce(p_input->>'shipTo','')='' or coalesce(p_input->>'accountReference','')='' then
      raise exception 'approved_current_bom_required' using errcode='23514'; end if;
    if exists(select 1 from jsonb_array_elements(v_state->'orders') where value->>'bomId'=v_bom->>'id') then
      raise exception 'bom_already_ordered' using errcode='23505'; end if;
    if exists(select 1 from (select l->>'materialId' id,count(*) c from jsonb_array_elements(p_input->'lines') l group by l->>'materialId') x
      where x.id is null or x.c>1) then raise exception 'duplicate_po_allocation' using errcode='23514'; end if;
    v_order_lines:='[]'::jsonb;
    v_sum:=0;
    for v_line in select value from jsonb_array_elements(p_input->'lines') loop
      select value into v_item from jsonb_array_elements(v_bom->'lines') where value->>'materialId'=v_line->>'materialId';
      if v_item is null or v_item->>'supplyResponsibility'<>'Rybex' or
        v_line->>'quantity'<>v_item->>'quantity' or v_line->>'unit'<>v_item->>'unit' then
        raise exception 'po_bom_allocation_invalid' using errcode='23514'; end if;
      select value into v_quote from jsonb_array_elements(v_state->'quotes') where value->>'id'=v_item->>'quoteId';
      if v_quote is null or v_quote->>'expiresAt'<current_date::text or v_quote->>'accountReference'<>p_input->>'accountReference' then
        raise exception 'quote_expired_or_account_changed' using errcode='23514'; end if;
      select value into v_receipt_item from jsonb_array_elements(v_quote->'lines') where value->>'lineNumber'=v_item->>'lineNumber';
      if v_receipt_item is null or v_receipt_item->>'unit'<>v_line->>'unit'
        or (v_receipt_item->>'priceBasis')='pack' and mod((v_line->>'quantity')::numeric,(v_receipt_item->>'packSize')::numeric)<>0 then
        raise exception 'po_pack_or_unit_invalid' using errcode='23514'; end if;
      v_sum:=v_sum+round((v_line->>'quantity')::numeric/(v_receipt_item->>'packSize')::numeric*(v_receipt_item->>'unitPriceMinor')::bigint)::bigint;
      v_order_lines:=v_order_lines||jsonb_build_array(v_line||jsonb_build_object(
        'unitPriceMinor',v_receipt_item->>'unitPriceMinor','packSize',v_receipt_item->>'packSize',
        'graybarSku',v_receipt_item->>'graybarSku','quoteId',v_quote->>'id',
        'quoteLineNumber',v_receipt_item->>'lineNumber'));

    end loop;
    if coalesce(p_input->>'budgetMinor','') !~ '^\d+$' or v_sum>(p_input->>'budgetMinor')::bigint then
      raise exception 'purchase_budget_exceeded' using errcode='23514'; end if;
    v_order:=jsonb_build_object('id',gen_random_uuid(),'status','Prepared','bomId',v_bom->>'id',
      'designRevision',v_design.decision_revision,'accountReference',p_input->>'accountReference',
      'shipTo',p_input->>'shipTo','requiredDate',p_input->>'requiredDate','lines',v_order_lines,
      'amountMinor',v_sum,'currency','USD','budgetMinor',(p_input->>'budgetMinor')::bigint,
      'preparedBy',v_actor,'preparedAt',v_now,'substitutionsPermitted',false);
    v_state:=jsonb_set(v_state,'{orders}',v_state->'orders'||jsonb_build_array(v_order));
    v_source:=jsonb_build_object('bomId',v_bom->>'id','designRevision',v_design.decision_revision);
  elsif p_action='approve-po' then
    select value into v_order from jsonb_array_elements(v_state->'orders') where value->>'id'=p_input->>'orderId';
    if v_member.role<>'admin' or v_order->>'status'<>'Prepared' or v_order->>'preparedBy'=v_actor::text
      or v_order->>'bomId'<>v_state#>>'{bom,id}' or v_order->>'designRevision'<>v_design.decision_revision::text
      or v_state#>>'{bom,defineRevision}'<>v_define.definition_revision::text
      or v_state#>>'{bom,estimateRevision}'<>v_estimate.estimate_revision::text then
      raise exception 'independent_purchasing_authority_required' using errcode='42501'; end if;
    for v_line in select value from jsonb_array_elements(v_order->'lines') loop
      select value into v_item from jsonb_array_elements(v_state#>'{bom,lines}') where value->>'materialId'=v_line->>'materialId';
      select value into v_quote from jsonb_array_elements(v_state->'quotes') where value->>'id'=v_item->>'quoteId';
      if v_quote->>'expiresAt'<current_date::text then raise exception 'quote_expired' using errcode='23514'; end if;
    end loop;
    v_order:=v_order||jsonb_build_object('status','Approved','approvedBy',v_actor,'approvedAt',v_now,
      'authorityBasis',coalesce(p_input->>'authorityBasis','Workspace administrator'));
    v_state:=jsonb_set(v_state,'{orders}',(select jsonb_agg(case when value->>'id'=p_input->>'orderId' then v_order else value end)
      from jsonb_array_elements(v_state->'orders')));
    v_source:=jsonb_build_object('bomId',v_order->>'bomId','orderId',v_order->>'id');
  elsif p_action='record-test-submission' then
    select value into v_order from jsonb_array_elements(v_state->'orders') where value->>'id'=p_input->>'orderId';
    if v_member.role<>'admin' or v_order->>'status'<>'Approved' or p_input->>'testOnly'<>'true'
      or v_work.title !~* '^(fictional|synthetic)' or length(trim(coalesce(p_input->>'sourceReference','')))<6 then
      raise exception 'test_submission_authority_required' using errcode='42501'; end if;
    v_order:=v_order||jsonb_build_object('status','Test submitted','submissionChannel','controlled local fixture',
      'submissionSource',p_input->>'sourceReference','submittedAt',v_now,'submittedBy',v_actor,
      'supplierAcknowledged',false);
    v_state:=jsonb_set(v_state,'{orders}',(select jsonb_agg(case when value->>'id'=p_input->>'orderId' then v_order else value end)
      from jsonb_array_elements(v_state->'orders')));
    v_source:=jsonb_build_object('orderId',v_order->>'id','channel','controlled local fixture');
  elsif p_action='record-acknowledgment' then
    select value into v_order from jsonb_array_elements(v_state->'orders') where value->>'id'=p_input->>'orderId';
    if v_member.role not in ('admin','operations_leader') or v_order->>'status'<>'Test submitted'
      or coalesce(p_input->>'supplierReference','')='' or jsonb_typeof(p_input->'lines')<>'array'
      or jsonb_array_length(p_input->'lines')<>jsonb_array_length(v_order->'lines') then
      raise exception 'submitted_order_ack_required' using errcode='23514'; end if;
    v_doc:=(p_input->>'documentId')::uuid;
    if not exists(select 1 from d5o_hosted.graybar_documents where workspace_id=v_workspace.id and work_id=v_work.id and id=v_doc and kind='acknowledgment') then
      raise exception 'retained_acknowledgment_required' using errcode='23514'; end if;
    if exists(select 1 from (select l->>'materialId' id,count(*) c from jsonb_array_elements(p_input->'lines') l group by l->>'materialId') x
      where x.id is null or x.c>1) then raise exception 'duplicate_acknowledgment_line' using errcode='23514'; end if;
    for v_line in select value from jsonb_array_elements(p_input->'lines') loop
      select value into v_item from jsonb_array_elements(v_order->'lines') where value->>'materialId'=v_line->>'materialId';
      if v_item is null or coalesce(v_line->>'quantity','') !~ '^\d+(\.\d{1,3})?$'
        or (v_line->>'quantity')::numeric>(v_item->>'quantity')::numeric
        or v_line->>'unit'<>v_item->>'unit' or v_line->>'unitPriceMinor'<>v_item->>'unitPriceMinor'
        or coalesce(v_line->>'promisedDate','') !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'acknowledgment_variance_requires_disposition' using errcode='23514'; end if;
    end loop;
    v_order:=v_order||jsonb_build_object('status','Acknowledged','acknowledgment',p_input||jsonb_build_object('at',v_now,'actorId',v_actor));
    v_state:=jsonb_set(v_state,'{orders}',(select jsonb_agg(case when value->>'id'=p_input->>'orderId' then v_order else value end)
      from jsonb_array_elements(v_state->'orders')));
    v_source:=jsonb_build_object('orderId',v_order->>'id','documentId',v_doc);
  elsif p_action='record-shipment' then
    select value into v_order from jsonb_array_elements(v_state->'orders') where value->>'id'=p_input->>'orderId';
    if v_member.role not in ('admin','operations_leader') or v_order->>'status'<>'Acknowledged'
      or jsonb_typeof(p_input->'lines')<>'array' or jsonb_array_length(p_input->'lines')=0
      or coalesce(p_input->>'trackingReference','')='' then
      raise exception 'acknowledged_order_required' using errcode='23514'; end if;
    v_doc:=(p_input->>'documentId')::uuid;
    if not exists(select 1 from d5o_hosted.graybar_documents where workspace_id=v_workspace.id and work_id=v_work.id and id=v_doc and kind='delivery') then
      raise exception 'retained_delivery_document_required' using errcode='23514'; end if;
    if exists(select 1 from (select l->>'materialId' id,count(*) c from jsonb_array_elements(p_input->'lines') l group by l->>'materialId') x
      where x.id is null or x.c>1) then raise exception 'duplicate_shipment_line' using errcode='23514'; end if;
    for v_line in select value from jsonb_array_elements(p_input->'lines') loop
      select value into v_item from jsonb_array_elements(v_order->'lines') where value->>'materialId'=v_line->>'materialId';
      select coalesce(sum((sline->>'quantity')::numeric),0) into v_quantity from jsonb_array_elements(v_state->'shipments') s,
        jsonb_array_elements(s->'lines') sline where s->>'orderId'=p_input->>'orderId' and sline->>'materialId'=v_line->>'materialId';
      if v_item is null or coalesce(v_line->>'quantity','') !~ '^\d+(\.\d{1,3})?$'
        or (v_line->>'quantity')::numeric<=0 or v_quantity+(v_line->>'quantity')::numeric>(v_item->>'quantity')::numeric then
        raise exception 'shipment_exceeds_acknowledged_order' using errcode='23514'; end if;
    end loop;
    v_item:=p_input||jsonb_build_object('id',gen_random_uuid(),'at',v_now,'actorId',v_actor);
    v_state:=jsonb_set(v_state,'{shipments}',v_state->'shipments'||jsonb_build_array(v_item));
    v_source:=jsonb_build_object('orderId',p_input->>'orderId','documentId',v_doc);
  elsif p_action='record-receipt' then
    if v_member.role not in ('admin','operations_leader','field_supervisor') or p_input->>'physicallyCounted'<>'true'
      or jsonb_typeof(p_input->'lines')<>'array' or coalesce(p_input->>'location','')='' then
      raise exception 'physical_receiving_authority_required' using errcode='42501'; end if;
    select value into v_item from jsonb_array_elements(v_state->'shipments') where value->>'id'=p_input->>'shipmentId';
    if v_item is null then raise exception 'shipment_required' using errcode='23514'; end if;
    if exists(select 1 from (select l->>'materialId' id,count(*) c from jsonb_array_elements(p_input->'lines') l group by l->>'materialId') x
      where x.id is null or x.c>1) then raise exception 'duplicate_receipt_line' using errcode='23514'; end if;
    for v_line in select value from jsonb_array_elements(p_input->'lines') loop
      select value into v_receipt_item from jsonb_array_elements(v_item->'lines') where value->>'materialId'=v_line->>'materialId';
      select coalesce(sum((rline->>'acceptedQuantity')::numeric+(rline->>'rejectedQuantity')::numeric),0) into v_quantity
        from jsonb_array_elements(v_state->'receipts') r,jsonb_array_elements(r->'lines') rline
        where r->>'shipmentId'=p_input->>'shipmentId' and rline->>'materialId'=v_line->>'materialId';
      if v_receipt_item is null or coalesce(v_line->>'acceptedQuantity','') !~ '^\d+(\.\d{1,3})?$'
        or coalesce(v_line->>'rejectedQuantity','') !~ '^\d+(\.\d{1,3})?$'
        or (v_line->>'acceptedQuantity')::numeric+(v_line->>'rejectedQuantity')::numeric<=0
        or v_quantity+(v_line->>'acceptedQuantity')::numeric+(v_line->>'rejectedQuantity')::numeric>(v_receipt_item->>'quantity')::numeric then
        raise exception 'receipt_exceeds_shipment' using errcode='23514'; end if;
    end loop;
    v_item:=p_input||jsonb_build_object('id',gen_random_uuid(),'at',v_now,'actorId',v_actor,'status','Counted');
    v_state:=jsonb_set(v_state,'{receipts}',v_state->'receipts'||jsonb_build_array(v_item));
    v_source:=jsonb_build_object('shipmentId',p_input->>'shipmentId','physicalReceipt',true);
  elsif p_action='record-return' then
    if v_member.role not in ('admin','operations_leader') or coalesce(p_input->>'reason','')=''
      or coalesce(p_input->>'supplierReturnReference','')='' then
      raise exception 'return_authority_and_source_required' using errcode='42501'; end if;
    select value into v_receipt_item from jsonb_array_elements(v_state->'receipts') where value->>'id'=p_input->>'receiptId';
    if v_receipt_item is null then raise exception 'physical_receipt_required' using errcode='23514'; end if;
    select value into v_line from jsonb_array_elements(v_receipt_item->'lines') where value->>'materialId'=p_input->>'materialId';
    select coalesce(sum((r->>'quantity')::numeric),0) into v_quantity from jsonb_array_elements(coalesce(v_state->'returns','[]'::jsonb)) r
      where r->>'receiptId'=p_input->>'receiptId' and r->>'materialId'=p_input->>'materialId';
    if v_line is null or coalesce(p_input->>'quantity','') !~ '^\d+(\.\d{1,3})?$'
      or (p_input->>'quantity')::numeric<=0 or v_quantity+(p_input->>'quantity')::numeric>(v_line->>'acceptedQuantity')::numeric then
      raise exception 'return_exceeds_accepted_receipt' using errcode='23514'; end if;
    v_item:=p_input||jsonb_build_object('id',gen_random_uuid(),'at',v_now,'actorId',v_actor,'status','Supplier return recorded');
    v_state:=jsonb_set(v_state,'{returns}',coalesce(v_state->'returns','[]'::jsonb)||jsonb_build_array(v_item));
    v_source:=jsonb_build_object('receiptId',p_input->>'receiptId','materialId',p_input->>'materialId');
  elsif p_action='record-credit' then
    if v_member.role not in ('admin','billing_commercial_lead') or coalesce(p_input->>'supplierCreditReference','')=''
      or coalesce(p_input->>'reason','')='' then raise exception 'finance_credit_source_required' using errcode='42501'; end if;
    select value into v_invoice from jsonb_array_elements(v_state->'supplierInvoices') where value->>'id'=p_input->>'invoiceId';
    select coalesce(sum((c->>'amountMinor')::bigint),0) into v_total from jsonb_array_elements(coalesce(v_state->'credits','[]'::jsonb)) c
      where c->>'invoiceId'=p_input->>'invoiceId';
    if v_invoice is null or coalesce(p_input->>'amountMinor','') !~ '^\d+$'
      or (p_input->>'amountMinor')::bigint<=0 or v_total+(p_input->>'amountMinor')::bigint>(v_invoice->>'totalMinor')::bigint then
      raise exception 'credit_exceeds_supplier_invoice' using errcode='23514'; end if;
    v_item:=p_input||jsonb_build_object('id',gen_random_uuid(),'at',v_now,'actorId',v_actor,'currency','USD');
    v_state:=jsonb_set(v_state,'{credits}',coalesce(v_state->'credits','[]'::jsonb)||jsonb_build_array(v_item));
    v_source:=jsonb_build_object('invoiceId',p_input->>'invoiceId','supplierCreditReference',p_input->>'supplierCreditReference');
  elsif p_action='record-supplier-invoice' then
    if v_member.role not in ('admin','billing_commercial_lead') or coalesce(p_input->>'invoiceNumber','')=''
      or p_input->>'currency'<>'USD' or jsonb_typeof(p_input->'lines')<>'array'
      or exists(select 1 from jsonb_array_elements(v_state->'supplierInvoices') where value->>'invoiceNumber'=p_input->>'invoiceNumber') then
      raise exception 'supplier_invoice_invalid' using errcode='23514'; end if;
    v_doc:=(p_input->>'documentId')::uuid;
    if not exists(select 1 from d5o_hosted.graybar_documents where workspace_id=v_workspace.id and work_id=v_work.id and id=v_doc and kind='supplier_invoice') then
      raise exception 'retained_supplier_invoice_required' using errcode='23514'; end if;
    select value into v_order from jsonb_array_elements(v_state->'orders') where value->>'id'=p_input->>'orderId' and value->>'status'='Acknowledged';
    if v_order is null then raise exception 'acknowledged_order_required' using errcode='23514'; end if;
    v_sum:=0;v_total:=0;
    if exists(select 1 from (select l->>'materialId' id,count(*) c from jsonb_array_elements(p_input->'lines') l group by l->>'materialId') x
      where x.id is null or x.c>1) then raise exception 'duplicate_invoice_allocation' using errcode='23514'; end if;
    for v_line in select value from jsonb_array_elements(p_input->'lines') loop
      select value into v_item from jsonb_array_elements(v_order->'lines') where value->>'materialId'=v_line->>'materialId';
      select coalesce(sum((rline->>'acceptedQuantity')::numeric),0) into v_quantity
        from jsonb_array_elements(v_state->'receipts') r,jsonb_array_elements(r->'lines') rline,
          jsonb_array_elements(v_state->'shipments') s
        where r->>'shipmentId'=s->>'id' and s->>'orderId'=p_input->>'orderId'
          and rline->>'materialId'=v_line->>'materialId';
      select v_quantity-coalesce(sum((iline->>'quantity')::numeric),0) into v_quantity
        from jsonb_array_elements(v_state->'supplierInvoices') prior,jsonb_array_elements(prior->'lines') iline
        where prior->>'orderId'=p_input->>'orderId' and prior->>'status'<>'Hold'
          and iline->>'materialId'=v_line->>'materialId';
      if v_item is null or coalesce(v_line->>'quantity','') !~ '^\d+(\.\d{1,3})?$'
        or coalesce(v_line->>'amountMinor','') !~ '^\d+$' or (v_line->>'quantity')::numeric>v_quantity
        or (v_line->>'quantity')::numeric<=0 then raise exception 'invoice_exceeds_accepted_receipt' using errcode='23514'; end if;
      v_sum:=v_sum+(v_line->>'amountMinor')::bigint;
      v_total:=v_total+round((v_line->>'quantity')::numeric/(v_item->>'packSize')::numeric*(v_item->>'unitPriceMinor')::bigint)::bigint;
    end loop;
    if coalesce(p_input->>'totalMinor','') !~ '^\d+$' or v_sum<>(p_input->>'totalMinor')::bigint then
      raise exception 'supplier_invoice_total_mismatch' using errcode='23514'; end if;
    v_invoice:=p_input||jsonb_build_object('id',gen_random_uuid(),'status',
      case when v_sum<>v_total then 'Exception' else 'Review' end,
      'recordedAt',v_now,'recordedBy',v_actor,'poAmountMinor',v_order->>'amountMinor');
    v_state:=jsonb_set(v_state,'{supplierInvoices}',v_state->'supplierInvoices'||jsonb_build_array(v_invoice));
    v_source:=jsonb_build_object('orderId',v_order->>'id','documentId',v_doc);
  elsif p_action='review-supplier-invoice' then
    if v_member.role not in ('admin','billing_commercial_lead') then raise exception 'finance_authority_required' using errcode='42501'; end if;
    select value into v_invoice from jsonb_array_elements(v_state->'supplierInvoices') where value->>'id'=p_input->>'invoiceId';
    if v_invoice is null or v_invoice->>'recordedBy'=v_actor::text or v_invoice->>'status' not in ('Review','Exception')
      or p_input->>'decision' not in ('Matched','Hold') or p_input->>'decision'='Matched' and v_invoice->>'status'='Exception'
      or coalesce(p_input->>'reason','')='' then raise exception 'independent_invoice_review_required' using errcode='23514'; end if;
    v_invoice:=v_invoice||jsonb_build_object('status',p_input->>'decision','reviewedBy',v_actor,'reviewedAt',v_now,'reason',p_input->>'reason');
    v_state:=jsonb_set(v_state,'{supplierInvoices}',(select jsonb_agg(case when value->>'id'=p_input->>'invoiceId' then v_invoice else value end)
      from jsonb_array_elements(v_state->'supplierInvoices')));
    v_source:=jsonb_build_object('invoiceId',v_invoice->>'id','orderId',v_invoice->>'orderId');
  elsif p_action='handoff-installed' then
    if v_member.role not in ('admin','operations_leader') or coalesce(p_input->>'assetId','')=''
      or coalesce(p_input->>'serialNumber','')='' or coalesce(p_input->>'materialId','')='' then
      raise exception 'installed_equipment_basis_required' using errcode='23514'; end if;
    if not exists(select 1 from d5o_hosted.connected_operate_states o,jsonb_array_elements(coalesce(o.state->'assets','[]'::jsonb)) a
      where o.workspace_id=v_workspace.id and o.work_id=v_work.id and a->>'id'=p_input->>'assetId') then
      raise exception 'supported_asset_required' using errcode='23514'; end if;
    select coalesce(sum((rline->>'acceptedQuantity')::numeric),0) into v_quantity
      from jsonb_array_elements(v_state->'receipts') r,jsonb_array_elements(r->'lines') rline
      where rline->>'materialId'=p_input->>'materialId';
    select v_quantity-coalesce(sum((returned->>'quantity')::numeric),0) into v_quantity
      from jsonb_array_elements(coalesce(v_state->'returns','[]'::jsonb)) returned
      where returned->>'materialId'=p_input->>'materialId';
    if v_quantity<1 or exists(select 1 from jsonb_array_elements(v_state->'installed') i where i->>'serialNumber'=p_input->>'serialNumber') then
      raise exception 'received_unique_equipment_required' using errcode='23514'; end if;
    select * into v_operate from d5o_hosted.connected_operate_states
      where workspace_id=v_workspace.id and work_id=v_work.id for update;
    select value into v_asset from jsonb_array_elements(coalesce(v_operate.state->'assets','[]'::jsonb))
      where value->>'id'=p_input->>'assetId' and value->>'status'='Supported';
    select value into v_receipt_item from jsonb_array_elements(v_state->'receipts')
      where value->>'id'=p_input->>'receiptId';
    if v_asset is null or v_receipt_item is null or not exists(select 1 from jsonb_array_elements(v_receipt_item->'lines') l
      where l->>'materialId'=p_input->>'materialId' and (l->>'acceptedQuantity')::numeric>0) then
      raise exception 'supported_asset_and_received_equipment_required' using errcode='23514'; end if;
    select count(*) into v_count from jsonb_array_elements(v_state->'installed') i
      where i->>'materialId'=p_input->>'materialId';
    if v_count>=v_quantity then raise exception 'equipment_allocation_exceeds_receipt' using errcode='23514'; end if;
    v_item:=p_input||jsonb_build_object('id',gen_random_uuid(),'at',v_now,'actorId',v_actor,'source','Graybar procurement receipt');
    v_state:=jsonb_set(v_state,'{installed}',v_state->'installed'||jsonb_build_array(v_item));
    v_asset:=jsonb_set(v_asset,'{history}',coalesce(v_asset->'history','[]'::jsonb)||jsonb_build_array(
      jsonb_build_object('at',v_now,'action','Installed equipment handoff',
        'source','Graybar receipt '||(p_input->>'receiptId')||' / serial '||(p_input->>'serialNumber'),
        'actorId',v_actor,'procurementEventId',v_item->>'id','warrantyReference',p_input->>'warrantyReference')));
    v_operate_state:=jsonb_set(v_operate.state,'{assets}',(
      select jsonb_agg(case when a->>'id'=p_input->>'assetId' then v_asset else a end order by ordinal)
      from jsonb_array_elements(v_operate.state->'assets') with ordinality entries(a,ordinal)));
    v_operate_state:=v_operate_state||jsonb_build_object('authorityRevision',v_operate.decision_revision+1,
      'events',coalesce(v_operate_state->'events','[]'::jsonb)||jsonb_build_array(jsonb_build_object(
        'id',gen_random_uuid(),'commandId',p_command_id,'fingerprint',v_fingerprint,
        'at',v_now,'actorId',v_actor,'membershipId',v_member.id,'action','installed-equipment-handoff',
        'detail',p_input->>'serialNumber')));
    update d5o_hosted.connected_operate_states set decision_revision=decision_revision+1,
      state=v_operate_state,updated_at=v_now where workspace_id=v_workspace.id and work_id=v_work.id;
    select coalesce(decision_revision,0) into v_deploy_revision from d5o_hosted.connected_deploy_states
      where workspace_id=v_workspace.id and work_id=v_work.id;
    insert into d5o_hosted.connected_operate_events(workspace_id,work_id,decision_revision,command_id,
      action,actor_user_id,membership_id,deploy_revision,snapshot)
      values(v_workspace.id,v_work.id,v_operate.decision_revision+1,p_command_id,
        'installed-equipment-handoff',v_actor,v_member.id,coalesce(v_deploy_revision,0),v_operate_state);
    insert into d5o_hosted.connected_operate_receipts(workspace_id,command_id,work_id,actor_user_id,fingerprint,result)
      values(v_workspace.id,p_command_id,v_work.id,v_actor,v_fingerprint,v_operate_state);
    v_source:=jsonb_build_object('assetId',p_input->>'assetId','materialId',p_input->>'materialId');
  end if;
  v_revision:=coalesce(v_current.revision,0)+1;
  if v_current.work_id is null then
    insert into d5o_hosted.graybar_states(workspace_id,work_id,revision,state) values(v_workspace.id,v_work.id,v_revision,v_state);
  else update d5o_hosted.graybar_states set revision=v_revision,state=v_state,updated_at=v_now
    where workspace_id=v_workspace.id and work_id=v_work.id; end if;
  insert into d5o_hosted.graybar_events(workspace_id,work_id,revision,command_id,action,actor_user_id,membership_id,source,state)
    values(v_workspace.id,v_work.id,v_revision,p_command_id,p_action,v_actor,v_member.id,v_source,v_state);
  v_result:=public.d5o_graybar_read_v1(p_workspace_key,p_presentation_id);
  insert into d5o_hosted.graybar_receipts(workspace_id,command_id,work_id,actor_user_id,fingerprint,result)
    values(v_workspace.id,p_command_id,v_work.id,v_actor,v_fingerprint,v_result);
  return v_result;
end; $$;
revoke all on function public.d5o_graybar_command_v1(text,text,text,jsonb,text,integer) from public,anon,service_role;
grant execute on function public.d5o_graybar_command_v1(text,text,text,jsonb,text,integer) to authenticated;

create function public.d5o_graybar_document_v1(p_workspace_key text,p_presentation_id text,p_document_id uuid,p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_workspace uuid;v_work uuid;v_document d5o_hosted.graybar_documents%rowtype;
begin
  if current_setting('role',true)<>'service_role' or p_actor is null then raise exception 'document_scope_forbidden' using errcode='42501'; end if;
  select id into v_workspace from d5o_hosted.workspaces where workspace_key=p_workspace_key and status='active';
  select work_id into v_work from d5o_hosted.work_identity_links where workspace_id=v_workspace and presentation_id=p_presentation_id;
  if v_work is null or not exists(select 1 from d5o_hosted.memberships where workspace_id=v_workspace and actor_user_id=p_actor and status='active' and role<>'field_worker') then
    raise exception 'document_scope_forbidden' using errcode='42501'; end if;
  select * into v_document from d5o_hosted.graybar_documents where workspace_id=v_workspace and work_id=v_work and id=p_document_id;
  if not found then raise exception 'document_missing' using errcode='23514'; end if;
  return jsonb_build_object('id',v_document.id,'kind',v_document.kind,'filename',v_document.filename,
    'mediaType',v_document.media_type,'storagePath',v_document.storage_path,'sha256',v_document.sha256,
    'byteCount',v_document.byte_count,'uploadedBy',v_document.uploaded_by,'uploadedAt',v_document.uploaded_at);
end; $$;
revoke all on function public.d5o_graybar_document_v1(text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.d5o_graybar_document_v1(text,text,uuid,uuid) to service_role;

-- A Graybar-sourced ROM line carries exact offer identity; React's displayed rate is not authority.
create function d5o_hosted.guard_graybar_rom_source_v1() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_line jsonb;v_source jsonb;v_quote jsonb;v_quoted_line jsonb;v_state jsonb;
begin
  for v_line in select value from jsonb_array_elements(coalesce(new.estimate#>'{detailed,input,lines}','[]'::jsonb)) loop
    v_source:=v_line->'procurementSource';
    if v_source is null then continue; end if;
    select state into v_state from d5o_hosted.graybar_states where workspace_id=new.workspace_id and work_id=new.work_id;
    select value into v_quote from jsonb_array_elements(coalesce(v_state->'quotes','[]'::jsonb))
      where value->>'id'=v_source->>'quoteId' and value->>'quoteRevision'=v_source->>'quoteRevision'
        and value->>'documentId'=v_source->>'documentId';
    if v_quote is null or v_quote->>'status'<>'Accepted' or v_quote->>'defineRevision'<>new.definition_revision::text
      or v_quote->>'expiresAt'<coalesce(new.estimate#>>'{detailed,input,pricedAt}',current_date::text) then
      raise exception 'graybar_rom_source_stale' using errcode='23514'; end if;
    select value into v_quoted_line from jsonb_array_elements(v_quote->'lines') where value->>'lineNumber'=v_source->>'lineNumber';
    if not exists(select 1 from jsonb_array_elements(coalesce(v_state->'assessments','[]'::jsonb)) a
      where a->>'quoteId'=v_source->>'quoteId' and a->>'lineNumber'=v_source->>'lineNumber'
        and a->>'requirementId'=v_line->>'scopeRef' and a->>'result'='Meets'
        and a->>'defineRevision'=new.definition_revision::text)
      or exists(select 1 from jsonb_array_elements(coalesce(v_state->'assessments','[]'::jsonb)) a
        where a->>'quoteId'=v_source->>'quoteId' and a->>'lineNumber'=v_source->>'lineNumber'
          and a->>'requirementId'=v_line->>'scopeRef' and a->>'result'='Fails') then
      raise exception 'graybar_rom_technical_assessment_required' using errcode='23514'; end if;
    if v_quoted_line is null or v_quoted_line->>'unitPriceMinor'<>v_source->>'unitPriceMinor'
      or v_quoted_line->>'packSize'<>v_source->>'packSize'
      or v_quoted_line->>'description'<>v_line->>'description'
      or v_line->>'manualRate'<>to_char((v_quoted_line->>'unitPriceMinor')::numeric/100,'FM999999999990.00')
      or v_line->>'unit'<>(v_quoted_line->>'packSize'||' '||v_quoted_line->>'unit')
      or coalesce(trim(v_line->>'quantityBasis'),'')='' then
      raise exception 'graybar_rom_price_or_quantity_mismatch' using errcode='23514'; end if;
  end loop;
  return new;
end; $$;
revoke all on function d5o_hosted.guard_graybar_rom_source_v1() from public,anon,authenticated,service_role;
create trigger guard_graybar_rom_source before insert or update on d5o_hosted.connected_estimate_states
  for each row execute function d5o_hosted.guard_graybar_rom_source_v1();

-- A package with an approved Graybar PO cannot use an earlier manually entered
-- "Available" label as a substitute for physically received, unreturned supply.
create function d5o_hosted.guard_graybar_field_material_v1() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_state jsonb;v_permit jsonb;v_material jsonb;v_received numeric;v_returned numeric;
begin
  select state into v_state from d5o_hosted.graybar_states
    where workspace_id=new.workspace_id and work_id=new.work_id;
  if v_state is null or v_state#>>'{bom,status}'<>'Approved' then return new; end if;
  for v_permit in select value from jsonb_array_elements(coalesce(new.state->'permits','[]'::jsonb))
    where value->>'status'='Authorized' and not exists (
      select 1 from jsonb_array_elements(coalesce(old.state->'permits','[]'::jsonb)) prior
      where prior->>'id'=value->>'id') loop
    for v_material in select value from jsonb_array_elements(v_state#>'{bom,lines}')
      where value->>'packageId'=v_permit->>'packageId' and value->>'supplyResponsibility'='Rybex' loop
      select coalesce(sum((line->>'acceptedQuantity')::numeric),0) into v_received
        from jsonb_array_elements(v_state->'receipts') r
        join lateral jsonb_array_elements(r->'lines') line on true
        join lateral jsonb_array_elements(v_state->'shipments') s on s->>'id'=r->>'shipmentId'
        join lateral jsonb_array_elements(v_state->'orders') o on o->>'id'=s->>'orderId'
        where o->>'bomId'=v_state#>>'{bom,id}' and line->>'materialId'=v_material->>'materialId';
      select coalesce(sum((ret->>'quantity')::numeric),0) into v_returned
        from jsonb_array_elements(coalesce(v_state->'returns','[]'::jsonb)) ret
        where ret->>'materialId'=v_material->>'materialId';
      if v_received-v_returned<(v_material->>'quantity')::numeric then
        raise exception 'graybar_physically_received_material_required' using errcode='23514'; end if;
    end loop;
  end loop;
  return new;
end; $$;
revoke all on function d5o_hosted.guard_graybar_field_material_v1() from public,anon,authenticated,service_role;
create trigger guard_graybar_field_material before update on d5o_hosted.connected_deploy_states
  for each row execute function d5o_hosted.guard_graybar_field_material_v1();

-- Read-only role projection. Opening a card never grants command authority.
create function public.d5o_graybar_actions_v1(p_workspace_key text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace uuid;v_role text;v_row record;v_order jsonb;v_invoice jsonb;
  v_actions jsonb:='[]'::jsonb;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null then
    raise exception 'workspace_forbidden' using errcode='42501'; end if;
  select id into v_workspace from d5o_hosted.workspaces where workspace_key=p_workspace_key and status='active';
  select role into v_role from d5o_hosted.memberships
    where workspace_id=v_workspace and actor_user_id=v_actor and status='active';
  if v_role is null or v_role='field_worker' then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  for v_row in select s.revision,s.state,l.presentation_id,w.title from d5o_hosted.graybar_states s
    join d5o_hosted.work_identity_links l on l.workspace_id=s.workspace_id and l.work_id=s.work_id
    join d5o_hosted.work_records w on w.workspace_id=s.workspace_id and w.id=s.work_id
    where s.workspace_id=v_workspace loop
    if v_row.state#>>'{bom,status}'='Prepared' and v_role in ('admin','operations_leader')
      and v_row.state#>>'{bom,preparedBy}'<>v_actor::text then
      v_actions:=v_actions||jsonb_build_array(jsonb_build_object('kind','Review Design BOM','phase','Procurement',
        'focus','bom','workId',v_row.presentation_id,'revision',v_row.revision,'status','Prepared',
        'title',v_row.title,'ownership','Independent technical reviewer','decisionId',v_row.state#>>'{bom,id}'));
    end if;
    for v_order in select value from jsonb_array_elements(v_row.state->'orders') loop
      if v_order->>'status'='Prepared' and v_role='admin' and v_order->>'preparedBy'<>v_actor::text then
        v_actions:=v_actions||jsonb_build_array(jsonb_build_object('kind','Approve Graybar PO','phase','Procurement',
          'focus','po','workId',v_row.presentation_id,'revision',v_row.revision,'status','Prepared',
          'title',v_row.title,'ownership','Workspace administrator','decisionId',v_order->>'id'));
      end if;
    end loop;
    for v_invoice in select value from jsonb_array_elements(v_row.state->'supplierInvoices') loop
      if v_invoice->>'status' in ('Review','Exception') and v_role in ('admin','billing_commercial_lead')
        and v_invoice->>'recordedBy'<>v_actor::text then
        v_actions:=v_actions||jsonb_build_array(jsonb_build_object('kind','Review supplier invoice','phase','Procurement',
          'focus','invoice','workId',v_row.presentation_id,'revision',v_row.revision,
          'status',v_invoice->>'status','title',v_row.title,'ownership','Independent Finance reviewer',
          'decisionId',v_invoice->>'id',
          'blocker',case when v_invoice->>'status'='Exception' then 'Price or amount mismatch requires a held disposition.' else null end));
      end if;
    end loop;
  end loop;
  return v_actions;
end; $$;
revoke all on function public.d5o_graybar_actions_v1(text) from public,anon,service_role;
grant execute on function public.d5o_graybar_actions_v1(text) to authenticated;
