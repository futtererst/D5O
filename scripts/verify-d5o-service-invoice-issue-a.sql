\set ON_ERROR_STOP on
begin;
select pg_catalog.set_config('request.jwt.claim.sub',
  (select m.actor_user_id::text from d5o_hosted.memberships m
   join d5o_hosted.workspaces w on w.id=m.workspace_id
   where w.workspace_key='rybex' and m.role='billing_commercial_lead'
     and m.status='active' limit 1),true);
set local role authenticated;
do $$
declare v_fin jsonb;v_inv jsonb;v_result jsonb;
begin
  v_fin:=public.d5o_hosted_service_finance_read_v1(
    'rybex','rybex-a8fd95e7e20d4bb3881c3549459c99e0',
    'abe94af3-bdc5-435b-b6ad-ca810293988e');
  v_inv:=public.d5o_hosted_service_invoice_read_v1(
    'rybex','rybex-a8fd95e7e20d4bb3881c3549459c99e0',
    'abe94af3-bdc5-435b-b6ad-ca810293988e');
  v_result:=public.d5o_hosted_service_invoice_command_v1(
    'rybex','rybex-a8fd95e7e20d4bb3881c3549459c99e0',
    'abe94af3-bdc5-435b-b6ad-ca810293988e','issue',
    pg_catalog.jsonb_build_object('invoiceDate',current_date::text,
      'source','FICTIONAL-CONCURRENT-ISSUE-A'),
    'concurrent-invoice-issue-a-20261010',
    (v_fin->>'workRevision')::bigint,(v_fin->>'operateRevision')::integer,
    (v_fin#>>'{basis,designRevision}')::integer,
    (v_fin#>>'{basis,deployRevision}')::integer,
    (v_fin->>'revision')::integer,v_fin->>'basisDigest',
    (v_inv#>>'{invoice,revision}')::integer,
    (v_inv#>>'{invoice,ledger_revision}')::integer);
  if v_result->>'status'<>'Issued' then raise exception 'issue_a_failed'; end if;
end; $$;
select pg_catalog.pg_sleep(2);
commit;
