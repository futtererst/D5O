-- A partial service request retains its coverage classification. Only the
-- uncovered, explicitly priced scope can proceed after an independent review
-- and a source-backed customer decision. This narrow contract supports one
-- sourced labor line from an active published tenant catalog; other methods
-- remain unavailable rather than accepting an unverified client calculation.
create or replace function public.d5o_hosted_service_pricing_command_v1(
  p_workspace_key text,p_parent_presentation_id text,p_request_id text,
  p_action text,p_input jsonb,p_command_id text,p_expected_work_revision bigint,
  p_expected_operate_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
  v_member d5o_hosted.memberships%rowtype;v_parent d5o_hosted.work_records%rowtype;
  v_raw d5o_hosted.prototype_states%rowtype;
  v_operate d5o_hosted.connected_operate_states%rowtype;
  v_receipt d5o_hosted.connected_operate_receipts%rowtype;
  v_request jsonb;v_policy jsonb;v_rate jsonb;v_line jsonb;v_input jsonb;
  v_estimate jsonb;v_eval jsonb;v_auth jsonb;v_state jsonb;v_result jsonb;
  v_cycle text;v_fingerprint text;v_now timestamptz:=now();
  v_qty numeric;v_cost numeric;v_direct bigint;v_overhead bigint;
  v_contingency bigint;v_included bigint;v_price bigint;v_base bigint;
  v_discount bigint;v_margin numeric;v_target numeric;v_floor numeric;
  v_discount_pct numeric;v_revision integer;v_reason text:=trim(coalesce(p_input->>'note',''));
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or p_action not in ('save-service-estimate','submit-service-pricing',
      'approve-service-pricing','return-service-pricing','record-service-authorization')
    or pg_catalog.jsonb_typeof(p_input)<>'object'
    or length(coalesce(p_command_id,'')) not between 8 and 120
    or p_expected_work_revision is null or p_expected_work_revision<1
    or p_expected_operate_revision is null or p_expected_operate_revision<1 then
    raise exception 'invalid_service_pricing_command' using errcode='22023'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('d5o-connected:'||v_workspace.id::text,0));
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor and status='active' for share;
  if not found then raise exception 'service_pricing_authority_required' using errcode='42501'; end if;
  select w.* into v_parent from d5o_hosted.work_records w
    join d5o_hosted.work_identity_links l on l.workspace_id=w.workspace_id
      and l.work_id=w.id and l.parent_work_id is null
    where w.workspace_id=v_workspace.id and l.presentation_id=p_parent_presentation_id
      for update of w;
  if not found then raise exception 'canonical_parent_required' using errcode='23503'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(
    p_workspace_key,p_parent_presentation_id,p_request_id,p_action,p_input,
    p_expected_work_revision,p_expected_operate_revision)::text);
  select * into v_receipt from d5o_hosted.connected_operate_receipts
    where workspace_id=v_workspace.id and command_id=p_command_id;
  if found then
    if v_receipt.work_id<>v_parent.id or v_receipt.actor_user_id<>v_actor
      or v_receipt.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_receipt.result; end if;
  select * into v_raw from d5o_hosted.prototype_states
    where workspace_id=v_workspace.id and state_key='work' for share;
  select * into v_operate from d5o_hosted.connected_operate_states
    where workspace_id=v_workspace.id and work_id=v_parent.id for update;
  if v_raw.revision is distinct from p_expected_work_revision
    or v_operate.decision_revision is distinct from p_expected_operate_revision then
    raise exception 'stale_service_pricing_basis' using errcode='23505'; end if;
  select item into v_request from pg_catalog.jsonb_array_elements(v_operate.state->'requests') item
    where item->>'id'=p_request_id;
  if v_request is null or v_request->>'status' not in ('Triaged','In progress')
    or v_request->>'coverage' not in ('Partially covered','Chargeable')
    or v_request->>'agreementId' is null then
    raise exception 'current_partial_request_required' using errcode='23514'; end if;
  v_cycle:=coalesce(v_request->>'reopenedAt',v_request->>'reportedAt');
  v_estimate:=v_request->'serviceEstimate';
  if p_action='save-service-estimate' then
    if v_member.role<>'project_manager' then
      raise exception 'service_estimator_required' using errcode='42501'; end if;
    v_input:=p_input->'pricingInput';
    if pg_catalog.jsonb_typeof(v_input->'lines')<>'array'
      or pg_catalog.jsonb_array_length(v_input->'lines')<>1
      or length(trim(coalesce(v_input->>'riskBasis','')))<10 then
      raise exception 'sourced_single_line_required' using errcode='23514'; end if;
    v_line:=v_input->'lines'->0;
    if v_line->>'category'<>'labor' or length(trim(coalesce(v_line->>'description','')))<8
      or length(trim(coalesce(v_line->>'source','')))<8
      or length(trim(coalesce(v_line->>'assumption','')))<8
      or v_line->>'rateId' is null or v_line->>'manualRate' is not null
      or v_line->>'scopeRef'<>p_request_id or v_line->>'unit'<>'hour'
      or v_line->'procurement' is not null then
      raise exception 'published_labor_rate_required' using errcode='23514'; end if;
    select p.payload into v_policy from d5o_hosted.connected_pricing_policies p
      join d5o_hosted.connected_pricing_active a on a.workspace_id=p.workspace_id
        and a.policy_id=p.policy_id and a.version=p.version
      where p.workspace_id=v_workspace.id and p.status='published';
    if v_policy is null or v_policy->>'method'<>'target-margin'
      or v_policy->>'currency' is distinct from v_input->>'currency'
      or (v_policy->>'effectiveFrom')::date>current_date then
      raise exception 'active_published_service_policy_required' using errcode='23514'; end if;
    select item into v_rate from pg_catalog.jsonb_array_elements(v_policy->'rates') item
      where item->>'id'=v_line->>'rateId' and item->>'category'='labor'
        and item->>'unit'='hour' and item#>>'{scope,kind}'='default'
        and (item->>'effectiveFrom')::date<=current_date
        and (item->>'effectiveTo' is null or (item->>'effectiveTo')::date>=current_date);
    if v_rate is null then raise exception 'effective_labor_rate_missing' using errcode='23514'; end if;
    begin
      v_qty:=(v_line->>'quantity')::numeric;
      v_cost:=(v_rate->>'amount')::numeric;
      v_target:=(v_policy->>'targetMarginPercent')::numeric;
      v_floor:=(v_policy->>'floorMarginPercent')::numeric;
      v_discount_pct:=(v_input->>'discountPercent')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'invalid_service_money_input' using errcode='22023'; end;
    if v_qty<=0 or v_qty>10000 or v_cost<=0 or v_cost>100000
      or v_target<0 or v_target>=100 or v_floor<0 or v_floor>=100
      or v_discount_pct<0 or v_discount_pct>(v_policy->>'maxDiscountPercent')::numeric then
      raise exception 'service_pricing_policy_limit' using errcode='23514'; end if;
    v_direct:=pg_catalog.round(v_qty*v_cost*100*
      (100+coalesce((v_rate->>'burdenPercent')::numeric,0))/100)::bigint;
    v_overhead:=pg_catalog.round(v_direct*(v_policy->>'overheadPercent')::numeric/100)::bigint;
    v_contingency:=pg_catalog.round(v_direct*(v_policy->>'contingencyPercent')::numeric/100)::bigint;
    v_included:=v_direct+v_overhead+v_contingency;
    v_base:=pg_catalog.ceil(v_included*100/(100-v_target))::bigint;
    v_discount:=pg_catalog.round(v_base*v_discount_pct/100)::bigint;
    v_price:=v_base-v_discount;
    v_margin:=(v_price-v_included)*100.0/v_price;
    if v_margin<v_floor then raise exception 'service_margin_below_floor' using errcode='23514'; end if;
    v_revision:=coalesce((v_estimate->>'revision')::integer,0)+1;
    v_input:=v_input||pg_catalog.jsonb_build_object('workType','Lifecycle service',
      'pricedAt',current_date,'definitionRevision',0,'solutionRevision',0);
    v_eval:=pg_catalog.jsonb_build_object('policyId',v_policy->>'id',
      'policyVersion',(v_policy->>'version')::integer,'currency',v_policy->>'currency',
      'input',v_input,'lines',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'id',v_line->>'id','category','labor','amountMinor',v_direct,
        'rateId',v_rate->>'id','rateSource',v_rate->>'source')),
      'directCostMinor',v_direct,'overheadMinor',v_overhead,
      'contingencyMinor',v_contingency,'includedCostMinor',v_included,
      'proposedPriceMinor',v_price,'discountMinor',v_discount,
      'grossProfitMinor',v_price-v_included,'marginPercent',v_margin,
      'annualRecurringMinor',0,'totalRecurringMinor',0,
      'minimumFloorPriceMinor',pg_catalog.ceil(v_included*100/(100-v_floor)),
      'minimumTargetPriceMinor',v_base,
      'absorbableCostMinor',v_price-pg_catalog.ceil(v_price*v_floor/100)-v_included,
      'issues','[]'::jsonb,'recommendation','Ready for pricing review',
      'calculatedAt',v_now);
    v_estimate:=pg_catalog.jsonb_build_object('revision',v_revision,
      'requestCycleAt',v_cycle,'status','Draft','input',v_input,
      'evaluation',v_eval,'policySnapshot',v_policy,'savedAt',v_now,
      'savedByActorId',v_actor,'history',coalesce(v_estimate->'history','[]'::jsonb)
        ||case when v_estimate is null then '[]'::jsonb else
          pg_catalog.jsonb_build_array(v_estimate) end);
    v_request:=v_request||pg_catalog.jsonb_build_object('serviceEstimate',v_estimate);
  elsif p_action='submit-service-pricing' then
    if v_member.role<>'project_manager' then
      raise exception 'service_estimator_required' using errcode='42501'; end if;
    if v_estimate->>'status'<>'Draft' or v_estimate->>'requestCycleAt'<>v_cycle
      or (v_estimate->>'revision')::integer is distinct from (p_input->>'estimateRevision')::integer then
      raise exception 'stale_service_estimate' using errcode='23505'; end if;
    v_estimate:=v_estimate||pg_catalog.jsonb_build_object('status','Pricing review',
      'submittedByActorId',v_actor,'submittedAt',v_now);
    v_request:=v_request||pg_catalog.jsonb_build_object('serviceEstimate',v_estimate);
  elsif p_action in ('approve-service-pricing','return-service-pricing') then
    if v_estimate->>'status'<>'Pricing review' or v_estimate->>'requestCycleAt'<>v_cycle
      or (v_estimate->>'revision')::integer is distinct from (p_input->>'estimateRevision')::integer then
      raise exception 'stale_service_pricing_review' using errcode='23505'; end if;
    if v_member.role<>v_estimate#>>'{policySnapshot,pricingApproverRole}'
      or v_actor::text=v_estimate->>'submittedByActorId' or length(v_reason)<10 then
      raise exception 'independent_pricing_review_required' using errcode='42501'; end if;
    v_estimate:=v_estimate||pg_catalog.jsonb_build_object('status',
      case when p_action='approve-service-pricing' then 'Approved' else 'Returned' end,
      'reviewedByActorId',v_actor,'reviewedAt',v_now,'reviewNote',v_reason);
    v_request:=v_request||pg_catalog.jsonb_build_object('serviceEstimate',v_estimate);
  else
    if v_member.role<>'operations_leader' or v_estimate->>'status'<>'Approved'
      or v_estimate->>'requestCycleAt'<>v_cycle
      or (v_estimate->>'revision')::integer is distinct from (p_input->>'estimateRevision')::integer
      or v_request#>>'{serviceAuthorization,estimateRevision}'=v_estimate->>'revision'
      or length(trim(coalesce(p_input->>'source','')))<10
      or length(trim(coalesce(p_input->>'customerParty','')))<3 or length(v_reason)<10 then
      raise exception 'exact_customer_service_authorization_required' using errcode='23514'; end if;
    v_auth:=pg_catalog.jsonb_build_object('estimateRevision',(v_estimate->>'revision')::integer,
      'amountMinor',v_estimate#>'{evaluation,proposedPriceMinor}',
      'currency',v_estimate#>>'{evaluation,currency}',
      'source',p_input->>'source','customerParty',p_input->>'customerParty',
      'recordedByActorId',v_actor,'recordedAt',v_now);
    v_request:=v_request||pg_catalog.jsonb_build_object('serviceAuthorization',v_auth,
      'serviceAuthorizationHistory',coalesce(v_request->'serviceAuthorizationHistory','[]'::jsonb));
  end if;
  v_request:=pg_catalog.jsonb_set(v_request,'{history}',
    coalesce(v_request->'history','[]'::jsonb)||pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('at',v_now,'action',p_action,
        'actorId',v_actor,'note',v_reason)));
  v_state:=pg_catalog.jsonb_set(v_operate.state,'{requests}',
    (select pg_catalog.jsonb_agg(case when item->>'id'=p_request_id then v_request
      else item end order by ordinal) from pg_catalog.jsonb_array_elements(v_operate.state->'requests')
      with ordinality as entries(item,ordinal)));
  v_state:=v_state||pg_catalog.jsonb_build_object('authorityRevision',
    v_operate.decision_revision+1,'events',coalesce(v_operate.state->'events','[]'::jsonb)
      ||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',gen_random_uuid(),
        'commandId',p_command_id,'fingerprint',v_fingerprint,'at',v_now,
        'actorId',v_actor,'membershipId',v_member.id,'action',p_action,
        'detail',p_request_id)));
  update d5o_hosted.connected_operate_states set decision_revision=decision_revision+1,
    state=v_state,updated_at=v_now where workspace_id=v_workspace.id and work_id=v_parent.id;
  insert into d5o_hosted.connected_operate_events(workspace_id,work_id,decision_revision,
    command_id,action,actor_user_id,membership_id,deploy_revision,snapshot)
  values(v_workspace.id,v_parent.id,v_operate.decision_revision+1,p_command_id,p_action,
    v_actor,v_member.id,coalesce((select decision_revision from d5o_hosted.connected_deploy_states
      where workspace_id=v_workspace.id and work_id=v_parent.id),0),v_state);
  v_result:=pg_catalog.jsonb_build_object('state',
    d5o_hosted.connected_operate_projection_v1(v_workspace.id,v_raw.state_json),
    'revision',v_raw.revision,'operateRevision',v_operate.decision_revision+1);
  insert into d5o_hosted.connected_operate_receipts(workspace_id,command_id,work_id,
    actor_user_id,fingerprint,result)
  values(v_workspace.id,p_command_id,v_parent.id,v_actor,v_fingerprint,v_result);
  return v_result;
end; $$;
revoke all on function public.d5o_hosted_service_pricing_command_v1(
  text,text,text,text,jsonb,text,bigint,integer) from public,anon,service_role;
grant execute on function public.d5o_hosted_service_pricing_command_v1(
  text,text,text,text,jsonb,text,bigint,integer) to authenticated;
