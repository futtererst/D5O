-- Solution review is a separate decision on the accepted Define basis.
-- Draft alternatives remain editable in the work projection; a review does not.
create table d5o_hosted.connected_solution_states (
  workspace_id uuid not null,
  work_id uuid not null,
  source_digest text not null,
  solution_revision integer not null check (solution_revision>0),
  decision_revision integer not null check (decision_revision>0),
  status text not null check (status in ('Submitted','Approved','Returned')),
  submitter uuid not null references auth.users(id),
  reviewer uuid references auth.users(id),
  review jsonb not null check (pg_catalog.jsonb_typeof(review)='object'),
  next_action text not null,
  updated_at timestamptz not null default now(),
  primary key (workspace_id,work_id),
  foreign key (work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id)
);
create table d5o_hosted.connected_solution_events (
  workspace_id uuid not null,work_id uuid not null,
  decision_revision integer not null,command_id text not null,
  action text not null,solution_revision integer not null,
  actor_user_id uuid not null references auth.users(id),
  membership_id uuid not null references d5o_hosted.memberships(id),
  authority_role text not null,configuration_version_id uuid not null,
  pricing_policy_id text not null,pricing_policy_version integer not null,
  source_digest text not null,reason text not null,
  occurred_at timestamptz not null default now(),
  primary key (workspace_id,work_id,decision_revision),
  unique (workspace_id,command_id),
  foreign key (work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id)
);
create table d5o_hosted.connected_solution_receipts (
  workspace_id uuid not null,command_id text not null,work_id uuid not null,
  actor_user_id uuid not null references auth.users(id),
  fingerprint text not null,result jsonb not null,
  primary key (workspace_id,command_id),
  foreign key (work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id)
);
alter table d5o_hosted.connected_solution_states enable row level security;
alter table d5o_hosted.connected_solution_events enable row level security;
alter table d5o_hosted.connected_solution_receipts enable row level security;
revoke all on d5o_hosted.connected_solution_states,d5o_hosted.connected_solution_events,
  d5o_hosted.connected_solution_receipts from public,anon,authenticated;

create function d5o_hosted.connected_solution_digest_v1(p_plan jsonb)
returns text language sql immutable set search_path='' as $$
  select pg_catalog.md5((p_plan-'review'-'authorityRevision'-'history')::text);
$$;
revoke all on function d5o_hosted.connected_solution_digest_v1(jsonb)
  from public,anon,authenticated,service_role;

create or replace function d5o_hosted.connected_define_projection_v1(p_workspace uuid,p_state jsonb)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when p_state is null then null else
    pg_catalog.jsonb_set(p_state,'{records}',coalesce((
      select pg_catalog.jsonb_agg(
        case when s.work_id is null then defined else
          defined||pg_catalog.jsonb_build_object(
            'develop',coalesce(defined->'develop','{}'::jsonb)||
              pg_catalog.jsonb_build_object('review',s.review,
                'authorityRevision',s.decision_revision),
            'nextAction',case when s.source_digest is distinct from
              d5o_hosted.connected_solution_digest_v1(item->'develop') then
              'Solution changed: submit a new revision for review'
              else s.next_action end) end order by ordinal)
      from pg_catalog.jsonb_array_elements(coalesce(p_state->'records','[]'::jsonb))
        with ordinality as records(item,ordinal)
      left join d5o_hosted.work_identity_links l on l.workspace_id=p_workspace
        and l.presentation_id=item->>'id'
      left join d5o_hosted.connected_define_states d on d.workspace_id=p_workspace
        and d.work_id=l.work_id
      left join d5o_hosted.connected_solution_states s on s.workspace_id=p_workspace
        and s.work_id=l.work_id
      cross join lateral (select coalesce(d5o_hosted.connected_pursuit_record_v1(
        p_workspace,item),item) as base) pursuit
      cross join lateral (select case when d.work_id is null then base else
        base||pg_catalog.jsonb_build_object('definition',d.projection,
          'nextAction',d.next_action) end as defined) definition
    ),'[]'::jsonb)) end;
$$;
revoke all on function d5o_hosted.connected_define_projection_v1(uuid,jsonb)
  from public,anon,authenticated,service_role;

