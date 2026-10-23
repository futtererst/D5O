\set ON_ERROR_STOP on
begin;
select pg_catalog.set_config('request.jwt.claim.sub',
  (select m.actor_user_id::text from d5o_hosted.memberships m
   join d5o_hosted.workspaces w on w.id=m.workspace_id
   where w.workspace_key='rybex' and m.role='billing_commercial_lead'
     and m.status='active' limit 1),true);
set local role authenticated;
select public.d5o_hosted_service_invoice_command_v1(
  'rybex','rybex-a8fd95e7e20d4bb3881c3549459c99e0',
  'abe94af3-bdc5-435b-b6ad-ca810293988e','record-payment',
  pg_catalog.jsonb_build_object('amountMinor','42465','paymentDate',current_date::text,
    'source','FICTIONAL-CONCURRENT-PAYMENT-B'),
  'concurrent-invoice-payment-b-20261010',0,0,0,0,0,'',4,1);
commit;
