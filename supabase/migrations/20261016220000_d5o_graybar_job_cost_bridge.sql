-- Explicit Finance posting of Graybar purchase commitments and matched supplier invoices.
-- The supplier document is never a customer invoice or a payment fact.
create table d5o_hosted.graybar_job_cost_links (
  workspace_id uuid not null, work_id uuid not null, order_id text not null,
  invoice_id text, material_id text not null, kind text not null check(kind in ('Committed','Incurred')),
  cost_id uuid not null unique references d5o_hosted.connected_job_costs(id),
  recorded_by uuid not null references auth.users(id), recorded_at timestamptz not null default now(),
  foreign key(work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id)
);
create unique index graybar_one_commitment_per_material on d5o_hosted.graybar_job_cost_links(workspace_id,work_id,order_id,material_id) where kind='Committed';
create unique index graybar_one_invoice_cost_per_material on d5o_hosted.graybar_job_cost_links(workspace_id,work_id,invoice_id,material_id) where kind='Incurred';
create unique index graybar_cost_source_once on d5o_hosted.connected_job_costs(workspace_id,work_id,source)
  where source like 'Graybar PO %' or source like 'Graybar invoice %';
create table d5o_hosted.graybar_job_cost_receipts (
  workspace_id uuid not null, command_id text not null, work_id uuid not null,
  actor_user_id uuid not null references auth.users(id), fingerprint text not null,
  result jsonb not null, primary key(workspace_id,command_id)
);
alter table d5o_hosted.graybar_job_cost_links enable row level security;
alter table d5o_hosted.graybar_job_cost_receipts enable row level security;
revoke all on d5o_hosted.graybar_job_cost_links,d5o_hosted.graybar_job_cost_receipts from public,anon,authenticated,service_role;

