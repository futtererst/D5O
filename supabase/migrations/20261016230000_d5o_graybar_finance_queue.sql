-- Finance work remains a separate, exact supplier-cost action after PO and invoice decisions.
create function public.d5o_graybar_job_cost_actions_v1(p_workspace_key text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace uuid;v_role text;v_row record;v_order jsonb;v_invoice jsonb;
  v_actions jsonb:='[]'::jsonb;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null then
    raise exception 'workspace_forbidden' using errcode='42501'; end if;
  select id into v_workspace from d5o_hosted.workspaces where workspace_key=p_workspace_key and status='active';
  select role into v_role from d5o_hosted.memberships where workspace_id=v_workspace and actor_user_id=v_actor and status='active';
  if v_role is null then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  if v_role<>'billing_commercial_lead' then return v_actions; end if;
  for v_row in select s.workspace_id,s.work_id,s.revision,s.state,l.presentation_id,w.title
    from d5o_hosted.graybar_states s join d5o_hosted.work_identity_links l
      on l.workspace_id=s.workspace_id and l.work_id=s.work_id
    join d5o_hosted.work_records w on w.workspace_id=s.workspace_id and w.id=s.work_id
    where s.workspace_id=v_workspace loop
    if d5o_hosted.job_finance_award_v1(v_workspace,v_row.work_id) is null or exists(
      select 1 from d5o_hosted.connected_operate_states o where o.workspace_id=v_workspace
        and o.work_id=v_row.work_id and o.state#>>'{finance,status}'='Closed') then continue; end if;
    for v_order in select value from jsonb_array_elements(v_row.state->'orders') loop
      if v_order->>'status' in ('Approved','Test submitted','Acknowledged')
        and not exists(select 1 from d5o_hosted.graybar_job_cost_links c where c.workspace_id=v_workspace
          and c.work_id=v_row.work_id and c.order_id=v_order->>'id' and c.kind='Committed') then
        v_actions:=v_actions||jsonb_build_array(jsonb_build_object('kind','Record Graybar purchase commitment',
          'phase','Procurement','focus','cost-po','workId',v_row.presentation_id,'revision',v_row.revision,
          'decisionId',v_order->>'id','title',v_row.title,'ownership','Finance',
          'blocker','Post the approved PO source to the fixed-price job ledger; no supplier payment is implied.'));
      end if;
    end loop;
    for v_invoice in select value from jsonb_array_elements(v_row.state->'supplierInvoices') loop
      if v_invoice->>'status'='Matched' and exists(select 1 from d5o_hosted.graybar_job_cost_links c
        where c.workspace_id=v_workspace and c.work_id=v_row.work_id and c.order_id=v_invoice->>'orderId' and c.kind='Committed')
        and not exists(select 1 from d5o_hosted.graybar_job_cost_links c where c.workspace_id=v_workspace
          and c.work_id=v_row.work_id and c.invoice_id=v_invoice->>'id' and c.kind='Incurred') then
        v_actions:=v_actions||jsonb_build_array(jsonb_build_object('kind','Reconcile Graybar supplier cost',
          'phase','Procurement','focus','cost-invoice','workId',v_row.presentation_id,'revision',v_row.revision,
          'decisionId',v_invoice->>'id','title',v_row.title,'ownership','Finance',
          'blocker','Match the retained supplier invoice to the exact posted PO commitment.'));
      end if;
    end loop;
  end loop;
  return v_actions;
end; $$;
revoke all on function public.d5o_graybar_job_cost_actions_v1(text) from public,anon,service_role;
grant execute on function public.d5o_graybar_job_cost_actions_v1(text) to authenticated;
