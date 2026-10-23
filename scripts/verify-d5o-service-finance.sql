-- Disposable completed pilot only. All probes run in a rolled-back transaction.
\set ON_ERROR_STOP on
begin;
create temp table probe as select e.command_id,e.snapshot->>'note' note,e.basis_digest,r.result
  from d5o_hosted.connected_service_finance_events e
  join d5o_hosted.connected_service_finance_receipts r using(workspace_id,command_id)
  where e.parent_work_id='a8fd95e7-e20d-4bb3-881c-3549459c99e0'
    and e.request_id='abe94af3-bdc5-435b-b6ad-ca810293988e'
    and e.action='prepare' order by e.revision limit 1;
grant select on probe to authenticated;
create temp table before_state as select md5(jsonb_build_object(
  'state',(select jsonb_agg(to_jsonb(s)) from d5o_hosted.connected_service_finance_states s
    where parent_work_id='a8fd95e7-e20d-4bb3-881c-3549459c99e0'),
  'events',(select count(*) from d5o_hosted.connected_service_finance_events
    where parent_work_id='a8fd95e7-e20d-4bb3-881c-3549459c99e0'),
  'receipts',(select count(*) from d5o_hosted.connected_service_finance_receipts
    where parent_work_id='a8fd95e7-e20d-4bb3-881c-3549459c99e0'))::text) digest;
set local role authenticated;
select set_config('request.jwt.claim.sub','4bb7a09e-6579-441a-88b9-512c5c79ceb0',true);
do $$
declare v_read jsonb; v_probe record; v_result jsonb; v_error text;
  v_work text:='rybex-a8fd95e7e20d4bb3881c3549459c99e0';
  v_request text:='abe94af3-bdc5-435b-b6ad-ca810293988e';
begin
  select * into v_probe from probe;
  if v_probe.command_id is null then raise exception 'missing_browser_fixture'; end if;
  v_read:=public.d5o_hosted_service_finance_read_v1('rybex',v_work,v_request);
  if v_read#>>'{decision,status}'<>'Hold' or v_read->>'revision'<>'2' then
    raise exception 'expected_finance_hold_missing'; end if;
  v_result:=public.d5o_hosted_service_finance_command_v1('rybex',v_work,v_request,
    'prepare',jsonb_build_object('note',v_probe.note,'billingTermsEvidenceId','',
      'billingTermsStatement',''),v_probe.command_id,40,34,31,15,0,v_probe.basis_digest);
  if v_result<>v_probe.result then raise exception 'identical_replay_changed'; end if;
  begin
    perform public.d5o_hosted_service_finance_command_v1('rybex',v_work,v_request,
      'prepare',jsonb_build_object('note','Conflicting payload',
        'billingTermsEvidenceId','','billingTermsStatement',''),v_probe.command_id,
      40,34,31,15,0,v_probe.basis_digest);
    raise exception 'conflicting_replay_accepted';
  exception when others then
    get stacked diagnostics v_error=message_text;
    if v_error<>'command_reuse_conflict' then raise; end if; end;
  begin
    perform public.d5o_hosted_service_finance_command_v1('rybex',v_work,v_request,
      'review-hold',jsonb_build_object('note','Wrong-role review must fail.'),
      'service-finance-wrong-role-001',40,34,31,15,2,v_read->>'basisDigest');
    raise exception 'wrong_role_accepted';
  exception when others then
    get stacked diagnostics v_error=message_text;
    if v_error<>'service_finance_role_required' then raise; end if; end;
  begin
    perform public.d5o_hosted_service_finance_command_v1('rybex',v_work,v_request,
      'prepare',jsonb_build_object('note','Stale Design source must fail.'),
      'service-finance-stale-001',40,34,30,15,2,v_read->>'basisDigest');
    raise exception 'stale_basis_accepted';
  exception when others then
    get stacked diagnostics v_error=message_text;
    if v_error<>'stale_service_finance_basis' then raise; end if; end;
  perform set_config('request.jwt.claim.sub','d6f00fb2-af52-4c6c-8612-c02b66f0fb96',true);
  begin
    perform public.d5o_hosted_service_finance_read_v1('rotork',v_work,v_request);
    raise exception 'cross_tenant_read_accepted';
  exception when others then
    get stacked diagnostics v_error=message_text;
    if v_error<>'service_finance_scope_forbidden' then raise; end if; end;
  raise notice 'replay, role, tenant and stale-source guards passed';
end $$;
reset role;
do $$ declare v_after text; begin
  select md5(jsonb_build_object(
    'state',(select jsonb_agg(to_jsonb(s)) from d5o_hosted.connected_service_finance_states s
      where parent_work_id='a8fd95e7-e20d-4bb3-881c-3549459c99e0'),
    'events',(select count(*) from d5o_hosted.connected_service_finance_events
      where parent_work_id='a8fd95e7-e20d-4bb3-881c-3549459c99e0'),
    'receipts',(select count(*) from d5o_hosted.connected_service_finance_receipts
      where parent_work_id='a8fd95e7-e20d-4bb3-881c-3549459c99e0'))::text)
    into v_after;
  if v_after<>(select digest from before_state) then raise exception 'rejected_probe_mutated_state'; end if;
end $$;
rollback;