create function public.d5o_hosted_solution_command_v1(
  p_workspace_key text,p_presentation_id text,p_action text,p_due_date text,
  p_reason text,p_command_id text,p_expected_source_revision bigint,
  p_expected_decision_revision integer,p_solution_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
  v_member d5o_hosted.memberships%rowtype;v_work d5o_hosted.work_records%rowtype;
  v_state d5o_hosted.prototype_states%rowtype;
  v_define d5o_hosted.connected_define_states%rowtype;
  v_control d5o_hosted.connected_solution_states%rowtype;
  v_receipt d5o_hosted.connected_solution_receipts%rowtype;
  v_raw jsonb;v_plan jsonb;v_option jsonb;v_requirement jsonb;
  v_policy jsonb;v_review jsonb;v_digest text;
  v_fingerprint text;v_next text;v_result jsonb;v_now timestamptz:=now();
  v_policy_id text;v_policy_version integer;v_approver_role text;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or p_action not in ('submit-solution','approve-solution','return-solution')
    or p_command_id is null or length(p_command_id) not between 8 and 120
    or p_expected_source_revision is null or p_expected_source_revision<1
    or p_expected_decision_revision is null or p_expected_decision_revision<0
    or p_solution_revision is null or p_solution_revision<1
    or length(coalesce(p_reason,''))>2000 then
    raise exception 'invalid_solution_command' using errcode='22023'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor and status='active' for share;
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  select w.* into v_work from d5o_hosted.work_records w
    join d5o_hosted.work_identity_links l on l.work_id=w.id and l.workspace_id=w.workspace_id
    where w.workspace_id=v_workspace.id and l.presentation_id=p_presentation_id for update of w;
  if not found then raise exception 'connected_work_unavailable' using errcode='42501'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_workspace_key,p_presentation_id,
    p_action,p_due_date,trim(coalesce(p_reason,'')),p_expected_source_revision,
    p_expected_decision_revision,p_solution_revision)::text);
  select * into v_receipt from d5o_hosted.connected_solution_receipts
    where workspace_id=v_workspace.id and command_id=p_command_id;
  if found then
    if v_receipt.work_id<>v_work.id or v_receipt.actor_user_id<>v_actor
      or v_receipt.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_receipt.result;
  end if;
  select * into v_state from d5o_hosted.prototype_states
    where workspace_id=v_workspace.id and state_key='work' for share;
  select * into v_control from d5o_hosted.connected_solution_states
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
  if not found or v_define.status<>'Approved'
    or v_define.projection#>>'{developHandoff,status}'<>'accepted'
    or v_define.projection#>>'{developHandoff,revision}'<>
       v_define.definition_revision::text then
    raise exception 'accepted_define_basis_required' using errcode='23514'; end if;
  v_plan:=v_raw->'develop';
  if v_plan is null or (v_plan->>'revision')::integer is distinct from p_solution_revision
    or v_raw#>'{develop,review}' is not null then
    raise exception 'solution_revision_unavailable' using errcode='23514'; end if;
  v_digest:=d5o_hosted.connected_solution_digest_v1(v_plan);
  select p.payload into v_policy from d5o_hosted.connected_pricing_active a
    join d5o_hosted.connected_pricing_policies p on p.workspace_id=a.workspace_id
      and p.policy_id=a.policy_id and p.version=a.version
    where a.workspace_id=v_workspace.id and p.status='published'
      and (p.payload->>'effectiveFrom')::date<=v_now::date
      and (p.payload->>'effectiveTo' is null or
        (p.payload->>'effectiveTo')::date>=v_now::date);
  if v_policy is null then raise exception 'pricing_policy_unavailable' using errcode='23514'; end if;
  v_policy_id:=v_policy->>'id';v_policy_version:=(v_policy->>'version')::integer;
  v_approver_role:=coalesce(v_policy->>'solutionApproverRole','operations_leader');
  if v_approver_role not in ('admin','operations_leader') then
    raise exception 'pricing_policy_invalid' using errcode='23514'; end if;
  if p_action='submit-solution' then
    if v_member.role not in ('admin','project_manager','operations_leader')
      or p_due_date is null or p_due_date !~ '^\d{4}-\d{2}-\d{2}$'
      or (v_control.work_id is not null and
        (v_control.status='Submitted' or p_solution_revision<=v_control.solution_revision)) then
      raise exception 'solution_submit_denied' using errcode='42501'; end if;
    select item into v_option from pg_catalog.jsonb_array_elements(
      coalesce(v_plan->'options','[]'::jsonb)) item
      where item->>'id'=v_plan->>'selectedOptionId';
    if v_option is null or v_option->>'status'<>'Viable'
      or length(trim(coalesce(v_option->>'unmetRequirements','')))>0
      or length(trim(coalesce(v_plan->>'selectionRationale','')))=0
      or exists(select 1 from pg_catalog.jsonb_array_elements(
        coalesce(v_define.projection#>'{scopeControl,requirements}','[]'::jsonb)) r
        where r->>'state'='Confirmed' and not
          coalesce(v_option->'requirementIds','[]'::jsonb) ? (r->>'id')) then
      raise exception 'solution_infeasible' using errcode='23514'; end if;
    if exists(select 1 from pg_catalog.unnest(array['laborStrategy','procurementStrategy',
      'scheduleStrategy','safetyStrategy','qualityStrategy','riskMitigation']) field
      where length(trim(coalesce(v_plan->>field,'')))=0) then
      raise exception 'strategy_incomplete' using errcode='23514'; end if;
    v_review:=pg_catalog.jsonb_build_object('revision',p_solution_revision,
      'status','Submitted','dueDate',p_due_date,'submittedAt',v_now,
      'submittedByActorId',v_actor,'submittedByMembershipId',v_member.id,
      'approverRole',v_approver_role,'policyId',v_policy_id,
      'policyVersion',v_policy_version,'defineRevision',v_define.definition_revision);
    v_next:='Review solution revision '||p_solution_revision::text;
    if v_control.work_id is null then
      insert into d5o_hosted.connected_solution_states(workspace_id,work_id,
        source_digest,solution_revision,decision_revision,status,submitter,review,next_action)
      values(v_workspace.id,v_work.id,v_digest,p_solution_revision,1,'Submitted',
        v_actor,v_review,v_next);
    else
      update d5o_hosted.connected_solution_states set source_digest=v_digest,
        solution_revision=p_solution_revision,decision_revision=decision_revision+1,
        status='Submitted',submitter=v_actor,reviewer=null,review=v_review,
        next_action=v_next,updated_at=v_now
        where workspace_id=v_workspace.id and work_id=v_work.id;
    end if;
  else
    if v_control.status<>'Submitted' or v_control.solution_revision<>p_solution_revision
      or v_control.source_digest<>v_digest or v_actor=v_control.submitter
      or v_member.role<>v_control.review->>'approverRole'
      or v_policy_id is distinct from v_control.review->>'policyId'
      or v_policy_version is distinct from
        (v_control.review->>'policyVersion')::integer
      or length(trim(coalesce(p_reason,'')))<10 then
      raise exception 'independent_solution_review_required' using errcode='42501'; end if;
    v_review:=v_control.review||pg_catalog.jsonb_build_object(
      'status',case when p_action='approve-solution' then 'Approved' else 'Returned' end,
      'decidedAt',v_now,'decidedByActorId',v_actor,
      'decidedByMembershipId',v_member.id,'note',trim(p_reason));
    v_next:=case when p_action='approve-solution' then
      'Complete and submit detailed estimate' else 'Revise the selected solution' end;
    update d5o_hosted.connected_solution_states set
      decision_revision=decision_revision+1,
      status=case when p_action='approve-solution' then 'Approved' else 'Returned' end,
      reviewer=v_actor,review=v_review,next_action=v_next,updated_at=v_now
      where workspace_id=v_workspace.id and work_id=v_work.id;
  end if;
  select * into v_control from d5o_hosted.connected_solution_states
    where workspace_id=v_workspace.id and work_id=v_work.id;
  insert into d5o_hosted.connected_solution_events(workspace_id,work_id,decision_revision,
    command_id,action,solution_revision,actor_user_id,membership_id,authority_role,
    configuration_version_id,pricing_policy_id,pricing_policy_version,source_digest,reason)
  values(v_workspace.id,v_work.id,v_control.decision_revision,p_command_id,p_action,
    p_solution_revision,v_actor,v_member.id,v_member.role,v_work.configuration_version_id,
    v_policy_id,v_policy_version,v_digest,trim(coalesce(p_reason,'')));
  v_result:=public.d5o_hosted_prototype_read_v1(p_workspace_key,'work');
  insert into d5o_hosted.connected_solution_receipts(workspace_id,command_id,work_id,
    actor_user_id,fingerprint,result)
  values(v_workspace.id,p_command_id,v_work.id,v_actor,v_fingerprint,v_result);
  return v_result;
end; $$;
revoke all on function public.d5o_hosted_solution_command_v1(
  text,text,text,text,text,text,bigint,integer,integer)
  from public,anon,service_role;
grant execute on function public.d5o_hosted_solution_command_v1(
  text,text,text,text,text,text,bigint,integer,integer) to authenticated;

-- A draft save may carry the projected review from a member read. Compare it
-- to the current DB-owned review, then write back only the draft plan. This
-- keeps the privileged replacement writer's review lock intact.
create function d5o_hosted.connected_solution_draft_rebase_v1(
  p_workspace uuid,p_raw jsonb,p_submitted jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_new jsonb;v_old jsonb;v_expected jsonb;v_control record;
  v_records jsonb:='[]'::jsonb;v_plan jsonb;v_prior_plan jsonb;
begin
  v_expected:=d5o_hosted.connected_define_projection_v1(p_workspace,p_raw);
  for v_new in select value from pg_catalog.jsonb_array_elements(p_submitted->'records') loop
    select value into v_old from pg_catalog.jsonb_array_elements(p_raw->'records')
      where value->>'id'=v_new->>'id';
    select value into v_expected from pg_catalog.jsonb_array_elements(
      d5o_hosted.connected_define_projection_v1(p_workspace,p_raw)->'records')
      where value->>'id'=v_new->>'id';
    select s.review,s.decision_revision,d.next_action as define_next,
      p.next_action as pursuit_next into v_control
      from d5o_hosted.work_identity_links l
      join d5o_hosted.connected_solution_states s on s.workspace_id=l.workspace_id
        and s.work_id=l.work_id
      left join d5o_hosted.connected_define_states d on d.workspace_id=l.workspace_id
        and d.work_id=l.work_id
      left join d5o_hosted.connected_pursuit_states p on p.workspace_id=l.workspace_id
        and p.work_id=l.work_id
      where l.workspace_id=p_workspace and l.presentation_id=v_new->>'id';
    if found then
      if v_new#>'{develop,review}' is distinct from v_control.review
        or v_new#>>'{develop,authorityRevision}' is distinct from
          v_control.decision_revision::text
        or v_new->>'nextAction' is distinct from v_expected->>'nextAction' then
        raise exception 'typed_solution_command_required' using errcode='42501'; end if;
      v_plan:=v_new->'develop';v_prior_plan:=v_old->'develop';
      v_plan:=v_plan-'review'-'authorityRevision';
      if v_prior_plan ? 'review' then
        v_plan:=v_plan||pg_catalog.jsonb_build_object('review',v_prior_plan->'review'); end if;
      if v_prior_plan ? 'authorityRevision' then
        v_plan:=v_plan||pg_catalog.jsonb_build_object(
          'authorityRevision',v_prior_plan->'authorityRevision'); end if;
      v_new:=pg_catalog.jsonb_set(v_new,'{develop}',v_plan);
      v_new:=v_new||pg_catalog.jsonb_build_object('nextAction',
        coalesce(v_control.define_next,v_control.pursuit_next,v_old->>'nextAction'));
    end if;
    v_records:=v_records||pg_catalog.jsonb_build_array(v_new);
  end loop;
  return pg_catalog.jsonb_set(p_submitted,'{records}',v_records);
end; $$;
revoke all on function d5o_hosted.connected_solution_draft_rebase_v1(uuid,jsonb,jsonb)
  from public,anon,authenticated,service_role;

create or replace function public.d5o_hosted_prototype_save_v1(
  p_workspace_key text,p_state_key text,p_expected_revision bigint,p_state jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_workspace uuid;v_membership d5o_hosted.memberships%rowtype;
  v_prior d5o_hosted.prototype_states%rowtype;v_state jsonb;v_revision bigint;
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
  v_state:=d5o_hosted.connected_draft_snapshot_v1(v_workspace,v_prior.state_json,
    d5o_hosted.connected_solution_draft_rebase_v1(
      v_workspace,v_prior.state_json,p_state),v_prior.revision+1);
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
  to authenticated;
