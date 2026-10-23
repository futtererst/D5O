-- Disposable accepted fixture only. Source mutations and the draft are rolled back.
\set ON_ERROR_STOP on
begin;
select set_config('qa.initial_revision',revision::text,true)
  from d5o_hosted.connected_job_finance_states
  where work_id='9e4f1e5f-9e6b-4e42-9142-d3b01e1825e5';
set local role authenticated;
do $$
declare v_result jsonb;
begin
  perform pg_catalog.set_config('request.jwt.claim.sub','4be53fd7-38fd-4810-9d00-12d8deae0197',true);
  v_result:=public.d5o_hosted_job_finance_command_v1('rybex',
    'rybex-9e4f1e5f9e6b4e429142d3b01e1825e5','draft-bill',
    pg_catalog.jsonb_build_object('lines',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('packageId','wp-29a99d91129147a4853b2449fc7ee7e7',
      'evidenceId','d945f2e5-ad19-45f7-9cd8-8422dc947780',
      'description','Fictional stale-source test','quantity','3',
      'unit','control points','amountMinor',1000))),
    'qa-billing-stale-'||pg_catalog.gen_random_uuid()::text,
    pg_catalog.current_setting('qa.initial_revision')::integer);
  perform pg_catalog.set_config('qa.billing_id',v_result->>'id',true);
end $$;
reset role;
update d5o_hosted.connected_deploy_states set decision_revision=decision_revision+1
  where work_id='9e4f1e5f-9e6b-4e42-9142-d3b01e1825e5';
set local role authenticated;
do $$
begin
  perform public.d5o_hosted_job_finance_command_v1('rybex',
    'rybex-9e4f1e5f9e6b4e429142d3b01e1825e5','submit-bill',
    pg_catalog.jsonb_build_object('billId',pg_catalog.current_setting('qa.billing_id'),
      'billRevision',1),'qa-billing-stale-submit-'||pg_catalog.gen_random_uuid()::text,
      pg_catalog.current_setting('qa.initial_revision')::integer+1);
  raise exception 'stale_source_unexpected_success';
exception when unique_violation then
  if sqlerrm<>'stale_billing_source_basis' then raise; end if;
  raise notice 'PASS source revision change blocks bill submission';
end $$;
rollback;

begin;
select set_config('qa.initial_revision',revision::text,true)
  from d5o_hosted.connected_job_finance_states
  where work_id='9e4f1e5f-9e6b-4e42-9142-d3b01e1825e5';
set local role authenticated;
do $$
declare v_result jsonb;
begin
  perform pg_catalog.set_config('request.jwt.claim.sub','4be53fd7-38fd-4810-9d00-12d8deae0197',true);
  v_result:=public.d5o_hosted_job_finance_command_v1('rybex',
    'rybex-9e4f1e5f9e6b4e429142d3b01e1825e5','draft-bill',
    pg_catalog.jsonb_build_object('lines',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('packageId','wp-29a99d91129147a4853b2449fc7ee7e7',
      'evidenceId','d945f2e5-ad19-45f7-9cd8-8422dc947780',
      'description','Fictional changed-proof test','quantity','3',
      'unit','control points','amountMinor',1000))),
    'qa-billing-proof-'||pg_catalog.gen_random_uuid()::text,
    pg_catalog.current_setting('qa.initial_revision')::integer);
  perform pg_catalog.set_config('qa.billing_id',v_result->>'id',true);
end $$;
reset role;
update d5o_hosted.connected_deploy_states set state=jsonb_set(state,
  array['evidence',(
    select (ordinality-1)::text from jsonb_array_elements(state->'evidence') with ordinality e(item,ordinality)
    where item->>'id'='d945f2e5-ad19-45f7-9cd8-8422dc947780'
  ),'state'],'"Rejected"'::jsonb)
  where work_id='9e4f1e5f-9e6b-4e42-9142-d3b01e1825e5';
set local role authenticated;
do $$
begin
  perform public.d5o_hosted_job_finance_command_v1('rybex',
    'rybex-9e4f1e5f9e6b4e429142d3b01e1825e5','submit-bill',
    pg_catalog.jsonb_build_object('billId',pg_catalog.current_setting('qa.billing_id'),
      'billRevision',1),'qa-billing-proof-submit-'||pg_catalog.gen_random_uuid()::text,
      pg_catalog.current_setting('qa.initial_revision')::integer+1);
  raise exception 'invalid_proof_unexpected_success';
exception when check_violation then
  if sqlerrm<>'accepted_billing_scope_and_evidence_required' then raise; end if;
  raise notice 'PASS rejected evidence blocks bill submission';
end $$;
rollback;

