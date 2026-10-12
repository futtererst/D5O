-- Reject missing Design draft references at the authenticated command boundary.
-- Prior SQL <> checks returned NULL for absent JSON keys. Historical drafts remain retained.
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
    if pg_catalog.jsonb_typeof(v_input) is distinct from 'object'
      or length(trim(coalesce(v_input->>'title',''))) not between 3 and 200
      or length(trim(coalesce(v_input->>'type',''))) not between 2 and 100
      or length(trim(coalesce(v_input->>'source',''))) not between 5 and 2000
      or pg_catalog.jsonb_typeof(v_input->'packageIds')<>'array'
      or pg_catalog.jsonb_typeof(v_input->'requirementIds') is distinct from 'array' then
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
      or pg_catalog.jsonb_typeof(v_input->'predecessorIds') is distinct from 'array'
      or pg_catalog.jsonb_typeof(v_input->'documentRefs') is distinct from 'array'
      or v_input#>>'{completionBasis,kind}' is null or v_input#>>'{completionBasis,kind}' not in ('Measured','Qualitative')
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
    if v_input->>'commercialDisposition' is null or v_input->>'commercialDisposition' not in ('None','Assessment required',
      'Routed to Develop') or v_input->>'materialStatus' is null or v_input->>'materialStatus' not in
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

