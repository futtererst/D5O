-- Disposable pilot only. Every successful probe is rolled back with the outer transaction.
\set ON_ERROR_STOP on
begin;
select set_config('qa.initial_revision',revision::text,true)
  from d5o_hosted.connected_job_finance_states
  where work_id='9e4f1e5f-9e6b-4e42-9142-d3b01e1825e5';
set local role authenticated;
do $$
declare
  v_pm constant text := '4be53fd7-38fd-4810-9d00-12d8deae0197';
  v_finance constant text := '32c8fda3-554c-428d-836f-4eb5e774d6cb';
  v_auditor constant text := 'f153b4f9-444c-4c15-b943-091df738b50b';
  v_work constant text := 'rybex-9e4f1e5f9e6b4e429142d3b01e1825e5';
  v_package constant text := 'wp-29a99d91129147a4853b2449fc7ee7e7';
  v_proof constant text := 'd945f2e5-ad19-45f7-9cd8-8422dc947780';
  v_revision integer := pg_catalog.current_setting('qa.initial_revision')::integer;
  v_result jsonb; v_a uuid; v_b uuid; v_lines jsonb;
  v_command text := 'qa-billing-aggregate-' || pg_catalog.gen_random_uuid()::text;
begin
  perform pg_catalog.set_config('request.jwt.claim.sub',v_pm,true);
  v_lines:=pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('packageId',v_package,'evidenceId',v_proof,
      'description','Fictional South allocation first','quantity','6',
      'unit','control points','amountMinor',1000),
    pg_catalog.jsonb_build_object('packageId',v_package,'evidenceId',v_proof,
      'description','Fictional South allocation second','quantity','6',
      'unit','control points','amountMinor',1000));
  begin
    perform public.d5o_hosted_job_finance_command_v1('rybex',v_work,'draft-bill',
      pg_catalog.jsonb_build_object('lines',v_lines),v_command,v_revision);
    raise exception 'aggregate_probe_unexpected_success';
  exception when check_violation then
    if sqlerrm<>'billing_exceeds_accepted_quantity' then raise; end if;
  end;
  raise notice 'PASS combined 6+6 exceeds ten despite authorized price capacity';

  v_lines:=pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('packageId',v_package,'evidenceId',v_proof,
      'description','Fictional South valid first','quantity','3',
      'unit','control points','amountMinor',1000),
    pg_catalog.jsonb_build_object('packageId',v_package,'evidenceId',v_proof,
      'description','Fictional South valid second','quantity','3',
      'unit','control points','amountMinor',1000));
  begin
    v_result:=public.d5o_hosted_job_finance_command_v1('rybex',v_work,'draft-bill',
      pg_catalog.jsonb_build_object('lines',v_lines),v_command||'-valid',v_revision);
    if v_result->>'action'<>'draft-bill' then raise exception 'valid_multiline_missing'; end if;
    raise exception 'rollback_valid_multiline';
  exception when raise_exception then
    if sqlerrm<>'rollback_valid_multiline' then raise; end if;
  end;
  raise notice 'PASS valid multi-line accepted before rollback';

  v_lines:=pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'packageId',v_package,'evidenceId',v_proof,'description','Fictional returned A',
    'quantity','6','unit','control points','amountMinor',1000));
  begin
    v_result:=public.d5o_hosted_job_finance_command_v1('rybex',v_work,'draft-bill',
      pg_catalog.jsonb_build_object('lines',v_lines),v_command||'-a',v_revision);
    v_a:=(v_result->>'id')::uuid;v_revision:=(v_result->>'revision')::integer;
    v_result:=public.d5o_hosted_job_finance_command_v1('rybex',v_work,'submit-bill',
      pg_catalog.jsonb_build_object('billId',v_a,'billRevision',1),v_command||'-submit-a',v_revision);
    v_revision:=(v_result->>'revision')::integer;
    perform pg_catalog.set_config('request.jwt.claim.sub',v_finance,true);
    v_result:=public.d5o_hosted_job_finance_command_v1('rybex',v_work,'review-bill',
      pg_catalog.jsonb_build_object('billId',v_a,'billRevision',2,'decision','Returned',
        'reason','Fictional independent correction requested'),v_command||'-return-a',v_revision);
    v_revision:=(v_result->>'revision')::integer;
    perform pg_catalog.set_config('request.jwt.claim.sub',v_pm,true);
    v_result:=public.d5o_hosted_job_finance_command_v1('rybex',v_work,'draft-bill',
      pg_catalog.jsonb_build_object('lines',v_lines),v_command||'-b',v_revision);
    v_b:=(v_result->>'id')::uuid;v_revision:=(v_result->>'revision')::integer;
    begin
      perform public.d5o_hosted_job_finance_command_v1('rybex',v_work,'submit-bill',
        pg_catalog.jsonb_build_object('billId',v_a,'billRevision',3),
        v_command||'-resubmit-a',v_revision);
      raise exception 'returned_resubmit_unexpected_success';
    exception when check_violation then
      if sqlerrm<>'billing_exceeds_accepted_quantity' then raise; end if;
    end;
    raise notice 'PASS returned A cannot reclaim quantity held by B';
    raise exception 'rollback_returned_sequence';
  exception when raise_exception then
    if sqlerrm<>'rollback_returned_sequence' then raise; end if;
  end;
  v_revision:=pg_catalog.current_setting('qa.initial_revision')::integer;
  begin
    v_result:=public.d5o_hosted_job_finance_command_v1('rybex',v_work,'draft-bill',
      pg_catalog.jsonb_build_object('lines',v_lines),v_command||'-self',v_revision);
    v_a:=(v_result->>'id')::uuid;v_revision:=(v_result->>'revision')::integer;
    v_result:=public.d5o_hosted_job_finance_command_v1('rybex',v_work,'submit-bill',
      pg_catalog.jsonb_build_object('billId',v_a,'billRevision',1),v_command||'-self-submit',v_revision);
    v_revision:=(v_result->>'revision')::integer;
    perform pg_catalog.set_config('request.jwt.claim.sub',v_finance,true);
    v_result:=public.d5o_hosted_job_finance_command_v1('rybex',v_work,'review-bill',
      pg_catalog.jsonb_build_object('billId',v_a,'billRevision',2,'decision','Returned',
        'reason','Fictional review return before resubmission'),v_command||'-self-return',v_revision);
    v_revision:=(v_result->>'revision')::integer;
    perform pg_catalog.set_config('request.jwt.claim.sub',v_pm,true);
    v_result:=public.d5o_hosted_job_finance_command_v1('rybex',v_work,'submit-bill',
      pg_catalog.jsonb_build_object('billId',v_a,'billRevision',3),v_command||'-self-resubmit',v_revision);
    if v_result->>'action'<>'submit-bill' then raise exception 'self_resubmit_missing'; end if;
    if public.d5o_hosted_job_finance_command_v1('rybex',v_work,'submit-bill',
      pg_catalog.jsonb_build_object('billId',v_a,'billRevision',3),v_command||'-self-resubmit',v_revision)
      is distinct from v_result then raise exception 'replay_mismatch'; end if;
    begin
      perform public.d5o_hosted_job_finance_command_v1('rybex',v_work,'submit-bill',
        pg_catalog.jsonb_build_object('billId',v_a,'billRevision',2),v_command||'-self-resubmit',v_revision);
      raise exception 'conflicting_replay_unexpected_success';
    exception when unique_violation then
      if sqlerrm<>'command_reuse_conflict' then raise; end if;
    end;
    begin
      perform public.d5o_hosted_job_finance_command_v1('rybex',v_work,'submit-bill',
        pg_catalog.jsonb_build_object('billId',v_a,'billRevision',3),v_command||'-stale',v_revision);
      raise exception 'stale_unexpected_success';
    exception when unique_violation then
      if sqlerrm<>'stale_job_finance' then raise; end if;
    end;
    raise notice 'PASS own-reservation excluded; identical replay, conflict and stale';
    raise exception 'rollback_valid_resubmit';
  exception when raise_exception then
    if sqlerrm<>'rollback_valid_resubmit' then raise; end if;
  end;
  perform pg_catalog.set_config('request.jwt.claim.sub',v_auditor,true);
  begin
    perform public.d5o_hosted_job_finance_command_v1('rybex',v_work,'draft-bill',
      pg_catalog.jsonb_build_object('lines',v_lines),v_command||'-wrong-role',
      pg_catalog.current_setting('qa.initial_revision')::integer);
    raise exception 'wrong_role_unexpected_success';
  exception when insufficient_privilege then
    if sqlerrm<>'job_finance_role_denied' then raise; end if;
  end;
  raise notice 'PASS wrong-role rejected';
  perform pg_catalog.set_config('request.jwt.claim.sub',v_pm,true);
  begin
    perform public.d5o_hosted_job_finance_command_v1('another-tenant',v_work,'draft-bill',
      pg_catalog.jsonb_build_object('lines',v_lines),v_command||'-cross-tenant',
      pg_catalog.current_setting('qa.initial_revision')::integer);
    raise exception 'cross_tenant_unexpected_success';
  exception when insufficient_privilege then
    if sqlerrm<>'job_finance_role_denied' then raise; end if;
  end;
  raise notice 'PASS missing tenant membership rejected';
end $$;
rollback;
