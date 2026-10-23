-- Sourced, append-only actual costs for a completed service cycle. This is
-- separate from both the customer-job cost ledger and the service invoice.
create table d5o_hosted.connected_service_cost_states (
  workspace_id uuid not null references d5o_hosted.workspaces(id),
  parent_work_id uuid not null,
  request_id text not null,
  request_cycle_at text not null,
  child_work_id uuid not null,
  revision integer not null default 0 check (revision >= 0),
  primary key(workspace_id,parent_work_id,request_id),
  foreign key(parent_work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id),
  foreign key(child_work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id)
);
create table d5o_hosted.connected_service_cost_entries (
  workspace_id uuid not null,
  entry_id uuid not null default pg_catalog.gen_random_uuid(),
  parent_work_id uuid not null,
  request_id text not null,
  request_cycle_at text not null,
  child_work_id uuid not null,
  kind text not null check (kind in ('Original','Reversal','Replacement')),
  root_id uuid,
  reverses_entry_id uuid,
  amount_minor bigint not null check (amount_minor <> 0),
  currency text not null check (currency='USD'),
  category text not null check (category in ('Labor','Material','Equipment','Subcontract','Travel','Other')),
  allocation text not null check (allocation in ('Covered','Uncovered','Unallocated')),
  incurred_date date not null,
  source_ref text not null,
  rationale text not null,
  source_basis jsonb not null,
  source_digest text not null,
  recorded_by uuid not null,
  recorded_at timestamptz not null default now(),
  primary key(workspace_id,entry_id),
  foreign key(workspace_id,parent_work_id,request_id)
    references d5o_hosted.connected_service_cost_states(workspace_id,parent_work_id,request_id),
  check ((kind='Reversal' and amount_minor<0 and reverses_entry_id is not null)
    or (kind in ('Original','Replacement') and amount_minor>0 and reverses_entry_id is null))
);
create unique index connected_service_cost_once_reversed on
  d5o_hosted.connected_service_cost_entries(workspace_id,reverses_entry_id)
  where kind='Reversal';
create unique index connected_service_cost_unique_source on
  d5o_hosted.connected_service_cost_entries(workspace_id,parent_work_id,request_id,lower(source_ref))
  where kind in ('Original','Replacement');
create index connected_service_cost_lookup on
  d5o_hosted.connected_service_cost_entries(workspace_id,parent_work_id,request_id,recorded_at);
create table d5o_hosted.connected_service_cost_events (
  workspace_id uuid not null,
  event_id uuid not null default pg_catalog.gen_random_uuid(),
  parent_work_id uuid not null,
  request_id text not null,
  command_id text not null,
  action text not null,
  actor_user_id uuid not null,
  membership_id uuid not null,
  revision integer not null,
  snapshot jsonb not null,
  at timestamptz not null default now(),
  primary key(workspace_id,event_id),
  unique(workspace_id,command_id)
);
create table d5o_hosted.connected_service_cost_receipts (
  workspace_id uuid not null,
  command_id text not null,
  parent_work_id uuid not null,
  actor_user_id uuid not null,
  fingerprint text not null,
  result jsonb not null,
  at timestamptz not null default now(),
  primary key(workspace_id,command_id)
);
alter table d5o_hosted.connected_service_cost_states enable row level security;
alter table d5o_hosted.connected_service_cost_entries enable row level security;
alter table d5o_hosted.connected_service_cost_events enable row level security;
alter table d5o_hosted.connected_service_cost_receipts enable row level security;
revoke all on d5o_hosted.connected_service_cost_states,
  d5o_hosted.connected_service_cost_entries,
  d5o_hosted.connected_service_cost_events,
  d5o_hosted.connected_service_cost_receipts from public,anon,authenticated,service_role;

