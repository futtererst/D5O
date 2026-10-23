-- Exact Design release and independent Deploy receipt for connected pilot work.
-- Only typed authenticated intent can change the normalized Design decision.
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
  select item into v_source from pg_catalog.jsonb_array_elements(
    d5o_hosted.connected_package_projection_v1(v_workspace.id,
      d5o_hosted.connected_define_projection_v1(v_workspace.id,v_raw.state_json),
      'work')->'records') item
    where item->>'id'=p_presentation_id and item->>'canonicalWorkId'=v_work.id::text;
  if v_source is null or v_source->>'phaseConfigurationVersionId' is distinct from
    v_work.configuration_version_id::text
    or v_source#>>'{discovery,designHandoff,status}' is distinct from 'accepted'
    or v_source#>>'{definition,revision}' is distinct from
      v_handoff.handoff#>>'{brief,definitionRevision}' then
    raise exception 'accepted_design_source_required' using errcode='23514'; end if;
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
        coalesce(v_source#>'{definition,scopeControl,requirements}','[]'::jsonb)) r
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
revoke all on function public.d5o_hosted_design_release_command_v1(
  text,text,text,jsonb,text,bigint,integer) from public,anon,service_role;
grant execute on function public.d5o_hosted_design_release_command_v1(
  text,text,text,jsonb,text,bigint,integer) to authenticated;
