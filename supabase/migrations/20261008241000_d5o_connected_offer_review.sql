-- The customer-facing offer is reviewed as an exact revision of the approved
-- Define, solution, estimate and policy basis. Ordinary saves retain drafts.
create table d5o_hosted.connected_offer_states (
  workspace_id uuid not null, work_id uuid not null,
  offer_revision integer not null check (offer_revision>0),
  decision_revision integer not null check (decision_revision>0),
  estimate_revision integer not null, offer_digest text not null,
  status text not null check (status in ('Draft','Internal review','Approved','Changes requested')),
  proposal jsonb not null, submitter uuid not null references auth.users(id),
  reviewer uuid references auth.users(id), updated_at timestamptz not null default now(),
  primary key(workspace_id,work_id),
  foreign key(work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id)
);
create table d5o_hosted.connected_offer_events (
  workspace_id uuid not null, work_id uuid not null, decision_revision integer not null,
  command_id text not null, action text not null, actor_user_id uuid not null references auth.users(id),
  membership_id uuid not null references d5o_hosted.memberships(id),
  offer_revision integer not null, estimate_revision integer not null,
  policy_id text not null, policy_version integer not null,
  snapshot jsonb not null, reason text not null, occurred_at timestamptz not null default now(),
  primary key(workspace_id,work_id,decision_revision), unique(workspace_id,command_id),
  foreign key(work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id)
);
create table d5o_hosted.connected_offer_receipts (
  workspace_id uuid not null, command_id text not null, work_id uuid not null,
  actor_user_id uuid not null references auth.users(id), fingerprint text not null, result jsonb not null,
  primary key(workspace_id,command_id),
  foreign key(work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id)
);
alter table d5o_hosted.connected_offer_states enable row level security;
alter table d5o_hosted.connected_offer_events enable row level security;
alter table d5o_hosted.connected_offer_receipts enable row level security;
revoke all on d5o_hosted.connected_offer_states,d5o_hosted.connected_offer_events,
  d5o_hosted.connected_offer_receipts from public,anon,authenticated,service_role;

-- A saved draft offer is editable, but a reviewed/submitted package is not.
create or replace function d5o_hosted.protected_work_record_v1(p_record jsonb)
returns jsonb language sql immutable set search_path='' as $$
  select pg_catalog.jsonb_build_object(
    'id',p_record->'id','workspace',p_record->'workspace',
    'stage',p_record->'stage','status',p_record->'status',
    'progress',p_record->'progress',
    'phaseConfigurationVersionId',p_record->'phaseConfigurationVersionId',
    'prototypeDecisionRights',p_record->'prototypeDecisionRights',
    'heldFrom',p_record->'heldFrom',
    'heldNextAction',p_record->'heldNextAction',
    'heldNextActionDue',p_record->'heldNextActionDue',
    'heldNextActionImpact',p_record->'heldNextActionImpact',
    'definitionStatus',case when p_record#>>'{definition,status}'='Draft'
      then null else p_record#>'{definition,status}' end,
    'definitionReviews',p_record#>'{definition,reviews}',
    'definitionBaselines',p_record#>'{definition,approvedBaselines}',
    'definitionReceipt',p_record#>'{definition,developHandoff}',
    'definitionDecisions',p_record#>'{definition,decisions}',
    'definitionLocked',case when p_record#>>'{definition,status}' is distinct from 'Draft'
      then p_record->'definition' else null end,
    'pursuit',p_record#>'{discovery,pursuitControl}',
    'solutionReview',p_record#>'{develop,review}',
    'estimateStatus',p_record#>'{discovery,estimate,status}',
    'estimateReview',p_record#>'{discovery,estimate,review}',
    'estimateHistory',p_record#>'{discovery,estimate,pricingHistory}',
    'proposalStatus',case when p_record#>>'{discovery,proposal,status}' in
      ('Not started','Draft') then null else p_record#>'{discovery,proposal,status}' end,
    'proposalPackage',case when p_record#>>'{discovery,proposal,status}' in
      ('Not started','Draft') then null else p_record#>'{discovery,proposal,package}' end,
    'proposalReview',p_record#>'{discovery,proposal,review}',
    'proposalSubmission',p_record#>'{discovery,proposal,submission}',
    'proposalSubmissionHistory',p_record#>'{discovery,proposal,submissionHistory}',
    'proposalResponses',p_record#>'{discovery,proposal,responseEvents}',
    'customerOutcome',p_record#>'{discovery,outcome}',
    'designReceipt',p_record#>'{discovery,designHandoff}',
    'design',p_record->'design','deploy',p_record->'deploy',
    'operate',p_record->'operate','serviceSource',p_record->'serviceSource');