create function public.d5o_graybar_job_cost_read_v1(p_workspace_key text,p_presentation_id text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace uuid;v_work uuid;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null then raise exception 'finance_scope_denied' using errcode='42501'; end if;
  select id into v_workspace from d5o_hosted.workspaces where workspace_key=p_workspace_key and status='active';
  if not exists(select 1 from d5o_hosted.memberships where workspace_id=v_workspace and actor_user_id=v_actor and status='active'
      and role in ('admin','project_manager','billing_commercial_lead')) then raise exception 'finance_scope_denied' using errcode='42501'; end if;
  select l.work_id into v_work from d5o_hosted.work_identity_links l where l.workspace_id=v_workspace and l.presentation_id=p_presentation_id;
  if v_work is null then raise exception 'finance_scope_denied' using errcode='42501'; end if;
  return jsonb_build_object('financeRevision',coalesce((select revision from d5o_hosted.connected_job_finance_states
      where workspace_id=v_workspace and work_id=v_work),0),
    'links',coalesce((select jsonb_agg(jsonb_build_object('orderId',l.order_id,'invoiceId',l.invoice_id,
      'materialId',l.material_id,'kind',l.kind,'costId',l.cost_id,'amountMinor',c.amount_minor,'source',c.source)
      order by l.recorded_at,l.cost_id) from d5o_hosted.graybar_job_cost_links l
      join d5o_hosted.connected_job_costs c on c.id=l.cost_id
      where l.workspace_id=v_workspace and l.work_id=v_work),'[]'::jsonb));
end; $$;
revoke all on function public.d5o_graybar_job_cost_read_v1(text,text) from public,anon,service_role;
grant execute on function public.d5o_graybar_job_cost_read_v1(text,text) to authenticated;

create function public.d5o_graybar_job_cost_command_v1(p_workspace_key text,p_presentation_id text,
  p_action text,p_input jsonb,p_command_id text,p_graybar_revision integer,p_finance_revision integer)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;v_member d5o_hosted.memberships%rowtype;
  v_work d5o_hosted.work_records%rowtype;v_proc d5o_hosted.graybar_states%rowtype;
  v_finance d5o_hosted.connected_job_finance_states%rowtype;v_receipt d5o_hosted.graybar_job_cost_receipts%rowtype;
  v_order jsonb;v_invoice jsonb;v_line jsonb;v_commit d5o_hosted.connected_job_costs%rowtype;
  v_fingerprint text;v_ids jsonb:='[]'::jsonb;v_cost_id uuid;v_amount bigint;v_result jsonb;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null or p_action not in ('post-commitment','post-matched-invoice')
    or jsonb_typeof(p_input)<>'object' or length(coalesce(p_command_id,'')) not between 8 and 120
    or p_graybar_revision is null or p_finance_revision is null then
    raise exception 'invalid_supplier_cost_command' using errcode='22023'; end if;
  select * into v_workspace from d5o_hosted.workspaces where workspace_key=p_workspace_key and status='active';
  select * into v_member from d5o_hosted.memberships where workspace_id=v_workspace.id and actor_user_id=v_actor
    and status='active' for share;
  select w.* into v_work from d5o_hosted.work_records w join d5o_hosted.work_identity_links l
    on l.workspace_id=w.workspace_id and l.work_id=w.id
    where w.workspace_id=v_workspace.id and l.presentation_id=p_presentation_id for update of w;
  if v_member.id is null or v_member.role<>'billing_commercial_lead' or v_work.id is null then
    raise exception 'supplier_cost_finance_role_required' using errcode='42501'; end if;
  if exists(select 1 from d5o_hosted.connected_operate_states o where o.workspace_id=v_workspace.id
    and o.work_id=v_work.id and o.state#>>'{finance,status}'='Closed') then
    raise exception 'finance_closed_requires_reopen' using errcode='23514'; end if;
  if d5o_hosted.job_finance_award_v1(v_workspace.id,v_work.id) is null then
    raise exception 'awarded_job_cost_basis_required' using errcode='23514'; end if;
  insert into d5o_hosted.connected_job_finance_states(workspace_id,work_id,currency)
    values(v_workspace.id,v_work.id,'USD') on conflict do nothing;
  select * into v_proc from d5o_hosted.graybar_states where workspace_id=v_workspace.id and work_id=v_work.id for update;
  select * into v_finance from d5o_hosted.connected_job_finance_states where workspace_id=v_workspace.id and work_id=v_work.id for update;
  v_fingerprint:=md5(jsonb_build_array(p_workspace_key,p_presentation_id,p_action,p_input,p_graybar_revision,p_finance_revision)::text);
  select * into v_receipt from d5o_hosted.graybar_job_cost_receipts where workspace_id=v_workspace.id and command_id=p_command_id;
  if found then
    if v_receipt.work_id<>v_work.id or v_receipt.actor_user_id<>v_actor or v_receipt.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_receipt.result;
  end if;
  if v_proc.revision is distinct from p_graybar_revision or v_finance.revision<>p_finance_revision then
    raise exception 'stale_supplier_cost_basis' using errcode='23505'; end if;
  select value into v_order from jsonb_array_elements(v_proc.state->'orders')
    where value->>'id'=p_input->>'orderId' and value->>'status' in ('Approved','Test submitted','Acknowledged');
  if v_order is null or v_order->>'currency'<>'USD' or v_order->>'bomId'<>v_proc.state#>>'{bom,id}' then
    raise exception 'current_approved_purchase_order_required' using errcode='23514'; end if;
  if p_action='post-commitment' then
    if exists(select 1 from d5o_hosted.graybar_job_cost_links where workspace_id=v_workspace.id and work_id=v_work.id
      and order_id=p_input->>'orderId' and kind='Committed') then
      raise exception 'purchase_commitment_already_posted' using errcode='23505'; end if;
    for v_line in select value from jsonb_array_elements(v_order->'lines') loop
      v_amount:=round((v_line->>'quantity')::numeric/(v_line->>'packSize')::numeric*(v_line->>'unitPriceMinor')::bigint)::bigint;
      if v_amount<=0 or v_amount>1000000000000 then raise exception 'unsupported_purchase_cost' using errcode='23514'; end if;
      insert into d5o_hosted.connected_job_costs(workspace_id,work_id,package_id,kind,category,amount_minor,cost_date,source,recorded_by)
        values(v_workspace.id,v_work.id,(select b->>'packageId' from jsonb_array_elements(v_proc.state#>'{bom,lines}') b
          where b->>'materialId'=v_line->>'materialId'),'Committed','Material',v_amount,current_date,
          'Graybar PO '||(v_order->>'id')||' material '||(v_line->>'materialId'),v_actor) returning id into v_cost_id;
      insert into d5o_hosted.graybar_job_cost_links(workspace_id,work_id,order_id,material_id,kind,cost_id,recorded_by)
        values(v_workspace.id,v_work.id,v_order->>'id',v_line->>'materialId','Committed',v_cost_id,v_actor);
      v_ids:=v_ids||jsonb_build_array(v_cost_id);
    end loop;
  else
    select value into v_invoice from jsonb_array_elements(v_proc.state->'supplierInvoices')
      where value->>'id'=p_input->>'invoiceId' and value->>'orderId'=v_order->>'id' and value->>'status'='Matched';
    if v_invoice is null then raise exception 'matched_supplier_invoice_required' using errcode='23514'; end if;
    if exists(select 1 from d5o_hosted.graybar_job_cost_links where workspace_id=v_workspace.id and work_id=v_work.id
      and invoice_id=p_input->>'invoiceId' and kind='Incurred') then
      raise exception 'supplier_invoice_cost_already_posted' using errcode='23505'; end if;
    for v_line in select value from jsonb_array_elements(v_invoice->'lines') loop
      select c.* into v_commit from d5o_hosted.graybar_job_cost_links l join d5o_hosted.connected_job_costs c on c.id=l.cost_id
        where l.workspace_id=v_workspace.id and l.work_id=v_work.id and l.order_id=v_order->>'id'
          and l.material_id=v_line->>'materialId' and l.kind='Committed' for update of c;
      v_amount:=(v_line->>'amountMinor')::bigint;
      if v_commit.id is null or v_amount<=0 or v_amount>v_commit.amount_minor-
        coalesce((select sum(c.amount_minor) from d5o_hosted.connected_job_costs c where c.reconciles_id=v_commit.id),0) then
        raise exception 'supplier_invoice_commitment_reconciliation_invalid' using errcode='23514'; end if;
      insert into d5o_hosted.connected_job_costs(workspace_id,work_id,package_id,kind,category,amount_minor,cost_date,source,reconciles_id,recorded_by)
        values(v_workspace.id,v_work.id,v_commit.package_id,'Incurred','Material',v_amount,current_date,
          'Graybar invoice '||(v_invoice->>'id')||' material '||(v_line->>'materialId'),v_commit.id,v_actor)
        returning id into v_cost_id;
      insert into d5o_hosted.graybar_job_cost_links(workspace_id,work_id,order_id,invoice_id,material_id,kind,cost_id,recorded_by)
        values(v_workspace.id,v_work.id,v_order->>'id',v_invoice->>'id',v_line->>'materialId','Incurred',v_cost_id,v_actor);
      v_ids:=v_ids||jsonb_build_array(v_cost_id);
    end loop;
  end if;
  update d5o_hosted.connected_job_finance_states set revision=revision+1 where workspace_id=v_workspace.id and work_id=v_work.id;
  v_result:=jsonb_build_object('action',p_action,'financeRevision',v_finance.revision+1,'graybarRevision',v_proc.revision,'costIds',v_ids);
  insert into d5o_hosted.connected_job_finance_events(workspace_id,work_id,revision,command_id,actor_user_id,membership_id,action,result)
    values(v_workspace.id,v_work.id,v_finance.revision+1,p_command_id,v_actor,v_member.id,p_action,v_result);
  insert into d5o_hosted.graybar_job_cost_receipts(workspace_id,command_id,work_id,actor_user_id,fingerprint,result)
    values(v_workspace.id,p_command_id,v_work.id,v_actor,v_fingerprint,v_result);
  return v_result;
end; $$;
revoke all on function public.d5o_graybar_job_cost_command_v1(text,text,text,jsonb,text,integer,integer) from public,anon,service_role;
grant execute on function public.d5o_graybar_job_cost_command_v1(text,text,text,jsonb,text,integer,integer) to authenticated;