begin;
select set_config('qa.initial_revision',revision::text,true)
  from d5o_hosted.connected_job_finance_states
  where work_id='9e4f1e5f-9e6b-4e42-9142-d3b01e1825e5';
set local role authenticated;
do $$
declare v_result jsonb;
begin
  perform pg_catalog.set_config('request.jwt.claim.sub','4be53fd7-38fd-4810-9d00-12d8deae0197',true);
  v_result:=public.d5o_hosted_job_finance_command_v1('rybex',
    'rybex-9e4f1e5f9e6b4e429142d3b01e1825e5','draft-bill',
    pg_catalog.jsonb_build_object('lines',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('packageId','wp-29a99d91129147a4853b2449fc7ee7e7',
      'evidenceId','d945f2e5-ad19-45f7-9cd8-8422dc947780',
      'description','Fictional stale-source test','quantity','3',
      'unit','control points','amountMinor',1000))),
    'qa-billing-release-'||pg_catalog.gen_random_uuid()::text,
    pg_catalog.current_setting('qa.initial_revision')::integer);
  perform pg_catalog.set_config('qa.billing_id',v_result->>'id',true);
end $$;
reset role;
update d5o_hosted.connected_design_states set state=jsonb_set(state,
  array['releases',(
    select (ordinality-1)::text from jsonb_array_elements(state->'releases') with ordinality r(item,ordinality)
    where item->>'id'='8dca50bf-0356-48c1-8989-f4961c92ec93'
  ),'status'],'"Held"'::jsonb)
  where work_id='9e4f1e5f-9e6b-4e42-9142-d3b01e1825e5';
set local role authenticated;
do $$
begin
  perform public.d5o_hosted_job_finance_command_v1('rybex',
    'rybex-9e4f1e5f9e6b4e429142d3b01e1825e5','submit-bill',
    pg_catalog.jsonb_build_object('billId',pg_catalog.current_setting('qa.billing_id'),
      'billRevision',1),'qa-billing-release-submit-'||pg_catalog.gen_random_uuid()::text,
      pg_catalog.current_setting('qa.initial_revision')::integer+1);
  raise exception 'release_unexpected_success';
exception when check_violation then
  if sqlerrm<>'accepted_billing_scope_and_evidence_required' then raise; end if;
  raise notice 'PASS changed release blocks bill submission';
end $$;
rollback;

begin;
select set_config('qa.initial_revision',revision::text,true)
  from d5o_hosted.connected_job_finance_states
  where work_id='9e4f1e5f-9e6b-4e42-9142-d3b01e1825e5';
set local role authenticated;
do $$
declare v_result jsonb;
begin
  perform pg_catalog.set_config('request.jwt.claim.sub','4be53fd7-38fd-4810-9d00-12d8deae0197',true);
  v_result:=public.d5o_hosted_job_finance_command_v1('rybex',
    'rybex-9e4f1e5f9e6b4e429142d3b01e1825e5','draft-bill',
    pg_catalog.jsonb_build_object('lines',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('packageId','wp-29a99d91129147a4853b2449fc7ee7e7',
      'evidenceId','d945f2e5-ad19-45f7-9cd8-8422dc947780',
      'description','Fictional stale-source test','quantity','3',
      'unit','control points','amountMinor',1000))),
    'qa-billing-acceptance-'||pg_catalog.gen_random_uuid()::text,
    pg_catalog.current_setting('qa.initial_revision')::integer);
  perform pg_catalog.set_config('qa.billing_id',v_result->>'id',true);
end $$;
reset role;
update d5o_hosted.connected_deploy_states set state=jsonb_set(state,
  array['turnovers',(
    select (ordinality-1)::text from jsonb_array_elements(state->'turnovers') with ordinality t(item,ordinality)
    where item->>'id'='49ebcb3d-6388-4922-9faa-eea85bd41f63'
  ),'receipt'],'"Returned"'::jsonb)
  where work_id='9e4f1e5f-9e6b-4e42-9142-d3b01e1825e5';
set local role authenticated;
do $$
begin
  perform public.d5o_hosted_job_finance_command_v1('rybex',
    'rybex-9e4f1e5f9e6b4e429142d3b01e1825e5','submit-bill',
    pg_catalog.jsonb_build_object('billId',pg_catalog.current_setting('qa.billing_id'),
      'billRevision',1),'qa-billing-acceptance-submit-'||pg_catalog.gen_random_uuid()::text,
      pg_catalog.current_setting('qa.initial_revision')::integer+1);
  raise exception 'acceptance_unexpected_success';
exception when check_violation then
  if sqlerrm<>'accepted_billing_scope_and_evidence_required' then raise; end if;
  raise notice 'PASS changed acceptance blocks bill submission';
end $$;
rollback;
