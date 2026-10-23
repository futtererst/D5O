-- Disposable fictional pilot only. All successful commands are rolled back.
\set ON_ERROR_STOP on
begin;
select set_config('qa.initial_revision',revision::text,true)
  from d5o_hosted.connected_job_finance_states
  where work_id='f50b8a6e-7c17-4052-ba29-8491a6ce1037';
select set_config('qa.cash_count',count(*)::text,true)
  from d5o_hosted.connected_job_cash_events
  where work_id='f50b8a6e-7c17-4052-ba29-8491a6ce1037';
set local role authenticated;
do $$
declare
  v_finance constant text:='32c8fda3-554c-428d-836f-4eb5e774d6cb';
  v_pm constant text:='4be53fd7-38fd-4810-9d00-12d8deae0197';
  v_work constant text:='rybex-f50b8a6e7c174052ba298491a6ce1037';
  v_bill constant text:='0065579b-7cd8-4f5a-8008-35f499c48e3a';
  v_initial integer:=pg_catalog.current_setting('qa.initial_revision')::integer;
  v_prefix text:='qa-closed-payment-'||pg_catalog.gen_random_uuid()::text;
  v_input jsonb;v_result jsonb;v_count integer;v_cash integer;v_remaining bigint;
begin
  perform pg_catalog.set_config('request.jwt.claim.sub',v_finance,true);
  v_cash:=pg_catalog.current_setting('qa.cash_count')::integer;
  v_input:=pg_catalog.jsonb_build_object('billId',v_bill,'billRevision',3,
    'amountMinor',100,'eventDate','2026-10-10','source','FICTIONAL-ROLLBACK-PAYMENT');
  v_result:=public.d5o_hosted_job_finance_command_v1('rybex',v_work,
    'record-paid',v_input,v_prefix,v_initial);
  if v_result->>'action'<>'record-paid' or
    v_result->>'revision'<>(v_initial+1)::text then
    raise exception 'closed_payment_not_recorded'; end if;
  if public.d5o_hosted_job_finance_command_v1('rybex',v_work,
    'record-paid',v_input,v_prefix,v_initial) is distinct from v_result then
    raise exception 'identical_replay_mismatch'; end if;
  begin
    perform public.d5o_hosted_job_finance_command_v1('rybex',v_work,
      'record-paid',v_input||'{"amountMinor":101}'::jsonb,v_prefix,v_initial);
    raise exception 'conflicting_replay_succeeded';
  exception when unique_violation then
    if sqlerrm<>'command_reuse_conflict' then raise; end if;
  end;
  begin
    perform public.d5o_hosted_job_finance_command_v1('rybex',v_work,
      'record-paid',v_input,v_prefix||'-stale',v_initial);
    raise exception 'stale_payment_succeeded';
  exception when unique_violation then
    if sqlerrm<>'stale_job_finance' then raise; end if;
  end;
  begin
    perform public.d5o_hosted_job_finance_command_v1('rybex',v_work,
      'record-paid',v_input||'{"amountMinor":3498858}'::jsonb,
      v_prefix||'-over',v_initial+1);
    raise exception 'overpayment_succeeded';
  exception when check_violation then
    if sqlerrm<>'payment_exceeds_billed' then raise; end if;
  end;
  v_count:=pg_catalog.jsonb_array_length(
    public.d5o_hosted_job_finance_read_v1('rybex',v_work)->'cashEvents');
  if v_count<>v_cash+1 then raise exception 'rejected_payment_changed_cash'; end if;
  raise notice 'PASS closed payment, identical replay, conflicting replay, stale and overpayment';

  foreach v_input in array array[
    '{"category":"Labor","kind":"Incurred","amountMinor":100,"costDate":"2026-10-10","source":"FICTIONAL-ROLLBACK-COST"}'::jsonb,
    '{"amountMinor":100,"forecastAt":"2026-10-10","source":"FICTIONAL-ROLLBACK-FORECAST"}'::jsonb,
    '{"lines":[]}'::jsonb
  ] loop
    begin
      perform public.d5o_hosted_job_finance_command_v1('rybex',v_work,
        case when v_input?'category' then 'add-cost'
          when v_input?'forecastAt' then 'set-remaining' else 'draft-bill' end,
        v_input,v_prefix||'-blocked-'||pg_catalog.gen_random_uuid()::text,v_initial+1);
      raise exception 'closed_mutation_succeeded';
    exception when check_violation then
      if sqlerrm<>'finance_closed_requires_reopen' then raise; end if;
    end;
  end loop;
  raise notice 'PASS closed cost, forecast and new billing decisions denied';

  v_input:=pg_catalog.jsonb_build_object('billId',v_bill,'billRevision',3,
    'amountMinor',100,'eventDate','2026-10-10','source','FICTIONAL-ROLLBACK-PAYMENT');
  perform pg_catalog.set_config('request.jwt.claim.sub',v_pm,true);
  begin
    perform public.d5o_hosted_job_finance_command_v1('rybex',v_work,
      'record-paid',v_input,v_prefix||'-pm',v_initial+1);
    raise exception 'wrong_role_payment_succeeded';
  exception when insufficient_privilege then
    if sqlerrm<>'finance_payment_role_denied' then raise; end if;
  end;
  perform pg_catalog.set_config('request.jwt.claim.sub',v_finance,true);
  begin
    perform public.d5o_hosted_job_finance_command_v1('another-tenant',v_work,
      'record-paid',v_input,v_prefix||'-tenant',v_initial+1);
    raise exception 'cross_tenant_payment_succeeded';
  exception when insufficient_privilege then
    if sqlerrm<>'job_finance_role_denied' then raise; end if;
  end;
  raise notice 'PASS wrong-role and cross-tenant denied';
  perform pg_catalog.set_config('request.jwt.claim.sub',v_finance,true);
  select coalesce(sum((item->>'amount_minor')::bigint) filter(where item->>'kind'='Billed'),0)
    - coalesce(sum((item->>'amount_minor')::bigint) filter(where item->>'kind'='Paid'),0)
    into v_remaining
    from pg_catalog.jsonb_array_elements(
      public.d5o_hosted_job_finance_read_v1('rybex',v_work)->'cashEvents') item
    where item->>'bill_id'=v_bill;
  begin
    perform public.d5o_hosted_job_finance_command_v1('rybex',v_work,'record-paid',
      v_input||pg_catalog.jsonb_build_object('amountMinor',v_remaining),
      v_prefix||'-exhaust',v_initial+1);
    begin
      perform public.d5o_hosted_job_finance_command_v1('rybex',v_work,'record-paid',
        v_input||'{"amountMinor":1}'::jsonb,v_prefix||'-second',v_initial+2);
      raise exception 'second_competing_payment_succeeded';
    exception when check_violation then
      if sqlerrm<>'payment_exceeds_billed' then raise; end if;
    end;
    raise exception 'rollback_exhaustion_probe';
  exception when raise_exception then
    if sqlerrm<>'rollback_exhaustion_probe' then raise; end if;
  end;
  raise notice 'PASS serial second payment cannot exceed invoice remaining balance';
end $$;
rollback;
