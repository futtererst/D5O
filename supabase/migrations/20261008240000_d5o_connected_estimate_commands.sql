-- The connected pilot's estimate is calculated and reviewed at the database
-- boundary. The browser submits inputs, never an evaluated or approved state.
create table d5o_hosted.connected_estimate_states (
  workspace_id uuid not null,work_id uuid not null,
  estimate_revision integer not null check(estimate_revision>0),
  decision_revision integer not null check(decision_revision>0),
  solution_digest text not null,definition_revision integer not null,
  status text not null check(status in ('Draft','Pricing review','Approved','Changes requested')),
  estimate jsonb not null check(pg_catalog.jsonb_typeof(estimate)='object'),
  submitter uuid references auth.users(id),reviewer uuid references auth.users(id),
  next_action text not null,updated_at timestamptz not null default now(),
  primary key(workspace_id,work_id),
  foreign key(work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id)
);
create table d5o_hosted.connected_estimate_events (
  workspace_id uuid not null,work_id uuid not null,
  decision_revision integer not null,command_id text not null,
  action text not null,estimate_revision integer not null,
  actor_user_id uuid not null references auth.users(id),
  membership_id uuid not null references d5o_hosted.memberships(id),
  solution_digest text not null,configuration_version_id uuid not null,
  policy_id text not null,policy_version integer not null,
  snapshot jsonb not null,reason text not null,occurred_at timestamptz not null default now(),
  primary key(workspace_id,work_id,decision_revision),unique(workspace_id,command_id),
  foreign key(work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id)
);
create table d5o_hosted.connected_estimate_receipts (
  workspace_id uuid not null,command_id text not null,work_id uuid not null,
  actor_user_id uuid not null references auth.users(id),
  fingerprint text not null,result jsonb not null,
  primary key(workspace_id,command_id),
  foreign key(work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id)
);
alter table d5o_hosted.connected_estimate_states enable row level security;
alter table d5o_hosted.connected_estimate_events enable row level security;
alter table d5o_hosted.connected_estimate_receipts enable row level security;
revoke all on d5o_hosted.connected_estimate_states,d5o_hosted.connected_estimate_events,
  d5o_hosted.connected_estimate_receipts from public,anon,authenticated;

create function d5o_hosted.connected_estimate_projection_v1(p_workspace uuid,p_state jsonb)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when p_state is null then null else
    pg_catalog.jsonb_set(projected,'{records}',coalesce((
      select pg_catalog.jsonb_agg(case when e.work_id is null then item else
        pg_catalog.jsonb_set(item,'{discovery,estimate}',e.estimate,true)||
          pg_catalog.jsonb_build_object('nextAction',e.next_action) end order by ordinal)
      from pg_catalog.jsonb_array_elements(coalesce(projected->'records','[]'::jsonb))
        with ordinality as records(item,ordinal)
      left join d5o_hosted.work_identity_links l on l.workspace_id=p_workspace
        and l.presentation_id=item->>'id'
      left join d5o_hosted.connected_estimate_states e on e.workspace_id=p_workspace
        and e.work_id=l.work_id
    ),'[]'::jsonb)) end
  from (select d5o_hosted.connected_pricing_projection_v1(p_workspace,p_state)
    as projected) source;
$$;
revoke all on function d5o_hosted.connected_estimate_projection_v1(uuid,jsonb)
  from public,anon,authenticated,service_role;
create or replace function d5o_hosted.connected_define_projection_v1(p_workspace uuid,p_state jsonb)
returns jsonb language sql stable security definer set search_path='' as $$
  select d5o_hosted.connected_estimate_projection_v1(p_workspace,p_state);
$$;
revoke all on function d5o_hosted.connected_define_projection_v1(uuid,jsonb)
  from public,anon,authenticated,service_role;

