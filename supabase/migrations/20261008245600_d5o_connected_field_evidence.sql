-- The file is uploaded to the existing private bucket before this command.
-- An authenticated caller can only register a file that actually exists at its
-- exact Work-scoped object path; review remains a separate independent action.
create or replace function public.d5o_hosted_field_evidence_command_v1(
  p_workspace_key text,p_presentation_id text,p_package_id text,
  p_action text,p_input jsonb,p_command_id text,
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
  v_binding d5o_hosted.crew_bindings%rowtype;
  v_release jsonb;v_publication jsonb;v_booking jsonb;
  v_state jsonb;v_evidence jsonb;v_path text;v_id uuid;
  v_object storage.objects%rowtype;v_now timestamptz:=now();
  v_fingerprint text;v_result jsonb;v_note text:=trim(coalesce(p_input->>'note',''));
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or p_action not in ('register-upload','review-evidence')
    or pg_catalog.jsonb_typeof(p_input)<>'object'
    or length(coalesce(p_command_id,'')) not between 8 and 120
    or p_expected_source_revision is null or p_expected_source_revision<1
    or p_expected_design_revision is null or p_expected_design_revision<1
    or p_expected_schedule_revision is null or p_expected_schedule_revision<1
    or p_expected_deploy_revision is null or p_expected_deploy_revision<1 then
    raise exception 'invalid_evidence_command' using errcode='22023'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor and status='active' for share;
  if not found then raise exception 'evidence_membership_required' using errcode='42501'; end if;
  select w.* into v_work from d5o_hosted.work_records w
    join d5o_hosted.work_identity_links l on l.work_id=w.id
      and l.workspace_id=w.workspace_id
    where w.workspace_id=v_workspace.id and l.presentation_id=p_presentation_id
      for update of w;
  if not found then raise exception 'connected_work_unavailable' using errcode='42501'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_workspace_key,
    p_presentation_id,p_package_id,p_action,p_input,p_expected_source_revision,
    p_expected_design_revision,p_expected_schedule_revision,
    p_expected_deploy_revision)::text);
  select * into v_receipt from d5o_hosted.connected_deploy_receipts
    where workspace_id=v_workspace.id and command_id=p_command_id;
  if found then
    if v_receipt.work_id<>v_work.id or v_receipt.actor_user_id<>v_actor
      or v_receipt.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    if v_member.role='field_worker' then
      return pg_catalog.jsonb_build_object('accepted',true,
        'packageId',p_package_id,'commandId',p_command_id,'replay',true);
    end if;
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
    or v_deploy.decision_revision is distinct from p_expected_deploy_revision then
    raise exception 'stale_evidence_basis' using errcode='23505'; end if;
  v_state:=v_deploy.state;
  select r into v_release from pg_catalog.jsonb_array_elements(v_design.state->'releases') r
    where r->>'packageId'=p_package_id order by r->>'issuedAt' desc limit 1;
  if v_release is null or v_release->>'status'<>'Accepted'
    or (v_release->>'packageRevision')::integer<>
      (select (p->>'revision')::integer from pg_catalog.jsonb_array_elements(
        v_design.state->'packages') p where p->>'packageId'=p_package_id) then
    raise exception 'current_release_required' using errcode='23514'; end if;
  if p_action='register-upload' then
    select * into v_binding from d5o_hosted.crew_bindings
      where workspace_id=v_workspace.id and actor_user_id=v_actor and active for share;
    select pub into v_publication from pg_catalog.jsonb_array_elements(
      v_schedule.state->'publications') pub
      where exists(select 1 from pg_catalog.jsonb_array_elements(pub->'assignments') a
        where a->>'workId'=p_presentation_id and a->>'packageId'=p_package_id)
      order by pub->>'publishedAt' desc limit 1;
    select a into v_booking from pg_catalog.jsonb_array_elements(
      coalesce(v_publication->'assignments','[]'::jsonb)) a
      where a->>'id'=p_input->>'bookingId' and a->>'workId'=p_presentation_id
        and a->>'packageId'=p_package_id;
    if v_member.role<>'field_worker' or v_binding.person is null
      or v_booking is null or not (v_booking->'people' ? v_binding.person) then
      raise exception 'assigned_worker_required' using errcode='42501'; end if;
    begin v_id:=(p_input->>'evidenceId')::uuid;
    exception when invalid_text_representation then
      raise exception 'invalid_evidence_id' using errcode='22023'; end;
    if v_id is null or length(trim(coalesce(p_input->>'caption','')))<5
      or length(trim(coalesce(p_input->>'purpose','')))<3 then
      raise exception 'evidence_description_required' using errcode='22023'; end if;
    v_path:=p_workspace_key||'/'||pg_catalog.encode(
      extensions.digest(p_presentation_id,'sha256'),'hex')||'/'||v_id::text;
    select * into v_object from storage.objects
      where bucket_id='d5o-deploy-evidence' and name=v_path;
    if not found or v_object.metadata->>'mimetype' not in
      ('image/jpeg','image/png','image/webp','application/pdf')
      or (v_object.metadata->>'size')::bigint not between 1 and 10485760 then
      raise exception 'uploaded_object_missing_or_invalid' using errcode='23514'; end if;
    if exists(select 1 from pg_catalog.jsonb_array_elements(v_state->'evidence') e
      where e->>'id'=v_id::text) then
      raise exception 'evidence_already_registered' using errcode='23505'; end if;
    v_evidence:=pg_catalog.jsonb_build_object('id',v_id,'packageId',p_package_id,
      'releaseId',v_release->>'id','bookingId',v_booking->>'id',
      'purpose',trim(p_input->>'purpose'),'caption',trim(p_input->>'caption'),
      'filename',left(coalesce(p_input->>'filename','field-file'),200),
      'mimeType',v_object.metadata->>'mimetype',
      'sizeBytes',(v_object.metadata->>'size')::bigint,
      'checksumSha256',p_input->>'checksumSha256',
      'objectPath',v_path,'uploaderId',v_actor,
      'uploadedAt',v_now,'state','Uploaded');
    v_state:=pg_catalog.jsonb_set(v_state,'{evidence}',
      v_state->'evidence'||pg_catalog.jsonb_build_array(v_evidence));
  else
    if v_member.role not in ('operations_leader','field_supervisor')
      or p_input->>'decision' not in ('Reviewed','Returned')
      or length(v_note)<15 then
      raise exception 'evidence_review_authority_required' using errcode='42501'; end if;
    select e into v_evidence from pg_catalog.jsonb_array_elements(v_state->'evidence') e
      where e->>'id'=p_input->>'evidenceId' and e->>'packageId'=p_package_id;
    if v_evidence is null or v_evidence->>'state'<>'Uploaded'
      or v_evidence->>'uploaderId'=v_actor::text
      or v_evidence->>'releaseId'<>v_release->>'id' then
      raise exception 'independent_current_evidence_required' using errcode='23514'; end if;
    select * into v_object from storage.objects
      where bucket_id='d5o-deploy-evidence' and name=v_evidence->>'objectPath';
    if not found then raise exception 'evidence_object_unavailable' using errcode='23514'; end if;
    v_evidence:=v_evidence||pg_catalog.jsonb_build_object(
      'state',p_input->>'decision','reviewerId',v_actor,
      'reviewedAt',v_now,'reviewNote',v_note);
    v_state:=pg_catalog.jsonb_set(v_state,'{evidence}',
      (select pg_catalog.jsonb_agg(case when e->>'id'=v_evidence->>'id'
        then v_evidence else e end order by ordinal)
        from pg_catalog.jsonb_array_elements(v_state->'evidence')
          with ordinality as entries(e,ordinal)));
  end if;
  v_state:=v_state||pg_catalog.jsonb_build_object(
    'authorityRevision',v_deploy.decision_revision+1,
    'events',v_state->'events'||pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('id',gen_random_uuid(),
        'commandId',p_command_id,'at',v_now,'actorId',v_actor,
        'membershipId',v_member.id,'action',p_action,
        'packageId',p_package_id,'evidenceId',v_evidence->>'id')));
  update d5o_hosted.connected_deploy_states set
    decision_revision=decision_revision+1,state=v_state,updated_at=v_now
    where workspace_id=v_workspace.id and work_id=v_work.id;
  insert into d5o_hosted.connected_deploy_events(workspace_id,work_id,
    decision_revision,command_id,action,actor_user_id,membership_id,
    design_revision,schedule_revision,snapshot)
  values(v_workspace.id,v_work.id,v_deploy.decision_revision+1,p_command_id,
    p_action,v_actor,v_member.id,v_design.decision_revision,
    v_schedule.decision_revision,v_state);
  v_result:=case when v_member.role='field_worker' then
    pg_catalog.jsonb_build_object('accepted',true,
      'decisionRevision',v_deploy.decision_revision+1,
      'packageId',p_package_id,'commandId',p_command_id)
    else public.d5o_hosted_prototype_read_v1(p_workspace_key,'work') end;
  insert into d5o_hosted.connected_deploy_receipts(workspace_id,command_id,
    work_id,actor_user_id,fingerprint,result)
  values(v_workspace.id,p_command_id,v_work.id,v_actor,v_fingerprint,v_result);
  return v_result;
end; $$;
revoke all on function public.d5o_hosted_field_evidence_command_v1(
  text,text,text,text,jsonb,text,bigint,integer,integer,integer)
  from public,anon,service_role;
grant execute on function public.d5o_hosted_field_evidence_command_v1(
  text,text,text,text,jsonb,text,bigint,integer,integer,integer)
  to authenticated;