$$;
revoke all on function d5o_hosted.protected_work_record_v1(jsonb)
  from public,anon,authenticated,service_role;

-- The older service-role snapshot writer may still edit drafts. Once an offer
-- enters review, its raw source package is locked even on that alternate path.
create or replace function d5o_hosted.guard_connected_identity_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_link record;v_record jsonb;v_prior jsonb;v_count integer;
begin
  if new.state_key not in ('work','catalog') or not exists (
    select 1 from d5o_hosted.work_identity_links l
      where l.workspace_id=new.workspace_id) then return new; end if;
  if pg_catalog.jsonb_typeof(new.state_json->'records') is distinct from 'array' then
    raise exception 'connected_records_missing' using errcode='42501'; end if;
  for v_link in select work_id,presentation_id from d5o_hosted.work_identity_links
      where workspace_id=new.workspace_id loop
    select count(*),(pg_catalog.jsonb_agg(item)->0) into v_count,v_record
      from pg_catalog.jsonb_array_elements(new.state_json->'records') item
      where item->>'id'=v_link.presentation_id;
    if v_count<>1 or v_record->>'canonicalWorkId' is distinct from v_link.work_id::text
      or v_record->>'workspace' is distinct from (
        select workspace_key from d5o_hosted.workspaces where id=new.workspace_id) then
      raise exception 'connected_identity_changed' using errcode='42501'; end if;
    if tg_op='UPDATE' and new.state_key='work' and exists(
      select 1 from d5o_hosted.connected_offer_states o
        where o.workspace_id=new.workspace_id and o.work_id=v_link.work_id) then
      select item into v_prior from pg_catalog.jsonb_array_elements(
        old.state_json->'records') item where item->>'id'=v_link.presentation_id;
      if v_prior#>'{discovery,proposal}' is distinct from
          v_record#>'{discovery,proposal}' then
        raise exception 'typed_offer_command_required' using errcode='42501'; end if;
    end if;
  end loop;
  return new;
end; $$;
revoke all on function d5o_hosted.guard_connected_identity_v1()
  from public,anon,authenticated,service_role;

create function d5o_hosted.connected_offer_projection_v1(p_workspace uuid,p_state jsonb)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when p_state is null then null else
    pg_catalog.jsonb_set(projected,'{records}',coalesce((
      select pg_catalog.jsonb_agg(case when o.work_id is null then item else
        pg_catalog.jsonb_set(item,'{discovery,proposal}',o.proposal,true)||
          pg_catalog.jsonb_build_object('nextAction',case o.status
            when 'Draft' then 'Complete proposal revision '||o.offer_revision::text
            when 'Approved' then 'Record customer proposal submission'
            when 'Changes requested' then 'Revise proposal package'
            else 'Review proposal revision '||o.offer_revision::text end)
        end order by ordinal)
      from pg_catalog.jsonb_array_elements(coalesce(projected->'records','[]'::jsonb))
        with ordinality as records(item,ordinal)
      left join d5o_hosted.work_identity_links l on l.workspace_id=p_workspace
        and l.presentation_id=item->>'id'
      left join d5o_hosted.connected_offer_states o on o.workspace_id=p_workspace
        and o.work_id=l.work_id
    ),'[]'::jsonb)) end
  from (select d5o_hosted.connected_estimate_projection_v1(p_workspace,p_state)
    as projected) source;
$$;
revoke all on function d5o_hosted.connected_offer_projection_v1(uuid,jsonb)
  from public,anon,authenticated,service_role;
