\set ON_ERROR_STOP on
begin;
select pg_catalog.set_config('d5o.probe.finance_actor',
  (select m.actor_user_id::text from d5o_hosted.memberships m
   join d5o_hosted.workspaces w on w.id=m.workspace_id
   where w.workspace_key='rybex' and m.role='billing_commercial_lead'
     and m.status='active' limit 1),true);
-- This artificial pre-issue position and mismatched retained document exist only
-- inside this transaction. The completed pilot invoice is restored by ROLLBACK.
update d5o_hosted.connected_service_invoices set
  status='Reviewed',revision=3,ledger_revision=0,invoice_number=null,
  issued_by=null,issued_at=null,invoice_date=null,due_date=null,
  issue_source=null,issued_snapshot=null
 where invoice_id='827eeebc-7b14-4113-baee-a6f9ad4a44f7';
update d5o_hosted.customer_decision_evidence set checksum_sha256=repeat('0',64)
 where id=(select evidence_id from d5o_hosted.connected_service_billing_terms
   where request_id='abe94af3-bdc5-435b-b6ad-ca810293988e');
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub',
  pg_catalog.current_setting('d5o.probe.finance_actor'),true);
do $$
declare v_fin jsonb;v_inv jsonb;v_result jsonb;
begin
  v_fin:=public.d5o_hosted_service_finance_read_v1(
    'rybex','rybex-a8fd95e7e20d4bb3881c3549459c99e0',
    'abe94af3-bdc5-435b-b6ad-ca810293988e');
  v_inv:=public.d5o_hosted_service_invoice_read_v1(
    'rybex','rybex-a8fd95e7e20d4bb3881c3549459c99e0',
    'abe94af3-bdc5-435b-b6ad-ca810293988e');
  if v_fin#>>'{basis,billingTermsKnown}'<>'false' then
    raise exception 'mismatched_document_not_detected'; end if;
  begin
    v_result:=public.d5o_hosted_service_invoice_command_v1(
      'rybex','rybex-a8fd95e7e20d4bb3881c3549459c99e0',
      'abe94af3-bdc5-435b-b6ad-ca810293988e','issue',
      pg_catalog.jsonb_build_object('invoiceDate',current_date::text,
        'source','FICTIONAL-ISSUE-REJECTION'),
      'rollback-mismatched-evidence-20261010',
      (v_fin->>'workRevision')::bigint,(v_fin->>'operateRevision')::integer,
      (v_fin#>>'{basis,designRevision}')::integer,
      (v_fin#>>'{basis,deployRevision}')::integer,
      (v_fin->>'revision')::integer,v_fin->>'basisDigest',
      (v_inv#>>'{invoice,revision}')::integer,
      (v_inv#>>'{invoice,ledger_revision}')::integer);
    raise exception 'mismatched_evidence_issued_invoice';
  exception when check_violation then
    if sqlerrm<>'current_fixed_fee_service_basis_required' then raise; end if;
  end;
  raise notice 'mismatched_evidence_issue_blocked';
end; $$;
rollback;
