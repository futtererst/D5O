\set ON_ERROR_STOP on
begin;
select pg_catalog.set_config('d5o.probe.finance_actor',
  (select m.actor_user_id::text from d5o_hosted.memberships m
   join d5o_hosted.workspaces w on w.id=m.workspace_id
   where w.workspace_key='rybex' and m.role='billing_commercial_lead'
     and m.status='active' limit 1),true);
update d5o_hosted.connected_service_billing_terms set revision=revision+1
 where request_id='abe94af3-bdc5-435b-b6ad-ca810293988e';
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub',
  pg_catalog.current_setting('d5o.probe.finance_actor'),true);
do $$
declare v_read jsonb;v_result jsonb;v_inv jsonb;
begin
  v_read:=public.d5o_hosted_service_invoice_read_v1(
    'rybex','rybex-a8fd95e7e20d4bb3881c3549459c99e0',
    'abe94af3-bdc5-435b-b6ad-ca810293988e');
  if v_read->>'sourceCurrent'<>'false' then
    raise exception 'changed_source_not_detected'; end if;
  v_inv:=v_read->'invoice';
  v_result:=public.d5o_hosted_service_invoice_command_v1(
    'rybex','rybex-a8fd95e7e20d4bb3881c3549459c99e0',
    'abe94af3-bdc5-435b-b6ad-ca810293988e','record-payment',
    pg_catalog.jsonb_build_object('amountMinor','100','paymentDate',current_date::text,
      'source','FICTIONAL-ROLLBACK-AFTER-SOURCE'),
    'rollback-payment-after-source-20261010',0,0,0,0,0,'',
    (v_inv->>'revision')::integer,(v_inv->>'ledger_revision')::integer);
  if (v_result->>'outstandingMinor')::bigint<>42365 then
    raise exception 'retained_receivable_payment_failed'; end if;
  begin
    update d5o_hosted.connected_service_invoices set amount_minor=1
      where invoice_id=(v_inv->>'invoice_id')::uuid;
    raise exception 'direct_invoice_write_was_allowed';
  exception when insufficient_privilege then null;
  end;
  raise notice 'changed_source_payment_and_protected_write_pass';
end; $$;
rollback;
