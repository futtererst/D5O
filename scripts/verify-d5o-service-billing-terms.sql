-- Run against the disposable Rybex pilot only. Every positive probe rolls back.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','4bb7a09e-6579-441a-88b9-512c5c79ceb0',true);
do $$
declare
  v_work constant text:='rybex-a8fd95e7e20d4bb3881c3549459c99e0';
  v_request constant text:='abe94af3-bdc5-435b-b6ad-ca810293988e';
  v_read jsonb;v_input jsonb;v_result jsonb;v_prepared jsonb;
begin
  v_read:=public.d5o_hosted_service_finance_read_v1('rybex',v_work,v_request);
  if v_read#>>'{basis,billingTermsKnown}'<>'true'
    or v_read#>>'{basis,uncoveredAmountMinor}'<>'52465'
    or v_read#>>'{basis,currency}'<>'USD' then
    raise exception 'current_fictional_terms_missing'; end if;
  v_input:=pg_catalog.jsonb_build_object(
    'evidenceId',v_read#>>'{basis,billingTermsEvidenceId}',
    'billingBasis','Fixed fee for approved uncovered scope',
    'billingTrigger','Accepted service scope',
    'paymentTerms','Net 30 days from invoice',
    'customerParty','Fictional Casey Customer',
    'customerOrganization','Fictional North Campus Properties',
    'customerRole','Site service representative',
    'authorityBasis','Fictional delegated authority for exact uncovered scope',
    'note','Rollback-only replay and authority probe');
  -- A Finance user cannot record a customer terms supplement.
  perform set_config('request.jwt.claim.sub',
    '063c0f28-2ab0-4106-88e1-80e2d9203866',true);
  begin
    perform public.d5o_hosted_service_billing_terms_command_v1(
      'rybex',v_work,v_request,v_input,'terms-wrong-role-probe',
      (v_read->>'workRevision')::bigint,(v_read->>'operateRevision')::integer,
      (v_read#>>'{basis,designRevision}')::integer,
      (v_read#>>'{basis,deployRevision}')::integer,
      (v_read->>'termsRevision')::integer,v_read->>'termsSourceDigest');
    raise exception 'wrong_role_was_accepted';
  exception when insufficient_privilege then
    if sqlerrm<>'service_billing_terms_role_required' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub',
    '4bb7a09e-6579-441a-88b9-512c5c79ceb0',true);
  begin
    perform public.d5o_hosted_service_billing_terms_command_v1(
      'rotork',v_work,v_request,v_input,'terms-cross-tenant-probe',
      (v_read->>'workRevision')::bigint,(v_read->>'operateRevision')::integer,
      (v_read#>>'{basis,designRevision}')::integer,
      (v_read#>>'{basis,deployRevision}')::integer,
      (v_read->>'termsRevision')::integer,v_read->>'termsSourceDigest');
    raise exception 'cross_tenant_was_accepted';
  exception when others then
    if sqlerrm not in ('service_billing_terms_role_required',
      'canonical_parent_required','workspace_forbidden') then raise; end if;
  end;
  begin
    perform public.d5o_hosted_service_billing_terms_command_v1(
      'rybex',v_work,v_request,v_input,'terms-stale-probe',
      (v_read->>'workRevision')::bigint,(v_read->>'operateRevision')::integer,
      (v_read#>>'{basis,designRevision}')::integer,
      (v_read#>>'{basis,deployRevision}')::integer,
      0,v_read->>'termsSourceDigest');
    raise exception 'stale_revision_was_accepted';
  exception when unique_violation then
    if sqlerrm<>'stale_service_billing_terms_source' then raise; end if;
  end;
  begin
    perform public.d5o_hosted_service_billing_terms_command_v1(
      'rybex',v_work,v_request,v_input||'{"amountMinor":"99999"}'::jsonb,
      'terms-wrong-amount-probe',
      (v_read->>'workRevision')::bigint,(v_read->>'operateRevision')::integer,
      (v_read#>>'{basis,designRevision}')::integer,
      (v_read#>>'{basis,deployRevision}')::integer,
      (v_read->>'termsRevision')::integer,v_read->>'termsSourceDigest');
    raise exception 'caller_amount_was_accepted';
  exception when invalid_parameter_value then
    if sqlerrm<>'invalid_service_billing_terms_command' then raise; end if;
  end;
  begin
    perform public.d5o_hosted_service_billing_terms_command_v1(
      'rybex',v_work,v_request,
      v_input||'{"evidenceId":"b80d402b-7ccf-4949-9bec-c780cd1e78fb"}'::jsonb,
      'terms-wrong-evidence-probe',
      (v_read->>'workRevision')::bigint,(v_read->>'operateRevision')::integer,
      (v_read#>>'{basis,designRevision}')::integer,
      (v_read#>>'{basis,deployRevision}')::integer,
      (v_read->>'termsRevision')::integer,v_read->>'termsSourceDigest');
    raise exception 'wrong_purpose_evidence_was_accepted';
  exception when check_violation then
    if sqlerrm<>'exact_customer_evidence_required' then raise; end if;
  end;
  begin
    perform public.d5o_hosted_service_billing_terms_command_v1(
      'rybex',v_work,v_request,
      v_input||'{"evidenceId":"00000000-0000-4000-8000-000000000001"}'::jsonb,
      'terms-missing-evidence-probe',
      (v_read->>'workRevision')::bigint,(v_read->>'operateRevision')::integer,
      (v_read#>>'{basis,designRevision}')::integer,
      (v_read#>>'{basis,deployRevision}')::integer,
      (v_read->>'termsRevision')::integer,v_read->>'termsSourceDigest');
    raise exception 'missing_evidence_was_accepted';
  exception when check_violation then
    if sqlerrm<>'exact_customer_evidence_required' then raise; end if;
  end;
  -- A new terms revision is permitted, and an identical command returns its
  -- original receipt even though its expected revision is now old.
  v_result:=public.d5o_hosted_service_billing_terms_command_v1(
    'rybex',v_work,v_request,v_input,'terms-replay-probe-20261010',
    (v_read->>'workRevision')::bigint,(v_read->>'operateRevision')::integer,
    (v_read#>>'{basis,designRevision}')::integer,
    (v_read#>>'{basis,deployRevision}')::integer,
    (v_read->>'termsRevision')::integer,v_read->>'termsSourceDigest');
  if v_result is distinct from public.d5o_hosted_service_billing_terms_command_v1(
    'rybex',v_work,v_request,v_input,'terms-replay-probe-20261010',
    (v_read->>'workRevision')::bigint,(v_read->>'operateRevision')::integer,
    (v_read#>>'{basis,designRevision}')::integer,
    (v_read#>>'{basis,deployRevision}')::integer,
    (v_read->>'termsRevision')::integer,v_read->>'termsSourceDigest') then
    raise exception 'identical_replay_changed_receipt'; end if;
  begin
    perform public.d5o_hosted_service_billing_terms_command_v1(
      'rybex',v_work,v_request,v_input||'{"note":"Conflicting replay text"}'::jsonb,
      'terms-replay-probe-20261010',
      (v_read->>'workRevision')::bigint,(v_read->>'operateRevision')::integer,
      (v_read#>>'{basis,designRevision}')::integer,
      (v_read#>>'{basis,deployRevision}')::integer,
      (v_read->>'termsRevision')::integer,v_read->>'termsSourceDigest');
    raise exception 'conflicting_replay_was_accepted';
  exception when unique_violation then
    if sqlerrm<>'command_reuse_conflict' then raise; end if;
  end;

  -- A new terms revision invalidates the earlier Ready decision.
  v_read:=public.d5o_hosted_service_finance_read_v1('rybex',v_work,v_request);
  if v_read->>'decisionCurrent'<>'false' then
    raise exception 'superseded_finance_decision_still_current'; end if;
  v_prepared:=public.d5o_hosted_service_finance_command_v1(
    'rybex',v_work,v_request,'prepare',
    pg_catalog.jsonb_build_object('note','Prepare exact rollback-only supplement for review',
      'billingTermsEvidenceId',v_read#>>'{basis,billingTermsEvidenceId}',
      'billingTermsStatement',v_read#>>'{basis,billingTermsStatement}'),
    'terms-prepare-probe-20261010',
    (v_read->>'workRevision')::bigint,(v_read->>'operateRevision')::integer,
    (v_read#>>'{basis,designRevision}')::integer,
    (v_read#>>'{basis,deployRevision}')::integer,
    (v_read->>'revision')::integer,v_read->>'basisDigest');
  perform set_config('request.jwt.claim.sub',
    '063c0f28-2ab0-4106-88e1-80e2d9203866',true);
  begin
    perform public.d5o_hosted_service_finance_command_v1(
      'rybex',v_work,v_request,'review-ready',
      '{"note":"Stale basis must not authorize this fictional amount."}'::jsonb,
      'terms-stale-finance-review',
      (v_read->>'workRevision')::bigint,(v_read->>'operateRevision')::integer,
      (v_read#>>'{basis,designRevision}')::integer,
      (v_read#>>'{basis,deployRevision}')::integer,
      (v_read->>'revision')::integer,v_read->>'basisDigest');
    raise exception 'stale_finance_review_was_accepted';
  exception when unique_violation then
    if sqlerrm<>'stale_service_finance_basis' then raise; end if;
  end;
  raise notice 'terms probes passed; original pilot will be unchanged by rollback';
end $$;
rollback;