create or replace function d5o_hosted.connected_define_projection_v1(p_workspace uuid,p_state jsonb)
returns jsonb language sql stable security definer set search_path='' as $$
  select d5o_hosted.connected_offer_projection_v1(p_workspace,p_state);
$$;
revoke all on function d5o_hosted.connected_define_projection_v1(uuid,jsonb)
  from public,anon,authenticated,service_role;

create function public.d5o_hosted_offer_review_command_v1(
  p_workspace_key text,p_presentation_id text,p_action text,p_due_date text,
  p_reason text,p_command_id text,p_expected_source_revision bigint,
  p_expected_decision_revision integer,p_offer_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
  v_member d5o_hosted.memberships%rowtype;v_work d5o_hosted.work_records%rowtype;
  v_state d5o_hosted.prototype_states%rowtype;
  v_estimate d5o_hosted.connected_estimate_states%rowtype;
  v_offer d5o_hosted.connected_offer_states%rowtype;
  v_receipt d5o_hosted.connected_offer_receipts%rowtype;
  v_raw jsonb;v_package jsonb;v_proposal jsonb;v_review jsonb;
  v_fingerprint text;v_result jsonb;v_now timestamptz:=now();
  v_policy_id text;v_policy_version integer;v_approver text;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or p_action not in ('submit-proposal','approve-proposal','return-proposal')
    or length(coalesce(p_command_id,'')) not between 8 and 120
    or p_expected_source_revision is null or p_expected_source_revision<1
    or p_expected_decision_revision is null or p_expected_decision_revision<0
    or p_offer_revision is null or p_offer_revision<1
    or length(coalesce(p_reason,''))>2000 then
    raise exception 'invalid_offer_command' using errcode='22023'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor and status='active' for share;
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  select w.* into v_work from d5o_hosted.work_records w
    join d5o_hosted.work_identity_links l on l.work_id=w.id and l.workspace_id=w.workspace_id
    where w.workspace_id=v_workspace.id and l.presentation_id=p_presentation_id
    for update of w;
  if not found then raise exception 'connected_work_unavailable' using errcode='42501'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_workspace_key,
    p_presentation_id,p_action,p_due_date,trim(coalesce(p_reason,'')),
    p_expected_source_revision,p_expected_decision_revision,p_offer_revision)::text);
  select * into v_receipt from d5o_hosted.connected_offer_receipts
    where workspace_id=v_workspace.id and command_id=p_command_id;
  if found then
    if v_receipt.work_id<>v_work.id or v_receipt.actor_user_id<>v_actor
      or v_receipt.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_receipt.result;
  end if;
  select * into v_state from d5o_hosted.prototype_states
    where workspace_id=v_workspace.id and state_key='work' for share;
  select * into v_estimate from d5o_hosted.connected_estimate_states
    where workspace_id=v_workspace.id and work_id=v_work.id for share;
  select * into v_offer from d5o_hosted.connected_offer_states
    where workspace_id=v_workspace.id and work_id=v_work.id for update;
  if v_state.revision is distinct from p_expected_source_revision
    or coalesce(v_offer.decision_revision,0)<>p_expected_decision_revision then
    raise exception 'stale_state' using errcode='23505'; end if;
  select item into v_raw from pg_catalog.jsonb_array_elements(v_state.state_json->'records') item
    where item->>'id'=p_presentation_id and item->>'canonicalWorkId'=v_work.id::text;
  if v_raw is null or v_raw->>'phaseConfigurationVersionId' is distinct from
    v_work.configuration_version_id::text or v_estimate.status is distinct from 'Approved'
    or v_estimate.estimate#>>'{review,decidedAt}' is null then
    raise exception 'approved_offer_basis_required' using errcode='23514'; end if;
  v_policy_id:=v_estimate.estimate#>>'{detailed,evaluation,policyId}';
  v_policy_version:=(v_estimate.estimate#>>'{detailed,evaluation,policyVersion}')::integer;
  v_approver:=v_estimate.estimate#>>'{detailed,policySnapshot,proposalApproverRole}';
  if v_approver is null or not exists(select 1 from d5o_hosted.connected_pricing_policies
    where workspace_id=v_workspace.id and policy_id=v_policy_id
      and version=v_policy_version and status='published') then
    raise exception 'pinned_offer_policy_unavailable' using errcode='23514'; end if;
  v_package:=case when v_offer.work_id is null then
    v_raw#>'{discovery,proposal,package}' else v_offer.proposal->'package' end;
  if p_action='submit-proposal' then
    if v_member.role not in ('admin','project_manager','operations_leader')
      or v_offer.status='Internal review'
      or coalesce(v_offer.status,v_raw#>>'{discovery,proposal,status}')<>'Draft'
      or v_package is null or (v_package->>'revision')::integer<>p_offer_revision
      or v_package->>'estimateRevision' is distinct from v_estimate.estimate_revision::text
      or coalesce(trim(v_package->>'scope'),'')=''
      or coalesce(trim(v_package->>'commercialTerms'),'')=''
      or v_package#>>'{pricingBasis,policyId}' is distinct from v_policy_id
      or (v_package#>>'{pricingBasis,policyVersion}')::integer is distinct from v_policy_version
      or (v_package#>>'{pricingBasis,priceMinor}')::numeric is distinct from
        (v_estimate.estimate#>>'{detailed,evaluation,proposedPriceMinor}')::numeric
      or (v_package#>>'{pricingBasis,includedCostMinor}')::numeric is distinct from
        (v_estimate.estimate#>>'{detailed,evaluation,includedCostMinor}')::numeric
      or v_package#>>'{pricingBasis,currency}' is distinct from
        v_estimate.estimate#>>'{detailed,input,currency}'
      or v_package#>>'{pricingBasis,solutionRevision}' is distinct from
        v_estimate.estimate#>>'{detailed,input,solutionRevision}'
      or (v_package->>'sellPrice')::numeric is distinct from
        (v_estimate.estimate->>'sellPrice')::numeric
      or (v_package#>>'{definitionSource,revision}')::integer is distinct from
        (v_estimate.estimate#>>'{definitionSource,revision}')::integer
      or p_due_date is null or p_due_date !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'offer_submission_denied' using errcode='23514'; end if;
    v_review:=pg_catalog.jsonb_build_object('revision',p_offer_revision,
      'submittedAt',v_now,'submittedBy',v_raw->>'owner',
      'submittedByActorId',v_actor,'submittedByMembershipId',v_member.id,
      'dueDate',p_due_date,'authorityRole',v_approver,
      'authorityProfileId','policy-'||v_policy_id||'-v'||v_policy_version::text,
      'grossMarginPercent',v_estimate.estimate#>>'{detailed,evaluation,marginPercent}');
    v_proposal:=coalesce(v_offer.proposal,v_raw#>'{discovery,proposal}')||
      pg_catalog.jsonb_build_object(
      'status','Internal review','review',v_review,
      'authorityRevision',coalesce(v_offer.decision_revision,0)+1);
    if v_offer.work_id is null then
      insert into d5o_hosted.connected_offer_states(workspace_id,work_id,
        offer_revision,decision_revision,estimate_revision,offer_digest,status,
        proposal,submitter)
      values(v_workspace.id,v_work.id,p_offer_revision,1,v_estimate.estimate_revision,
        pg_catalog.md5(v_package::text),'Internal review',v_proposal,v_actor);
    else
      if v_offer.status<>'Draft' or p_offer_revision<>v_offer.offer_revision then
        raise exception 'new_offer_revision_required' using errcode='23514'; end if;
      update d5o_hosted.connected_offer_states set offer_revision=p_offer_revision,
        decision_revision=decision_revision+1,estimate_revision=v_estimate.estimate_revision,
        offer_digest=pg_catalog.md5(v_package::text),status='Internal review',
        proposal=v_proposal,submitter=v_actor,reviewer=null,updated_at=v_now
        where workspace_id=v_workspace.id and work_id=v_work.id;
    end if;
  else
    if v_offer.status<>'Internal review' or v_offer.offer_revision<>p_offer_revision
      or v_estimate.estimate_revision<>v_offer.estimate_revision
      or pg_catalog.md5(v_package::text)<>v_offer.offer_digest
      or v_actor=v_offer.submitter or v_member.role<>v_approver
      or length(trim(coalesce(p_reason,'')))<10 then
      raise exception 'independent_offer_review_required' using errcode='42501'; end if;
    v_review:=v_offer.proposal->'review'||pg_catalog.jsonb_build_object(
      'decidedAt',v_now,'decisionNote',trim(p_reason),'actorId',v_actor,
      'membershipId',v_member.id);
    v_proposal:=v_offer.proposal||pg_catalog.jsonb_build_object(
      'status',case when p_action='approve-proposal' then 'Approved'
        else 'Changes requested' end,'review',v_review,
      'authorityRevision',v_offer.decision_revision+1);
    update d5o_hosted.connected_offer_states set decision_revision=decision_revision+1,
      status=case when p_action='approve-proposal' then 'Approved'
        else 'Changes requested' end,proposal=v_proposal,reviewer=v_actor,updated_at=v_now
      where workspace_id=v_workspace.id and work_id=v_work.id;
  end if;
  select * into v_offer from d5o_hosted.connected_offer_states
    where workspace_id=v_workspace.id and work_id=v_work.id;
  insert into d5o_hosted.connected_offer_events(workspace_id,work_id,decision_revision,
    command_id,action,actor_user_id,membership_id,offer_revision,estimate_revision,
    policy_id,policy_version,snapshot,reason)
  values(v_workspace.id,v_work.id,v_offer.decision_revision,p_command_id,p_action,
    v_actor,v_member.id,p_offer_revision,v_estimate.estimate_revision,v_policy_id,
    v_policy_version,v_offer.proposal,trim(coalesce(p_reason,'')));
  v_result:=public.d5o_hosted_prototype_read_v1(p_workspace_key,'work');
  insert into d5o_hosted.connected_offer_receipts(workspace_id,command_id,
    work_id,actor_user_id,fingerprint,result)
  values(v_workspace.id,p_command_id,v_work.id,v_actor,v_fingerprint,v_result);
  return v_result;
end; $$;
revoke all on function public.d5o_hosted_offer_review_command_v1(
  text,text,text,text,text,text,bigint,integer,integer)
  from public,anon,service_role;
grant execute on function public.d5o_hosted_offer_review_command_v1(
  text,text,text,text,text,text,bigint,integer,integer) to authenticated;

create function public.d5o_hosted_offer_revision_command_v1(
  p_workspace_key text,p_presentation_id text,p_input jsonb,p_command_id text,
  p_expected_source_revision bigint,p_expected_decision_revision integer,
  p_offer_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
  v_member d5o_hosted.memberships%rowtype;v_work d5o_hosted.work_records%rowtype;
  v_state d5o_hosted.prototype_states%rowtype;
  v_estimate d5o_hosted.connected_estimate_states%rowtype;
  v_offer d5o_hosted.connected_offer_states%rowtype;
  v_receipt d5o_hosted.connected_offer_receipts%rowtype;
  v_raw jsonb;v_package jsonb;v_proposal jsonb;v_result jsonb;
  v_fingerprint text;v_now timestamptz:=now();
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or p_input is null or pg_catalog.jsonb_typeof(p_input)<>'object'
    or length(coalesce(p_command_id,'')) not between 8 and 120
    or p_expected_source_revision is null or p_expected_source_revision<1
    or p_expected_decision_revision is null or p_expected_decision_revision<1
    or p_offer_revision is null or p_offer_revision<2
    or length(trim(coalesce(p_input->>'scope',''))) not between 10 and 4000
    or length(trim(coalesce(p_input->>'commercialTerms',''))) not between 10 and 4000
    or length(trim(coalesce(p_input->>'changeReason',''))) not between 10 and 2000
    or length(coalesce(p_input->>'assumptions',''))>4000
    or length(coalesce(p_input->>'exclusions',''))>4000 then
    raise exception 'invalid_offer_revision_input' using errcode='22023'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor and status='active' for share;
  if not found or v_member.role not in ('admin','project_manager','operations_leader') then
    raise exception 'offer_editor_denied' using errcode='42501'; end if;
  select w.* into v_work from d5o_hosted.work_records w
    join d5o_hosted.work_identity_links l on l.work_id=w.id and l.workspace_id=w.workspace_id
    where w.workspace_id=v_workspace.id and l.presentation_id=p_presentation_id
    for update of w;
  if not found then raise exception 'connected_work_unavailable' using errcode='42501'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_workspace_key,
    p_presentation_id,p_input,p_expected_source_revision,
    p_expected_decision_revision,p_offer_revision)::text);
  select * into v_receipt from d5o_hosted.connected_offer_receipts
    where workspace_id=v_workspace.id and command_id=p_command_id;
  if found then
    if v_receipt.work_id<>v_work.id or v_receipt.actor_user_id<>v_actor
      or v_receipt.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_receipt.result;
  end if;
  select * into v_state from d5o_hosted.prototype_states
    where workspace_id=v_workspace.id and state_key='work' for share;
  select * into v_estimate from d5o_hosted.connected_estimate_states
    where workspace_id=v_workspace.id and work_id=v_work.id for share;
  select * into v_offer from d5o_hosted.connected_offer_states
    where workspace_id=v_workspace.id and work_id=v_work.id for update;
  if v_state.revision is distinct from p_expected_source_revision
    or v_offer.decision_revision is distinct from p_expected_decision_revision then
    raise exception 'stale_state' using errcode='23505'; end if;
  select item into v_raw from pg_catalog.jsonb_array_elements(v_state.state_json->'records') item
    where item->>'id'=p_presentation_id and item->>'canonicalWorkId'=v_work.id::text;
  if v_raw is null or v_raw->>'phaseConfigurationVersionId' is distinct from
      v_work.configuration_version_id::text
    or v_estimate.status is distinct from 'Approved'
    or v_offer.status is distinct from 'Changes requested'
    or v_offer.estimate_revision<>v_estimate.estimate_revision
    or p_offer_revision<>v_offer.offer_revision+1
    or v_actor<>v_offer.submitter then
    raise exception 'returned_offer_revision_required' using errcode='23514'; end if;
  v_package:=pg_catalog.jsonb_build_object(
    'revision',p_offer_revision,'estimateRevision',v_estimate.estimate_revision,
    'scope',trim(p_input->>'scope'),
    'assumptions',trim(coalesce(p_input->>'assumptions','')),
    'exclusions',trim(coalesce(p_input->>'exclusions','')),
    'commercialTerms',trim(p_input->>'commercialTerms'),
    'sellPrice',v_estimate.estimate->'sellPrice','preparedAt',v_now,
    'definitionSource',v_estimate.estimate->'definitionSource',
    'changeReason',trim(p_input->>'changeReason'),
    'pricingBasis',pg_catalog.jsonb_build_object(
      'policyId',v_estimate.estimate#>>'{detailed,evaluation,policyId}',
      'policyVersion',v_estimate.estimate#>'{detailed,evaluation,policyVersion}',
      'solutionRevision',v_estimate.estimate#>'{detailed,input,solutionRevision}',
      'currency',v_estimate.estimate#>>'{detailed,input,currency}',
      'includedCostMinor',v_estimate.estimate#>'{detailed,evaluation,includedCostMinor}',
      'priceMinor',v_estimate.estimate#>'{detailed,evaluation,proposedPriceMinor}'));
  v_proposal:=(v_offer.proposal-'review')||pg_catalog.jsonb_build_object(
    'status','Draft','package',v_package,
    'packageHistory',coalesce(v_offer.proposal->'packageHistory','[]'::jsonb)||
      pg_catalog.jsonb_build_array(v_package),
    'authorityRevision',v_offer.decision_revision+1);
  update d5o_hosted.connected_offer_states set offer_revision=p_offer_revision,
    decision_revision=decision_revision+1,offer_digest=pg_catalog.md5(v_package::text),
    status='Draft',proposal=v_proposal,reviewer=null,updated_at=v_now
    where workspace_id=v_workspace.id and work_id=v_work.id;
  insert into d5o_hosted.connected_offer_events(workspace_id,work_id,decision_revision,
    command_id,action,actor_user_id,membership_id,offer_revision,estimate_revision,
    policy_id,policy_version,snapshot,reason)
  values(v_workspace.id,v_work.id,v_offer.decision_revision+1,p_command_id,
    'save-proposal-revision',v_actor,v_member.id,p_offer_revision,
    v_estimate.estimate_revision,
    v_estimate.estimate#>>'{detailed,evaluation,policyId}',
    (v_estimate.estimate#>>'{detailed,evaluation,policyVersion}')::integer,
    v_proposal,trim(p_input->>'changeReason'));
  v_result:=public.d5o_hosted_prototype_read_v1(p_workspace_key,'work');
  insert into d5o_hosted.connected_offer_receipts(workspace_id,command_id,
    work_id,actor_user_id,fingerprint,result)
  values(v_workspace.id,p_command_id,v_work.id,v_actor,v_fingerprint,v_result);
  return v_result;
end; $$;
revoke all on function public.d5o_hosted_offer_revision_command_v1(
  text,text,jsonb,text,bigint,integer,integer)
  from public,anon,service_role;
grant execute on function public.d5o_hosted_offer_revision_command_v1(
  text,text,jsonb,text,bigint,integer,integer) to authenticated;

create function d5o_hosted.connected_offer_draft_rebase_v1(
  p_workspace uuid,p_raw jsonb,p_submitted jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_new jsonb;v_old jsonb;v_expected jsonb;v_records jsonb:='[]'::jsonb;
begin
  for v_new in select value from pg_catalog.jsonb_array_elements(p_submitted->'records') loop
    select value into v_old from pg_catalog.jsonb_array_elements(p_raw->'records')
      where value->>'id'=v_new->>'id';
    if exists(select 1 from d5o_hosted.work_identity_links l
      join d5o_hosted.connected_offer_states o on o.workspace_id=l.workspace_id
        and o.work_id=l.work_id
      where l.workspace_id=p_workspace and l.presentation_id=v_new->>'id') then
      select value into v_expected from pg_catalog.jsonb_array_elements(
        d5o_hosted.connected_define_projection_v1(p_workspace,p_raw)->'records')
        where value->>'id'=v_new->>'id';
      if v_new#>'{discovery,proposal}' is distinct from
          v_expected#>'{discovery,proposal}' then
        raise exception 'typed_offer_command_required' using errcode='42501'; end if;
      v_new:=pg_catalog.jsonb_set(v_new,'{discovery,proposal}',
        v_old#>'{discovery,proposal}',true);
      v_new:=v_new||pg_catalog.jsonb_build_object('nextAction',v_expected->'nextAction');
    elsif v_new#>'{discovery,proposal}' is distinct from
        v_old#>'{discovery,proposal}' then
      select value into v_expected from pg_catalog.jsonb_array_elements(
        d5o_hosted.connected_define_projection_v1(p_workspace,p_raw)->'records')
        where value->>'id'=v_new->>'id';
      v_new:=v_new||pg_catalog.jsonb_build_object('nextAction',v_expected->'nextAction');
    end if;
    v_records:=v_records||pg_catalog.jsonb_build_array(v_new);
  end loop;
  return pg_catalog.jsonb_set(p_submitted,'{records}',v_records);
end; $$;
revoke all on function d5o_hosted.connected_offer_draft_rebase_v1(uuid,jsonb,jsonb)
  from public,anon,authenticated,service_role;

-- Replace only the authenticated draft save wrapper; the existing trigger,
-- protected-field comparison and estimate/solution rebases stay in force.
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
      d5o_hosted.connected_estimate_draft_rebase_v1(v_workspace,v_prior.state_json,
        d5o_hosted.connected_offer_draft_rebase_v1(v_workspace,v_prior.state_json,v_input))),
    v_prior.revision+1);
  update d5o_hosted.prototype_states set revision=revision+1,state_json=v_state,
    updated_by=auth.uid(),updated_at=now()
    where workspace_id=v_workspace and state_key='work' returning revision into v_revision;
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
