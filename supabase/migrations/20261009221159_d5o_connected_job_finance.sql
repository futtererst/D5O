-- Source-backed USD fixed-price job ledger. Money is stored in integer minor units.
-- Finance facts and approvals are typed commands, not Work snapshot fields.
create table d5o_hosted.connected_job_finance_states (
  workspace_id uuid not null,work_id uuid not null,
  revision integer not null default 0 check(revision>=0),
  currency text not null check(currency='USD'),
  remaining_forecast_minor bigint check(remaining_forecast_minor>=0),
  forecast_source text,forecast_at date,
  primary key(workspace_id,work_id),
  foreign key(work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id)
);
create table d5o_hosted.connected_job_costs (
  id uuid primary key default pg_catalog.gen_random_uuid(),workspace_id uuid not null,
  work_id uuid not null,package_id text,kind text not null check(kind in ('Committed','Incurred')),
  category text not null check(category in ('Labor','Material','Equipment','Subcontract')),
  amount_minor bigint not null check(amount_minor>0 and amount_minor<=1000000000000),
  cost_date date not null,source text not null check(length(trim(source))>=8),
  reconciles_id uuid references d5o_hosted.connected_job_costs(id),
  recorded_by uuid not null references auth.users(id),recorded_at timestamptz not null default now(),
  foreign key(work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id)
);
create table d5o_hosted.connected_job_bills (
  id uuid primary key default pg_catalog.gen_random_uuid(),workspace_id uuid not null,
  work_id uuid not null,revision integer not null default 1,
  status text not null check(status in ('Draft','In review','Reviewed','Returned')),
  lines jsonb not null check(pg_catalog.jsonb_typeof(lines)='array'),
  prepared_by uuid not null references auth.users(id),reviewed_by uuid references auth.users(id),
  review_reason text,created_at timestamptz not null default now(),
  foreign key(work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id)
);
create table d5o_hosted.connected_job_cash_events (
  id uuid primary key default pg_catalog.gen_random_uuid(),workspace_id uuid not null,
  work_id uuid not null,bill_id uuid not null references d5o_hosted.connected_job_bills(id),
  kind text not null check(kind in ('Billed','Paid')),
  amount_minor bigint not null check(amount_minor>0),event_date date not null,
  source text not null check(length(trim(source))>=8),
  recorded_by uuid not null references auth.users(id),recorded_at timestamptz not null default now(),
  foreign key(work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id)
);
create table d5o_hosted.connected_job_finance_receipts (
  workspace_id uuid not null,command_id text not null,
  actor_user_id uuid not null references auth.users(id),fingerprint text not null,
  result jsonb not null,primary key(workspace_id,command_id)
);
create table d5o_hosted.connected_job_finance_events (
  workspace_id uuid not null,work_id uuid not null,revision integer not null,
  command_id text not null,actor_user_id uuid not null references auth.users(id),
  membership_id uuid not null references d5o_hosted.memberships(id),
  action text not null,result jsonb not null,occurred_at timestamptz not null default now(),
  primary key(workspace_id,work_id,revision),unique(workspace_id,command_id)
);
alter table d5o_hosted.connected_job_finance_states enable row level security;
alter table d5o_hosted.connected_job_costs enable row level security;
alter table d5o_hosted.connected_job_bills enable row level security;
alter table d5o_hosted.connected_job_cash_events enable row level security;
alter table d5o_hosted.connected_job_finance_receipts enable row level security;
alter table d5o_hosted.connected_job_finance_events enable row level security;
revoke all on d5o_hosted.connected_job_finance_states,d5o_hosted.connected_job_costs,
  d5o_hosted.connected_job_bills,d5o_hosted.connected_job_cash_events,
  d5o_hosted.connected_job_finance_receipts,d5o_hosted.connected_job_finance_events
  from public,anon,authenticated,service_role;

