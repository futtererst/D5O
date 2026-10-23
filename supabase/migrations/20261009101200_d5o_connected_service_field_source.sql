-- Recheck the accepted service source when authorizing or resuming field work.
create or replace function public.d5o_hosted_field_start_command_v1(
  p_workspace_key text,p_presentation_id text,p_package_id text,
  p_action text,p_reason text,p_command_id text,
  p_expected_source_revision bigint,p_expected_design_revision integer,
  p_expected_schedule_revision integer,p_expected_deploy_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
  v_member d5o_hosted.memberships%rowtype;v_work d5o_hosted.work_records%rowtype;
  v_raw d5o_hosted.prototype_states%rowtype;
  v_design d5o_hosted.connected_design_states%rowtype;
  v_schedule d5o_hosted.connected_schedule_states%rowtype;
  v_deploy d5o_hosted.connected_deploy_states%rowtype;
  v_receipt d5o_hosted.connected_deploy_receipts%rowtype;
  v_policy jsonb;v_release jsonb;v_package jsonb;v_publication jsonb;
  v_current_source jsonb;v_current_handoff d5o_hosted.connected_design_handoffs%rowtype;
  v_booking jsonb;v_person jsonb;v_predecessor jsonb;v_material jsonb;
  v_state jsonb;v_permit jsonb;v_result jsonb;v_now timestamptz:=now();
  v_fingerprint text;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or p_action not in ('authorize-start','hold','resume')
    or length(coalesce(p_command_id,'')) not between 8 and 120
    or length(trim(coalesce(p_reason,'')))<15
    or p_expected_source_revision is null or p_expected_source_revision<1
    or p_expected_design_revision is null or p_expected_design_revision<1
    or p_expected_schedule_revision is null or p_expected_schedule_revision<1
    or p_expected_deploy_revision is null or p_expected_deploy_revision<0 then
    raise exception 'invalid_field_start_command' using errcode='22023'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor and status='active' for share;
  if not found or v_member.role not in ('field_supervisor','operations_leader') then
    raise exception 'field_start_authority_required' using errcode='42501'; end if;
  select w.* into v_work from d5o_hosted.work_records w
    join d5o_hosted.work_identity_links l on l.work_id=w.id
      and l.workspace_id=w.workspace_id
    where w.workspace_id=v_workspace.id and l.presentation_id=p_presentation_id
      for update of w;
  if not found then raise exception 'connected_work_unavailable' using errcode='42501'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_workspace_key,
    p_presentation_id,p_package_id,p_action,p_reason,p_expected_source_revision,
    p_expected_design_revision,p_expected_schedule_revision,
    p_expected_deploy_revision)::text);
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
    or v_schedule.decision_revision is distinct from p_expected_schedule_revision
    or coalesce(v_deploy.decision_revision,0)<>p_expected_deploy_revision then
    raise exception 'stale_field_start_basis' using errcode='23505'; end if;
  select wt->'deployControls' into v_policy
    from d5o_hosted.configuration_versions c,
      lateral pg_catalog.jsonb_array_elements(
        c.manifest_json#>'{d5oPresentation,phaseContract,workTypes}') wt
    where c.id=v_work.configuration_version_id
      and wt->>'workTypeKey'=v_work.work_type_key;
  if v_policy is null or v_policy->>'schemaVersion'<>'1' then
    raise exception 'pinned_deploy_policy_unavailable' using errcode='23514'; end if;
  v_state:=coalesce(v_deploy.state,pg_catalog.jsonb_build_object(
    'permits','[]'::jsonb,'reports','[]'::jsonb,'inspections','[]'::jsonb,
    'issues','[]'::jsonb,'evidence','[]'::jsonb,'signoffs','[]'::jsonb,
    'turnovers','[]'::jsonb,'completions','[]'::jsonb,'events','[]'::jsonb));
  select r into v_release from pg_catalog.jsonb_array_elements(v_design.state->'releases') r
    where r->>'packageId'=p_package_id order by r->>'issuedAt' desc limit 1;
  if v_release is null or v_release->>'status'<>'Accepted'
    or (v_release->>'packageRevision')::integer<>
      (select (p->>'revision')::integer from pg_catalog.jsonb_array_elements(
        v_design.state->'packages') p where p->>'packageId'=p_package_id) then
    raise exception 'current_accepted_release_required' using errcode='23514'; end if;
  -- A service receipt remains historical; start and resume require the same
  -- accepted request/asset/coverage basis to be current at commit time.
  if p_action in ('authorize-start','resume') and exists (
    select 1 from d5o_hosted.work_identity_links l
    where l.workspace_id=v_workspace.id and l.work_id=v_work.id
      and l.relation_kind='service_visit') then
    if v_release->>'sourceKind'<>'service' then
      raise exception 'service_release_source_required' using errcode='23514'; end if;
    v_current_source:=d5o_hosted.connected_design_source_v1(
      v_workspace.id,v_work.id,v_raw.state_json);
    select * into v_current_handoff from d5o_hosted.connected_design_handoffs
      where workspace_id=v_workspace.id and work_id=v_work.id for share;
    if v_release->>'sourceId'<>v_current_handoff.handoff->>'id'
      or v_release->>'sourceDigest'<>v_current_handoff.source_digest
      or v_release->>'sourceId'<>v_current_source#>>'{serviceExecutionBasis,id}' then
      raise exception 'stale_service_field_basis' using errcode='23514'; end if;
  end if;
  v_package:=v_release->'snapshot';
  select pub into v_publication from pg_catalog.jsonb_array_elements(
    v_schedule.state->'publications') pub
    where exists(select 1 from pg_catalog.jsonb_array_elements(
      pub->'assignments') a where a->>'workId'=p_presentation_id
        and a->>'packageId'=p_package_id)
    order by pub->>'publishedAt' desc limit 1;
  select a into v_booking from pg_catalog.jsonb_array_elements(
    coalesce(v_publication->'assignments','[]'::jsonb)) a
    where a->>'workId'=p_presentation_id and a->>'packageId'=p_package_id;
  if v_booking is null or not exists(select 1 from pg_catalog.jsonb_array_elements(
    v_schedule.state->'assignments') a where a=v_booking)
    or pg_catalog.jsonb_array_length(v_booking->'people')<
      (v_release#>>'{crewDemandSnapshot,minimumPeople}')::integer then
    raise exception 'current_published_crew_required' using errcode='23514'; end if;
  for v_person in select value from pg_catalog.jsonb_array_elements(
    v_booking->'people') loop
    if v_policy->>'requireWorkerAcknowledgment'='true' and not exists(
      select 1 from pg_catalog.jsonb_array_elements(v_schedule.state->'receipts') r
        where r->>'publicationId'=v_publication->>'id'
          and r->>'assignmentId'=v_booking->>'id'
          and r->>'recipient'=v_person#>>'{}'
          and r->>'response'='acknowledged') then
      raise exception 'worker_acknowledgment_required' using errcode='23514'; end if;
  end loop;
  for v_predecessor in select value from pg_catalog.jsonb_array_elements(
    v_package->'predecessorIds') loop
    if not exists(select 1 from pg_catalog.jsonb_array_elements(
      coalesce(v_state->'completions','[]'::jsonb)) c
      where c->>'packageId'=v_predecessor#>>'{}'
        and c->>'status'='Reviewed'
        and exists(select 1 from pg_catalog.jsonb_array_elements(
          v_design.state->'releases') r where r->>'id'=c->>'releaseId'
            and r->>'status'='Accepted')) then
      raise exception 'predecessor_reviewed_completion_required' using errcode='23514'; end if;
  end loop;
  if v_policy->>'requirePhysicalMaterials'='true' then
    for v_material in select value from pg_catalog.jsonb_array_elements(
      coalesce(v_package->'materialLines','[]'::jsonb)) loop
      if v_material->>'status'<>'Available' or
        coalesce((v_material->>'availableQuantity')::numeric,0)<
          (v_material->>'quantity')::numeric then
        raise exception 'physical_material_shortage' using errcode='23514'; end if;
    end loop;
  end if;
  if v_policy->>'requireAccess'='true' and coalesce(v_package->>'access','')=''
    or v_policy->>'requirePermit'='true' and coalesce(v_package->>'permit','')=''
    or coalesce(v_package->>'safetyControls','')=''
    or coalesce(v_package->>'method','')='' then
    raise exception 'field_controls_incomplete' using errcode='23514'; end if;
  if exists(select 1 from pg_catalog.jsonb_array_elements(v_state->'issues') i
    where i->>'packageId'=p_package_id and i->>'status'='Open') then
    raise exception 'open_issue_blocks_start' using errcode='23514'; end if;
  if p_action='authorize-start' then
    if exists(select 1 from pg_catalog.jsonb_array_elements(v_state->'permits') p
      where p->>'packageId'=p_package_id and p->>'status'='Authorized') then
      raise exception 'already_authorized' using errcode='23514'; end if;
  elsif p_action='hold' then
    if not exists(select 1 from pg_catalog.jsonb_array_elements(v_state->'permits') p
      where p->>'packageId'=p_package_id and p->>'status'='Authorized') then
      raise exception 'active_start_required' using errcode='23514'; end if;
    v_state:=pg_catalog.jsonb_set(v_state,'{permits}',
      (select pg_catalog.jsonb_agg(case when p->>'packageId'=p_package_id
        and p->>'status'='Authorized' then p||pg_catalog.jsonb_build_object(
          'status','Held','heldAt',v_now) else p end order by ordinal)
        from pg_catalog.jsonb_array_elements(v_state->'permits')
          with ordinality as entries(p,ordinal)));
  else
    if not exists(select 1 from pg_catalog.jsonb_array_elements(v_state->'permits') p
      where p->>'packageId'=p_package_id and p->>'status'='Held') then
      raise exception 'held_start_required' using errcode='23514'; end if;
  end if;
  if p_action in ('authorize-start','resume') then
    v_permit:=pg_catalog.jsonb_build_object('id',gen_random_uuid(),
      'packageId',p_package_id,'releaseId',v_release->>'id',
      'packageRevision',(v_release->>'packageRevision')::integer,
      'publicationId',v_publication->>'id',
      'scheduleRevision',v_schedule.decision_revision,
      'policyVersionId',v_work.configuration_version_id,
      'status','Authorized','at',v_now,'actorId',v_actor,
      'reason',trim(p_reason));
    v_state:=pg_catalog.jsonb_set(v_state,'{permits}',
      v_state->'permits'||pg_catalog.jsonb_build_array(v_permit));
  end if;
  v_state:=v_state||pg_catalog.jsonb_build_object(
    'authorityRevision',coalesce(v_deploy.decision_revision,0)+1,
    'events',v_state->'events'||pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('id',gen_random_uuid(),
        'commandId',p_command_id,'at',v_now,'actorId',v_actor,
        'membershipId',v_member.id,'action',p_action,
        'packageId',p_package_id,'note',trim(p_reason))));
  if v_deploy.work_id is null then
    insert into d5o_hosted.connected_deploy_states(workspace_id,work_id,
      decision_revision,state) values(v_workspace.id,v_work.id,1,v_state);
  else
    update d5o_hosted.connected_deploy_states set
      decision_revision=decision_revision+1,state=v_state,updated_at=v_now
      where workspace_id=v_workspace.id and work_id=v_work.id;
  end if;
  insert into d5o_hosted.connected_deploy_events(workspace_id,work_id,
    decision_revision,command_id,action,actor_user_id,membership_id,
    design_revision,schedule_revision,snapshot)
  values(v_workspace.id,v_work.id,coalesce(v_deploy.decision_revision,0)+1,
    p_command_id,p_action,v_actor,v_member.id,v_design.decision_revision,
    v_schedule.decision_revision,v_state);
  v_result:=public.d5o_hosted_prototype_read_v1(p_workspace_key,'work');
  insert into d5o_hosted.connected_deploy_receipts(workspace_id,command_id,
    work_id,actor_user_id,fingerprint,result)
  values(v_workspace.id,p_command_id,v_work.id,v_actor,v_fingerprint,v_result);
  return v_result;
end; $$;
revoke all on function public.d5o_hosted_field_start_command_v1(
  text,text,text,text,text,text,bigint,integer,integer,integer)
  from public,anon,service_role;
grant execute on function public.d5o_hosted_field_start_command_v1(
  text,text,text,text,text,text,bigint,integer,integer,integer)
  to authenticated;
