-- Shared Design commands call this internal source resolver. It enforces the
-- commercial award/Define contract unchanged, or the current accepted service
-- request/asset/coverage contract. Caller labels cannot select a weaker path.
create function d5o_hosted.connected_design_source_v1(
  p_workspace uuid,p_work uuid,p_raw jsonb
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_work d5o_hosted.work_records%rowtype;
  v_link d5o_hosted.work_identity_links%rowtype;
  v_handoff d5o_hosted.connected_design_handoffs%rowtype;
  v_record jsonb;v_source jsonb;
begin
  select * into v_work from d5o_hosted.work_records
    where workspace_id=p_workspace and id=p_work;
  select * into v_link from d5o_hosted.work_identity_links
    where workspace_id=p_workspace and work_id=p_work;
  select * into v_handoff from d5o_hosted.connected_design_handoffs
    where workspace_id=p_workspace and work_id=p_work;
  if v_work.id is null or v_link.work_id is null
    or v_handoff.status is distinct from 'accepted' then
    raise exception 'accepted_design_source_required' using errcode='23514'; end if;
  if v_handoff.source_kind='service' then
    if v_link.relation_kind<>'service_visit' then
      raise exception 'service_source_identity_required' using errcode='23514'; end if;
    v_source:=d5o_hosted.current_service_source_v1(p_workspace,p_work);
    if v_handoff.source_digest<>pg_catalog.md5(v_source::text)
      or v_handoff.handoff#>>'{brief,source,canonicalWorkId}'<>p_work::text
      or v_handoff.handoff#>>'{brief,configurationVersionId}'<>
        v_work.configuration_version_id::text then
      raise exception 'stale_service_design_source' using errcode='23514'; end if;
    select item into v_record from pg_catalog.jsonb_array_elements(
      d5o_hosted.connected_package_projection_v1(p_workspace,
        d5o_hosted.connected_service_projection_v1(p_workspace,
          pg_catalog.jsonb_build_object('records','[]'::jsonb),'work'),'work')->'records') item
      where item->>'id'=v_link.presentation_id;
    if v_record#>>'{serviceExecutionBasis,status}'<>'accepted'
      or v_record#>>'{serviceExecutionBasis,id}'<>v_handoff.handoff->>'id' then
      raise exception 'service_basis_projection_mismatch' using errcode='23514'; end if;
  else
    if v_link.relation_kind='service_visit' then
      raise exception 'commercial_source_identity_required' using errcode='23514'; end if;
    select item into v_record from pg_catalog.jsonb_array_elements(
      d5o_hosted.connected_package_projection_v1(p_workspace,
        d5o_hosted.connected_define_projection_v1(p_workspace,p_raw),'work')->'records') item
      where item->>'id'=v_link.presentation_id;
    if v_record#>>'{discovery,designHandoff,status}'<>'accepted'
      or v_record#>>'{definition,revision}' is distinct from
        v_handoff.handoff#>>'{brief,definitionRevision}' then
      raise exception 'accepted_commercial_design_source_required' using errcode='23514'; end if;
  end if;
  if v_record is null or v_record->>'canonicalWorkId'<>p_work::text
    or v_record->>'phaseConfigurationVersionId'<>
      v_work.configuration_version_id::text then
    raise exception 'design_source_identity_mismatch' using errcode='23514'; end if;
  return v_record;
end; $$;
revoke all on function d5o_hosted.connected_design_source_v1(uuid,uuid,jsonb)
  from public,anon,authenticated,service_role;

create function d5o_hosted.connected_design_requirements_v1(
  p_source jsonb
) returns jsonb language sql immutable security definer set search_path='' as $$
  select case when p_source ? 'serviceExecutionBasis' then
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'id','service-scope','title','Accepted service scope',
      'description',p_source#>>'{serviceExecutionBasis,brief,scope}',
      'sourceKind','service',
      'sourceRevision',p_source#>>'{serviceExecutionBasis,revision}'))
  else coalesce(p_source#>'{definition,scopeControl,requirements}','[]'::jsonb) end;
$$;
revoke all on function d5o_hosted.connected_design_requirements_v1(jsonb)
  from public,anon,authenticated,service_role;

-- Exact-source adaptation of d5o_hosted_design_draft_command_v1; existing approval rules remain.
create or replace function public.d5o_hosted_design_draft_command_v1(
  p_workspace_key text,p_presentation_id text,p_action text,p_input jsonb,
  p_command_id text,p_expected_source_revision bigint,
  p_expected_decision_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
  v_member d5o_hosted.memberships%rowtype;v_work d5o_hosted.work_records%rowtype;
  v_state d5o_hosted.prototype_states%rowtype;
  v_handoff d5o_hosted.connected_design_handoffs%rowtype;
  v_design d5o_hosted.connected_design_states%rowtype;
  v_receipt d5o_hosted.connected_design_receipts%rowtype;
  v_fingerprint text;v_source jsonb;v_previous jsonb;v_document jsonb;
  v_package jsonb;v_basis jsonb;v_input jsonb;v_next jsonb;
  v_result jsonb;v_id text;v_revision integer;v_now timestamptz:=now();
  v_item jsonb;v_ref text;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or p_action not in ('save-document','save-package')
    or p_input is null or pg_catalog.jsonb_typeof(p_input)<>'object'
    or length(coalesce(p_command_id,'')) not between 8 and 120
    or p_expected_source_revision is null or p_expected_source_revision<1
    or p_expected_decision_revision is null or p_expected_decision_revision<0 then
    raise exception 'invalid_design_draft_command' using errcode='22023'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor and status='active' for share;
  if not found or v_member.role not in ('admin','project_manager','operations_leader') then
    raise exception 'design_editor_denied' using errcode='42501'; end if;
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
  select * into v_state from d5o_hosted.prototype_states
    where workspace_id=v_workspace.id and state_key='work' for share;
  select * into v_handoff from d5o_hosted.connected_design_handoffs
    where workspace_id=v_workspace.id and work_id=v_work.id for share;
  select * into v_design from d5o_hosted.connected_design_states
    where workspace_id=v_workspace.id and work_id=v_work.id for update;
  if v_state.revision is distinct from p_expected_source_revision
    or coalesce(v_design.decision_revision,0)<>p_expected_decision_revision
    or v_handoff.status is distinct from 'accepted'
    or v_design.source_handoff_revision is not null and
      v_design.source_handoff_revision<>v_handoff.revision then
    raise exception 'stale_design_basis' using errcode='23505'; end if;
  v_source:=d5o_hosted.connected_design_source_v1(v_workspace.id,v_work.id,v_state.state_json);
  v_next:=coalesce(v_design.state,pg_catalog.jsonb_build_object(
    'documents','[]'::jsonb,'packages','[]'::jsonb,'reviews','[]'::jsonb,
    'releases','[]'::jsonb,'history','[]'::jsonb));
  if p_action='save-document' then
    v_input:=p_input->'document';
    if pg_catalog.jsonb_typeof(v_input)<>'object'
      or length(trim(coalesce(v_input->>'title',''))) not between 3 and 200
      or length(trim(coalesce(v_input->>'type',''))) not between 2 and 100
      or length(trim(coalesce(v_input->>'source',''))) not between 5 and 2000
      or pg_catalog.jsonb_typeof(v_input->'packageIds')<>'array'
      or pg_catalog.jsonb_typeof(v_input->'requirementIds')<>'array' then
      raise exception 'document_draft_invalid' using errcode='22023'; end if;
    for v_item in select value from pg_catalog.jsonb_array_elements(v_input->'packageIds') loop
      if pg_catalog.jsonb_typeof(v_item)<>'string' or not exists(
        select 1 from pg_catalog.jsonb_array_elements(v_source->'packages') p
          where p->>'id'=v_item#>>'{}') then
        raise exception 'document_package_reference_invalid' using errcode='23514'; end if;
    end loop;
    for v_item in select value from pg_catalog.jsonb_array_elements(v_input->'requirementIds') loop
      if pg_catalog.jsonb_typeof(v_item)<>'string' or not exists(
        select 1 from pg_catalog.jsonb_array_elements(
          d5o_hosted.connected_design_requirements_v1(v_source)) r
          where r->>'id'=v_item#>>'{}') then
        raise exception 'document_requirement_reference_invalid' using errcode='23514'; end if;
    end loop;
    v_id:=coalesce(nullif(trim(v_input->>'id'),''),gen_random_uuid()::text);
    select max((d->>'revision')::integer) into v_revision
      from pg_catalog.jsonb_array_elements(v_next->'documents') d where d->>'id'=v_id;
    v_revision:=coalesce(v_revision,0)+1;
    v_document:=pg_catalog.jsonb_build_object('id',v_id,'revision',v_revision,
      'type',trim(v_input->>'type'),'title',trim(v_input->>'title'),
      'source',trim(v_input->>'source'),
      'owner',coalesce(nullif(trim(v_input->>'owner'),''),v_actor::text),
      'packageIds',v_input->'packageIds',
      'requirementIds',v_input->'requirementIds',
      'status','Draft','dueDate',coalesce(v_input->>'dueDate',''),
      'createdAt',v_now,'createdByActorId',v_actor);
    v_next:=pg_catalog.jsonb_set(v_next,'{documents}',
      v_next->'documents'||pg_catalog.jsonb_build_array(v_document));
  else
    v_input:=p_input->'package';
    v_id:=v_input->>'packageId';
    if pg_catalog.jsonb_typeof(v_input)<>'object' or v_id is null
      or not exists(select 1 from pg_catalog.jsonb_array_elements(
        coalesce(v_source->'packages','[]'::jsonb)) p where p->>'id'=v_id)
      or pg_catalog.jsonb_typeof(v_input->'requirementIds')<>'array'
      or pg_catalog.jsonb_typeof(v_input->'predecessorIds')<>'array'
      or pg_catalog.jsonb_typeof(v_input->'documentRefs')<>'array'
      or v_input#>>'{completionBasis,kind}' not in ('Measured','Qualitative')
      or v_input#>>'{completionBasis,kind}'='Measured' and
        (coalesce((v_input#>>'{completionBasis,plannedQuantity}')::numeric,0)<=0
          or length(trim(coalesce(v_input#>>'{completionBasis,unit}','')))=0)
      or v_input#>>'{completionBasis,kind}'='Qualitative' and
        length(trim(coalesce(v_input#>>'{completionBasis,criterion}','')))<10 then
      raise exception 'package_draft_invalid' using errcode='22023'; end if;
    for v_item in select value from pg_catalog.jsonb_array_elements(v_input->'predecessorIds') loop
      if v_item#>>'{}'=v_id or not exists(select 1 from
        pg_catalog.jsonb_array_elements(v_source->'packages') p
        where p->>'id'=v_item#>>'{}') then
        raise exception 'package_predecessor_invalid' using errcode='23514'; end if;
    end loop;
    for v_item in select value from pg_catalog.jsonb_array_elements(v_input->'requirementIds') loop
      if not exists(select 1 from pg_catalog.jsonb_array_elements(
        d5o_hosted.connected_design_requirements_v1(v_source)) r
        where r->>'id'=v_item#>>'{}') then
        raise exception 'package_requirement_invalid' using errcode='23514'; end if;
    end loop;
    for v_item in select value from pg_catalog.jsonb_array_elements(v_input->'documentRefs') loop
      v_ref:=v_item#>>'{}';
      if not exists(select 1 from pg_catalog.jsonb_array_elements(v_next->'documents') d
        where (d->>'id')||'@'||(d->>'revision')=v_ref
          and d->'packageIds' ? v_id) then
        raise exception 'package_document_invalid' using errcode='23514'; end if;
    end loop;
    if v_input->>'commercialDisposition' not in ('None','Assessment required',
      'Routed to Develop') or v_input->>'materialStatus' not in
      ('Unknown','Planned','Ordered','Supplier confirmed','Received','Available') then
      raise exception 'package_status_invalid' using errcode='22023'; end if;
    select p into v_previous from pg_catalog.jsonb_array_elements(v_next->'packages') p
      where p->>'packageId'=v_id;
    if exists(select 1 from pg_catalog.jsonb_array_elements(v_next->'releases') r
      where r->>'packageId'=v_id and r->>'status' in ('Awaiting receipt','Accepted')) then
      raise exception 'released_package_locked' using errcode='23514'; end if;
    v_revision:=coalesce((v_previous->>'revision')::integer,0)+1;
    v_basis:=v_input->'completionBasis';
    v_package:=pg_catalog.jsonb_build_object(
      'packageId',v_id,'revision',v_revision,'scope',coalesce(v_input->>'scope',''),
      'location',coalesce(v_input->>'location',''),
      'systems',coalesce(v_input->>'systems',''),
      'completionBasis',v_basis,'requirementIds',v_input->'requirementIds',
      'predecessorIds',v_input->'predecessorIds',
      'documentRefs',v_input->'documentRefs',
      'materials',coalesce(v_input->>'materials',''),
      'materialLines',coalesce(v_input->'materialLines','[]'::jsonb),
      'materialStatus',v_input->>'materialStatus',
      'materialRequiredDate',coalesce(v_input->>'materialRequiredDate',''),
      'materialForecastDate',coalesce(v_input->>'materialForecastDate',''),
      'materialSource',coalesce(v_input->>'materialSource',''),
      'access',coalesce(v_input->>'access',''),
      'permit',coalesce(v_input->>'permit',''),
      'safetyControls',coalesce(v_input->>'safetyControls',''),
      'equipment',coalesce(v_input->>'equipment',''),
      'method',coalesce(v_input->>'method',''),
      'rollback',coalesce(v_input->>'rollback',''),
      'verification',coalesce(v_input->>'verification',''),
      'proof',coalesce(v_input->>'proof',''),
      'acceptingAuthority',coalesce(v_input->>'acceptingAuthority',''),
      'windowStart',coalesce(v_input->>'windowStart',''),
      'windowEnd',coalesce(v_input->>'windowEnd',''),
      'targetReleaseDate',coalesce(v_input->>'targetReleaseDate',''),
      'crewDemandRequired',coalesce((v_input->>'crewDemandRequired')::boolean,true),
      'crewExemptionReason',coalesce(v_input->>'crewExemptionReason',''),
      'commercialImpact',coalesce(v_input->>'commercialImpact',''),
      'commercialDisposition',v_input->>'commercialDisposition',
      'status','Draft');
    v_next:=pg_catalog.jsonb_set(v_next,'{packages}',
      (select coalesce(pg_catalog.jsonb_agg(p order by ordinal),'[]'::jsonb)
        from pg_catalog.jsonb_array_elements(v_next->'packages')
          with ordinality as entries(p,ordinal) where p->>'packageId'<>v_id)
        ||pg_catalog.jsonb_build_array(v_package));
  end if;
  v_next:=v_next||pg_catalog.jsonb_build_object(
    'authorityRevision',coalesce(v_design.decision_revision,0)+1,
    'history',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'at',v_now,'actorId',v_actor,'membershipId',v_member.id,
      'action',p_action||' · '||p_command_id,'note',coalesce(p_input->>'note',''),
      'packageId',case when p_action='save-package' then v_id else null end,
      'revision',v_revision))||coalesce(v_next->'history','[]'::jsonb));
  if v_design.work_id is null then
    insert into d5o_hosted.connected_design_states(workspace_id,work_id,
      decision_revision,source_handoff_revision,state)
    values(v_workspace.id,v_work.id,1,v_handoff.revision,v_next);
  else
    update d5o_hosted.connected_design_states set
      decision_revision=decision_revision+1,state=v_next,updated_at=v_now
      where workspace_id=v_workspace.id and work_id=v_work.id;
  end if;
  insert into d5o_hosted.connected_design_events(workspace_id,work_id,
    decision_revision,command_id,action,actor_user_id,membership_id,
    source_handoff_revision,snapshot,reason)
  values(v_workspace.id,v_work.id,coalesce(v_design.decision_revision,0)+1,
    p_command_id,p_action,v_actor,v_member.id,v_handoff.revision,v_next,
    coalesce(p_input->>'note',''));
  v_result:=public.d5o_hosted_prototype_read_v1(p_workspace_key,'work');
  insert into d5o_hosted.connected_design_receipts(workspace_id,command_id,
    work_id,actor_user_id,fingerprint,result)
  values(v_workspace.id,p_command_id,v_work.id,v_actor,v_fingerprint,v_result);
  return v_result;
end; $$;

-- Exact-source adaptation of d5o_hosted_design_review_command_v1; existing approval rules remain.
create or replace function public.d5o_hosted_design_review_command_v1(
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
  v_fingerprint text;v_state jsonb;v_result jsonb;v_target jsonb;
  v_documents jsonb;v_reviews jsonb;v_packages jsonb;v_policy jsonb;
  v_now timestamptz:=now();v_id text;v_revision integer;v_package text;
  v_discipline text;v_note text:=trim(coalesce(p_input->>'note',''));
  v_due text;v_decision text;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or p_action not in ('submit-document','approve-document','issue-document',
      'request-review','decide-review')
    or p_input is null or pg_catalog.jsonb_typeof(p_input)<>'object'
    or length(coalesce(p_command_id,'')) not between 8 and 120
    or p_expected_source_revision is null or p_expected_source_revision<1
    or p_expected_decision_revision is null or p_expected_decision_revision<1 then
    raise exception 'invalid_design_review_command' using errcode='22023'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor and status='active' for share;
  if not found then raise exception 'design_review_role_denied' using errcode='42501'; end if;
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
    raise exception 'stale_design_review_basis' using errcode='23505'; end if;
  perform d5o_hosted.connected_design_source_v1(v_workspace.id,v_work.id,v_raw.state_json);
  select wt->'designControls' into v_policy
    from d5o_hosted.configuration_versions c,
      lateral pg_catalog.jsonb_array_elements(
        c.manifest_json#>'{d5oPresentation,phaseContract,workTypes}') wt
    where c.id=v_work.configuration_version_id
      and wt->>'workTypeKey'=v_work.work_type_key;
  if v_policy is null or v_policy->>'schemaVersion'<>'1' then
    raise exception 'pinned_design_policy_unavailable' using errcode='23514'; end if;
  v_state:=v_design.state;
  v_documents:=v_state->'documents';v_reviews:=v_state->'reviews';
  v_packages:=v_state->'packages';
  if p_action in ('submit-document','approve-document','issue-document') then
    v_id:=p_input->>'documentId';
    v_revision:=(p_input->>'documentRevision')::integer;
    select d into v_target from pg_catalog.jsonb_array_elements(v_documents) d
      where d->>'id'=v_id and (d->>'revision')::integer=v_revision;
    if v_target is null then raise exception 'document_revision_missing' using errcode='23514'; end if;
    if p_action='submit-document' then
      if v_member.role not in ('project_manager','admin')
        or v_target->>'status'<>'Draft' then
        raise exception 'document_submission_denied' using errcode='42501'; end if;
      v_target:=v_target||pg_catalog.jsonb_build_object('status','In review',
        'submittedByActorId',v_actor,'submittedAt',v_now);
    elsif p_action='approve-document' then
      if v_member.role<>'operations_leader'
        or v_target->>'status'<>'In review'
        or v_target->>'submittedByActorId'=v_actor::text
        or length(v_note)<15 then
        raise exception 'independent_document_review_required' using errcode='42501'; end if;
      v_target:=v_target||pg_catalog.jsonb_build_object('status','Approved',
        'approvedByActorId',v_actor,'approvedByMembershipId',v_member.id,
        'approvedAt',v_now,'reviewNote',v_note);
    else
      if v_member.role not in ('project_manager','admin')
        or v_target->>'status'<>'Approved'
        or v_target->>'approvedByActorId'=v_actor::text then
        raise exception 'independent_document_issue_required' using errcode='42501'; end if;
      if exists(select 1 from pg_catalog.jsonb_array_elements(v_state->'releases') r
        where r->>'status' in ('Awaiting receipt','Accepted')
          and r->'documentRefs' ? (v_id||'@'||v_revision::text)) then
        raise exception 'active_field_revision_locked' using errcode='23514'; end if;
      v_target:=v_target||pg_catalog.jsonb_build_object('status','Issued for use',
        'issuedAt',v_now,'issuedBy',v_actor);
    end if;
    v_documents:=(select pg_catalog.jsonb_agg(case when d->>'id'=v_id
      and (d->>'revision')::integer=v_revision then v_target else d end order by ordinal)
      from pg_catalog.jsonb_array_elements(v_documents)
        with ordinality as entries(d,ordinal));
    v_state:=pg_catalog.jsonb_set(v_state,'{documents}',v_documents);
  elsif p_action='request-review' then
    v_package:=p_input->>'packageId';
    v_discipline:=p_input->>'discipline';
    v_due:=p_input->>'dueDate';
    select p into v_target from pg_catalog.jsonb_array_elements(v_packages) p
      where p->>'packageId'=v_package;
    if v_member.role not in ('project_manager','admin') or v_target is null
      or v_discipline is null or not (v_policy->'requiredReviews' ? v_discipline)
      or v_due is null or v_due !~ '^\d{4}-\d{2}-\d{2}$'
      or p_input->>'assignee' is distinct from v_discipline||' review queue'
      or exists(select 1 from pg_catalog.jsonb_array_elements(v_reviews) r
        where r->>'packageId'=v_package
          and r->>'revision'=v_target->>'revision'
          and r->>'discipline'=v_discipline and r->>'status'='Requested') then
      raise exception 'package_review_request_invalid' using errcode='23514'; end if;
    v_id:=gen_random_uuid()::text;
    v_revision:=(v_target->>'revision')::integer;
    v_reviews:=v_reviews||pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('id',v_id,'packageId',v_package,
        'revision',v_revision,'discipline',v_discipline,'status','Requested',
        'assignee',v_discipline||' review queue','dueDate',v_due,
        'requestedAt',v_now,'requestedByActorId',v_actor,
        'requestedByMembershipId',v_member.id));
    v_state:=pg_catalog.jsonb_set(v_state,'{reviews}',v_reviews);
    v_packages:=(select pg_catalog.jsonb_agg(case when p->>'packageId'=v_package
      then p||pg_catalog.jsonb_build_object('status','In review') else p end order by ordinal)
      from pg_catalog.jsonb_array_elements(v_packages)
        with ordinality as entries(p,ordinal));
    v_state:=pg_catalog.jsonb_set(v_state,'{packages}',v_packages);
  else
    v_id:=p_input->>'reviewId';
    v_decision:=p_input->>'decision';
    select r into v_target from pg_catalog.jsonb_array_elements(v_reviews) r
      where r->>'id'=v_id;
    v_package:=v_target->>'packageId';
    v_revision:=(v_target->>'revision')::integer;
    if v_member.role<>'operations_leader' or v_target is null
      or v_target->>'status'<>'Requested'
      or v_target->>'requestedByActorId'=v_actor::text
      or v_decision not in ('Approved','Returned')
      or length(v_note)<15
      or not exists(select 1 from pg_catalog.jsonb_array_elements(v_packages) p
        where p->>'packageId'=v_package
          and (p->>'revision')::integer=v_revision) then
      raise exception 'independent_package_review_required' using errcode='42501'; end if;
    v_target:=v_target||pg_catalog.jsonb_build_object('status',v_decision,
      'decidedAt',v_now,'decidedByActorId',v_actor,
      'decidedByMembershipId',v_member.id,'note',v_note);
    v_reviews:=(select pg_catalog.jsonb_agg(case when r->>'id'=v_id
      then v_target else r end order by ordinal)
      from pg_catalog.jsonb_array_elements(v_reviews)
        with ordinality as entries(r,ordinal));
    v_state:=pg_catalog.jsonb_set(v_state,'{reviews}',v_reviews);
    if v_decision='Returned' then
      v_packages:=(select pg_catalog.jsonb_agg(case when p->>'packageId'=v_package
        then p||pg_catalog.jsonb_build_object('status','Returned') else p end order by ordinal)
        from pg_catalog.jsonb_array_elements(v_packages)
          with ordinality as entries(p,ordinal));
      v_state:=pg_catalog.jsonb_set(v_state,'{packages}',v_packages);
    end if;
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

-- Exact-source adaptation of d5o_hosted_design_demand_command_v1; existing approval rules remain.
create or replace function public.d5o_hosted_design_demand_command_v1(
  p_workspace_key text,p_presentation_id text,p_demand jsonb,
  p_command_id text,p_expected_source_revision bigint,
  p_expected_decision_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
  v_member d5o_hosted.memberships%rowtype;v_work d5o_hosted.work_records%rowtype;
  v_raw d5o_hosted.prototype_states%rowtype;
  v_handoff d5o_hosted.connected_design_handoffs%rowtype;
  v_design d5o_hosted.connected_design_states%rowtype;
  v_receipt d5o_hosted.connected_design_receipts%rowtype;
  v_target jsonb;v_slot jsonb;v_demands jsonb;v_state jsonb;
  v_fingerprint text;v_result jsonb;v_now timestamptz:=now();
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or pg_catalog.jsonb_typeof(p_demand)<>'object'
    or length(coalesce(p_command_id,'')) not between 8 and 120
    or p_expected_source_revision is null or p_expected_source_revision<1
    or p_expected_decision_revision is null or p_expected_decision_revision<1 then
    raise exception 'invalid_design_demand_command' using errcode='22023'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor and status='active' for share;
  if not found or v_member.role not in ('admin','project_manager','operations_leader') then
    raise exception 'design_demand_role_denied' using errcode='42501'; end if;
  select w.* into v_work from d5o_hosted.work_records w
    join d5o_hosted.work_identity_links l on l.work_id=w.id and l.workspace_id=w.workspace_id
    where w.workspace_id=v_workspace.id and l.presentation_id=p_presentation_id
    for update of w;
  if not found then raise exception 'connected_work_unavailable' using errcode='42501'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_workspace_key,
    p_presentation_id,p_demand,p_expected_source_revision,
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
    raise exception 'stale_design_demand_basis' using errcode='23505'; end if;
  perform d5o_hosted.connected_design_source_v1(v_workspace.id,v_work.id,v_raw.state_json);
  select p into v_target from pg_catalog.jsonb_array_elements(v_design.state->'packages') p
    where p->>'packageId'=p_demand->>'packageId';
  if v_target is null or p_demand->>'workId'<>p_presentation_id
    or p_demand->>'qualification' is null
    or coalesce((p_demand->>'minimumPeople')::integer,0)<1
    or coalesce((p_demand->>'estimatedPersonHours')::numeric,0)<=0
    or pg_catalog.jsonb_typeof(p_demand->'requiredSlots')<>'array'
    or pg_catalog.jsonb_array_length(p_demand->'requiredSlots')=0
    or p_demand->>'priority' not in ('Critical','High','Normal') then
    raise exception 'dated_design_demand_invalid' using errcode='23514'; end if;
  for v_slot in select value from pg_catalog.jsonb_array_elements(p_demand->'requiredSlots') loop
    if coalesce(v_slot->>'date','')<v_target->>'windowStart'
      or coalesce(v_slot->>'date','')>v_target->>'windowEnd'
      or coalesce(v_slot->>'shift','')='' then
      raise exception 'demand_outside_package_window' using errcode='23514'; end if;
  end loop;
  if exists(select 1 from pg_catalog.jsonb_array_elements(v_design.state->'releases') r
    where r->>'packageId'=p_demand->>'packageId'
      and r->>'status' in ('Awaiting receipt','Accepted')) then
    raise exception 'released_demand_locked' using errcode='23514'; end if;
  v_demands:=(select coalesce(pg_catalog.jsonb_agg(d order by ordinal),'[]'::jsonb)
    from pg_catalog.jsonb_array_elements(coalesce(v_design.state->'demands','[]'::jsonb))
      with ordinality as entries(d,ordinal)
    where d->>'packageId'<>p_demand->>'packageId');
  v_demands:=v_demands||pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('workId',p_presentation_id,
      'packageId',p_demand->>'packageId','qualification',p_demand->>'qualification',
      'minimumPeople',(p_demand->>'minimumPeople')::integer,
      'estimatedPersonHours',(p_demand->>'estimatedPersonHours')::numeric,
      'requiredSlots',p_demand->'requiredSlots','priority',p_demand->>'priority',
      'prerequisite',coalesce(p_demand->>'prerequisite',''),
      'crewSchedulable',coalesce((p_demand->>'crewSchedulable')::boolean,true),
      'designPackageRevision',(v_target->>'revision')::integer));
  v_state:=v_design.state||pg_catalog.jsonb_build_object(
    'demands',v_demands,'authorityRevision',v_design.decision_revision+1,
    'history',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'at',v_now,'actorId',v_actor,'membershipId',v_member.id,
      'action','save-demand · '||p_command_id,
      'note','Dated qualified package demand recorded',
      'packageId',p_demand->>'packageId',
      'revision',(v_target->>'revision')::integer))||
      coalesce(v_design.state->'history','[]'::jsonb));
  update d5o_hosted.connected_design_states set
    decision_revision=decision_revision+1,state=v_state,updated_at=v_now
    where workspace_id=v_workspace.id and work_id=v_work.id;
  insert into d5o_hosted.connected_design_events(workspace_id,work_id,
    decision_revision,command_id,action,actor_user_id,membership_id,
    source_handoff_revision,snapshot,reason)
  values(v_workspace.id,v_work.id,v_design.decision_revision+1,p_command_id,
    'save-demand',v_actor,v_member.id,v_handoff.revision,v_state,
    'Dated qualified package demand recorded');
  v_result:=public.d5o_hosted_prototype_read_v1(p_workspace_key,'work');
  insert into d5o_hosted.connected_design_receipts(workspace_id,command_id,
    work_id,actor_user_id,fingerprint,result)
  values(v_workspace.id,p_command_id,v_work.id,v_actor,v_fingerprint,v_result);
  return v_result;
end; $$;

-- Exact-source adaptation of d5o_hosted_design_release_command_v1; existing approval rules remain.
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
  v_id text;v_note text:=trim(coalesce(p_input->>'note',''));
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
    if coalesce(p_input->>'receivingOwner','')='' or
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
      'receivingOwner',p_input->>'receivingOwner',
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
      or length(v_note)<15 or v_release->>'issuedByActorId'=v_actor::text then
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
