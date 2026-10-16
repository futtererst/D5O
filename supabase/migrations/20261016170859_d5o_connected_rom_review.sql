-- Review of a new ROM estimate is tied to the current approved Define scope,
-- sourced quantity schedule and a reproducible scenario basis. Existing
-- Budgetary/Firm and historical approved estimates are not rewritten.
create function d5o_hosted.validate_connected_rom_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_define d5o_hosted.connected_define_states%rowtype;
  v_input jsonb;v_basis jsonb;v_coverage jsonb;v_lines jsonb;v_item jsonb;
  v_obligation jsonb;v_obligations jsonb:='[]'::jsonb;v_row jsonb;
  v_scenario jsonb;v_line jsonb;v_eval_line jsonb;v_policy jsonb;
  v_units numeric;v_base_hours numeric;v_quantity numeric;
  v_direct numeric;v_base_amount numeric;v_new_amount numeric;
  v_overhead numeric;v_contingency numeric;v_target numeric;v_discount numeric;
  v_scenarios jsonb:='{}'::jsonb;v_label text;v_hours numeric;
  v_count integer;v_revision integer;
begin
  if new.status not in ('Pricing review','Approved')
    or new.estimate#>>'{detailed,input,estimateMaturity}' is distinct from 'ROM' then
    return new; end if;
  v_input:=new.estimate#>'{detailed,input}';
  v_basis:=v_input->'romBasis';v_coverage:=v_basis->'coverage';v_lines:=v_input->'lines';
  if pg_catalog.jsonb_typeof(v_coverage)<>'array' or
    pg_catalog.jsonb_typeof(v_lines)<>'array' then
    raise exception 'rom_coverage_required' using errcode='23514'; end if;
  if exists(select 1 from (select value->>'id' as id
      from pg_catalog.jsonb_array_elements(v_lines) value) lines
    group by id having count(*)>1 or nullif(id,'') is null) then
    raise exception 'rom_duplicate_cost_line' using errcode='23514'; end if;
  if length(trim(coalesce(v_basis#>>'{communication,scope}','')))=0 or
    length(trim(coalesce(v_basis#>>'{communication,assumptions}','')))=0 or
    length(trim(coalesce(v_basis#>>'{communication,informationNeeded}','')))=0 or
    length(trim(coalesce(v_basis#>>'{communication,designValidation}','')))=0 or
    coalesce(v_basis#>>'{communication,reviewDate}','') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'rom_communication_basis_missing' using errcode='23514'; end if;
  select * into v_define from d5o_hosted.connected_define_states
    where workspace_id=new.workspace_id and work_id=new.work_id;
  if v_define.status is distinct from 'Approved' or
    v_define.projection#>>'{developHandoff,status}' is distinct from 'accepted' or
    v_define.definition_revision<>new.definition_revision then
    raise exception 'rom_define_source_changed' using errcode='23514'; end if;
  v_revision:=v_define.definition_revision;
  for v_item in select value from pg_catalog.jsonb_array_elements(
    coalesce(v_define.projection#>'{scopeControl,requirements}','[]'::jsonb)) loop
    v_obligations:=v_obligations||pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('id',v_item->>'id',
        'confirmed',v_item->>'state'='Confirmed',
        'customerOwner',coalesce(v_item->>'owner','')~*'customer'));
  end loop;
  v_count:=0;
  for v_item in select value from pg_catalog.jsonb_array_elements(
    coalesce(v_define.projection#>'{registers,acceptance_criteria}','[]'::jsonb))
    loop
    v_count:=v_count+1;
    -- The UI uses a stable fallback identity for older criteria without IDs.
    v_obligations:=v_obligations||pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('id',coalesce(nullif(v_item->>'id',''),
        'acceptance-'||v_count::text),
        'confirmed',true,'customerOwner',false));
  end loop;
  for v_item in select value from pg_catalog.jsonb_array_elements(
    coalesce(v_define.projection#>'{scopeControl,interfaces}','[]'::jsonb)) loop
    v_obligations:=v_obligations||pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('id',v_item->>'id',
        'confirmed',coalesce(v_item->>'agreement','')<>'',
        'customerOwner',coalesce(v_item->>'counterparty','')~*'customer'));
  end loop;
  for v_label in select unnest(array['milestones','dependencies']) loop
    v_count:=0;
    for v_item in select value from pg_catalog.jsonb_array_elements(
      coalesce(v_define.projection->'registers'->v_label,'[]'::jsonb)) loop
      v_count:=v_count+1;
      v_obligations:=v_obligations||pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('id',coalesce(nullif(v_item->>'id',''),
          v_label||'-'||v_count::text),'confirmed',true,'customerOwner',false));
    end loop;
  end loop;
  if pg_catalog.jsonb_array_length(v_obligations)=0 then
    raise exception 'rom_define_obligations_missing' using errcode='23514'; end if;
  for v_obligation in select value from pg_catalog.jsonb_array_elements(v_obligations) loop
    select count(*) into v_count
      from pg_catalog.jsonb_array_elements(v_coverage) value
      where value->>'obligationId'=v_obligation->>'id';
    select value into v_row from pg_catalog.jsonb_array_elements(v_coverage) value
      where value->>'obligationId'=v_obligation->>'id' limit 1;
    if v_count<>1 or v_row->>'sourceRevision' is distinct from v_revision::text or
      length(trim(coalesce(v_row->>'owner','')))=0 or
      length(trim(coalesce(v_row->>'rationale','')))=0 then
      raise exception 'rom_obligation_unaddressed:%',v_obligation->>'id' using errcode='23514'; end if;
    if v_row->>'treatment' not in ('Line','Shared allowance','Customer responsibility') or
      v_row->>'treatment'='Excluded' or
      v_row->>'treatment'='Customer responsibility' and
        not (v_obligation->>'customerOwner')::boolean then
      raise exception 'rom_scope_deviation:%',v_obligation->>'id' using errcode='23514'; end if;
    if v_row->>'treatment' in ('Line','Shared allowance') then
      if pg_catalog.jsonb_typeof(v_row->'lineIds')<>'array' or
        pg_catalog.jsonb_array_length(v_row->'lineIds')=0 or exists(
          select 1 from pg_catalog.jsonb_array_elements_text(v_row->'lineIds') id
          where not exists(select 1 from pg_catalog.jsonb_array_elements(v_lines) line
            where line->>'id'=id.value)) then
        raise exception 'rom_cost_link_missing:%',v_obligation->>'id' using errcode='23514'; end if;
    end if;
  end loop;
  if exists(select 1 from pg_catalog.jsonb_array_elements(v_coverage) row
    where not exists(select 1 from pg_catalog.jsonb_array_elements(v_obligations) obligation
      where obligation->>'id'=row->>'obligationId')) then
    raise exception 'rom_stale_coverage' using errcode='23514'; end if;
  for v_line in select value from pg_catalog.jsonb_array_elements(v_lines) loop
    if length(trim(coalesce(v_line->>'quantityBasis','')))=0 or
      coalesce(v_line->>'sourceKind','') not in ('Assumed','Historical','Quoted','Policy rate') or
      coalesce(v_line->>'sourceDate','') !~ '^\d{4}-\d{2}-\d{2}$' or
      (exists(select 1 from pg_catalog.jsonb_array_elements(
        new.estimate#>'{detailed,evaluation,lines}') evaluated
        where evaluated->>'id'=v_line->>'id' and
          coalesce((evaluated->>'amountMinor')::numeric,0)=0) and
        length(trim(coalesce(v_line->>'noCostReason','')))=0) then
      raise exception 'rom_line_basis_missing:%',v_line->>'id' using errcode='23514'; end if;
  end loop;
  v_scenario:=v_basis->'installationScenario';
  if pg_catalog.jsonb_typeof(v_scenario)<>'object' or
    coalesce(v_scenario->>'units','') !~ '^\d+(\.\d+)?$' or
    coalesce(v_scenario->>'lowHoursPerUnit','') !~ '^\d+(\.\d+)?$' or
    coalesce(v_scenario->>'baseHoursPerUnit','') !~ '^\d+(\.\d+)?$' or
    coalesce(v_scenario->>'highHoursPerUnit','') !~ '^\d+(\.\d+)?$' or
    length(trim(coalesce(v_scenario->>'quantitySource','')))=0 or
    length(trim(coalesce(v_scenario->>'rationale','')))=0 then
    raise exception 'rom_scenario_basis_missing' using errcode='23514'; end if;
  v_units:=(v_scenario->>'units')::numeric;
  v_base_hours:=(v_scenario->>'baseHoursPerUnit')::numeric;
  if v_units<=0 or v_base_hours<=0 or
    (v_scenario->>'lowHoursPerUnit')::numeric<=0 or
    (v_scenario->>'highHoursPerUnit')::numeric<v_base_hours or
    (v_scenario->>'lowHoursPerUnit')::numeric>v_base_hours then
    raise exception 'rom_scenario_order_invalid' using errcode='23514'; end if;
  select value into v_line from pg_catalog.jsonb_array_elements(v_lines) value
    where value->>'id'=v_scenario->>'lineId';
  select value into v_eval_line from pg_catalog.jsonb_array_elements(
    new.estimate#>'{detailed,evaluation,lines}') value
    where value->>'id'=v_scenario->>'lineId';
  if v_line is null or v_eval_line is null or v_line->>'category'<>'labor' or
    v_line->>'unit'<>'person-hour' or
    (v_line->>'quantity')::numeric<>v_units*v_base_hours then
    raise exception 'rom_installation_effort_mismatch' using errcode='23514'; end if;
  v_policy:=new.estimate#>'{detailed,policySnapshot}';
  if v_policy->>'method'<>'target-margin' then
    raise exception 'rom_scenarios_need_target_margin_policy' using errcode='23514'; end if;
  v_direct:=(new.estimate#>>'{detailed,evaluation,directCostMinor}')::numeric;
  v_base_amount:=(v_eval_line->>'amountMinor')::numeric;
  v_overhead:=(v_policy->>'overheadPercent')::numeric;
  v_contingency:=(v_policy->>'contingencyPercent')::numeric;
  v_target:=(v_policy->>'targetMarginPercent')::numeric;
  v_discount:=coalesce((v_input->>'discountPercent')::numeric,0);
  for v_label in select unnest(array['low','base','high']) loop
    v_hours:=(v_scenario->>(v_label||'HoursPerUnit'))::numeric;
    v_new_amount:=round(v_base_amount*v_hours/v_base_hours);
    v_quantity:=v_direct-v_base_amount+v_new_amount;
    v_scenarios:=v_scenarios||pg_catalog.jsonb_build_object(v_label,
      pg_catalog.jsonb_build_object('hoursPerUnit',v_hours,
        'directCostMinor',v_quantity,
        'includedCostMinor',v_quantity+round(v_quantity*v_overhead/100)+
          round(v_quantity*v_contingency/100),
        'priceMinor',ceil((v_quantity+round(v_quantity*v_overhead/100)+
          round(v_quantity*v_contingency/100))*100/(100-v_target))-
          round(ceil((v_quantity+round(v_quantity*v_overhead/100)+
          round(v_quantity*v_contingency/100))*100/(100-v_target))*v_discount/100)));
  end loop;
  new.estimate:=pg_catalog.jsonb_set(new.estimate,'{detailed,romScenarios}',
    v_scenarios,true);
  return new;
end; $$;
revoke all on function d5o_hosted.validate_connected_rom_v1()
  from public,anon,authenticated,service_role;
create trigger validate_connected_rom_before_review
before insert or update on d5o_hosted.connected_estimate_states
for each row execute function d5o_hosted.validate_connected_rom_v1();

-- Budget acknowledgment and permission to undertake detailed Design are not an
-- award. This ledger has no path into the awarded Design/Deploy source adapter.
create table d5o_hosted.connected_rom_design_states (
  workspace_id uuid not null, work_id uuid not null,
  decision_revision integer not null check (decision_revision > 0),
  estimate_revision integer not null, offer_revision integer not null,
  definition_revision integer not null, solution_digest text not null,
  status text not null check (status in ('Acknowledged','Design authorized')),
  acknowledgment jsonb not null, design_authorization jsonb,
  reconciliation jsonb not null default '[]'::jsonb,
  prepared_by uuid not null references auth.users(id),
  authorized_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (workspace_id,work_id),
  foreign key (work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id)
);
create table d5o_hosted.connected_rom_design_events (
  workspace_id uuid not null, work_id uuid not null,
  decision_revision integer not null, command_id text not null,
  action text not null, actor_user_id uuid not null references auth.users(id),
  membership_id uuid not null references d5o_hosted.memberships(id),
  snapshot jsonb not null, occurred_at timestamptz not null default now(),
  primary key (workspace_id,work_id,decision_revision),
  unique (workspace_id,command_id)
);
create table d5o_hosted.connected_rom_design_receipts (
  workspace_id uuid not null, command_id text not null, work_id uuid not null,
  actor_user_id uuid not null references auth.users(id),
  fingerprint text not null, result jsonb not null,
  primary key (workspace_id,command_id)
);
alter table d5o_hosted.connected_rom_design_states enable row level security;
alter table d5o_hosted.connected_rom_design_events enable row level security;
alter table d5o_hosted.connected_rom_design_receipts enable row level security;
revoke all on d5o_hosted.connected_rom_design_states,
  d5o_hosted.connected_rom_design_events,d5o_hosted.connected_rom_design_receipts
  from public,anon,authenticated;

create function public.d5o_hosted_rom_design_read_v1(p_workspace_key text,p_presentation_id text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace uuid;v_work uuid;
  v_source bigint;v_state d5o_hosted.connected_rom_design_states%rowtype;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null then
    raise exception 'workspace_forbidden' using errcode='42501'; end if;
  select id into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  if not exists(select 1 from d5o_hosted.memberships where workspace_id=v_workspace
    and actor_user_id=v_actor and status='active'
    and role in ('admin','project_manager','operations_leader','billing_commercial_lead')) then
    raise exception 'workspace_forbidden' using errcode='42501'; end if;
  select work_id into v_work from d5o_hosted.work_identity_links
    where workspace_id=v_workspace and presentation_id=p_presentation_id;
  if v_work is null then raise exception 'connected_work_unavailable' using errcode='42501'; end if;
  select revision into v_source from d5o_hosted.prototype_states
    where workspace_id=v_workspace and state_key='work';
  select * into v_state from d5o_hosted.connected_rom_design_states
    where workspace_id=v_workspace and work_id=v_work;
  return pg_catalog.jsonb_build_object('sourceRevision',v_source,
    'decisionRevision',coalesce(v_state.decision_revision,0),
    'status',v_state.status,'estimateRevision',v_state.estimate_revision,
    'offerRevision',v_state.offer_revision,'acknowledgment',v_state.acknowledgment,
    'authorization',v_state.design_authorization,'reconciliation',v_state.reconciliation);
end; $$;
revoke all on function public.d5o_hosted_rom_design_read_v1(text,text)
  from public,anon,service_role;
grant execute on function public.d5o_hosted_rom_design_read_v1(text,text) to authenticated;

create function public.d5o_hosted_rom_design_command_v1(
  p_workspace_key text,p_presentation_id text,p_action text,p_basis jsonb,
  p_command_id text,p_expected_source_revision bigint,
  p_expected_decision_revision integer,p_estimate_revision integer,p_offer_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
  v_member d5o_hosted.memberships%rowtype;v_work d5o_hosted.work_records%rowtype;
  v_source d5o_hosted.prototype_states%rowtype;
  v_define d5o_hosted.connected_define_states%rowtype;
  v_solution d5o_hosted.connected_solution_states%rowtype;
  v_estimate d5o_hosted.connected_estimate_states%rowtype;
  v_offer d5o_hosted.connected_offer_states%rowtype;
  v_current d5o_hosted.connected_rom_design_states%rowtype;
  v_receipt d5o_hosted.connected_rom_design_receipts%rowtype;
  v_fingerprint text;v_result jsonb;v_next jsonb;v_item jsonb;
  v_now timestamptz:=now();v_revision integer;v_design_role text;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or p_action not in ('record-budget-ack','authorize-design','record-reconciliation')
    or pg_catalog.jsonb_typeof(p_basis)<>'object'
    or length(coalesce(p_command_id,'')) not between 8 and 120
    or p_expected_source_revision is null or p_expected_source_revision<1
    or p_expected_decision_revision is null or p_expected_decision_revision<0
    or p_estimate_revision is null or p_estimate_revision<1
    or p_offer_revision is null or p_offer_revision<1 then
    raise exception 'invalid_rom_design_command' using errcode='22023'; end if;
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
    p_presentation_id,p_action,p_basis,p_expected_source_revision,
    p_expected_decision_revision,p_estimate_revision,p_offer_revision)::text);
  select * into v_receipt from d5o_hosted.connected_rom_design_receipts
    where workspace_id=v_workspace.id and command_id=p_command_id;
  if found then
    if v_receipt.work_id<>v_work.id or v_receipt.actor_user_id<>v_actor
      or v_receipt.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_receipt.result;
  end if;
  select * into v_source from d5o_hosted.prototype_states
    where workspace_id=v_workspace.id and state_key='work' for share;
  select * into v_current from d5o_hosted.connected_rom_design_states
    where workspace_id=v_workspace.id and work_id=v_work.id for update;
  if v_source.revision is distinct from p_expected_source_revision or
    coalesce(v_current.decision_revision,0)<>p_expected_decision_revision then
    raise exception 'stale_state' using errcode='23505'; end if;
  select * into v_define from d5o_hosted.connected_define_states
    where workspace_id=v_workspace.id and work_id=v_work.id for share;
  select * into v_solution from d5o_hosted.connected_solution_states
    where workspace_id=v_workspace.id and work_id=v_work.id for share;
  select * into v_estimate from d5o_hosted.connected_estimate_states
    where workspace_id=v_workspace.id and work_id=v_work.id for share;
  select * into v_offer from d5o_hosted.connected_offer_states
    where workspace_id=v_workspace.id and work_id=v_work.id for share;
  if v_define.status is distinct from 'Approved' or
    v_define.projection#>>'{developHandoff,status}' is distinct from 'accepted' or
    v_solution.status is distinct from 'Approved' or
    v_estimate.status is distinct from 'Approved' or
    v_estimate.estimate#>>'{detailed,input,estimateMaturity}' is distinct from 'ROM' or
    v_estimate.definition_revision is distinct from v_define.definition_revision or
    v_estimate.solution_digest is distinct from v_solution.source_digest or
    v_estimate.estimate_revision<>p_estimate_revision or
    v_offer.status is distinct from 'Submitted' or
    v_offer.offer_revision<>p_offer_revision or
    v_offer.estimate_revision<>p_estimate_revision or
    v_offer.proposal#>>'{submission,revision}' is distinct from p_offer_revision::text or
    v_offer.proposal->'responseEvents'->-1->>'status' in ('Awarded','Not awarded') then
    raise exception 'current_communicated_rom_required' using errcode='23514'; end if;
  if p_action='record-budget-ack' then
    if v_member.role not in ('admin','project_manager') or
      (v_member.role='project_manager' and v_work.created_by<>v_actor) or
      v_current.work_id is not null
      or length(trim(coalesce(p_basis->>'sourceReference',''))) not between 5 and 500
      or length(trim(coalesce(p_basis->>'customerStatement',''))) not between 10 and 2000
      or length(trim(coalesce(p_basis->>'customerRepresentative',''))) not between 3 and 200 then
      raise exception 'budget_ack_basis_invalid' using errcode='42501'; end if;
    v_next:=pg_catalog.jsonb_build_object('sourceReference',p_basis->>'sourceReference',
      'customerStatement',p_basis->>'customerStatement',
      'customerRepresentative',p_basis->>'customerRepresentative',
      'estimateRevision',p_estimate_revision,'offerRevision',p_offer_revision,
      'recordedAt',v_now,'recordedByActorId',v_actor,'recordedByMembershipId',v_member.id);
    insert into d5o_hosted.connected_rom_design_states(workspace_id,work_id,
      decision_revision,estimate_revision,offer_revision,definition_revision,
      solution_digest,status,acknowledgment,prepared_by)
    values(v_workspace.id,v_work.id,1,p_estimate_revision,p_offer_revision,
      v_define.definition_revision,v_solution.source_digest,'Acknowledged',v_next,v_actor);
  elsif p_action='authorize-design' then
    v_design_role:=v_estimate.estimate#>>'{detailed,policySnapshot,proposalApproverRole}';
    if v_current.status<>'Acknowledged' or v_actor=v_current.prepared_by
      or v_design_role not in ('admin','operations_leader')
      or v_member.role<>v_design_role
      or v_current.estimate_revision<>p_estimate_revision
      or v_current.offer_revision<>p_offer_revision
      or v_current.definition_revision<>v_define.definition_revision
      or v_current.solution_digest<>v_solution.source_digest
      or length(trim(coalesce(p_basis->>'authorizedExtent',''))) not between 10 and 2000
      or length(trim(coalesce(p_basis->>'fundingSource',''))) not between 5 and 500
      or length(trim(coalesce(p_basis->>'sourceReference',''))) not between 5 and 500
      or coalesce(p_basis->>'spendCapMinor','') !~ '^[0-9]+$' then
      raise exception 'independent_design_authority_required' using errcode='42501'; end if;
    v_next:=pg_catalog.jsonb_build_object('authorizedExtent',p_basis->>'authorizedExtent',
      'fundingSource',p_basis->>'fundingSource',
      'sourceReference',p_basis->>'sourceReference',
      'spendCapMinor',(p_basis->>'spendCapMinor')::bigint,
      'currency',v_estimate.estimate#>>'{detailed,input,currency}',
      'estimateRevision',p_estimate_revision,'offerRevision',p_offer_revision,
      'authorizedAt',v_now,'authorizedByActorId',v_actor,
      'authorizedByMembershipId',v_member.id,
      'limits','Detailed Design only; no award, purchase, crew publication or field start');
    update d5o_hosted.connected_rom_design_states set decision_revision=decision_revision+1,
      status='Design authorized',design_authorization=v_next,authorized_by=v_actor,updated_at=v_now
      where workspace_id=v_workspace.id and work_id=v_work.id;
  else
    if v_current.status<>'Design authorized' or
      v_member.role not in ('admin','project_manager','operations_leader') or
      v_current.estimate_revision<>p_estimate_revision or
      v_current.offer_revision<>p_offer_revision or
      v_current.definition_revision<>v_define.definition_revision or
      v_current.solution_digest<>v_solution.source_digest or
      pg_catalog.jsonb_typeof(p_basis->'differences')<>'array' or
      pg_catalog.jsonb_array_length(p_basis->'differences') not between 1 and 100 then
      raise exception 'current_design_authorization_required' using errcode='23514'; end if;
    for v_item in select value from pg_catalog.jsonb_array_elements(p_basis->'differences') loop
      if length(trim(coalesce(v_item->>'romLineId','')))=0 or
        not exists(select 1 from pg_catalog.jsonb_array_elements(
          v_estimate.estimate#>'{detailed,input,lines}') line
          where line->>'id'=v_item->>'romLineId') or
        coalesce(v_item->>'designQuantity','') !~ '^[0-9]+(\.[0-9]+)?$' or
        length(trim(coalesce(v_item->>'designUnit','')))=0 or
        v_item->>'cause' not in ('Customer scope change','Estimating assumption resolved',
          'Technical solution change','Estimating omission/correction') or
        length(trim(coalesce(v_item->>'explanation','')))<10 then
        raise exception 'design_difference_invalid' using errcode='23514'; end if;
    end loop;
    v_next:=pg_catalog.jsonb_build_object('differences',p_basis->'differences',
      'sourceReference',p_basis->>'sourceReference','recordedAt',v_now,
      'recordedByActorId',v_actor,'estimateRevision',p_estimate_revision,
      'offerRevision',p_offer_revision,
      'position','Design difference only; changes require separate commercial authority');
    update d5o_hosted.connected_rom_design_states set decision_revision=decision_revision+1,
      reconciliation=reconciliation||pg_catalog.jsonb_build_array(v_next),updated_at=v_now
      where workspace_id=v_workspace.id and work_id=v_work.id;
  end if;
  select * into v_current from d5o_hosted.connected_rom_design_states
    where workspace_id=v_workspace.id and work_id=v_work.id;
  v_revision:=v_current.decision_revision;
  insert into d5o_hosted.connected_rom_design_events(workspace_id,work_id,
    decision_revision,command_id,action,actor_user_id,membership_id,snapshot)
  values(v_workspace.id,v_work.id,v_revision,p_command_id,p_action,v_actor,v_member.id,
    pg_catalog.to_jsonb(v_current));
  v_result:=public.d5o_hosted_rom_design_read_v1(p_workspace_key,p_presentation_id);
  insert into d5o_hosted.connected_rom_design_receipts(workspace_id,command_id,
    work_id,actor_user_id,fingerprint,result)
  values(v_workspace.id,p_command_id,v_work.id,v_actor,v_fingerprint,v_result);
  return v_result;
end; $$;
revoke all on function public.d5o_hosted_rom_design_command_v1(
  text,text,text,jsonb,text,bigint,integer,integer,integer)
  from public,anon,service_role;
grant execute on function public.d5o_hosted_rom_design_command_v1(
  text,text,text,jsonb,text,bigint,integer,integer,integer) to authenticated;