create function public.d5o_hosted_service_cost_read_v1(
  p_workspace_key text,p_parent_presentation_id text,p_request_id text
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid();v_workspace uuid;v_parent uuid;v_basis jsonb;
  v_state d5o_hosted.connected_service_cost_states%rowtype;
  v_work_revision bigint;v_operate_revision integer;
  v_entries jsonb;v_active jsonb;v_covered bigint;v_uncovered bigint;v_unallocated bigint;
  v_count integer;v_invoice jsonb;v_estimated_cost text;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null then
    raise exception 'service_cost_auth_required' using errcode='42501'; end if;
  select w.id,l.work_id into v_workspace,v_parent from d5o_hosted.workspaces w
    join d5o_hosted.memberships m on m.workspace_id=w.id
      and m.actor_user_id=v_actor and m.status='active'
    join d5o_hosted.work_identity_links l on l.workspace_id=w.id
      and l.presentation_id=p_parent_presentation_id and l.parent_work_id is null
    where w.workspace_key=p_workspace_key and w.status='active'
      and m.role in ('project_manager','billing_commercial_lead','operations_leader','admin','executive');
  if v_parent is null then raise exception 'service_cost_scope_forbidden' using errcode='42501'; end if;
  v_basis:=d5o_hosted.current_service_finance_basis_v1(v_workspace,v_parent,p_request_id);
  select item#>>'{serviceEstimate,evaluation,includedCostMinor}' into v_estimated_cost
    from d5o_hosted.connected_operate_states o,
      lateral pg_catalog.jsonb_array_elements(coalesce(o.state->'requests','[]'::jsonb)) item
    where o.workspace_id=v_workspace and o.work_id=v_parent
      and item->>'id'=p_request_id
      and item#>>'{serviceEstimate,status}'='Approved'
      and item#>>'{serviceEstimate,requestCycleAt}'=v_basis->>'requestCycleAt';
  select * into v_state from d5o_hosted.connected_service_cost_states
    where workspace_id=v_workspace and parent_work_id=v_parent and request_id=p_request_id;
  select revision into v_work_revision from d5o_hosted.prototype_states
    where workspace_id=v_workspace and state_key='work';
  select decision_revision into v_operate_revision from d5o_hosted.connected_operate_states
    where workspace_id=v_workspace and work_id=v_parent;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(e) order by e.recorded_at,e.entry_id),'[]'::jsonb)
    into v_entries from d5o_hosted.connected_service_cost_entries e
    where e.workspace_id=v_workspace and e.parent_work_id=v_parent and e.request_id=p_request_id;
  select count(*),sum(e.amount_minor) filter (where e.allocation='Covered'),
    sum(e.amount_minor) filter (where e.allocation='Uncovered'),
    sum(e.amount_minor) filter (where e.allocation='Unallocated'),
    coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(e) order by e.recorded_at,e.entry_id),'[]'::jsonb)
    into v_count,v_covered,v_uncovered,v_unallocated,v_active
    from d5o_hosted.connected_service_cost_entries e
    where e.workspace_id=v_workspace and e.parent_work_id=v_parent and e.request_id=p_request_id
      and e.kind in ('Original','Replacement') and not exists (
        select 1 from d5o_hosted.connected_service_cost_entries r
        where r.workspace_id=e.workspace_id and r.kind='Reversal' and r.reverses_entry_id=e.entry_id);
  v_invoice:=public.d5o_hosted_service_invoice_read_v1(p_workspace_key,p_parent_presentation_id,p_request_id);
  return pg_catalog.jsonb_build_object(
    'revision',coalesce(v_state.revision,0),'workRevision',v_work_revision,
    'operateRevision',v_operate_revision,'requestCycleAt',v_basis->>'requestCycleAt',
    'childWorkId',v_basis->>'childWorkId','sourceDigest',pg_catalog.md5(v_basis::text),
    'reviewedHours',(v_basis->>'reviewedHours')::numeric,
    'approvedUncoveredMinor',case when (v_basis->>'uncoveredAmountMinor') ~ '^[0-9]+$'
      then (v_basis->>'uncoveredAmountMinor')::bigint else null end,
    'estimatedIncludedCostMinor',case when coalesce(v_estimated_cost,'') ~ '^[0-9]+$'
      then v_estimated_cost::bigint else null end,
    'entries',v_entries,'active',v_active,
    'totals',pg_catalog.jsonb_build_object(
      'coveredMinor',case when v_count=0 then null else coalesce(v_covered,0) end,
      'uncoveredMinor',case when v_count=0 then null else coalesce(v_uncovered,0) end,
      'unallocatedMinor',case when v_count=0 then null else coalesce(v_unallocated,0) end),
    'invoice',pg_catalog.jsonb_build_object('invoicedMinor',v_invoice->'invoicedMinor',
      'paidMinor',v_invoice->'paidMinor','outstandingMinor',v_invoice->'outstandingMinor'),
    'costCompleteness','Unverified');