create function d5o_hosted.job_finance_award_v1(p_workspace uuid,p_work uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select e.snapshot->'package'||pg_catalog.jsonb_build_object(
    'awardEventId',e.command_id,'awardAt',e.occurred_at)
  from d5o_hosted.connected_offer_events e
  where e.workspace_id=p_workspace and e.work_id=p_work
    and e.action='record-customer-response'
    and e.snapshot->'responseEvents'->-1->>'status'='Awarded'
  order by e.occurred_at,e.decision_revision limit 1;
$$;
revoke all on function d5o_hosted.job_finance_award_v1(uuid,uuid)
  from public,anon,authenticated,service_role;

create function public.d5o_hosted_job_finance_read_v1(p_workspace_key text,p_presentation_id text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace uuid;v_member d5o_hosted.memberships%rowtype;
  v_work uuid;v_award jsonb;v_state d5o_hosted.connected_job_finance_states%rowtype;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null then
    raise exception 'membership_required' using errcode='42501'; end if;
  select id into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace and actor_user_id=v_actor and status='active';
  select work_id into v_work from d5o_hosted.work_identity_links
    where workspace_id=v_workspace and presentation_id=p_presentation_id;
  if v_member.id is null or v_member.role='field_worker' or v_work is null then
    raise exception 'job_finance_scope_denied' using errcode='42501'; end if;
  select * into v_state from d5o_hosted.connected_job_finance_states
    where workspace_id=v_workspace and work_id=v_work;
  v_award:=d5o_hosted.job_finance_award_v1(v_workspace,v_work);
  return pg_catalog.jsonb_build_object('revision',coalesce(v_state.revision,0),
    'currency',coalesce(v_state.currency,v_award#>>'{pricingBasis,currency}'),
    'baseline',v_award,'remainingForecastMinor',v_state.remaining_forecast_minor,
    'forecastSource',v_state.forecast_source,'forecastAt',v_state.forecast_at,
    'changes',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',c.id,'packageId',c.package_id,'revision',c.revision,
      'priceAmount',c.facts#>>'{proposal,priceAmount}',
      'currency',c.facts#>>'{proposal,currency}',
      'customerAuthorization',c.facts->'customerAuthorization',
      'revisedReleaseId',c.facts->>'revisedReleaseId') order by c.updated_at)
      from d5o_hosted.connected_field_changes c where c.workspace_id=v_workspace
        and c.work_id=v_work and c.status='Resolved' and c.kind='Scope change'
        and c.facts ? 'customerAuthorization' and c.facts ? 'revisedReleaseId'),'[]'::jsonb),
    'costs',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.recorded_at)
      from d5o_hosted.connected_job_costs x where x.workspace_id=v_workspace
        and x.work_id=v_work),'[]'::jsonb),
    'bills',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(b) order by b.created_at)
      from d5o_hosted.connected_job_bills b where b.workspace_id=v_workspace
        and b.work_id=v_work),'[]'::jsonb),
    'cashEvents',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(c) order by c.recorded_at)
      from d5o_hosted.connected_job_cash_events c where c.workspace_id=v_workspace
        and c.work_id=v_work),'[]'::jsonb));
end; $$;
revoke all on function public.d5o_hosted_job_finance_read_v1(text,text) from public,anon,service_role;
grant execute on function public.d5o_hosted_job_finance_read_v1(text,text) to authenticated;

