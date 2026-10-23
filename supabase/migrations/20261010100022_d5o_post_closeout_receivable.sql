-- Collect a retained reviewed invoice after Finance closeout without reopening commercial decisions.
create or replace function public.d5o_hosted_job_finance_command_v1(
  p_workspace_key text,p_presentation_id text,p_action text,p_input jsonb,
  p_command_id text,p_expected_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace uuid;v_member d5o_hosted.memberships%rowtype;
  v_work d5o_hosted.work_records%rowtype;
  v_state d5o_hosted.connected_job_finance_states%rowtype;
  v_bill d5o_hosted.connected_job_bills%rowtype;
  v_receipt d5o_hosted.connected_job_finance_receipts%rowtype;
  v_fingerprint text;v_basis jsonb;v_result jsonb;v_id uuid;v_closed boolean;v_amount bigint;v_billed numeric;v_paid numeric;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null or
    p_action not in ('add-cost','set-remaining','draft-bill','revise-bill',
      'submit-bill','review-bill','return-unbilled','record-billed','record-paid') or
    pg_catalog.jsonb_typeof(p_input)<>'object' or
    length(coalesce(p_command_id,'')) not between 8 and 120 or
    p_expected_revision is null or p_expected_revision<0 then
    raise exception 'invalid_job_finance_command' using errcode='22023'; end if;
  select id into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace and actor_user_id=v_actor and status='active' for share;
  select w.* into v_work from d5o_hosted.work_records w
    join d5o_hosted.work_identity_links l on l.workspace_id=w.workspace_id and l.work_id=w.id
    where w.workspace_id=v_workspace and l.presentation_id=p_presentation_id for update of w;
  if v_member.id is null or v_work.id is null or
    v_member.role not in ('project_manager','billing_commercial_lead') then
    raise exception 'job_finance_role_denied' using errcode='42501'; end if;
  select * into v_state from d5o_hosted.connected_job_finance_states
    where workspace_id=v_workspace and work_id=v_work.id for update;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_workspace_key,
    p_presentation_id,p_action,p_input,p_expected_revision)::text);
  select * into v_receipt from d5o_hosted.connected_job_finance_receipts
    where workspace_id=v_workspace and command_id=p_command_id;
  if found then
    if v_receipt.actor_user_id<>v_actor or v_receipt.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_receipt.result; end if;
  if coalesce(v_state.revision,0)<>p_expected_revision then
    raise exception 'stale_job_finance' using errcode='23505'; end if;
  select coalesce(o.state#>>'{finance,status}'='Closed',false) into v_closed
    from d5o_hosted.connected_operate_states o
    where o.workspace_id=v_workspace and o.work_id=v_work.id;
  if coalesce(v_closed,false) and p_action<>'record-paid' then
    raise exception 'finance_closed_requires_reopen' using errcode='23514'; end if;
  if p_action in ('revise-bill','submit-bill','review-bill','return-unbilled',
    'record-billed','record-paid') then
    if coalesce(p_input->>'billRevision','')!~'^\d+$' then
      raise exception 'bill_revision_required' using errcode='22023'; end if;
    select * into v_bill from d5o_hosted.connected_job_bills
      where workspace_id=v_workspace and work_id=v_work.id
        and id=(p_input->>'billId')::uuid for update;
    if v_bill.id is null then
      raise exception 'billing_record_missing' using errcode='23503'; end if;
    if v_bill.revision<>(p_input->>'billRevision')::integer then
      raise exception 'stale_bill_revision' using errcode='23505'; end if;
  end if;
  if p_action='record-paid' then
    if v_member.role<>'billing_commercial_lead' then
      raise exception 'finance_payment_role_denied' using errcode='42501'; end if;
    if v_bill.status<>'Reviewed' then
      raise exception 'payment_invoice_not_reviewed' using errcode='23514'; end if;
    if coalesce(p_input->>'amountMinor','')!~'^[0-9]+$' or
      length(p_input->>'amountMinor')>13 or
      coalesce(p_input->>'eventDate','')!~'^\d{4}-\d{2}-\d{2}$' or
      length(trim(coalesce(p_input->>'source',''))) not between 8 and 500 then
      raise exception 'invalid_payment_fact' using errcode='22023'; end if;
    v_amount:=(p_input->>'amountMinor')::bigint;
    if v_amount<=0 or v_amount>1000000000000 then
      raise exception 'invalid_payment_amount' using errcode='22023'; end if;
    -- The canonical Work and ledger rows above serialize all payment decisions.
    -- Historical invoice events, not live scope, establish this receivable.
    select coalesce(sum(amount_minor) filter(where kind='Billed'),0),
      coalesce(sum(amount_minor) filter(where kind='Paid'),0)
      into v_billed,v_paid from d5o_hosted.connected_job_cash_events
      where workspace_id=v_workspace and work_id=v_work.id and bill_id=v_bill.id;
    if v_billed<=0 or v_paid<0 or v_paid>v_billed or v_amount>v_billed-v_paid then
      raise exception 'payment_exceeds_billed' using errcode='23514'; end if;
    insert into d5o_hosted.connected_job_cash_events(workspace_id,work_id,bill_id,
      kind,amount_minor,event_date,source,recorded_by)
      values(v_workspace,v_work.id,v_bill.id,'Paid',v_amount,
        (p_input->>'eventDate')::date,trim(p_input->>'source'),v_actor)
      returning id into v_id;
    update d5o_hosted.connected_job_finance_states set revision=revision+1
      where workspace_id=v_workspace and work_id=v_work.id;
    v_result:=pg_catalog.jsonb_build_object('id',v_id,'revision',v_state.revision+1,
      'action',p_action,'billId',v_bill.id);
    insert into d5o_hosted.connected_job_finance_events(workspace_id,work_id,revision,
      command_id,actor_user_id,membership_id,action,result)
      values(v_workspace,v_work.id,v_state.revision+1,p_command_id,v_actor,v_member.id,p_action,v_result);
    insert into d5o_hosted.connected_job_finance_receipts(workspace_id,command_id,
      actor_user_id,fingerprint,result)
      values(v_workspace,p_command_id,v_actor,v_fingerprint,v_result);
    return v_result;
  end if;
  if p_action in ('revise-bill','return-unbilled') then
    insert into d5o_hosted.connected_job_bill_history(workspace_id,work_id,bill_id,
      revision,status,lines,basis,reviewed_by,review_reason,actor_user_id)
      values(v_workspace,v_work.id,v_bill.id,v_bill.revision,v_bill.status,
        v_bill.lines,v_bill.basis,v_bill.reviewed_by,v_bill.review_reason,v_actor)
      on conflict do nothing;
    if p_action='revise-bill' then
      if v_bill.prepared_by<>v_actor or v_bill.status not in ('Draft','Returned') or
        exists(select 1 from d5o_hosted.connected_job_cash_events
          where bill_id=v_bill.id) then
        raise exception 'billing_correction_denied' using errcode='42501'; end if;
      v_basis:=d5o_hosted.validate_job_bill_v2(v_workspace,v_work.id,
        p_input->'lines',v_bill.id);
      update d5o_hosted.connected_job_bills set lines=p_input->'lines',basis=v_basis,
        status='Draft',revision=revision+1,reviewed_by=null,review_reason=null
        where id=v_bill.id;
    else
      if v_member.role<>'billing_commercial_lead' or v_bill.status<>'Reviewed' or
        length(trim(coalesce(p_input->>'reason','')))<10 or
        exists(select 1 from d5o_hosted.connected_job_cash_events
          where bill_id=v_bill.id) then
        raise exception 'unbilled_return_denied' using errcode='42501'; end if;
      update d5o_hosted.connected_job_bills set status='Returned',revision=revision+1,
        reviewed_by=v_actor,review_reason=trim(p_input->>'reason') where id=v_bill.id;
    end if;
    update d5o_hosted.connected_job_finance_states set revision=revision+1
      where workspace_id=v_workspace and work_id=v_work.id;
    v_result:=pg_catalog.jsonb_build_object('id',v_bill.id,
      'revision',v_state.revision+1,'action',p_action);
    insert into d5o_hosted.connected_job_finance_events(workspace_id,work_id,revision,
      command_id,actor_user_id,membership_id,action,result)
      values(v_workspace,v_work.id,v_state.revision+1,p_command_id,v_actor,v_member.id,p_action,v_result);
    insert into d5o_hosted.connected_job_finance_receipts(workspace_id,command_id,
      actor_user_id,fingerprint,result)
      values(v_workspace,p_command_id,v_actor,v_fingerprint,v_result);
  else
    if p_action='draft-bill' then
      v_basis:=d5o_hosted.validate_job_bill_v2(v_workspace,v_work.id,p_input->'lines');
    elsif p_action='submit-bill' or
      p_action='review-bill' and p_input->>'decision'='Reviewed' or
      p_action='record-billed' then
      if v_bill.basis is null then
        raise exception 'billing_basis_missing_revise_required' using errcode='23514'; end if;
      v_basis:=d5o_hosted.validate_job_bill_v2(v_workspace,v_work.id,v_bill.lines,v_bill.id);
      if v_basis is distinct from v_bill.basis then
        raise exception 'stale_billing_source_basis' using errcode='23505'; end if;
    end if;
    v_result:=d5o_hosted.job_finance_legacy_command_v1(p_workspace_key,
      p_presentation_id,p_action,p_input,p_command_id,p_expected_revision);
    if p_action='draft-bill' then
      update d5o_hosted.connected_job_bills set basis=v_basis
        where id=(v_result->>'id')::uuid and workspace_id=v_workspace and work_id=v_work.id;
      v_bill.id:=(v_result->>'id')::uuid;
    end if;
  end if;
  if p_action in ('draft-bill','revise-bill','submit-bill','review-bill','return-unbilled') then
    select * into v_bill from d5o_hosted.connected_job_bills
      where id=coalesce(v_bill.id,(v_result->>'id')::uuid) and workspace_id=v_workspace;
    insert into d5o_hosted.connected_job_bill_history(workspace_id,work_id,bill_id,
      revision,status,lines,basis,reviewed_by,review_reason,actor_user_id)
      values(v_workspace,v_work.id,v_bill.id,v_bill.revision,v_bill.status,
        v_bill.lines,v_bill.basis,v_bill.reviewed_by,v_bill.review_reason,v_actor)
      on conflict do nothing;
  end if;
  return v_result;
end; $$;
revoke all on function public.d5o_hosted_job_finance_command_v1(text,text,text,jsonb,text,integer)
  from public,anon,service_role;
grant execute on function public.d5o_hosted_job_finance_command_v1(text,text,text,jsonb,text,integer)
  to authenticated;


create or replace function public.d5o_hosted_job_finance_read_v1(p_workspace_key text,p_presentation_id text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace uuid;v_member d5o_hosted.memberships%rowtype;
  v_work uuid;v_award jsonb;v_state d5o_hosted.connected_job_finance_states%rowtype;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null then
    raise exception 'membership_required' using errcode='42501'; end if;
  select id into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace and actor_user_id=v_actor and status='active';
  select work_id into v_work from d5o_hosted.work_identity_links
    where workspace_id=v_workspace and presentation_id=p_presentation_id;
  if v_member.id is null or v_member.role='field_worker' or v_work is null then
    raise exception 'job_finance_scope_denied' using errcode='42501'; end if;
  select * into v_state from d5o_hosted.connected_job_finance_states
    where workspace_id=v_workspace and work_id=v_work;
  v_award:=d5o_hosted.job_finance_award_v1(v_workspace,v_work);
  return pg_catalog.jsonb_build_object('revision',coalesce(v_state.revision,0),
    'financeStatus',(select o.state#>>'{finance,status}' from d5o_hosted.connected_operate_states o
      where o.workspace_id=v_workspace and o.work_id=v_work),
    'currency',coalesce(v_state.currency,v_award#>>'{pricingBasis,currency}'),
    'baseline',v_award,'remainingForecastMinor',v_state.remaining_forecast_minor,
    'forecastSource',v_state.forecast_source,'forecastAt',v_state.forecast_at,
    'changes',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',c.id,'packageId',c.package_id,'revision',c.revision,
      'priceAmount',c.facts#>>'{proposal,priceAmount}',
      'currency',c.facts#>>'{proposal,currency}',
      'customerAuthorization',c.facts->'customerAuthorization',
      'revisedReleaseId',c.facts->>'revisedReleaseId') order by c.updated_at)
      from d5o_hosted.connected_field_changes c where c.workspace_id=v_workspace
        and c.work_id=v_work and c.status='Resolved' and c.kind='Scope change'
        and c.facts ? 'customerAuthorization' and c.facts ? 'revisedReleaseId'),'[]'::jsonb),
    'costs',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.recorded_at)
      from d5o_hosted.connected_job_costs x where x.workspace_id=v_workspace
        and x.work_id=v_work),'[]'::jsonb),
    'bills',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(b) order by b.created_at)
      from d5o_hosted.connected_job_bills b where b.workspace_id=v_workspace
        and b.work_id=v_work),'[]'::jsonb),
    'billHistory',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(h) order by h.recorded_at,h.revision)
      from d5o_hosted.connected_job_bill_history h where h.workspace_id=v_workspace
        and h.work_id=v_work),'[]'::jsonb),
    'cashEvents',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(c) order by c.recorded_at)
      from d5o_hosted.connected_job_cash_events c where c.workspace_id=v_workspace
        and c.work_id=v_work),'[]'::jsonb));
end; $$;
revoke all on function public.d5o_hosted_job_finance_read_v1(text,text) from public,anon,service_role;
grant execute on function public.d5o_hosted_job_finance_read_v1(text,text) to authenticated;