end; $$;
revoke all on function public.d5o_hosted_service_cost_read_v1(text,text,text) from public,anon,service_role;
grant execute on function public.d5o_hosted_service_cost_read_v1(text,text,text) to authenticated;

create function public.d5o_hosted_service_cost_command_v1(
  p_workspace_key text,p_parent_presentation_id text,p_request_id text,
  p_action text,p_input jsonb,p_command_id text,p_expected_revision integer,
  p_expected_work_revision bigint,p_expected_operate_revision integer,
  p_expected_cycle text,p_expected_child_work_id text,p_expected_source_digest text
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
  v_member d5o_hosted.memberships%rowtype;v_parent d5o_hosted.work_records%rowtype;
  v_state d5o_hosted.connected_service_cost_states%rowtype;
  v_receipt d5o_hosted.connected_service_cost_receipts%rowtype;
  v_original d5o_hosted.connected_service_cost_entries%rowtype;
  v_basis jsonb;v_digest text;v_fingerprint text;v_result jsonb;
  v_work_revision bigint;v_operate_revision integer;
  v_amount bigint;v_child uuid;v_entry uuid;v_reversal uuid;
  v_category text:=coalesce(p_input->>'category','');
  v_allocation text:=coalesce(p_input->>'allocation','');
  v_source text:=trim(coalesce(p_input->>'source',''));
  v_rationale text:=trim(coalesce(p_input->>'rationale',''));
  v_date date;v_original_id uuid;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or p_action not in ('record-cost','correct-cost')
    or pg_catalog.jsonb_typeof(p_input)<>'object'
    or length(coalesce(p_command_id,'')) not between 8 and 120
    or p_expected_revision is null or p_expected_revision<0 then
    raise exception 'invalid_service_cost_command' using errcode='22023'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('d5o-connected:'||v_workspace.id::text,0));
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor and status='active' for share;
  if not found or v_member.role<>'billing_commercial_lead' then
    raise exception 'service_cost_finance_role_required' using errcode='42501'; end if;
  select w.* into v_parent from d5o_hosted.work_records w
    join d5o_hosted.work_identity_links l on l.workspace_id=w.workspace_id
      and l.work_id=w.id and l.parent_work_id is null
    where w.workspace_id=v_workspace.id and l.presentation_id=p_parent_presentation_id
    for update of w;
  if not found then raise exception 'canonical_parent_required' using errcode='23503'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(
    p_workspace_key,p_parent_presentation_id,p_request_id,p_action,p_input,
    p_expected_revision,p_expected_work_revision,p_expected_operate_revision,
    p_expected_cycle,p_expected_child_work_id,p_expected_source_digest)::text);
  select * into v_receipt from d5o_hosted.connected_service_cost_receipts
    where workspace_id=v_workspace.id and command_id=p_command_id;
  if found then
    if v_receipt.parent_work_id<>v_parent.id or v_receipt.actor_user_id<>v_actor
      or v_receipt.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_receipt.result;
  end if;
  select revision into v_work_revision from d5o_hosted.prototype_states
    where workspace_id=v_workspace.id and state_key='work' for share;
  select decision_revision into v_operate_revision from d5o_hosted.connected_operate_states
    where workspace_id=v_workspace.id and work_id=v_parent.id for share;
  perform 1 from d5o_hosted.connected_service_work s
    where s.workspace_id=v_workspace.id and s.parent_work_id=v_parent.id
      and s.request_id=p_request_id for share;
  perform 1 from d5o_hosted.connected_deploy_states d
    where d.workspace_id=v_workspace.id and d.work_id in
      (select s.work_id from d5o_hosted.connected_service_work s
       where s.workspace_id=v_workspace.id and s.parent_work_id=v_parent.id
         and s.request_id=p_request_id) for share;
  v_basis:=d5o_hosted.current_service_finance_basis_v1(
    v_workspace.id,v_parent.id,p_request_id);
  v_digest:=pg_catalog.md5(v_basis::text);
  if v_work_revision is distinct from p_expected_work_revision
    or v_operate_revision is distinct from p_expected_operate_revision
    or v_basis->>'requestCycleAt' is distinct from p_expected_cycle
    or v_basis->>'childWorkId' is distinct from p_expected_child_work_id
    or v_digest is distinct from p_expected_source_digest then
    raise exception 'stale_service_cost_source' using errcode='23505'; end if;
  if v_basis->>'eligibleForFinanceReview' is distinct from 'true'
    or v_basis->>'coverage' is distinct from 'Partially covered'
    or v_basis->>'currency' is distinct from 'USD'
    or coalesce(v_basis->>'childWorkId','') !~ '^[0-9a-f-]{36}$' then
    raise exception 'completed_service_cost_basis_required' using errcode='23514'; end if;
  v_child:=(v_basis->>'childWorkId')::uuid;
  select * into v_state from d5o_hosted.connected_service_cost_states
    where workspace_id=v_workspace.id and parent_work_id=v_parent.id
      and request_id=p_request_id for update;
  if coalesce(v_state.revision,0)<>p_expected_revision then
    raise exception 'stale_service_cost_revision' using errcode='23505'; end if;
  if v_state.revision is not null and (v_state.request_cycle_at<>p_expected_cycle
    or v_state.child_work_id<>v_child) then
    raise exception 'service_cost_cycle_changed' using errcode='23514'; end if;
  if coalesce(p_input->>'amountMinor','') !~ '^[1-9][0-9]{0,12}$'
    or p_input->>'currency' is distinct from 'USD'
    or v_category not in ('Labor','Material','Equipment','Subcontract','Travel','Other')
    or v_allocation not in ('Covered','Uncovered','Unallocated')
    or coalesce(p_input->>'incurredDate','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or length(v_source)<12 or length(v_source)>240
    or length(v_rationale)<12 or length(v_rationale)>1000 then
    raise exception 'invalid_service_cost_input' using errcode='22023'; end if;
  v_amount:=(p_input->>'amountMinor')::bigint;
  v_date:=(p_input->>'incurredDate')::date;
  if v_date>current_date+1 then
    raise exception 'service_cost_future_date' using errcode='23514'; end if;
  if exists(select 1 from d5o_hosted.connected_service_cost_entries e
      where e.workspace_id=v_workspace.id and e.parent_work_id=v_parent.id
        and e.request_id=p_request_id and e.kind in ('Original','Replacement')
        and lower(e.source_ref)=lower(v_source)) then
    raise exception 'service_cost_duplicate_source' using errcode='23505'; end if;
  if p_action='correct-cost' then
    if coalesce(p_input->>'originalId','') !~ '^[0-9a-f-]{36}$' then
      raise exception 'service_cost_original_required' using errcode='22023'; end if;
    v_original_id:=(p_input->>'originalId')::uuid;
    select * into v_original from d5o_hosted.connected_service_cost_entries
      where workspace_id=v_workspace.id and parent_work_id=v_parent.id
        and request_id=p_request_id and request_cycle_at=p_expected_cycle
        and child_work_id=v_child and entry_id=v_original_id
        and kind in ('Original','Replacement') for share;
    if not found or exists(select 1 from d5o_hosted.connected_service_cost_entries r
        where r.workspace_id=v_workspace.id and r.kind='Reversal'
          and r.reverses_entry_id=v_original_id) then
      raise exception 'current_service_cost_entry_required' using errcode='23514'; end if;
  elsif p_input->>'originalId' is not null then
    raise exception 'unexpected_service_cost_original' using errcode='22023';
  end if;
  if v_state.revision is null then
    insert into d5o_hosted.connected_service_cost_states(
      workspace_id,parent_work_id,request_id,request_cycle_at,child_work_id)
    values(v_workspace.id,v_parent.id,p_request_id,p_expected_cycle,v_child);
  end if;
  if p_action='correct-cost' then
    insert into d5o_hosted.connected_service_cost_entries(
      workspace_id,parent_work_id,request_id,request_cycle_at,child_work_id,
      kind,root_id,reverses_entry_id,amount_minor,currency,category,allocation,
      incurred_date,source_ref,rationale,source_basis,source_digest,recorded_by)
    values(v_workspace.id,v_parent.id,p_request_id,p_expected_cycle,v_child,
      'Reversal',coalesce(v_original.root_id,v_original.entry_id),v_original.entry_id,
      -v_original.amount_minor,'USD',v_original.category,v_original.allocation,
      v_original.incurred_date,v_original.source_ref,
      'Reversed by sourced correction: '||v_rationale,
      v_original.source_basis,v_original.source_digest,v_actor)
    returning entry_id into v_reversal;
  end if;
  insert into d5o_hosted.connected_service_cost_entries(
    workspace_id,parent_work_id,request_id,request_cycle_at,child_work_id,
    kind,root_id,amount_minor,currency,category,allocation,incurred_date,
    source_ref,rationale,source_basis,source_digest,recorded_by)
  values(v_workspace.id,v_parent.id,p_request_id,p_expected_cycle,v_child,
    case when p_action='correct-cost' then 'Replacement' else 'Original' end,
    case when p_action='correct-cost' then coalesce(v_original.root_id,v_original.entry_id) else null end,
    v_amount,'USD',v_category,v_allocation,v_date,
    v_source,v_rationale,v_basis,v_digest,v_actor)
  returning entry_id into v_entry;
  update d5o_hosted.connected_service_cost_states set revision=revision+1
    where workspace_id=v_workspace.id and parent_work_id=v_parent.id and request_id=p_request_id;
  v_result:=pg_catalog.jsonb_build_object('entryId',v_entry,'reversalId',v_reversal,
    'correctedEntryId',v_original_id,'revision',p_expected_revision+1,
    'requestCycleAt',p_expected_cycle,'childWorkId',v_child,
    'amountMinor',v_amount,'currency','USD','allocation',v_allocation);
  insert into d5o_hosted.connected_service_cost_events(
    workspace_id,parent_work_id,request_id,command_id,action,actor_user_id,
    membership_id,revision,snapshot)
  values(v_workspace.id,v_parent.id,p_request_id,p_command_id,p_action,v_actor,
    v_member.id,p_expected_revision+1,v_result||pg_catalog.jsonb_build_object(
      'source',v_source,'rationale',v_rationale,'sourceDigest',v_digest));
  insert into d5o_hosted.connected_service_cost_receipts(
    workspace_id,command_id,parent_work_id,actor_user_id,fingerprint,result)
  values(v_workspace.id,p_command_id,v_parent.id,v_actor,v_fingerprint,v_result);
  return v_result;
end; $$;
revoke all on function public.d5o_hosted_service_cost_command_v1(
  text,text,text,text,jsonb,text,integer,bigint,integer,text,text,text)
  from public,anon,service_role;
grant execute on function public.d5o_hosted_service_cost_command_v1(
  text,text,text,text,jsonb,text,integer,bigint,integer,text,text,text)
  to authenticated;

-- A second queue projection retains the existing invoice/payment action for
-- the same request. Cost follow-up never replaces receivable collection.
create function public.d5o_hosted_service_cost_actions_v1(p_workspace_key text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid();v_workspace uuid;v_role text;v_row record;
  v_request jsonb;v_basis jsonb;v_active_count integer;v_unallocated bigint;
  v_items jsonb:='[]'::jsonb;v_customer text;v_kind text;v_blocker text;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null then
    raise exception 'membership_required' using errcode='42501'; end if;
  select w.id,m.role into v_workspace,v_role from d5o_hosted.workspaces w
    join d5o_hosted.memberships m on m.workspace_id=w.id
      and m.actor_user_id=v_actor and m.status='active'
    where w.workspace_key=p_workspace_key and w.status='active';
  if v_workspace is null then raise exception 'queue_scope_denied' using errcode='42501'; end if;
  if v_role not in ('project_manager','billing_commercial_lead','operations_leader','admin','executive')
    then return v_items; end if;
  for v_row in select l.work_id,l.presentation_id,w.title,o.state
    from d5o_hosted.connected_operate_states o
    join d5o_hosted.work_identity_links l on l.workspace_id=o.workspace_id
      and l.work_id=o.work_id and l.parent_work_id is null
    join d5o_hosted.work_records w on w.workspace_id=o.workspace_id and w.id=o.work_id
    where o.workspace_id=v_workspace loop
    select item->>'customer' into v_customer from d5o_hosted.prototype_states p,
      lateral pg_catalog.jsonb_array_elements(coalesce(p.state_json->'records','[]'::jsonb)) item
      where p.workspace_id=v_workspace and p.state_key='work'
        and item->>'id'=v_row.presentation_id limit 1;
    for v_request in select item from pg_catalog.jsonb_array_elements(
      coalesce(v_row.state->'requests','[]'::jsonb)) item loop
      if v_request->>'coverage'<>'Partially covered' or v_request->>'status'<>'Closed' then continue; end if;
      v_basis:=d5o_hosted.current_service_finance_basis_v1(
        v_workspace,v_row.work_id,v_request->>'id');
      if v_basis->>'eligibleForFinanceReview'<>'true' then continue; end if;
      select count(*),coalesce(sum(e.amount_minor) filter (where e.allocation='Unallocated'),0)
        into v_active_count,v_unallocated
        from d5o_hosted.connected_service_cost_entries e
        where e.workspace_id=v_workspace and e.parent_work_id=v_row.work_id
          and e.request_id=v_request->>'id'
          and e.kind in ('Original','Replacement') and not exists (
            select 1 from d5o_hosted.connected_service_cost_entries r
            where r.workspace_id=e.workspace_id and r.kind='Reversal'
              and r.reverses_entry_id=e.entry_id);
      if v_active_count=0 then
        v_kind:='Service cost source';
        v_blocker:='No sourced actual cost has been recorded; Finance must establish the incurred-cost position.';
      elsif v_unallocated<>0 then
        v_kind:='Service cost allocation';
        v_blocker:='Recorded cost remains unallocated between covered and uncovered service scope.';
      else continue; end if;
      v_items:=v_items||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'kind',v_kind,'workId',v_row.presentation_id,'workTitle',v_row.title,
        'requestId',v_request->>'id','requestTitle',v_request->>'title',
        'customer',v_customer,'childWorkId',v_basis->>'childPresentationId',
        'requestCycleAt',v_basis->>'requestCycleAt','coverage','Partially covered',
        'requestStatus','Closed','revision',coalesce((select revision
          from d5o_hosted.connected_service_cost_states s
          where s.workspace_id=v_workspace and s.parent_work_id=v_row.work_id
            and s.request_id=v_request->>'id'),0),
        'status',case when v_active_count=0 then 'Cost unknown' else 'Allocation needed' end,
        'blocker',v_blocker,'responsibleRole','billing_commercial_lead',
        'actionable',v_role='billing_commercial_lead',
        'ownership',case when v_role='billing_commercial_lead'
          then 'Available to your role' else 'Waiting on another role' end,
        'dueDate',null,'panel','finance'));
    end loop;
  end loop;
  return v_items;
end; $$;
revoke all on function public.d5o_hosted_service_cost_actions_v1(text) from public,anon,service_role;
grant execute on function public.d5o_hosted_service_cost_actions_v1(text) to authenticated;