create function public.d5o_hosted_job_finance_command_v1(
  p_workspace_key text,p_presentation_id text,p_action text,p_input jsonb,
  p_command_id text,p_expected_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace uuid;v_member d5o_hosted.memberships%rowtype;
  v_work d5o_hosted.work_records%rowtype;v_state d5o_hosted.connected_job_finance_states%rowtype;
  v_receipt d5o_hosted.connected_job_finance_receipts%rowtype;
  v_award jsonb;v_cost d5o_hosted.connected_job_costs%rowtype;
  v_bill d5o_hosted.connected_job_bills%rowtype;
  v_deploy d5o_hosted.connected_deploy_states%rowtype;
  v_design d5o_hosted.connected_design_states%rowtype;
  v_line jsonb;v_release jsonb;v_completion jsonb;v_fingerprint text;v_result jsonb;
  v_quantity numeric;v_existing_quantity numeric;v_allocated bigint;v_contract bigint;
  v_amount bigint;v_total bigint;v_date date;v_id uuid;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or p_action not in ('add-cost','set-remaining','draft-bill','submit-bill',
      'review-bill','record-billed','record-paid')
    or pg_catalog.jsonb_typeof(p_input)<>'object'
    or length(coalesce(p_command_id,'')) not between 8 and 120
    or p_expected_revision is null or p_expected_revision<0 then
    raise exception 'invalid_job_finance_command' using errcode='22023'; end if;
  select id into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace and actor_user_id=v_actor and status='active' for share;
  select w.* into v_work from d5o_hosted.work_records w
    join d5o_hosted.work_identity_links l on l.workspace_id=w.workspace_id and l.work_id=w.id
    where w.workspace_id=v_workspace and l.presentation_id=p_presentation_id for update of w;
  if v_member.id is null or v_work.id is null or v_member.role not in
    ('billing_commercial_lead','project_manager') then
    raise exception 'job_finance_role_denied' using errcode='42501'; end if;
  if exists(select 1 from d5o_hosted.connected_operate_states o
    where o.workspace_id=v_workspace and o.work_id=v_work.id
      and o.state#>>'{finance,status}'='Closed') then
    raise exception 'finance_closed_requires_reopen' using errcode='23514'; end if;
  v_award:=d5o_hosted.job_finance_award_v1(v_workspace,v_work.id);
  if v_award is null or v_award#>>'{pricingBasis,currency}'<>'USD'
    or (v_award#>>'{pricingBasis,priceMinor}')::bigint<=0 then
    raise exception 'approved_usd_fixed_price_award_required' using errcode='23514'; end if;
  insert into d5o_hosted.connected_job_finance_states(workspace_id,work_id,currency)
    values(v_workspace,v_work.id,'USD') on conflict do nothing;
  select * into v_state from d5o_hosted.connected_job_finance_states
    where workspace_id=v_workspace and work_id=v_work.id for update;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_workspace_key,
    p_presentation_id,p_action,p_input,p_expected_revision)::text);
  select * into v_receipt from d5o_hosted.connected_job_finance_receipts
    where workspace_id=v_workspace and command_id=p_command_id;
  if found then
    if v_receipt.actor_user_id<>v_actor or v_receipt.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_receipt.result; end if;
  if v_state.revision<>p_expected_revision then
    raise exception 'stale_job_finance' using errcode='23505'; end if;
  if p_action='add-cost' then
    if v_member.role<>'billing_commercial_lead' or
      p_input->>'category' not in ('Labor','Material','Equipment','Subcontract')
      or p_input->>'kind' not in ('Committed','Incurred')
      or coalesce(p_input->>'amountMinor','')!~'^\d+$'
      or length(trim(coalesce(p_input->>'source','')))<8
      or coalesce(p_input->>'costDate','')!~'^\d{4}-\d{2}-\d{2}$' then
      raise exception 'sourced_cost_required' using errcode='22023'; end if;
    v_amount:=(p_input->>'amountMinor')::bigint;v_date:=(p_input->>'costDate')::date;
    if v_amount<=0 or v_amount>1000000000000 then
      raise exception 'cost_amount_invalid' using errcode='22023'; end if;
    if nullif(p_input->>'packageId','') is not null and not exists(select 1 from
      d5o_hosted.connected_package_states p where p.workspace_id=v_workspace
      and p.work_id=v_work.id and p.package_id=p_input->>'packageId') then
      raise exception 'cost_package_scope_invalid' using errcode='23514'; end if;
    if nullif(p_input->>'reconcilesId','') is not null then
      select * into v_cost from d5o_hosted.connected_job_costs
        where workspace_id=v_workspace and work_id=v_work.id
          and id=(p_input->>'reconcilesId')::uuid for update;
      if v_cost.id is null or v_cost.kind<>'Committed'
        or p_input->>'kind'<>'Incurred' or v_cost.category<>p_input->>'category'
        or v_cost.package_id is distinct from nullif(p_input->>'packageId','') then
        raise exception 'commitment_reconciliation_invalid' using errcode='23514'; end if;
      select coalesce(sum(amount_minor),0) into v_total from d5o_hosted.connected_job_costs
        where reconciles_id=v_cost.id;
      if v_total+v_amount>v_cost.amount_minor then
        raise exception 'commitment_over_reconciled' using errcode='23514'; end if;
    end if;
    insert into d5o_hosted.connected_job_costs(workspace_id,work_id,package_id,
      kind,category,amount_minor,cost_date,source,reconciles_id,recorded_by)
    values(v_workspace,v_work.id,nullif(p_input->>'packageId',''),p_input->>'kind',
      p_input->>'category',v_amount,v_date,trim(p_input->>'source'),v_cost.id,v_actor)
    returning id into v_id;
  elsif p_action='set-remaining' then
    if v_member.role<>'billing_commercial_lead'
      or coalesce(p_input->>'amountMinor','')!~'^\d+$'
      or length(trim(coalesce(p_input->>'source','')))<8
      or coalesce(p_input->>'forecastAt','')!~'^\d{4}-\d{2}-\d{2}$' then
      raise exception 'remaining_forecast_source_required' using errcode='22023'; end if;
    v_amount:=(p_input->>'amountMinor')::bigint;
    if v_amount>1000000000000 then raise exception 'forecast_amount_invalid' using errcode='22023'; end if;
    update d5o_hosted.connected_job_finance_states set
      remaining_forecast_minor=v_amount,forecast_source=trim(p_input->>'source'),
      forecast_at=(p_input->>'forecastAt')::date
      where workspace_id=v_workspace and work_id=v_work.id;
  elsif p_action='draft-bill' then
    if p_input->>'lines' is null or pg_catalog.jsonb_typeof(p_input->'lines')<>'array'
      or pg_catalog.jsonb_array_length(p_input->'lines')=0
      or pg_catalog.jsonb_array_length(p_input->'lines')>20 then
      raise exception 'billing_lines_required' using errcode='22023'; end if;
    select * into v_deploy from d5o_hosted.connected_deploy_states
      where workspace_id=v_workspace and work_id=v_work.id for share;
    select * into v_design from d5o_hosted.connected_design_states
      where workspace_id=v_workspace and work_id=v_work.id for share;
    for v_line in select value from pg_catalog.jsonb_array_elements(p_input->'lines') loop
      if coalesce(v_line->>'amountMinor','')!~'^\d+$'
        or (v_line->>'amountMinor')::bigint<=0 or length(coalesce(v_line->>'description',''))<5
        or coalesce(v_line->>'evidenceId','')='' then
        raise exception 'billing_line_invalid' using errcode='22023'; end if;
      select r into v_release from pg_catalog.jsonb_array_elements(
        coalesce(v_design.state->'releases','[]'::jsonb)) r
        where r->>'packageId'=v_line->>'packageId' order by r->>'issuedAt' desc limit 1;
      select c into v_completion from pg_catalog.jsonb_array_elements(
        coalesce(v_deploy.state->'completions','[]'::jsonb)) c
        where c->>'packageId'=v_line->>'packageId' and c->>'releaseId'=v_release->>'id';
      if v_release is null or v_release->>'status'<>'Accepted'
        or not exists(select 1 from pg_catalog.jsonb_array_elements(
          coalesce(v_deploy.state->'turnovers','[]'::jsonb)) t
          where t->>'status'='Client accepted' and t->'releaseIds' ? (v_release->>'id'))
        or v_completion is null
        or not exists(select 1 from pg_catalog.jsonb_array_elements(
          coalesce(v_deploy.state->'evidence','[]'::jsonb)) e
          where e->>'id'=v_line->>'evidenceId' and e->>'packageId'=v_line->>'packageId'
            and e->>'state'='Reviewed') then
        raise exception 'accepted_billing_scope_and_evidence_required' using errcode='23514'; end if;
      if coalesce(v_line->>'quantity','')!~'^\d+(\.\d{1,3})?$'
        or coalesce(v_line->>'unit','')='' then
        raise exception 'billing_quantity_required' using errcode='22023'; end if;
      v_quantity:=(v_line->>'quantity')::numeric;
      if v_quantity<=0 or v_quantity>1000000 then
        raise exception 'billing_quantity_invalid' using errcode='22023'; end if;
      select coalesce(sum((line->>'quantity')::numeric),0) into v_existing_quantity
        from d5o_hosted.connected_job_bills b,
          lateral pg_catalog.jsonb_array_elements(b.lines) line
        where b.workspace_id=v_workspace and b.work_id=v_work.id
          and b.status<>'Returned' and line->>'packageId'=v_line->>'packageId';
      if v_release#>>'{snapshot,completionBasis,kind}'='Measured' then
        if v_line->>'unit' is distinct from v_completion->>'unit'
          or v_existing_quantity+v_quantity>(v_completion->>'reviewedQuantity')::numeric then
          raise exception 'billing_exceeds_accepted_quantity' using errcode='23514'; end if;
      elsif v_quantity<>1 or v_existing_quantity+v_quantity>1 then
        raise exception 'billing_exceeds_accepted_scope' using errcode='23514'; end if;
    end loop;
    v_contract:=(v_award#>>'{pricingBasis,priceMinor}')::bigint;
    select v_contract+coalesce(sum(((c.facts#>>'{proposal,priceAmount}')::numeric*100)::bigint),0)
      into v_contract from d5o_hosted.connected_field_changes c
      where c.workspace_id=v_workspace and c.work_id=v_work.id
        and c.status='Resolved' and c.kind='Scope change'
        and c.facts ? 'customerAuthorization' and c.facts ? 'revisedReleaseId'
        and c.facts#>>'{proposal,currency}'='USD';
    select coalesce(sum((line->>'amountMinor')::bigint),0) into v_allocated
      from d5o_hosted.connected_job_bills b,
        lateral pg_catalog.jsonb_array_elements(b.lines) line
      where b.workspace_id=v_workspace and b.work_id=v_work.id and b.status<>'Returned';
    select v_allocated+coalesce(sum((line->>'amountMinor')::bigint),0) into v_allocated
      from pg_catalog.jsonb_array_elements(p_input->'lines') line;
    if v_allocated>v_contract then
      raise exception 'billing_exceeds_authorized_contract' using errcode='23514'; end if;
    insert into d5o_hosted.connected_job_bills(workspace_id,work_id,status,lines,prepared_by)
      values(v_workspace,v_work.id,'Draft',p_input->'lines',v_actor) returning id into v_id;
  elsif p_action in ('submit-bill','review-bill') then
    select * into v_bill from d5o_hosted.connected_job_bills
      where id=(p_input->>'billId')::uuid and workspace_id=v_workspace and work_id=v_work.id for update;
    if v_bill.id is null then raise exception 'billing_record_missing' using errcode='23503'; end if;
    if p_action='submit-bill' then
      if v_bill.status not in ('Draft','Returned') or v_bill.prepared_by<>v_actor then
        raise exception 'billing_submit_denied' using errcode='42501'; end if;
      update d5o_hosted.connected_job_bills set status='In review',revision=revision+1 where id=v_bill.id;
    else
      if v_member.role<>'billing_commercial_lead' or v_bill.status<>'In review'
        or v_bill.prepared_by=v_actor or p_input->>'decision' not in ('Reviewed','Returned')
        or length(trim(coalesce(p_input->>'reason','')))<10 then
        raise exception 'independent_billing_review_required' using errcode='42501'; end if;
      update d5o_hosted.connected_job_bills set status=p_input->>'decision',
        revision=revision+1,reviewed_by=v_actor,review_reason=p_input->>'reason' where id=v_bill.id;
    end if;
    v_id:=v_bill.id;
  else
    if v_member.role<>'billing_commercial_lead' or
      coalesce(p_input->>'amountMinor','')!~'^\d+$'
      or coalesce(p_input->>'eventDate','')!~'^\d{4}-\d{2}-\d{2}$'
      or length(trim(coalesce(p_input->>'source','')))<8 then
      raise exception 'cash_source_required' using errcode='22023'; end if;
    v_amount:=(p_input->>'amountMinor')::bigint;
    select * into v_bill from d5o_hosted.connected_job_bills
      where id=(p_input->>'billId')::uuid and workspace_id=v_workspace and work_id=v_work.id for update;
    if v_bill.id is null or v_bill.status<>'Reviewed' or v_amount<=0 then
      raise exception 'reviewed_bill_required' using errcode='23514'; end if;
    select coalesce(sum((line->>'amountMinor')::bigint),0) into v_total
      from pg_catalog.jsonb_array_elements(v_bill.lines) line;
    if p_action='record-billed' then
      if exists(select 1 from d5o_hosted.connected_job_cash_events
        where bill_id=v_bill.id and kind='Billed') or v_amount<>v_total then
        raise exception 'bill_amount_mismatch' using errcode='23514'; end if;
    else
      select coalesce(sum(amount_minor),0) into v_total from d5o_hosted.connected_job_cash_events
        where bill_id=v_bill.id and kind='Billed';
      if v_total=0 or v_amount+coalesce((select sum(amount_minor) from
        d5o_hosted.connected_job_cash_events where bill_id=v_bill.id and kind='Paid'),0)>v_total then
        raise exception 'payment_exceeds_billed' using errcode='23514'; end if;
    end if;
    insert into d5o_hosted.connected_job_cash_events(workspace_id,work_id,bill_id,
      kind,amount_minor,event_date,source,recorded_by)
    values(v_workspace,v_work.id,v_bill.id,case when p_action='record-billed' then 'Billed' else 'Paid' end,
      v_amount,(p_input->>'eventDate')::date,p_input->>'source',v_actor) returning id into v_id;
  end if;
  update d5o_hosted.connected_job_finance_states set revision=revision+1
    where workspace_id=v_workspace and work_id=v_work.id;
  v_result:=pg_catalog.jsonb_build_object('id',v_id,'revision',v_state.revision+1,'action',p_action);
  insert into d5o_hosted.connected_job_finance_events(workspace_id,work_id,revision,
    command_id,actor_user_id,membership_id,action,result)
    values(v_workspace,v_work.id,v_state.revision+1,p_command_id,v_actor,v_member.id,p_action,v_result);
  insert into d5o_hosted.connected_job_finance_receipts(workspace_id,command_id,
    actor_user_id,fingerprint,result) values(v_workspace,p_command_id,v_actor,v_fingerprint,v_result);
  return v_result;
end; $$;
revoke all on function public.d5o_hosted_job_finance_command_v1(text,text,text,jsonb,text,integer)
  from public,anon,service_role;
grant execute on function public.d5o_hosted_job_finance_command_v1(text,text,text,jsonb,text,integer)
  to authenticated;

-- A new Finance Closed decision must have a sourced and reconciled job position.
-- Historical Closed events are not rewritten; unrelated Operate writes remain possible.
create function d5o_hosted.guard_job_finance_closeout_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_ledger d5o_hosted.connected_job_finance_states%rowtype;
  v_commit bigint;v_billed bigint;v_contract bigint;v_award jsonb;
begin
  if new.state#>>'{finance,status}'='Closed' and
    (tg_op='INSERT' or old.state#>>'{finance,status}' is distinct from 'Closed') then
    select * into v_ledger from d5o_hosted.connected_job_finance_states
      where workspace_id=new.workspace_id and work_id=new.work_id;
    if v_ledger.work_id is null or v_ledger.remaining_forecast_minor is null
      or v_ledger.remaining_forecast_minor<>0 then
      raise exception 'finance_remaining_cost_unresolved' using errcode='23514'; end if;
    v_award:=d5o_hosted.job_finance_award_v1(new.workspace_id,new.work_id);
    if v_award is null then raise exception 'finance_award_missing' using errcode='23514'; end if;
    v_contract:=(v_award#>>'{pricingBasis,priceMinor}')::bigint;
    select v_contract+coalesce(sum(((c.facts#>>'{proposal,priceAmount}')::numeric*100)::bigint),0)
      into v_contract from d5o_hosted.connected_field_changes c
      where c.workspace_id=new.workspace_id and c.work_id=new.work_id
        and c.status='Resolved' and c.kind='Scope change'
        and c.facts ? 'customerAuthorization' and c.facts ? 'revisedReleaseId'
        and c.facts#>>'{proposal,currency}'=v_ledger.currency;
    select coalesce(sum(greatest(0,c.amount_minor-coalesce((select sum(i.amount_minor)
      from d5o_hosted.connected_job_costs i where i.reconciles_id=c.id),0))),0)
      into v_commit from d5o_hosted.connected_job_costs c
      where c.workspace_id=new.workspace_id and c.work_id=new.work_id and c.kind='Committed';
    select coalesce(sum(amount_minor),0) into v_billed
      from d5o_hosted.connected_job_cash_events
      where workspace_id=new.workspace_id and work_id=new.work_id and kind='Billed';
    if v_commit<>0 or v_billed<v_contract
      or not exists(select 1 from d5o_hosted.connected_job_costs
        where workspace_id=new.workspace_id and work_id=new.work_id and kind='Incurred') then
      raise exception 'finance_cost_or_billing_gap' using errcode='23514'; end if;
  end if;
  return new;
end; $$;
revoke all on function d5o_hosted.guard_job_finance_closeout_v1() from public,anon,authenticated,service_role;
create trigger guard_job_finance_closeout before insert or update on d5o_hosted.connected_operate_states
  for each row execute function d5o_hosted.guard_job_finance_closeout_v1();

-- One authenticated, exact-revision queue for independent Design, field-change,
-- and Finance decisions. Presentation labels never establish eligibility.
create function public.d5o_hosted_role_actions_v1(p_workspace_key text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace uuid;v_member d5o_hosted.memberships%rowtype;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null then
    raise exception 'membership_required' using errcode='42501'; end if;
  select id into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace and actor_user_id=v_actor and status='active';
  if v_member.id is null then raise exception 'queue_scope_denied' using errcode='42501'; end if;
  return coalesce((select pg_catalog.jsonb_agg(a.item order by a.sort_at desc)
    from (
      select c.updated_at as sort_at,pg_catalog.jsonb_build_object(
        'kind','Field change','workId',l.presentation_id,'packageId',c.package_id,
        'revision',c.revision,'status',c.status,'title',c.title,
        'dueDate',c.due_date,'phase',case when c.status in ('Proposed','Internal review') then 'Develop' else 'Deploy' end,
        'ownership','Available to your role') as item
      from d5o_hosted.connected_field_changes c
      join d5o_hosted.work_identity_links l on l.workspace_id=c.workspace_id and l.work_id=c.work_id
      where c.workspace_id=v_workspace and c.status<>'Resolved'
        and (c.status='Open' and c.kind is null and
              v_member.role in ('field_supervisor','operations_leader','project_manager') and c.created_by<>v_actor
          or c.status='Query' and v_member.role in ('admin','project_manager')
          or c.status in ('Proposed','Returned') and v_member.role in ('project_manager','billing_commercial_lead')
          or c.status='Internal review' and v_member.role in ('billing_commercial_lead','admin')
            and c.facts->>'submittedBy' is distinct from v_actor::text
          or c.status='Internally approved' and v_member.role in ('project_manager','operations_leader')
          or c.status='Customer authorized' and v_member.role in ('project_manager','operations_leader')
            and c.created_by<>v_actor)
      union all
      select b.created_at,pg_catalog.jsonb_build_object(
        'kind','Billing review','workId',l.presentation_id,'packageId',null,
        'revision',b.revision,'status',b.status,'title','Review billing record '||b.id::text,
        'dueDate',null,'phase','Operate','ownership','Available to your role')
      from d5o_hosted.connected_job_bills b
      join d5o_hosted.work_identity_links l on l.workspace_id=b.workspace_id and l.work_id=b.work_id
      where b.workspace_id=v_workspace and b.status='In review'
        and v_member.role='billing_commercial_lead' and b.prepared_by<>v_actor
      union all
      select (r->>'receivedAt')::timestamptz,pg_catalog.jsonb_build_object(
        'kind','Field report review','workId',l.presentation_id,'packageId',r->>'packageId',
        'revision',(r->>'revision')::integer,'status','Submitted',
        'title','Review field report '||left(r->>'id',8),'dueDate',null,
        'phase','Deploy','ownership','Available to your role')
      from d5o_hosted.connected_deploy_states d
      join d5o_hosted.work_identity_links l on l.workspace_id=d.workspace_id and l.work_id=d.work_id
      cross join lateral pg_catalog.jsonb_array_elements(coalesce(d.state->'reports','[]'::jsonb)) r
      where d.workspace_id=v_workspace and v_member.role in ('field_supervisor','operations_leader')
        and r->>'status'='Submitted' and r->>'authorId' is distinct from v_actor::text
      union all
      select (r->>'requestedAt')::timestamptz,pg_catalog.jsonb_build_object(
        'kind','Design review','workId',l.presentation_id,'packageId',r->>'packageId',
        'revision',(r->>'revision')::integer,'status','Requested',
        'title',(r->>'discipline')||' package review','dueDate',r->>'dueDate',
        'phase','Design','ownership','Available to your role')
      from d5o_hosted.connected_design_states d
      join d5o_hosted.work_identity_links l on l.workspace_id=d.workspace_id and l.work_id=d.work_id
      cross join lateral pg_catalog.jsonb_array_elements(coalesce(d.state->'reviews','[]'::jsonb)) r
      where d.workspace_id=v_workspace and v_member.role='operations_leader'
        and r->>'status'='Requested' and r->>'requestedByActorId' is distinct from v_actor::text
    ) a),'[]'::jsonb);
end; $$;
revoke all on function public.d5o_hosted_role_actions_v1(text) from public,anon,service_role;
grant execute on function public.d5o_hosted_role_actions_v1(text) to authenticated;