create function public.d5o_hosted_estimate_command_v1(
  p_workspace_key text,p_presentation_id text,p_action text,p_input jsonb,
  p_due_date text,p_reason text,p_command_id text,p_expected_source_revision bigint,
  p_expected_decision_revision integer,p_estimate_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
  v_member d5o_hosted.memberships%rowtype;v_work d5o_hosted.work_records%rowtype;
  v_state d5o_hosted.prototype_states%rowtype;
  v_solution d5o_hosted.connected_solution_states%rowtype;
  v_define d5o_hosted.connected_define_states%rowtype;
  v_control d5o_hosted.connected_estimate_states%rowtype;
  v_receipt d5o_hosted.connected_estimate_receipts%rowtype;
  v_raw jsonb;v_policy jsonb;v_rate jsonb;v_line jsonb;v_lines jsonb:='[]'::jsonb;
  v_snapshot jsonb;v_evaluation jsonb;v_review jsonb;v_issues jsonb:='[]'::jsonb;
  v_fingerprint text;v_result jsonb;v_now timestamptz:=now();v_next text;
  v_digits integer;v_factor numeric;v_qty numeric;v_unit_cost numeric;
  v_burden numeric;v_line_minor numeric;v_direct numeric:=0;
  v_overhead numeric;v_contingency numeric;v_included numeric;
  v_price numeric;v_discount numeric;v_profit numeric;v_margin numeric;
  v_annual numeric:=0;v_recurring numeric:=0;v_floor numeric;
  v_target numeric;v_discount_pct numeric;v_method text;
  v_rate_rank integer;v_rate_count integer;v_scope_rank integer;
  v_policy_id text;v_policy_version integer;v_category text;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or p_action not in ('save-detailed-estimate','submit-pricing',
      'approve-pricing','return-pricing')
    or p_command_id is null or length(p_command_id) not between 8 and 120
    or p_expected_source_revision is null or p_expected_source_revision<1
    or p_expected_decision_revision is null or p_expected_decision_revision<0
    or p_estimate_revision is null or p_estimate_revision<1
    or length(coalesce(p_reason,''))>2000 then
    raise exception 'invalid_estimate_command' using errcode='22023'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor and status='active'
    for share;
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  select w.* into v_work from d5o_hosted.work_records w
    join d5o_hosted.work_identity_links l on l.work_id=w.id and l.workspace_id=w.workspace_id
    where w.workspace_id=v_workspace.id and l.presentation_id=p_presentation_id
    for update of w;
  if not found then raise exception 'connected_work_unavailable' using errcode='42501'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_workspace_key,
    p_presentation_id,p_action,p_input,p_due_date,trim(coalesce(p_reason,'')),
    p_expected_source_revision,p_expected_decision_revision,p_estimate_revision)::text);
  select * into v_receipt from d5o_hosted.connected_estimate_receipts
    where workspace_id=v_workspace.id and command_id=p_command_id;
  if found then
    if v_receipt.work_id<>v_work.id or v_receipt.actor_user_id<>v_actor
      or v_receipt.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_receipt.result;
  end if;
  select * into v_state from d5o_hosted.prototype_states
    where workspace_id=v_workspace.id and state_key='work' for share;
  select * into v_control from d5o_hosted.connected_estimate_states
    where workspace_id=v_workspace.id and work_id=v_work.id for update;
  if v_state.revision is distinct from p_expected_source_revision
    or coalesce(v_control.decision_revision,0)<>p_expected_decision_revision then
    raise exception 'stale_state' using errcode='23505'; end if;
  select item into v_raw from pg_catalog.jsonb_array_elements(v_state.state_json->'records') item
    where item->>'id'=p_presentation_id and item->>'canonicalWorkId'=v_work.id::text;
  if v_raw is null or v_raw->>'phaseConfigurationVersionId' is distinct from
    v_work.configuration_version_id::text then
    raise exception 'source_identity_changed' using errcode='42501'; end if;
  select * into v_define from d5o_hosted.connected_define_states
    where workspace_id=v_workspace.id and work_id=v_work.id for share;
  select * into v_solution from d5o_hosted.connected_solution_states
    where workspace_id=v_workspace.id and work_id=v_work.id for share;
  if v_define.status is distinct from 'Approved'
    or v_define.projection#>>'{developHandoff,status}'<>'accepted'
    or v_solution.status is distinct from 'Approved'
    or v_solution.source_digest is distinct from
      d5o_hosted.connected_solution_digest_v1(v_raw->'develop') then
    raise exception 'approved_solution_basis_required' using errcode='23514'; end if;
  select p.payload into v_policy from d5o_hosted.connected_pricing_active a
    join d5o_hosted.connected_pricing_policies p on p.workspace_id=a.workspace_id
      and p.policy_id=a.policy_id and p.version=a.version
    where a.workspace_id=v_workspace.id and p.status='published'
      and (p.payload->>'effectiveFrom')::date<=v_now::date
      and (p.payload->>'effectiveTo' is null or
        (p.payload->>'effectiveTo')::date>=v_now::date);
  if v_policy is null then raise exception 'pricing_policy_unavailable' using errcode='23514'; end if;
  v_policy_id:=v_policy->>'id';v_policy_version:=(v_policy->>'version')::integer;
  if v_solution.review->>'policyId' is distinct from v_policy_id
    or (v_solution.review->>'policyVersion')::integer is distinct from v_policy_version then
    raise exception 'solution_policy_changed' using errcode='23514'; end if;
  if p_action='save-detailed-estimate' then
    if v_member.role not in ('admin','project_manager','operations_leader')
      or p_input is null or pg_catalog.jsonb_typeof(p_input)<>'object'
      or p_estimate_revision<>coalesce(v_control.estimate_revision,0)+1
      or v_control.status='Pricing review'
      or pg_catalog.jsonb_typeof(p_input->'lines')<>'array'
      or pg_catalog.jsonb_array_length(p_input->'lines') not between 1 and 100
      or p_input->>'currency' is distinct from v_policy->>'currency'
      or p_input->>'workType' is distinct from v_raw->>'type'
      or p_input->>'customer' is distinct from v_raw->>'customer'
      or p_input->>'definitionRevision' is distinct from
        v_define.definition_revision::text
      or p_input->>'solutionRevision' is distinct from
        v_solution.solution_revision::text
      or coalesce(p_input->>'pricedAt','') !~ '^\d{4}-\d{2}-\d{2}$'
      or p_input->>'pricedAt' < v_policy->>'effectiveFrom'
      or (v_policy->>'effectiveTo' is not null and
        p_input->>'pricedAt'>v_policy->>'effectiveTo')
      or coalesce(p_input->>'riskBasis','')=''
      or coalesce(p_input->>'estimateMaturity','') not in ('ROM','Budgetary','Firm') then
      raise exception 'invalid_estimate_basis' using errcode='23514'; end if;
    v_digits:=case when p_input->>'currency'='JPY' then 0 else 2 end;
    v_factor:=power(10,v_digits);
    v_method:=coalesce(p_input->>'method',v_policy->>'method');
    if v_method is distinct from v_policy->>'method'
      or v_method not in ('target-margin','markup','fixed-price')
      or coalesce(p_input->>'discountPercent','') !~ '^[0-9]+(\.[0-9]+)?$'
      or (p_input->>'discountPercent')::numeric>
        (v_policy->>'maxDiscountPercent')::numeric then
      raise exception 'invalid_estimate_pricing_method' using errcode='23514'; end if;
    v_discount_pct:=(p_input->>'discountPercent')::numeric;
    for v_line in select value from pg_catalog.jsonb_array_elements(p_input->'lines') loop
      v_category:=v_line->>'category';
      if coalesce(v_category,'') not in ('labor','material','equipment','subcontract',
        'travel','mobilization','setup','recurring','other')
        or length(trim(coalesce(v_line->>'id','')))=0
        or length(trim(coalesce(v_line->>'scopeRef','')))=0
        or length(trim(coalesce(v_line->>'description','')))=0
        or length(trim(coalesce(v_line->>'source','')))=0
        or length(trim(coalesce(v_line->>'assumption','')))=0
        or length(trim(coalesce(v_line->>'unit','')))=0
        or coalesce(v_line->>'quantity','') !~ '^[0-9]+(\.[0-9]{1,3})?$'
        or (v_line->>'quantity')::numeric<=0
        or v_line ? 'procurement' then
        raise exception 'invalid_or_unassessed_estimate_line' using errcode='23514'; end if;
      v_qty:=(v_line->>'quantity')::numeric;
      v_rate:=null;v_rate_count:=0;
      if length(coalesce(v_line->>'rateId',''))>0 then
        select value into v_rate from pg_catalog.jsonb_array_elements(v_policy->'rates') value
          where value->>'id'=v_line->>'rateId'
            and value->>'category'=v_category and value->>'unit'=v_line->>'unit'
            and value->>'effectiveFrom'<=p_input->>'pricedAt'
            and (value->>'effectiveTo' is null or value->>'effectiveTo'>=p_input->>'pricedAt')
            and (value#>>'{scope,kind}'='default' or
              value#>>'{scope,value}'=case value#>>'{scope,kind}'
                when 'customer' then p_input->>'customer'
                when 'workType' then p_input->>'workType'
                when 'region' then p_input->>'region' end)
          order by case value#>>'{scope,kind}' when 'customer' then 0
            when 'workType' then 1 when 'region' then 2 else 3 end
          limit 1;
        if v_rate is null then raise exception 'estimate_rate_missing' using errcode='23514'; end if;
        v_scope_rank:=case v_rate#>>'{scope,kind}' when 'customer' then 0
          when 'workType' then 1 when 'region' then 2 else 3 end;
        select count(*) into v_rate_count from pg_catalog.jsonb_array_elements(v_policy->'rates') value
          where value->>'id'=v_line->>'rateId' and value->>'category'=v_category
            and value->>'unit'=v_line->>'unit'
            and value->>'effectiveFrom'<=p_input->>'pricedAt'
            and (value->>'effectiveTo' is null or value->>'effectiveTo'>=p_input->>'pricedAt')
            and case value#>>'{scope,kind}' when 'customer' then 0
              when 'workType' then 1 when 'region' then 2 else 3 end=v_scope_rank
            and (value#>>'{scope,kind}'='default' or
              value#>>'{scope,value}'=case value#>>'{scope,kind}'
                when 'customer' then p_input->>'customer'
                when 'workType' then p_input->>'workType'
                when 'region' then p_input->>'region' end);
        if v_rate_count<>1 then raise exception 'estimate_rate_ambiguous' using errcode='23514'; end if;
        v_unit_cost:=(v_rate->>'amount')::numeric;
      else
        if coalesce(v_line->>'manualRate','') !~ (case when v_digits=0 then
          '^[0-9]+$' else '^[0-9]+(\.[0-9]{1,2})?$' end) then
          raise exception 'estimate_cost_missing' using errcode='23514'; end if;
        v_unit_cost:=(v_line->>'manualRate')::numeric;
      end if;
      if v_line->>'validUntil' is not null and
        (v_line->>'validUntil'<p_input->>'pricedAt' or
          (p_input->>'expectedAwardDate' is not null and
            v_line->>'validUntil'<p_input->>'expectedAwardDate')) then
        raise exception 'estimate_quote_expired' using errcode='23514'; end if;
      v_burden:=case when v_category='labor' then
        coalesce((v_rate->>'burdenPercent')::numeric,0) else 0 end;
      if v_burden<0 or v_burden>=100 then
        raise exception 'invalid_labor_burden' using errcode='23514'; end if;
      v_line_minor:=round(v_qty*v_unit_cost*v_factor*(1+v_burden/100));
      if v_category='recurring' then
        if coalesce(v_line->>'recurringMonths','') !~ '^[0-9]+$'
          or (v_line->>'recurringMonths')::integer not between 1 and 600 then
          raise exception 'invalid_recurring_period' using errcode='23514'; end if;
        v_annual:=v_annual+v_line_minor*least((v_line->>'recurringMonths')::integer,12);
        v_line_minor:=v_line_minor*(v_line->>'recurringMonths')::integer;
        v_recurring:=v_recurring+v_line_minor;
      end if;
      v_direct:=v_direct+v_line_minor;
      v_lines:=v_lines||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'id',v_line->>'id','category',v_category,'amountMinor',v_line_minor,
        'rateId',v_rate->>'id','rateSource',coalesce(v_rate->>'source',v_line->>'source')));
    end loop;
    if v_direct>9000000000000 then
      raise exception 'estimate_overflow' using errcode='22003'; end if;
    v_overhead:=round(v_direct*(v_policy->>'overheadPercent')::numeric/100);
    v_contingency:=round(v_direct*(v_policy->>'contingencyPercent')::numeric/100);
    v_included:=v_direct+v_overhead+v_contingency;
    v_target:=(v_policy->>'targetMarginPercent')::numeric;
    v_floor:=(v_policy->>'floorMarginPercent')::numeric;
    v_price:=case v_method
      when 'target-margin' then ceil(v_included*100/(100-v_target))
      when 'markup' then round(v_included*(100+(v_policy->>'markupPercent')::numeric)/100)
      else (coalesce(p_input->>'fixedPrice',v_policy->>'fixedPrice'))::numeric*v_factor end;
    if v_price is null or v_price<=0 then
      raise exception 'estimate_price_missing' using errcode='23514'; end if;
    v_discount:=round(v_price*v_discount_pct/100);
    v_price:=v_price-v_discount;
    v_profit:=v_price-v_included;v_margin:=round(v_profit*100/v_price,6);
    if v_margin<v_floor then
      v_issues:=pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'code','below_floor','message','Price falls below the policy margin floor',
        'action','Revise price or seek the configured exception'));
    end if;
    v_evaluation:=pg_catalog.jsonb_build_object(
      'policyId',v_policy_id,'policyVersion',v_policy_version,
      'currency',p_input->>'currency','input',p_input,'lines',v_lines,
      'directCostMinor',v_direct,'overheadMinor',v_overhead,
      'contingencyMinor',v_contingency,'includedCostMinor',v_included,
      'proposedPriceMinor',v_price,'discountMinor',v_discount,
      'grossProfitMinor',v_profit,'marginPercent',v_margin,
      'annualRecurringMinor',v_annual,'totalRecurringMinor',v_recurring,
      'minimumFloorPriceMinor',ceil(v_included*100/(100-v_floor)),
      'minimumTargetPriceMinor',ceil(v_included*100/(100-v_target)),
      'absorbableCostMinor',v_price-ceil(v_price*v_floor/100)-v_included,
      'issues',v_issues,'recommendation',case when v_margin<v_floor then
        'Escalate for margin decision' else 'Ready for pricing review' end,
      'calculatedAt',v_now);
    v_snapshot:=pg_catalog.jsonb_build_object('revision',p_estimate_revision,
      'status','Draft','labor',coalesce((select sum((x->>'amountMinor')::numeric)
        from pg_catalog.jsonb_array_elements(v_lines) x where x->>'category'='labor'),0)/v_factor,
      'materials',coalesce((select sum((x->>'amountMinor')::numeric)
        from pg_catalog.jsonb_array_elements(v_lines) x where x->>'category' in
          ('material','equipment')),0)/v_factor,
      'subcontract',coalesce((select sum((x->>'amountMinor')::numeric)
        from pg_catalog.jsonb_array_elements(v_lines) x where x->>'category'='subcontract'),0)/v_factor,
      'travel',coalesce((select sum((x->>'amountMinor')::numeric)
        from pg_catalog.jsonb_array_elements(v_lines) x where x->>'category' in
          ('travel','mobilization','setup','recurring','other')),0)/v_factor,
      'contingency',(v_overhead+v_contingency)/v_factor,
      'targetMargin',v_target,'sellPrice',v_price/v_factor,
      'assumption',p_input->>'riskBasis',
      'definitionSource',pg_catalog.jsonb_build_object(
        'revision',v_define.definition_revision,
        'configurationVersionId',v_work.configuration_version_id,
        'workTypeKey',v_define.projection->>'configurationWorkTypeKey',
        'capturedAt',v_now),
      'detailed',pg_catalog.jsonb_build_object('input',p_input,
        'evaluation',v_evaluation,'policySnapshot',v_policy,'savedAt',v_now),
      'revisionHistory',case when v_control.work_id is null then '[]'::jsonb
        else coalesce(v_control.estimate->'revisionHistory','[]'::jsonb)||
          pg_catalog.jsonb_build_array(v_control.estimate) end,
      'authorityRevision',coalesce(v_control.decision_revision,0)+1);
    v_next:=case when v_margin<v_floor then 'Resolve estimate margin floor'
      else 'Submit detailed estimate for pricing review' end;
    if v_control.work_id is null then
      insert into d5o_hosted.connected_estimate_states(workspace_id,work_id,
        estimate_revision,decision_revision,solution_digest,definition_revision,
        status,estimate,next_action)
      values(v_workspace.id,v_work.id,p_estimate_revision,1,
        v_solution.source_digest,v_define.definition_revision,'Draft',
        v_snapshot,v_next);
    else
      update d5o_hosted.connected_estimate_states set
        estimate_revision=p_estimate_revision,decision_revision=decision_revision+1,
        solution_digest=v_solution.source_digest,
        definition_revision=v_define.definition_revision,status='Draft',
        estimate=v_snapshot,submitter=null,reviewer=null,next_action=v_next,
        updated_at=v_now where workspace_id=v_workspace.id and work_id=v_work.id;
    end if;
  else
    if p_input is not null or v_control.work_id is null
      or v_control.estimate_revision<>p_estimate_revision
      or v_control.solution_digest<>v_solution.source_digest
      or v_control.definition_revision<>v_define.definition_revision
      or v_control.estimate#>>'{detailed,evaluation,policyId}'<>v_policy_id
      or (v_control.estimate#>>'{detailed,evaluation,policyVersion}')::integer<>
        v_policy_version then
      raise exception 'estimate_basis_changed' using errcode='23514'; end if;
    if p_action='submit-pricing' then
      if v_member.role not in ('admin','project_manager','operations_leader')
        or v_control.status<>'Draft' or p_due_date is null
        or p_due_date !~ '^\d{4}-\d{2}-\d{2}$'
        or pg_catalog.jsonb_array_length(
          v_control.estimate#>'{detailed,evaluation,issues}')>0 then
        raise exception 'estimate_submit_denied' using errcode='42501'; end if;
      v_review:=pg_catalog.jsonb_build_object('revision',p_estimate_revision,
        'submittedAt',v_now,'submittedBy',v_raw->>'owner',
        'submittedByActorId',v_actor,
        'submittedByMembershipId',v_member.id,'dueDate',p_due_date,
        'authorityRole',v_policy->>'pricingApproverRole',
        'policyId',v_policy_id,'policyVersion',v_policy_version);
      v_snapshot:=v_control.estimate||pg_catalog.jsonb_build_object(
        'status','Pricing review','review',v_review,
        'authorityRevision',v_control.decision_revision+1);
      v_next:='Review estimate revision '||p_estimate_revision::text;
      update d5o_hosted.connected_estimate_states set
        decision_revision=decision_revision+1,status='Pricing review',
        estimate=v_snapshot,submitter=v_actor,reviewer=null,next_action=v_next,
        updated_at=v_now where workspace_id=v_workspace.id and work_id=v_work.id;
    else
      if v_control.status<>'Pricing review' or v_actor=v_control.submitter
        or v_member.role<>v_control.estimate#>>'{review,authorityRole}'
        or length(trim(coalesce(p_reason,'')))<10 then
        raise exception 'independent_pricing_review_required' using errcode='42501'; end if;
      v_review:=v_control.estimate->'review'||pg_catalog.jsonb_build_object(
        'decidedAt',v_now,'decisionNote',trim(p_reason),
        'actorId',v_actor,'membershipId',v_member.id);
      v_snapshot:=v_control.estimate||pg_catalog.jsonb_build_object(
        'status',case when p_action='approve-pricing' then 'Approved'
          else 'Changes requested' end,'review',v_review,
        'authorityRevision',v_control.decision_revision+1);
      v_next:=case when p_action='approve-pricing' then
        'Prepare customer proposal' else 'Revise estimate and resubmit' end;
      update d5o_hosted.connected_estimate_states set
        decision_revision=decision_revision+1,
        status=case when p_action='approve-pricing' then 'Approved'
          else 'Changes requested' end,
        estimate=v_snapshot,reviewer=v_actor,next_action=v_next,updated_at=v_now
        where workspace_id=v_workspace.id and work_id=v_work.id;
    end if;
  end if;
  select * into v_control from d5o_hosted.connected_estimate_states
    where workspace_id=v_workspace.id and work_id=v_work.id;
  insert into d5o_hosted.connected_estimate_events(workspace_id,work_id,
    decision_revision,command_id,action,estimate_revision,actor_user_id,
    membership_id,solution_digest,configuration_version_id,policy_id,
    policy_version,snapshot,reason)
  values(v_workspace.id,v_work.id,v_control.decision_revision,p_command_id,p_action,
    p_estimate_revision,v_actor,v_member.id,v_solution.source_digest,
    v_work.configuration_version_id,v_policy_id,v_policy_version,
    v_control.estimate,trim(coalesce(p_reason,'')));
  v_result:=public.d5o_hosted_prototype_read_v1(p_workspace_key,'work');
  insert into d5o_hosted.connected_estimate_receipts(workspace_id,command_id,
    work_id,actor_user_id,fingerprint,result)
  values(v_workspace.id,p_command_id,v_work.id,v_actor,v_fingerprint,v_result);
  return v_result;
end; $$;
revoke all on function public.d5o_hosted_estimate_command_v1(
  text,text,text,jsonb,text,text,text,bigint,integer,integer)
  from public,anon,service_role;
grant execute on function public.d5o_hosted_estimate_command_v1(
  text,text,text,jsonb,text,text,text,bigint,integer,integer)
  to authenticated;

create function d5o_hosted.connected_estimate_draft_rebase_v1(
  p_workspace uuid,p_raw jsonb,p_submitted jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_new jsonb;v_old jsonb;v_expected jsonb;v_records jsonb:='[]'::jsonb;
begin
  for v_new in select value from pg_catalog.jsonb_array_elements(p_submitted->'records') loop
    select value into v_old from pg_catalog.jsonb_array_elements(p_raw->'records')
      where value->>'id'=v_new->>'id';
    if exists(select 1 from d5o_hosted.work_identity_links l
      join d5o_hosted.connected_estimate_states e on e.workspace_id=l.workspace_id
        and e.work_id=l.work_id
      where l.workspace_id=p_workspace and l.presentation_id=v_new->>'id') then
      select value into v_expected from pg_catalog.jsonb_array_elements(
        d5o_hosted.connected_define_projection_v1(p_workspace,p_raw)->'records')
        where value->>'id'=v_new->>'id';
      if v_new#>'{discovery,estimate}' is distinct from
        v_expected#>'{discovery,estimate}' then
        raise exception 'typed_estimate_command_required' using errcode='42501'; end if;
      v_new:=pg_catalog.jsonb_set(v_new,'{discovery,estimate}',
        v_old#>'{discovery,estimate}',true);
    end if;
    v_records:=v_records||pg_catalog.jsonb_build_array(v_new);
  end loop;
  return pg_catalog.jsonb_set(p_submitted,'{records}',v_records);
end; $$;
revoke all on function d5o_hosted.connected_estimate_draft_rebase_v1(uuid,jsonb,jsonb)
  from public,anon,authenticated,service_role;

create or replace function public.d5o_hosted_prototype_save_v1(
  p_workspace_key text,p_state_key text,p_expected_revision bigint,p_state jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_workspace uuid;v_membership d5o_hosted.memberships%rowtype;
  v_prior d5o_hosted.prototype_states%rowtype;v_state jsonb;v_input jsonb;
  v_projection jsonb;v_revision bigint;v_field text;
begin
  if auth.uid() is null or p_state_key is distinct from 'work'
    or p_expected_revision is null or p_expected_revision<1 or p_state is null
    or pg_catalog.jsonb_typeof(p_state)<>'object'
    or p_state->>'workspace' is distinct from p_workspace_key
    or p_state->>'schemaVersion' is distinct from '1'
    or pg_catalog.octet_length(p_state::text)>2000000 then
    raise exception 'invalid_prototype_state' using errcode='22023'; end if;
  select m.* into v_membership from d5o_hosted.workspaces w
    join d5o_hosted.memberships m on m.workspace_id=w.id
    where w.workspace_key=p_workspace_key and w.status='active'
      and m.actor_user_id=auth.uid() and m.status='active';
  v_workspace:=v_membership.workspace_id;
  if v_workspace is null or v_membership.role not in
    ('admin','operations_leader','project_manager','field_supervisor') then
    raise exception 'prototype_write_forbidden' using errcode='42501'; end if;
  select * into v_prior from d5o_hosted.prototype_states
    where workspace_id=v_workspace and state_key='work' for update;
  if not found or v_prior.revision<>p_expected_revision then
    raise exception 'stale_prototype_state' using errcode='23505'; end if;
  v_projection:=d5o_hosted.connected_define_projection_v1(v_workspace,v_prior.state_json);
  v_input:=p_state;
  foreach v_field in array array['pricingPolicies','activePricingPolicy','pricingPolicyHistory'] loop
    if p_state->v_field is distinct from v_projection->v_field then
      raise exception 'typed_policy_command_required' using errcode='42501'; end if;
    v_input:=v_input-v_field;
    if v_prior.state_json ? v_field then
      v_input:=v_input||pg_catalog.jsonb_build_object(v_field,v_prior.state_json->v_field);
    end if;
  end loop;
  v_state:=d5o_hosted.connected_draft_snapshot_v1(v_workspace,v_prior.state_json,
    d5o_hosted.connected_solution_draft_rebase_v1(v_workspace,v_prior.state_json,
      d5o_hosted.connected_estimate_draft_rebase_v1(
        v_workspace,v_prior.state_json,v_input)),v_prior.revision+1);
  update d5o_hosted.prototype_states set revision=revision+1,state_json=v_state,
    updated_by=auth.uid(),updated_at=now()
    where workspace_id=v_workspace and state_key='work'
    returning revision into v_revision;
  insert into d5o_hosted.prototype_state_revisions(
    workspace_id,state_key,revision,state_json,actor_user_id,membership_id)
  values(v_workspace,'work',v_revision,v_state,auth.uid(),v_membership.id);
  return pg_catalog.jsonb_build_object('revision',v_revision,'state',
    d5o_hosted.connected_define_projection_v1(v_workspace,v_state));
end; $$;
revoke all on function public.d5o_hosted_prototype_save_v1(text,text,bigint,jsonb)
  from public,anon;
grant execute on function public.d5o_hosted_prototype_save_v1(text,text,bigint,jsonb)
  to authenticated,service_role;
