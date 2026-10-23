-- Handoff routing belongs to published configuration, never to a submitting user.
-- Existing pinned versions receive an explicit migration-owned route; new versions
-- use the administrator-published d5oPresentation.handoffRoles manifest.
create table d5o_hosted.configuration_handoff_roles (
  configuration_version_id uuid not null references d5o_hosted.configuration_versions(id),
  route_key text not null check (route_key in ('discoverDefine','designDeploy','deployOperate')),
  receiving_role text not null check (receiving_role in ('admin','operations_leader','project_manager')),
  configured_at timestamptz not null default now(),
  primary key (configuration_version_id, route_key),
  check (route_key <> 'deployOperate' or receiving_role = 'operations_leader')
);
alter table d5o_hosted.configuration_handoff_roles enable row level security;
revoke all on d5o_hosted.configuration_handoff_roles from public, anon, authenticated;
insert into d5o_hosted.configuration_handoff_roles(configuration_version_id,route_key,receiving_role)
select v.id,r.route_key,r.receiving_role from d5o_hosted.configuration_versions v
cross join (values ('discoverDefine','operations_leader'),
  ('designDeploy','operations_leader'),('deployOperate','operations_leader')) r(route_key,receiving_role)
on conflict do nothing;

create function d5o_hosted.configured_handoff_role_v1(p_version uuid,p_route text)
returns text language plpgsql stable set search_path='' as $$
declare v_role text;
begin
  if p_route not in ('discoverDefine','designDeploy','deployOperate') then
    raise exception 'handoff_route_unavailable' using errcode='23514'; end if;
  select nullif(v.manifest_json#>>array['d5oPresentation','handoffRoles',p_route],'')
    into v_role from d5o_hosted.configuration_versions v
    where v.id=p_version and v.status in ('published','superseded');
  if v_role is null then
    select r.receiving_role into v_role from d5o_hosted.configuration_handoff_roles r
      where r.configuration_version_id=p_version and r.route_key=p_route;
  end if;
  if v_role not in ('admin','operations_leader','project_manager')
    or (p_route='deployOperate' and v_role<>'operations_leader') then
    raise exception 'handoff_route_unavailable' using errcode='23514'; end if;
  return v_role;
end $$;
revoke all on function d5o_hosted.configured_handoff_role_v1(uuid,text)
  from public, anon, authenticated;

-- Revised typed commands retain existing locks, revisions, replay receipts and decision history.
create or replace function public.d5o_hosted_pursuit_command_v1(
  p_workspace_key text,p_presentation_id text,p_action text,p_intent jsonb,
  p_command_id text,p_expected_source_revision bigint,p_expected_decision_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_workspace d5o_hosted.workspaces%rowtype;
  v_member d5o_hosted.memberships%rowtype; v_work d5o_hosted.work_records%rowtype;
  v_state d5o_hosted.prototype_states%rowtype; v_control d5o_hosted.connected_pursuit_states%rowtype;
  v_receipt d5o_hosted.connected_pursuit_receipts%rowtype; v_raw jsonb;
  v_projection jsonb; v_fingerprint text; v_source_digest text;
  v_next text; v_fit text; v_reason text; v_result jsonb; v_receiving_role text;
  v_now timestamptz:=now();
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or p_action not in ('save-intake','submit','decide','submit-handoff','respond-handoff')
    or p_intent is null or pg_catalog.jsonb_typeof(p_intent)<>'object'
    or p_command_id is null or length(p_command_id) not between 8 and 120
    or p_expected_source_revision is null or p_expected_source_revision<1
    or p_expected_decision_revision is null or p_expected_decision_revision<0 then
    raise exception 'invalid_pursuit_command' using errcode='22023'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor and status='active' for share;
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  select w.* into v_work from d5o_hosted.work_records w
    join d5o_hosted.work_identity_links l on l.workspace_id=w.workspace_id and l.work_id=w.id
    where w.workspace_id=v_workspace.id and l.presentation_id=p_presentation_id for update of w;
  if not found then raise exception 'connected_work_unavailable' using errcode='42501'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_workspace_key,p_presentation_id,
    p_action,p_intent,p_expected_source_revision,p_expected_decision_revision)::text);
  select * into v_receipt from d5o_hosted.connected_pursuit_receipts
    where workspace_id=v_workspace.id and command_id=p_command_id;
  if found then
    if v_receipt.work_id<>v_work.id or v_receipt.actor_user_id<>v_actor
      or v_receipt.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_receipt.result;
  end if;
  select * into v_state from d5o_hosted.prototype_states
    where workspace_id=v_workspace.id and state_key='work' for share;
  select * into v_control from d5o_hosted.connected_pursuit_states
    where workspace_id=v_workspace.id and work_id=v_work.id for update;
  if v_state.revision is distinct from p_expected_source_revision
    or coalesce(v_control.decision_revision,0)<>p_expected_decision_revision then
    raise exception 'stale_state' using errcode='23505'; end if;
  select item into v_raw from pg_catalog.jsonb_array_elements(v_state.state_json->'records') item
    where item->>'id'=p_presentation_id and item->>'canonicalWorkId'=v_work.id::text;
  if v_raw is null or v_raw->>'phaseConfigurationVersionId' is distinct from v_work.configuration_version_id::text
    then raise exception 'source_identity_changed' using errcode='42501'; end if;
  v_source_digest:=d5o_hosted.connected_pursuit_source_digest_v1(v_raw);
  if v_control.work_id is not null and v_control.source_digest<>v_source_digest
    and p_action<>'save-intake' then
    raise exception 'pursuit_source_changed' using errcode='23505'; end if;
  v_projection:=coalesce(v_control.projection,v_raw#>'{discovery,pursuitControl}');
  if v_projection is null then raise exception 'pursuit_draft_unavailable' using errcode='22023'; end if;
  v_reason:=trim(coalesce(p_intent->>'reason',''));
  if p_action='save-intake' then
    if v_member.role not in ('admin','project_manager','business_development_lead')
      or coalesce(v_control.status,'draft') not in ('draft','returned','held')
      or p_intent-'requester'-'intendedOutcome'-'roughValue'-'currency'-'requiredDate'-'knownRisk'
        -'customer'-'site'-'owner'-'need'<>'{}'::jsonb
      or p_intent->>'customer' is distinct from v_raw->>'customer'
      or p_intent->>'site' is distinct from v_raw->>'site'
      or p_intent->>'owner' is distinct from v_raw->>'owner'
      or p_intent->>'need' is distinct from v_raw#>>'{discovery,need}'
      or length(trim(coalesce(p_intent->>'requester','')))=0
      or length(trim(coalesce(p_intent->>'intendedOutcome','')))=0
      or (p_intent->>'roughValue') !~ '^[0-9]+(\.[0-9]{1,2})?$'
      or (p_intent->>'roughValue')::numeric<=0
      or (p_intent->>'currency') !~ '^[A-Z]{3}$'
      or (p_intent->>'requiredDate') !~ '^\d{4}-\d{2}-\d{2}$'
      or length(trim(coalesce(p_intent->>'knownRisk','')))=0 then
      raise exception 'invalid_pursuit_intake' using errcode='22023'; end if;
    v_projection:=v_projection||pg_catalog.jsonb_build_object('status','draft',
      'requester',trim(p_intent->>'requester'),
      'intendedOutcome',trim(p_intent->>'intendedOutcome'),
      'roughValue',p_intent->>'roughValue','currency',p_intent->>'currency',
      'requiredDate',p_intent->>'requiredDate','knownRisk',trim(p_intent->>'knownRisk'));
    v_next:='Submit intake for pursuit decision'; v_fit:='Unassessed';
  elsif p_action='submit' then
    if v_member.role not in ('admin','project_manager','business_development_lead')
      or coalesce(v_control.status,'draft')<>'draft'
      or length(trim(coalesce(v_projection->>'requester','')))=0
      or length(trim(coalesce(v_projection->>'intendedOutcome','')))=0
      or length(trim(coalesce(v_projection->>'roughValue','')))=0
      or length(trim(coalesce(v_projection->>'requiredDate','')))=0
      or length(trim(coalesce(v_projection->>'knownRisk','')))=0
      or length(trim(coalesce(v_raw->>'customer','')))=0
      or length(trim(coalesce(v_raw->>'site','')))=0
      or length(trim(coalesce(v_raw->>'owner','')))=0
      or length(trim(coalesce(v_raw#>>'{discovery,need}','')))=0 then
      raise exception 'pursuit_intake_incomplete' using errcode='23514'; end if;
    v_projection:=v_projection||pg_catalog.jsonb_build_object('status','submitted',
      'submission',pg_catalog.jsonb_build_object('revision',p_expected_decision_revision+1,
        'at',v_now,'actor',v_actor::text,'actorId',v_actor));
    v_control.status:='submitted'; v_control.submitter:=v_actor;
    v_next:='Qualification authority: decide pursuit';
    v_fit:='Unassessed';
  elsif p_action='decide' then
    if v_member.role not in ('admin','billing_commercial_lead','business_development_lead')
      or v_control.status<>'submitted' or v_actor=v_control.submitter
      or p_intent-'outcome'-'reason'<>'{}'::jsonb
      or p_intent->>'outcome' not in ('qualified','returned','held','declined')
      or length(v_reason)<10 then
      raise exception 'pursuit_decision_denied' using errcode='42501'; end if;
    if p_intent->>'outcome'='qualified' and v_raw#>'{discovery,crm}' is not null
      and (v_raw#>>'{discovery,crm,disqualifier}'<>'None'
        or (v_raw#>'{discovery,crm,assessmentHistory}'->-1)->>'recommendation'
          not in ('Pursue','Pursue with conditions')) then
      raise exception 'pursuit_assessment_unfavorable' using errcode='23514'; end if;
    v_control.status:=p_intent->>'outcome'; v_control.decider:=v_actor;
    v_projection:=v_projection||pg_catalog.jsonb_build_object('status',v_control.status,
      'decision',pg_catalog.jsonb_build_object('revision',v_projection#>'{submission,revision}',
        'outcome',v_control.status,'reason',v_reason,'at',v_now,'actor',v_actor::text,
        'actorId',v_actor,'policyVersion',v_work.configuration_version_id));
    v_fit:=case when v_control.status='qualified' then 'Qualified'
      when v_control.status='declined' then 'Disqualified' else 'Unassessed' end;
    v_next:=case when v_control.status='qualified' then
      'Request bounded pursuit spend or send Define handoff' else
      'Correct intake or retain the pursuit decision' end;
  elsif p_action='submit-handoff' then
    if v_member.role not in ('admin','project_manager','business_development_lead')
      or v_control.status<>'qualified' or v_projection#>>'{handoff,status}' in ('submitted','accepted')
      or p_intent-'brief'<>'{}'::jsonb
      or length(trim(coalesce(p_intent->>'brief','')))<20 then
      raise exception 'pursuit_handoff_denied' using errcode='42501'; end if;
    v_receiving_role:=d5o_hosted.configured_handoff_role_v1(v_work.configuration_version_id,'discoverDefine');
    if not exists(select 1 from d5o_hosted.memberships m
      where m.workspace_id=v_workspace.id and m.status='active'
        and m.role=v_receiving_role and m.actor_user_id<>v_actor) then
      raise exception 'configured_receiver_unavailable' using errcode='23514'; end if;
    v_projection:=pg_catalog.jsonb_set(v_projection,'{handoff}',
      pg_catalog.jsonb_build_object('status','submitted',
        'receiver','Configured '||v_receiving_role||' queue',
        'receiverRole',v_receiving_role,'brief',trim(p_intent->>'brief'),
        'revision',coalesce((v_projection#>>'{handoff,revision}')::integer,0)+1,
        'actor',v_actor::text,'actorId',v_actor,'at',v_now));
    v_control.handoff_sender:=v_actor; v_next:='Define receiver: accept or return the pursuit brief';
    v_fit:='Qualified';
  elsif p_action='respond-handoff' then
    if v_member.role not in ('admin','operations_leader','project_manager')
      or v_control.status<>'qualified' or v_projection#>>'{handoff,status}'<>'submitted'
      or v_actor=v_control.handoff_sender
      or (case when v_projection#>>'{handoff,receiverRole}' is not null
          then v_member.role is distinct from v_projection#>>'{handoff,receiverRole}'
          else v_actor::text is distinct from v_projection#>>'{handoff,receiverActorId}' end)
      or p_intent-'outcome'-'reason'<>'{}'::jsonb
      or p_intent->>'outcome' not in ('accepted','returned')
      or length(v_reason)<10 then
      raise exception 'pursuit_receipt_denied' using errcode='42501'; end if;
    v_projection:=pg_catalog.jsonb_set(v_projection,'{handoff}',
      (v_projection->'handoff')||pg_catalog.jsonb_build_object(
        'status',p_intent->>'outcome','reason',v_reason,'actor',v_actor::text,
        'actorId',v_actor,'at',v_now));
    v_control.handoff_receiver:=v_actor;
    v_next:=case when p_intent->>'outcome'='accepted' then
      'Define owner: establish scope baseline' else
      'Pursuit owner: correct Define brief' end;
    v_fit:='Qualified';
  end if;
  v_projection:=v_projection||pg_catalog.jsonb_build_object(
    'revision',p_expected_decision_revision+1,
    'history',coalesce(v_projection->'history','[]'::jsonb)||
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'revision',p_expected_decision_revision+1,'action',p_action,
        'actor',v_actor::text,'at',v_now,'note',coalesce(nullif(v_reason,''),p_action))));
  if v_control.work_id is null then
    insert into d5o_hosted.connected_pursuit_states(workspace_id,work_id,source_digest,
      decision_revision,status,projection,fit,next_action)
    values(v_workspace.id,v_work.id,v_source_digest,1,'draft',v_projection,v_fit,v_next);
  else
    update d5o_hosted.connected_pursuit_states set source_digest=v_source_digest,
      decision_revision=decision_revision+1,
      status=v_projection->>'status',submitter=coalesce(v_control.submitter,submitter),
      decider=coalesce(v_control.decider,decider),
      handoff_sender=coalesce(v_control.handoff_sender,handoff_sender),
      handoff_receiver=coalesce(v_control.handoff_receiver,handoff_receiver),
      projection=v_projection,fit=v_fit,next_action=v_next,updated_at=v_now
    where workspace_id=v_workspace.id and work_id=v_work.id;
  end if;
  insert into d5o_hosted.connected_pursuit_events(workspace_id,work_id,decision_revision,
    command_id,action,actor_user_id,membership_id,authority_role,configuration_version_id,
    source_digest,reason)
  values(v_workspace.id,v_work.id,p_expected_decision_revision+1,p_command_id,p_action,
    v_actor,v_member.id,v_member.role,v_work.configuration_version_id,v_source_digest,v_reason);
  v_result:=public.d5o_hosted_prototype_read_v1(p_workspace_key,'work');
  insert into d5o_hosted.connected_pursuit_receipts(workspace_id,command_id,work_id,
    actor_user_id,fingerprint,result)
  values(v_workspace.id,p_command_id,v_work.id,v_actor,v_fingerprint,v_result);
  return v_result;
end; $$;

create or replace function public.d5o_hosted_design_release_command_v1(
  p_workspace_key text,p_presentation_id text,p_action text,p_input jsonb,
  p_command_id text,p_expected_source_revision bigint,
  p_expected_decision_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
  v_member d5o_hosted.memberships%rowtype;v_work d5o_hosted.work_records%rowtype;
  v_raw d5o_hosted.prototype_states%rowtype;
  v_handoff d5o_hosted.connected_design_handoffs%rowtype;
  v_design d5o_hosted.connected_design_states%rowtype;
  v_receipt d5o_hosted.connected_design_receipts%rowtype;
  v_policy jsonb;v_state jsonb;v_source jsonb;v_target jsonb;
  v_demand jsonb;v_release jsonb;v_review jsonb;v_doc jsonb;
  v_item jsonb;v_ref text;v_package text;v_revision integer;
  v_id text;v_receiving_role text;v_note text:=trim(coalesce(p_input->>'note',''));
  v_now timestamptz:=now();v_fingerprint text;v_result jsonb;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or p_action not in ('release-package','respond-receipt')
    or pg_catalog.jsonb_typeof(p_input)<>'object'
    or length(coalesce(p_command_id,'')) not between 8 and 120
    or p_expected_source_revision is null or p_expected_source_revision<1
    or p_expected_decision_revision is null or p_expected_decision_revision<1 then
    raise exception 'invalid_design_release_command' using errcode='22023'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor and status='active' for share;
  if not found or v_member.role not in ('admin','project_manager','operations_leader') then
    raise exception 'design_release_role_denied' using errcode='42501'; end if;
  select w.* into v_work from d5o_hosted.work_records w
    join d5o_hosted.work_identity_links l on l.work_id=w.id and l.workspace_id=w.workspace_id
    where w.workspace_id=v_workspace.id and l.presentation_id=p_presentation_id
    for update of w;
  if not found then raise exception 'connected_work_unavailable' using errcode='42501'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_workspace_key,
    p_presentation_id,p_action,p_input,p_expected_source_revision,
    p_expected_decision_revision)::text);
  select * into v_receipt from d5o_hosted.connected_design_receipts
    where workspace_id=v_workspace.id and command_id=p_command_id;
  if found then
    if v_receipt.work_id<>v_work.id or v_receipt.actor_user_id<>v_actor
      or v_receipt.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_receipt.result;
  end if;
  select * into v_raw from d5o_hosted.prototype_states
    where workspace_id=v_workspace.id and state_key='work' for share;
  select * into v_handoff from d5o_hosted.connected_design_handoffs
    where workspace_id=v_workspace.id and work_id=v_work.id for share;
  select * into v_design from d5o_hosted.connected_design_states
    where workspace_id=v_workspace.id and work_id=v_work.id for update;
  if v_raw.revision is distinct from p_expected_source_revision
    or v_design.decision_revision is distinct from p_expected_decision_revision
    or v_handoff.status is distinct from 'accepted'
    or v_design.source_handoff_revision<>v_handoff.revision then
    raise exception 'stale_design_release_basis' using errcode='23505'; end if;
  select wt->'designControls' into v_policy
    from d5o_hosted.configuration_versions c,
      lateral pg_catalog.jsonb_array_elements(
        c.manifest_json#>'{d5oPresentation,phaseContract,workTypes}') wt
    where c.id=v_work.configuration_version_id
      and wt->>'workTypeKey'=v_work.work_type_key;
  if v_policy is null or v_policy->>'schemaVersion'<>'1' then
    raise exception 'pinned_design_policy_unavailable' using errcode='23514'; end if;
  v_source:=d5o_hosted.connected_design_source_v1(v_workspace.id,v_work.id,v_raw.state_json);
  v_state:=v_design.state;
  if p_action='release-package' then
    if v_member.role not in ('project_manager','operations_leader','admin') then
      raise exception 'delivery_release_authority_required' using errcode='42501'; end if;
    if v_policy->>'allowPartialRelease'<>'true' then
      raise exception 'partial_release_policy_denied' using errcode='23514'; end if;
    v_package:=p_input->>'packageId';
    select p into v_target from pg_catalog.jsonb_array_elements(v_state->'packages') p
      where p->>'packageId'=v_package;
    if v_target is null or not exists(select 1 from
      pg_catalog.jsonb_array_elements(v_source->'packages') p
        where p->>'id'=v_package) then
      raise exception 'release_package_unavailable' using errcode='23514'; end if;
    v_revision:=(v_target->>'revision')::integer;
    if exists(select 1 from pg_catalog.jsonb_array_elements(v_state->'releases') r
      where r->>'packageId'=v_package and r->>'status' in ('Awaiting receipt','Accepted')) then
      raise exception 'active_release_exists' using errcode='23514'; end if;
    if p_input ? 'receivingOwner' or
      coalesce(p_input->>'dueDate','') !~ '^\d{4}-\d{2}-\d{2}$' or
      length(v_note)<15 then
      raise exception 'release_receiver_and_reason_required' using errcode='22023'; end if;
    if v_target->>'scope'='' or v_target->>'location'=''
      or v_target->>'systems'='' or v_target->>'safetyControls'=''
      or v_target->>'verification'='' or v_target->>'proof'=''
      or v_target->>'acceptingAuthority'=''
      or (v_policy->>'requireAccess'='true' and v_target->>'access'='')
      or (v_policy->>'requirePermit'='true' and v_target->>'permit'='')
      or (v_policy->>'requireMop'='true' and v_target->>'method'='')
      or (v_policy->>'requireRollback'='true' and v_target->>'rollback'='')
      or coalesce(v_target->>'commercialDisposition','')<>'None'
      or coalesce(v_target->>'commercialImpact','')<>''
      or v_target->>'windowStart'='' or v_target->>'windowEnd'=''
      or v_target->>'windowEnd'<v_target->>'windowStart'
      or pg_catalog.jsonb_array_length(v_target->'requirementIds')=0
      or pg_catalog.jsonb_array_length(v_target->'documentRefs')=0
      or v_target#>>'{completionBasis,kind}' not in ('Measured','Qualitative') then
      raise exception 'package_release_readiness_blocked' using errcode='23514'; end if;
    for v_item in select value from pg_catalog.jsonb_array_elements(v_target->'predecessorIds') loop
      if not exists(select 1 from pg_catalog.jsonb_array_elements(v_state->'releases') r
        where r->>'packageId'=v_item#>>'{}' and r->>'status'='Accepted'
          and (r->>'packageRevision')::integer=(select (p->>'revision')::integer
            from pg_catalog.jsonb_array_elements(v_state->'packages') p
              where p->>'packageId'=v_item#>>'{}')) then
        raise exception 'predecessor_receipt_required' using errcode='23514'; end if;
    end loop;
    for v_item in select value from pg_catalog.jsonb_array_elements(v_target->'requirementIds') loop
      if not exists(select 1 from pg_catalog.jsonb_array_elements(
        d5o_hosted.connected_design_requirements_v1(v_source)) r
          where r->>'id'=v_item#>>'{}') then
        raise exception 'package_requirement_stale' using errcode='23514'; end if;
    end loop;
    for v_item in select value from pg_catalog.jsonb_array_elements(v_target->'documentRefs') loop
      v_ref:=v_item#>>'{}';
      select d into v_doc from pg_catalog.jsonb_array_elements(v_state->'documents') d
        where (d->>'id')||'@'||(d->>'revision')=v_ref and
          d->>'status'='Issued for use' and d->'packageIds' ? v_package;
      if v_doc is null then
        raise exception 'issued_document_revision_required' using errcode='23514'; end if;
    end loop;
    for v_item in select value from pg_catalog.jsonb_array_elements(v_policy->'requiredReviews') loop
      select r into v_review from pg_catalog.jsonb_array_elements(v_state->'reviews') r
        where r->>'packageId'=v_package
          and (r->>'revision')::integer=v_revision
          and r->>'discipline'=v_item#>>'{}' and r->>'status'='Approved';
      if v_review is null then
        raise exception 'package_independent_review_required' using errcode='23514'; end if;
      if v_item#>>'{}'='Engineering' and v_review->>'decidedByActorId'=v_actor::text then
        raise exception 'release_separation_required' using errcode='42501'; end if;
    end loop;
    if v_policy->>'requireMaterialAvailability'='true' then
      if pg_catalog.jsonb_array_length(coalesce(v_target->'materialLines','[]'::jsonb))=0 then
        raise exception 'physical_material_basis_required' using errcode='23514'; end if;
      for v_item in select value from pg_catalog.jsonb_array_elements(v_target->'materialLines') loop
        if coalesce(v_item->>'item','')='' or coalesce(v_item->>'unit','')=''
          or coalesce(v_item->>'source','')='' or coalesce(v_item->>'requiredDate','')=''
          or coalesce(v_item->>'confidence','')<>'Physically counted'
          or v_item->>'status' not in ('Received','Available')
          or coalesce((v_item->>'quantity')::numeric,0)<=0
          or coalesce((v_item->>'receivedQuantity')::numeric,0)<
            (v_item->>'quantity')::numeric
          or (v_item->>'status'='Available' and
            coalesce((v_item->>'availableQuantity')::numeric,0)<
              (v_item->>'quantity')::numeric) then
          raise exception 'physical_material_availability_required' using errcode='23514'; end if;
      end loop;
    end if;
    if v_policy->>'requireCrewDemand'='true' then
      select d into v_demand from pg_catalog.jsonb_array_elements(
        coalesce(v_state->'demands','[]'::jsonb)) d
        where d->>'workId'=p_presentation_id and d->>'packageId'=v_package;
      if v_demand is null or coalesce(v_demand->>'qualification','')=''
        or (v_demand->>'designPackageRevision')::integer<>v_revision
        or coalesce((v_demand->>'minimumPeople')::integer,0)<1
        or coalesce((v_demand->>'estimatedPersonHours')::numeric,0)<=0
        or pg_catalog.jsonb_array_length(coalesce(v_demand->'requiredSlots','[]'::jsonb))=0 then
        raise exception 'dated_crew_demand_required' using errcode='23514'; end if;
      for v_item in select value from pg_catalog.jsonb_array_elements(v_demand->'requiredSlots') loop
        if coalesce(v_item->>'date','')<v_target->>'windowStart'
          or coalesce(v_item->>'date','')>v_target->>'windowEnd'
          or coalesce(v_item->>'shift','')='' then
          raise exception 'crew_demand_outside_window' using errcode='23514'; end if;
      end loop;
    end if;
    if exists(select 1 from pg_catalog.jsonb_array_elements(
      coalesce(v_state->'changes','[]'::jsonb)) c
        where c->>'packageId'=v_package and c->>'status'='Open') then
      raise exception 'open_design_change_blocks_release' using errcode='23514'; end if;
    v_receiving_role:=d5o_hosted.configured_handoff_role_v1(v_work.configuration_version_id,'designDeploy');
    if not exists(select 1 from d5o_hosted.memberships m
      where m.workspace_id=v_workspace.id and m.status='active'
        and m.role=v_receiving_role and m.actor_user_id<>v_actor) then
      raise exception 'configured_receiver_unavailable' using errcode='23514'; end if;
    v_id:=gen_random_uuid()::text;
    v_release:=pg_catalog.jsonb_build_object('id',v_id,'packageId',v_package,
      'packageRevision',v_revision,'documentRefs',v_target->'documentRefs',
      'sourceHandoffRevision',v_handoff.revision,
      'sourceKind',v_handoff.source_kind,
      'sourceId',v_handoff.handoff->>'id',
      'sourceDigest',v_handoff.source_digest,
      'definitionRevision',(v_source#>>'{definition,revision}')::integer,
      'configurationVersionId',v_work.configuration_version_id,
      'assessment',pg_catalog.jsonb_build_object('evaluatedAt',v_now,
        'packageId',v_package,'packageRevision',v_revision,
        'policyVersion',v_work.configuration_version_id,
        'recommendation','Ready for release','findings','[]'::jsonb),
      'issuedAt',v_now,'issuedByActorId',v_actor,
      'issuedByMembershipId',v_member.id,
      'receivingOwner','Configured '||v_receiving_role||' queue',
      'receivingRole',v_receiving_role,
      'responseDueDate',p_input->>'dueDate','status','Awaiting receipt',
      'snapshot',v_target,'documentSnapshots',
        (select coalesce(pg_catalog.jsonb_agg(d),'[]'::jsonb)
          from pg_catalog.jsonb_array_elements(v_state->'documents') d
          where v_target->'documentRefs' ? ((d->>'id')||'@'||(d->>'revision'))),
      'sourceSnapshot',v_handoff.handoff->'brief',
      'crewDemandSnapshot',v_demand);
    v_state:=pg_catalog.jsonb_set(v_state,'{releases}',
      v_state->'releases'||pg_catalog.jsonb_build_array(v_release));
    v_state:=pg_catalog.jsonb_set(v_state,'{packages}',
      (select pg_catalog.jsonb_agg(case when p->>'packageId'=v_package
        then p||pg_catalog.jsonb_build_object('status','Approved') else p end
        order by ordinal) from pg_catalog.jsonb_array_elements(v_state->'packages')
          with ordinality as entries(p,ordinal)));
  else
    v_id:=p_input->>'releaseId';
    select r into v_release from pg_catalog.jsonb_array_elements(v_state->'releases') r
      where r->>'id'=v_id and r->>'status'='Awaiting receipt';
    if v_release is null or p_input->>'response' not in ('Accepted','Returned')
      or length(v_note)<15 or v_release->>'issuedByActorId'=v_actor::text
      or (v_release->>'receivingRole' is not null
        and v_member.role is distinct from v_release->>'receivingRole') then
      raise exception 'independent_release_receipt_required' using errcode='42501'; end if;
    if p_input->>'response'='Accepted' then
      for v_item in select value from pg_catalog.jsonb_array_elements(
        v_release#>'{snapshot,predecessorIds}') loop
        if not exists(select 1 from pg_catalog.jsonb_array_elements(v_state->'releases') r
          where r->>'packageId'=v_item#>>'{}' and r->>'status'='Accepted'
            and (r->>'packageRevision')::integer=(select (p->>'revision')::integer
              from pg_catalog.jsonb_array_elements(v_state->'packages') p
              where p->>'packageId'=v_item#>>'{}')) then
          raise exception 'predecessor_receipt_required' using errcode='23514'; end if;
      end loop;
    end if;
    v_package:=v_release->>'packageId';
    v_revision:=(v_release->>'packageRevision')::integer;
    v_release:=v_release||pg_catalog.jsonb_build_object(
      'status',p_input->>'response','receivedAt',v_now,
      'receivedByActorId',v_actor,'receivedByMembershipId',v_member.id,
      'responseNote',v_note);
    v_state:=pg_catalog.jsonb_set(v_state,'{releases}',
      (select pg_catalog.jsonb_agg(case when r->>'id'=v_id then v_release
        else r end order by ordinal) from pg_catalog.jsonb_array_elements(
          v_state->'releases') with ordinality as entries(r,ordinal)));
  end if;
  v_state:=v_state||pg_catalog.jsonb_build_object(
    'authorityRevision',v_design.decision_revision+1,
    'history',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'at',v_now,'actorId',v_actor,'membershipId',v_member.id,
      'action',p_action||' · '||p_command_id,'note',v_note,
      'packageId',v_package,'revision',v_revision))||
      coalesce(v_state->'history','[]'::jsonb));
  update d5o_hosted.connected_design_states set
    decision_revision=decision_revision+1,state=v_state,updated_at=v_now
    where workspace_id=v_workspace.id and work_id=v_work.id;
  insert into d5o_hosted.connected_design_events(workspace_id,work_id,
    decision_revision,command_id,action,actor_user_id,membership_id,
    source_handoff_revision,snapshot,reason)
  values(v_workspace.id,v_work.id,v_design.decision_revision+1,p_command_id,
    p_action,v_actor,v_member.id,v_handoff.revision,v_state,v_note);
  v_result:=public.d5o_hosted_prototype_read_v1(p_workspace_key,'work');
  insert into d5o_hosted.connected_design_receipts(workspace_id,command_id,
    work_id,actor_user_id,fingerprint,result)
  values(v_workspace.id,p_command_id,v_work.id,v_actor,v_fingerprint,v_result);
  return v_result;
end; $$;

create or replace function public.d5o_hosted_acceptance_command_v1(
  p_workspace_key text,p_presentation_id text,p_package_id text,
  p_action text,p_input jsonb,p_command_id text,
  p_expected_source_revision bigint,p_expected_design_revision integer,
  p_expected_deploy_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
  v_member d5o_hosted.memberships%rowtype;v_work d5o_hosted.work_records%rowtype;
  v_raw d5o_hosted.prototype_states%rowtype;
  v_design d5o_hosted.connected_design_states%rowtype;
  v_schedule d5o_hosted.connected_schedule_states%rowtype;
  v_deploy d5o_hosted.connected_deploy_states%rowtype;
  v_receipt d5o_hosted.connected_deploy_receipts%rowtype;
  v_state jsonb;v_release jsonb;v_turnover jsonb;v_acceptance jsonb;v_evidence jsonb;v_receiving_role text;
  v_item jsonb;v_requirement text;v_package text;v_current jsonb;
  v_all_turnovers jsonb:='[]'::jsonb;v_release_ids jsonb:='[]'::jsonb;
  v_now timestamptz:=now();v_fingerprint text;v_result jsonb;
  v_note text:=trim(coalesce(p_input->>'note',''));
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or p_action not in ('assemble-turnover','accept-client','accept-work',
      'respond-operate','respond-operate-work')
    or pg_catalog.jsonb_typeof(p_input)<>'object'
    or length(coalesce(p_command_id,'')) not between 8 and 120
    or p_expected_source_revision is null or p_expected_source_revision<1
    or p_expected_design_revision is null or p_expected_design_revision<1
    or p_expected_deploy_revision is null or p_expected_deploy_revision<1 then
    raise exception 'invalid_acceptance_command' using errcode='22023'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor and status='active' for share;
  if not found then raise exception 'acceptance_membership_required' using errcode='42501'; end if;
  select w.* into v_work from d5o_hosted.work_records w
    join d5o_hosted.work_identity_links l on l.work_id=w.id
      and l.workspace_id=w.workspace_id
    where w.workspace_id=v_workspace.id and l.presentation_id=p_presentation_id
      for update of w;
  if not found then raise exception 'connected_work_unavailable' using errcode='42501'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_workspace_key,
    p_presentation_id,p_package_id,p_action,p_input,p_expected_source_revision,
    p_expected_design_revision,p_expected_deploy_revision)::text);
  select * into v_receipt from d5o_hosted.connected_deploy_receipts
    where workspace_id=v_workspace.id and command_id=p_command_id;
  if found then
    if v_receipt.work_id<>v_work.id or v_receipt.actor_user_id<>v_actor
      or v_receipt.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_receipt.result; end if;
  select * into v_raw from d5o_hosted.prototype_states
    where workspace_id=v_workspace.id and state_key='work' for share;
  select * into v_design from d5o_hosted.connected_design_states
    where workspace_id=v_workspace.id and work_id=v_work.id for share;
  select * into v_schedule from d5o_hosted.connected_schedule_states
    where workspace_id=v_workspace.id for share;
  select * into v_deploy from d5o_hosted.connected_deploy_states
    where workspace_id=v_workspace.id and work_id=v_work.id for update;
  if v_raw.revision is distinct from p_expected_source_revision
    or v_design.decision_revision is distinct from p_expected_design_revision
    or v_deploy.decision_revision is distinct from p_expected_deploy_revision then
    raise exception 'stale_acceptance_basis' using errcode='23505'; end if;
  v_state:=v_deploy.state;
  if p_action in ('assemble-turnover','accept-client','respond-operate') then
    select r into v_release from pg_catalog.jsonb_array_elements(v_design.state->'releases') r
      where r->>'packageId'=p_package_id order by r->>'issuedAt' desc limit 1;
    if v_release is null or v_release->>'status'<>'Accepted'
      or (v_release->>'packageRevision')::integer<>
        (select (p->>'revision')::integer from pg_catalog.jsonb_array_elements(
          v_design.state->'packages') p where p->>'packageId'=p_package_id) then
      raise exception 'current_accepted_release_required' using errcode='23514'; end if;
  end if;
  if p_action='assemble-turnover' then
    if v_member.role not in ('project_manager','field_supervisor')
      or p_input ? 'operateOwner' then
      raise exception 'turnover_assembly_authority_required' using errcode='42501'; end if;
    if not exists(select 1 from pg_catalog.jsonb_array_elements(v_state->'completions') c
      where c->>'packageId'=p_package_id and c->>'releaseId'=v_release->>'id'
        and c->>'status'='Reviewed') then
      raise exception 'reviewed_completion_required' using errcode='23514'; end if;
    if exists(select 1 from pg_catalog.jsonb_array_elements(v_state->'issues') i
      where i->>'packageId'=p_package_id and i->>'status'='Open') then
      raise exception 'open_issue_blocks_turnover' using errcode='23514'; end if;
    if exists(select 1 from pg_catalog.jsonb_array_elements(v_state->'turnovers') t
      where t->'releaseIds' ? (v_release->>'id') and t->>'status' in
        ('Draft','Client accepted','Conditionally accepted')) then
      raise exception 'current_turnover_already_exists' using errcode='23514'; end if;
    v_receiving_role:=d5o_hosted.configured_handoff_role_v1(v_work.configuration_version_id,'deployOperate');
    if not exists(select 1 from d5o_hosted.memberships m
      where m.workspace_id=v_workspace.id and m.status='active'
        and m.role=v_receiving_role and m.actor_user_id<>v_actor) then
      raise exception 'configured_receiver_unavailable' using errcode='23514'; end if;
    v_turnover:=pg_catalog.jsonb_build_object('id',gen_random_uuid(),
      'revision',1,'releaseIds',pg_catalog.jsonb_build_array(v_release->>'id'),
      'packageId',p_package_id,'reportIds',
        (select pg_catalog.jsonb_agg(r->>'id') from pg_catalog.jsonb_array_elements(v_state->'reports') r
          where r->>'packageId'=p_package_id and r->>'releaseId'=v_release->>'id'
            and r->>'status'='Reviewed'),
      'inspectionIds',
        (select pg_catalog.jsonb_agg(i->>'id') from pg_catalog.jsonb_array_elements(v_state->'inspections') i
          where i->>'packageId'=p_package_id and i->>'releaseId'=v_release->>'id'
            and i->>'status'='Verified' and i->>'result'='Pass'),
      'evidenceIds',
        (select pg_catalog.jsonb_agg(e->>'id') from pg_catalog.jsonb_array_elements(v_state->'evidence') e
          where e->>'packageId'=p_package_id and e->>'releaseId'=v_release->>'id'
            and e->>'state'='Reviewed'),
      'completionId',(select c->>'id' from pg_catalog.jsonb_array_elements(v_state->'completions') c
        where c->>'packageId'=p_package_id and c->>'releaseId'=v_release->>'id'
          and c->>'status'='Reviewed'
        order by (c->>'reviewedAt')::timestamptz desc limit 1),
      'assembledAt',v_now,'assembledByActorId',v_actor,
      'membershipId',v_member.id,'status','Draft',
      'operateOwner','Configured '||v_receiving_role||' queue',
      'operateRole',v_receiving_role,
      'obligations',trim(coalesce(p_input->>'obligations','')),'receipt','Awaiting');
    v_state:=pg_catalog.jsonb_set(v_state,'{turnovers}',
      v_state->'turnovers'||pg_catalog.jsonb_build_array(v_turnover));
  elsif p_action='accept-client' then
    if v_member.role not in ('project_manager','operations_leader')
      or length(trim(coalesce(p_input->>'signerName','')))<3
      or length(trim(coalesce(p_input->>'signerOrganization','')))<3
      or length(trim(coalesce(p_input->>'authorityBasis','')))<10
      or length(trim(coalesce(p_input->>'signerRole','')))<3
      or p_input->>'evidenceId' is null then
      raise exception 'customer_acceptance_recording_incomplete' using errcode='42501'; end if;
    select t into v_turnover from pg_catalog.jsonb_array_elements(v_state->'turnovers') t
      where t->>'id'=p_input->>'turnoverId' and t->>'status'='Draft'
        and t->'releaseIds' ? (v_release->>'id');
    if v_turnover is null or v_turnover->>'assembledByActorId'=v_actor::text
      or not exists(select 1 from pg_catalog.jsonb_array_elements(v_state->'completions') c
        where c->>'id'=v_turnover->>'completionId' and c->>'status'='Reviewed') then
      raise exception 'independent_current_turnover_required' using errcode='42501'; end if;
    for v_item in select value from pg_catalog.jsonb_array_elements(
      v_release#>'{snapshot,requirementIds}') loop
      v_requirement:=v_item#>>'{}';
      if not exists(select 1 from pg_catalog.jsonb_array_elements(v_state->'inspections') i
        where i->>'id' in (select pg_catalog.jsonb_array_elements_text(v_turnover->'inspectionIds'))
          and i->>'requirementId'=v_requirement and i->>'result'='Pass'
          and i->>'status'='Verified' and i->>'releaseId'=v_release->>'id') then
        raise exception 'turnover_verification_incomplete' using errcode='23514'; end if;
    end loop;
    if exists(select 1 from pg_catalog.jsonb_array_elements(v_state->'issues') i
      where i->>'packageId'=p_package_id and i->>'status'='Open') then
      raise exception 'open_issue_blocks_acceptance' using errcode='23514'; end if;
    v_evidence:=d5o_hosted.require_customer_decision_evidence_v1(
      v_workspace.id,v_work.id,p_input->>'evidenceId','package-acceptance',
      v_turnover->>'id',(v_turnover->>'revision')::integer,
      pg_catalog.jsonb_build_object('releaseIds',v_turnover->'releaseIds',
        'designRevision',v_design.decision_revision));
    v_turnover:=v_turnover||pg_catalog.jsonb_build_object(
      'status',case when trim(coalesce(p_input->>'conditions',''))=''
        then 'Client accepted' else 'Conditionally accepted' end,
      'acceptedAt',v_now,'recordedByActorId',v_actor,'signerName',trim(p_input->>'signerName'),
      'signerOrganization',trim(p_input->>'signerOrganization'),
      'signerRole',trim(p_input->>'signerRole'),
      'authorityBasis',trim(p_input->>'authorityBasis'),
      'source','evidence:'||(v_evidence->>'id'),'customerEvidence',v_evidence,
      'conditions',trim(coalesce(p_input->>'conditions','')),
      'exclusions',trim(coalesce(p_input->>'exclusions','')));
    v_state:=pg_catalog.jsonb_set(v_state,'{turnovers}',
      (select pg_catalog.jsonb_agg(case when t->>'id'=v_turnover->>'id' then v_turnover
        else t end order by ordinal) from pg_catalog.jsonb_array_elements(v_state->'turnovers')
          with ordinality as entries(t,ordinal)));
    v_state:=pg_catalog.jsonb_set(v_state,'{signoffs}',v_state->'signoffs'||
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',gen_random_uuid(),
        'kind','Customer scope acceptance','recordId',v_turnover->>'id',
        'recordRevision',1,'releaseIds',v_turnover->'releaseIds',
        'scope',p_package_id,'statement','Customer acceptance applies only to this exact turnover revision.',
        'signerName',v_turnover->>'signerName',
        'signerOrganization',v_turnover->>'signerOrganization',
        'method','Externally signed document','authorityBasis',v_turnover->>'authorityBasis',
        'source',v_turnover->>'source','capturedByActorId',v_actor,
        'at',v_now,'outcome',case when v_turnover->>'conditions'=''
          then 'Accepted' else 'Conditional' end,
        'conditions',v_turnover->>'conditions','snapshot',v_turnover)));
  elsif p_action='accept-work' then
    if v_member.role not in ('project_manager','operations_leader')
      or v_state->'workAcceptance' is not null
      or length(trim(coalesce(p_input->>'signerName','')))<3
      or length(trim(coalesce(p_input->>'signerOrganization','')))<3
      or length(trim(coalesce(p_input->>'signerRole','')))<3
      or length(trim(coalesce(p_input->>'authorityBasis','')))<10
      or p_input->>'evidenceId' is null
      or trim(coalesce(p_input->>'conditions',''))<>'' then
      raise exception 'whole_work_acceptance_incomplete' using errcode='42501'; end if;
    for v_item in select value from pg_catalog.jsonb_array_elements(v_design.state->'packages') loop
      v_package:=v_item->>'packageId';
      select r into v_current from pg_catalog.jsonb_array_elements(v_design.state->'releases') r
        where r->>'packageId'=v_package order by r->>'issuedAt' desc limit 1;
      select t into v_turnover from pg_catalog.jsonb_array_elements(v_state->'turnovers') t
        where t->>'packageId'=v_package and t->>'status'='Client accepted'
          and t->'releaseIds' ? (v_current->>'id');
      if v_current is null or v_current->>'status'<>'Accepted'
        or v_turnover is null or v_turnover->>'assembledByActorId'=v_actor::text
        or not exists(select 1 from pg_catalog.jsonb_array_elements(v_state->'completions') c
          where c->>'id'=v_turnover->>'completionId' and c->>'status'='Reviewed') then
        raise exception 'all_current_packages_require_acceptance' using errcode='23514'; end if;
      v_all_turnovers:=v_all_turnovers||pg_catalog.jsonb_build_array(v_turnover->>'id');
      v_release_ids:=v_release_ids||pg_catalog.jsonb_build_array(v_current->>'id');
    end loop;
    if pg_catalog.jsonb_array_length(v_all_turnovers)=0 or
      exists(select 1 from pg_catalog.jsonb_array_elements(v_state->'issues') i
        where i->>'status'='Open') then
      raise exception 'whole_work_scope_incomplete' using errcode='23514'; end if;
    v_evidence:=d5o_hosted.require_customer_decision_evidence_v1(
      v_workspace.id,v_work.id,p_input->>'evidenceId','work-acceptance',
      p_presentation_id,1,pg_catalog.jsonb_build_object(
        'turnoverIds',v_all_turnovers,'releaseIds',v_release_ids,
        'designRevision',v_design.decision_revision));
    v_acceptance:=pg_catalog.jsonb_build_object('id',gen_random_uuid(),
      'revision',1,'turnoverIds',v_all_turnovers,'releaseIds',v_release_ids,
      'acceptedAt',v_now,'recordedByActorId',v_actor,
      'signerName',trim(p_input->>'signerName'),
      'signerOrganization',trim(p_input->>'signerOrganization'),
      'signerRole',trim(p_input->>'signerRole'),
      'authorityBasis',trim(p_input->>'authorityBasis'),
      'source','evidence:'||(v_evidence->>'id'),'customerEvidence',v_evidence,
      'conditions','','receipt','Awaiting');
    v_state:=pg_catalog.jsonb_set(v_state,'{workAcceptance}',v_acceptance);
    v_state:=pg_catalog.jsonb_set(v_state,'{signoffs}',v_state->'signoffs'||
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',gen_random_uuid(),
        'kind','Final client acceptance','recordId',v_acceptance->>'id',
        'recordRevision',1,'releaseIds',v_release_ids,'scope',p_presentation_id,
        'statement','Customer accepts the exact listed package turnovers; Operations receipt is separate.',
        'signerName',v_acceptance->>'signerName',
        'signerOrganization',v_acceptance->>'signerOrganization',
        'method','Externally signed document','authorityBasis',v_acceptance->>'authorityBasis',
        'source',v_acceptance->>'source','capturedByActorId',v_actor,
        'at',v_now,'outcome','Accepted','conditions','','snapshot',v_acceptance)));
  elsif p_action='respond-operate' then
    if v_member.role<>'operations_leader'
      or p_input->>'decision' not in ('Accepted','Declined') or length(v_note)<15 then
      raise exception 'operations_receipt_authority_required' using errcode='42501'; end if;
    select t into v_turnover from pg_catalog.jsonb_array_elements(v_state->'turnovers') t
      where t->>'id'=p_input->>'turnoverId' and t->>'status'='Client accepted'
        and t->>'receipt'='Awaiting' and t->'releaseIds' ? (v_release->>'id');
    if v_turnover is null or v_turnover->>'recordedByActorId'=v_actor::text
      or v_turnover->>'assembledByActorId'=v_actor::text
      or (v_turnover->>'operateRole' is not null
        and v_member.role is distinct from v_turnover->>'operateRole') then
      raise exception 'independent_exact_turnover_required' using errcode='42501'; end if;
    v_turnover:=v_turnover||pg_catalog.jsonb_build_object('receipt',
      case when p_input->>'decision'='Accepted' then 'Accepted' else 'Returned' end,
      'receivedByActorId',v_actor,'receivedAt',v_now,'receiptNote',v_note);
    v_state:=pg_catalog.jsonb_set(v_state,'{turnovers}',
      (select pg_catalog.jsonb_agg(case when t->>'id'=v_turnover->>'id' then v_turnover
        else t end order by ordinal) from pg_catalog.jsonb_array_elements(v_state->'turnovers')
          with ordinality as entries(t,ordinal)));
  else
    if v_member.role<>'operations_leader'
      or p_input->>'decision' not in ('Accepted','Declined') or length(v_note)<15 then
      raise exception 'operations_receipt_authority_required' using errcode='42501'; end if;
    v_acceptance:=v_state->'workAcceptance';
    if v_acceptance is null or v_acceptance->>'receipt'<>'Awaiting'
      or v_acceptance->>'recordedByActorId'=v_actor::text then
      raise exception 'independent_work_receipt_required' using errcode='42501'; end if;
    if exists(select 1 from pg_catalog.jsonb_array_elements(v_state->'turnovers') t
      where t->>'id' in (select pg_catalog.jsonb_array_elements_text(v_acceptance->'turnoverIds'))
        and t->>'receipt'<>'Accepted') then
      raise exception 'package_receipts_required' using errcode='23514'; end if;
    if exists(select 1 from pg_catalog.jsonb_array_elements(v_design.state->'releases') r
      where r->>'status'='Accepted' and not (v_acceptance->'releaseIds' ? (r->>'id'))) then
      raise exception 'work_release_basis_stale' using errcode='23514'; end if;
    v_acceptance:=v_acceptance||pg_catalog.jsonb_build_object(
      'receipt',case when p_input->>'decision'='Accepted' then 'Accepted' else 'Returned' end,
      'receivedByActorId',v_actor,'receivedAt',v_now,'receiptNote',v_note);
    v_state:=pg_catalog.jsonb_set(v_state,'{workAcceptance}',v_acceptance);
  end if;
  v_state:=v_state||pg_catalog.jsonb_build_object(
    'authorityRevision',v_deploy.decision_revision+1,
    'events',v_state->'events'||pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('id',gen_random_uuid(),
        'commandId',p_command_id,'at',v_now,'actorId',v_actor,
        'membershipId',v_member.id,'action',p_action,
        'packageId',p_package_id,'note',v_note)));
  update d5o_hosted.connected_deploy_states set
    decision_revision=decision_revision+1,state=v_state,updated_at=v_now
    where workspace_id=v_workspace.id and work_id=v_work.id;
  insert into d5o_hosted.connected_deploy_events(workspace_id,work_id,
    decision_revision,command_id,action,actor_user_id,membership_id,
    design_revision,schedule_revision,snapshot)
  values(v_workspace.id,v_work.id,v_deploy.decision_revision+1,p_command_id,
    p_action,v_actor,v_member.id,v_design.decision_revision,
    v_schedule.decision_revision,v_state);
  v_result:=public.d5o_hosted_prototype_read_v1(p_workspace_key,'work');
  insert into d5o_hosted.connected_deploy_receipts(workspace_id,command_id,
    work_id,actor_user_id,fingerprint,result)
  values(v_workspace.id,p_command_id,v_work.id,v_actor,v_fingerprint,v_result);
  return v_result;
end; $$;
