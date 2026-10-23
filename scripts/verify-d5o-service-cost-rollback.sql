-- Run only in d5o_invoice_probe, a disposable clone distinct from the UI pilot.
begin;
set local role authenticated;
set local request.jwt.claim.sub='f1616f21-14f7-4a85-b5f5-5cbcc4e6b6bb';
do $$
declare
  r jsonb;input jsonb;outcome jsonb;first_result jsonb;
  work_id text:='rybex-a8fd95e7e20d4bb3881c3549459c99e0';
  request_id text:='abe94af3-bdc5-435b-b6ad-ca810293988e';
  command_id text:='cost-rollback-probe-20261010-first';
  before_invoice jsonb;after_invoice jsonb;
  after_cost jsonb;
begin
  r:=public.d5o_hosted_service_cost_read_v1('rybex',work_id,request_id);
  before_invoice:=public.d5o_hosted_service_invoice_read_v1('rybex',work_id,request_id);
  if (r->>'revision')::integer<>0 then raise exception 'probe_clone_not_empty'; end if;
  input:=pg_catalog.jsonb_build_object('amountMinor','8000','currency','USD',
    'category','Material','allocation','Unallocated',
    'incurredDate',(current_date-1)::text,
    'source','FICTIONAL-ISOLATED-COST-SOURCE-ONE',
    'rationale','Fictional isolated rollback-only cost source.');
  -- Wrong role and tenant must fail before a consequential write.
  perform pg_catalog.set_config('request.jwt.claim.sub','4bb7a09e-6579-441a-88b9-512c5c79ceb0',true);
  begin
    outcome:=public.d5o_hosted_service_cost_command_v1('rybex',work_id,request_id,
      'record-cost',input,'cost-rollback-wrong-role',0,
      (r->>'workRevision')::bigint,(r->>'operateRevision')::integer,
      r->>'requestCycleAt',r->>'childWorkId',r->>'sourceDigest');
    raise exception 'wrong_role_accepted';
  exception when others then
    if sqlerrm<>'service_cost_finance_role_required' then raise; end if;
  end;
  perform pg_catalog.set_config('request.jwt.claim.sub','f1616f21-14f7-4a85-b5f5-5cbcc4e6b6bb',true);
  begin
    outcome:=public.d5o_hosted_service_cost_command_v1('rotork',work_id,request_id,
      'record-cost',input,'cost-rollback-cross-tenant',0,
      (r->>'workRevision')::bigint,(r->>'operateRevision')::integer,
      r->>'requestCycleAt',r->>'childWorkId',r->>'sourceDigest');
    raise exception 'cross_tenant_accepted';
  exception when others then
    if sqlerrm<>'workspace_forbidden' then raise; end if;
  end;
  begin
    outcome:=public.d5o_hosted_service_cost_command_v1('rybex',work_id,request_id,
      'record-cost',input,'cost-rollback-stale',1,
      (r->>'workRevision')::bigint,(r->>'operateRevision')::integer,
      r->>'requestCycleAt',r->>'childWorkId',r->>'sourceDigest');
    raise exception 'stale_accepted';
  exception when others then
    if sqlerrm<>'stale_service_cost_revision' then raise; end if;
  end;
  begin
    outcome:=public.d5o_hosted_service_cost_command_v1('rybex',work_id,request_id,
      'record-cost',input,'cost-rollback-stale-source',0,
      (r->>'workRevision')::bigint,(r->>'operateRevision')::integer,
      r->>'requestCycleAt',r->>'childWorkId','superseded-source-digest');
    raise exception 'stale_source_accepted';
  exception when others then
    if sqlerrm<>'stale_service_cost_source' then raise; end if;
  end;
  begin
    outcome:=public.d5o_hosted_service_cost_command_v1('rybex',work_id,request_id,
      'record-cost',input||'{"allocation":"Other"}'::jsonb,'cost-rollback-allocation',0,
      (r->>'workRevision')::bigint,(r->>'operateRevision')::integer,
      r->>'requestCycleAt',r->>'childWorkId',r->>'sourceDigest');
    raise exception 'invalid_allocation_accepted';
  exception when others then
    if sqlerrm<>'invalid_service_cost_input' then raise; end if;
  end;
  begin
    outcome:=public.d5o_hosted_service_cost_command_v1('rybex',work_id,request_id,
      'record-cost',input||'{"currency":"GBP"}'::jsonb,'cost-rollback-currency',0,
      (r->>'workRevision')::bigint,(r->>'operateRevision')::integer,
      r->>'requestCycleAt',r->>'childWorkId',r->>'sourceDigest');
    raise exception 'unsupported_currency_accepted';
  exception when others then
    if sqlerrm<>'invalid_service_cost_input' then raise; end if;
  end;
  first_result:=public.d5o_hosted_service_cost_command_v1('rybex',work_id,request_id,
    'record-cost',input,command_id,0,(r->>'workRevision')::bigint,
    (r->>'operateRevision')::integer,r->>'requestCycleAt',r->>'childWorkId',r->>'sourceDigest');
  outcome:=public.d5o_hosted_service_cost_command_v1('rybex',work_id,request_id,
    'record-cost',input,command_id,0,(r->>'workRevision')::bigint,
    (r->>'operateRevision')::integer,r->>'requestCycleAt',r->>'childWorkId',r->>'sourceDigest');
  if outcome<>first_result then raise exception 'identical_replay_changed'; end if;
  begin
    outcome:=public.d5o_hosted_service_cost_command_v1('rybex',work_id,request_id,
      'record-cost',input||'{"amountMinor":"9000"}'::jsonb,command_id,0,
      (r->>'workRevision')::bigint,(r->>'operateRevision')::integer,
      r->>'requestCycleAt',r->>'childWorkId',r->>'sourceDigest');
    raise exception 'conflicting_replay_accepted';
  exception when others then
    if sqlerrm<>'command_reuse_conflict' then raise; end if;
  end;
  begin
    outcome:=public.d5o_hosted_service_cost_command_v1('rybex',work_id,request_id,
      'record-cost',input||'{"source":"fictional-isolated-cost-source-one"}'::jsonb,
      'cost-rollback-duplicate-source',1,(r->>'workRevision')::bigint,
      (r->>'operateRevision')::integer,r->>'requestCycleAt',r->>'childWorkId',r->>'sourceDigest');
    raise exception 'duplicate_source_accepted';
  exception when others then
    if sqlerrm<>'service_cost_duplicate_source' then raise; end if;
  end;
  after_cost:=public.d5o_hosted_service_cost_read_v1('rybex',work_id,request_id);
  if (after_cost->>'revision')::integer<>1
    or pg_catalog.jsonb_array_length(after_cost->'entries')<>1 then
    raise exception 'rejected_probe_created_cost'; end if;
  after_invoice:=public.d5o_hosted_service_invoice_read_v1('rybex',work_id,request_id);
  if after_invoice<>before_invoice then raise exception 'cost_probe_changed_invoice'; end if;
  begin
    update d5o_hosted.connected_service_cost_entries set amount_minor=1
      where workspace_id=(select id from d5o_hosted.workspaces where workspace_key='rybex');
    raise exception 'generic_write_accepted';
  exception when insufficient_privilege then null;
  end;
  raise notice 'service_cost_probe: wrong_role,cross_tenant,stale_revision,stale_source,allocation,currency,replay,duplicate_source,generic_write; one command only inside rollback';
end $$;
rollback;
