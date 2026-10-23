-- Return a completed covered visit to its existing request and asset.
-- The caller supplies intent and expected revisions, never a replacement state.
create or replace function public.d5o_hosted_service_return_command_v1(
  p_workspace_key text,p_parent_presentation_id text,p_action text,p_input jsonb,
  p_command_id text,p_expected_work_revision bigint,
  p_expected_operate_revision integer,p_expected_child_deploy_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
  v_member d5o_hosted.memberships%rowtype;
  v_parent_work d5o_hosted.work_records%rowtype;
  v_child_work d5o_hosted.work_records%rowtype;
  v_service d5o_hosted.connected_service_work%rowtype;
  v_raw d5o_hosted.prototype_states%rowtype;
  v_operate d5o_hosted.connected_operate_states%rowtype;
  v_deploy d5o_hosted.connected_deploy_states%rowtype;
  v_receipt d5o_hosted.connected_operate_receipts%rowtype;
  v_state jsonb;v_job jsonb;v_request jsonb;v_asset jsonb;
  v_evidence jsonb:='[]'::jsonb;v_completions jsonb:='[]'::jsonb;
  v_result jsonb;v_fingerprint text;v_now timestamptz:=now();
  v_job_id text;v_request_id text;v_note text:=trim(coalesce(p_input->>'note',''));
  v_item jsonb;v_release_id text;v_revision integer;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or p_action not in ('link-execution','complete-job','resolve-request','close-request')
    or pg_catalog.jsonb_typeof(p_input)<>'object'
    or length(coalesce(p_command_id,'')) not between 8 and 120
    or p_expected_work_revision is null or p_expected_work_revision<1
    or p_expected_operate_revision is null or p_expected_operate_revision<1
    or p_expected_child_deploy_revision is null or p_expected_child_deploy_revision<1 then
    raise exception 'invalid_service_return_command' using errcode='22023'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('d5o-connected:'||v_workspace.id::text,0));
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor and status='active' for share;
  if not found or (p_action in ('link-execution','complete-job','close-request')
      and v_member.role<>'operations_leader')
    or (p_action='resolve-request' and v_member.role<>'project_manager') then
    raise exception 'service_return_authority_required' using errcode='42501'; end if;
  select w.* into v_parent_work from d5o_hosted.work_records w
    join d5o_hosted.work_identity_links l on l.workspace_id=w.workspace_id
      and l.work_id=w.id and l.parent_work_id is null
    where w.workspace_id=v_workspace.id and l.presentation_id=p_parent_presentation_id
      for update of w;
  if not found then raise exception 'canonical_parent_required' using errcode='23503'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(
    p_workspace_key,p_parent_presentation_id,p_action,p_input,
    p_expected_work_revision,p_expected_operate_revision,
    p_expected_child_deploy_revision)::text);
  select * into v_receipt from d5o_hosted.connected_operate_receipts
    where workspace_id=v_workspace.id and command_id=p_command_id;
  if found then
    if v_receipt.work_id<>v_parent_work.id or v_receipt.actor_user_id<>v_actor
      or v_receipt.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_receipt.result; end if;
  select * into v_raw from d5o_hosted.prototype_states
    where workspace_id=v_workspace.id and state_key='work' for share;
  select * into v_operate from d5o_hosted.connected_operate_states
    where workspace_id=v_workspace.id and work_id=v_parent_work.id for update;
  if v_raw.revision is distinct from p_expected_work_revision
    or v_operate.decision_revision is distinct from p_expected_operate_revision then
    raise exception 'stale_service_return_basis' using errcode='23505'; end if;
  v_state:=v_operate.state;
  if p_action in ('link-execution','complete-job') then
    v_job_id:=p_input->>'jobId';
    select item into v_job from pg_catalog.jsonb_array_elements(v_state->'jobs') item
      where item->>'id'=v_job_id and item->>'requestId' is not null;
    v_request_id:=v_job->>'requestId';
  else
    v_request_id:=p_input->>'requestId';
    select item into v_request from pg_catalog.jsonb_array_elements(v_state->'requests') item
      where item->>'id'=v_request_id;
    if v_request is null or pg_catalog.jsonb_array_length(
      coalesce(v_request->'currentCycleJobIds','[]'::jsonb))<>1 then
      raise exception 'single_current_service_job_required' using errcode='23514'; end if;
    v_job_id:=v_request->'currentCycleJobIds'->>0;
    select item into v_job from pg_catalog.jsonb_array_elements(v_state->'jobs') item
      where item->>'id'=v_job_id and item->>'requestId'=v_request_id;
  end if;
  if v_job is null then raise exception 'service_job_missing' using errcode='23514'; end if;
  if v_request is null then
    select item into v_request from pg_catalog.jsonb_array_elements(v_state->'requests') item
      where item->>'id'=v_request_id;
  end if;
  if v_request is null or not (coalesce(v_request->'currentCycleJobIds','[]'::jsonb) ? v_job_id)
    or v_job->>'requestCycleAt' is distinct from
      coalesce(v_request->>'reopenedAt',v_request->>'reportedAt')
    or v_job->>'assetIds' is not null and not (v_job->'assetIds' ? (v_request->>'assetId')) then
    raise exception 'current_service_cycle_required' using errcode='23514'; end if;
  select * into v_service from d5o_hosted.connected_service_work
    where workspace_id=v_workspace.id and presentation_id=v_job->>'workId'
      and parent_work_id=v_parent_work.id and request_id=v_request_id
      and asset_id=v_request->>'assetId';
  select * into v_child_work from d5o_hosted.work_records
    where workspace_id=v_workspace.id and id=v_service.work_id for share;
  select * into v_deploy from d5o_hosted.connected_deploy_states
    where workspace_id=v_workspace.id and work_id=v_child_work.id for share;
  if v_service.work_id is null or v_child_work.id is null
    or v_deploy.decision_revision is distinct from p_expected_child_deploy_revision then
    raise exception 'stale_service_execution' using errcode='23505'; end if;
  if p_action='link-execution' then
    if v_job->>'status'<>'Generated' or v_request->>'status'<>'In progress'
      or v_request->>'coverage' not in ('Covered','Partially covered')
      or v_deploy.state#>>'{workAcceptance,receipt}'<>'Accepted' then
      raise exception 'accepted_service_execution_required' using errcode='23514'; end if;
    perform d5o_hosted.connected_design_source_v1(v_workspace.id,
      v_child_work.id,v_raw.state_json);
    for v_item in select value from pg_catalog.jsonb_array_elements(
      v_deploy.state#>'{workAcceptance,releaseIds}') loop
      v_release_id:=v_item#>>'{}';
      if not exists(select 1 from pg_catalog.jsonb_array_elements(v_deploy.state->'completions') c
        where c->>'releaseId'=v_release_id and c->>'status'='Reviewed')
        or not exists(select 1 from pg_catalog.jsonb_array_elements(v_deploy.state->'inspections') i
          where i->>'releaseId'=v_release_id and i->>'status'='Verified'
            and i->>'result'='Pass') then
        raise exception 'verified_service_completion_required' using errcode='23514'; end if;
      v_completions:=v_completions||coalesce((select pg_catalog.jsonb_agg(
        (v_job->>'workId')||':completion:'||(c->>'id')||':release:'||v_release_id)
        from pg_catalog.jsonb_array_elements(v_deploy.state->'completions') c
        where c->>'releaseId'=v_release_id and c->>'status'='Reviewed'),'[]'::jsonb);
    end loop;
    v_evidence:=coalesce((select pg_catalog.jsonb_agg(
      (v_job->>'workId')||':report:'||(r->>'id')||':r'||(r->>'revision'))
      from pg_catalog.jsonb_array_elements(v_deploy.state->'reports') r
      where r->>'status'='Reviewed' and v_deploy.state#>'{workAcceptance,releaseIds}'
        ? (r->>'releaseId')),'[]'::jsonb);
    if pg_catalog.jsonb_array_length(v_evidence)=0
      or not exists(select 1 from pg_catalog.jsonb_array_elements(v_deploy.state->'evidence') e
        where e->>'state'='Reviewed') then
      raise exception 'reviewed_service_evidence_required' using errcode='23514'; end if;
    v_job:=v_job||pg_catalog.jsonb_build_object('status','Execution linked',
      'evidence',v_evidence,'completionRefs',v_completions,
      'linkedByActorId',v_actor,'linkedAt',v_now,
      'workAcceptanceId',v_deploy.state#>>'{workAcceptance,id}');
    select item into v_asset from pg_catalog.jsonb_array_elements(v_state->'assets') item
      where item->>'id'=v_request->>'assetId' and item->>'status'='Supported';
    if v_asset is null then raise exception 'supported_asset_required' using errcode='23514'; end if;
    v_asset:=pg_catalog.jsonb_set(v_asset,'{history}',
      coalesce(v_asset->'history','[]'::jsonb)||pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('at',v_now,'action','Reviewed service execution linked',
          'source',v_job->>'workId','actorId',v_actor,
          'reports',v_evidence,'completions',v_completions)));
    v_state:=pg_catalog.jsonb_set(v_state,'{assets}',
      (select pg_catalog.jsonb_agg(case when a->>'id'=v_asset->>'id' then v_asset else a end order by ordinal)
       from pg_catalog.jsonb_array_elements(v_state->'assets') with ordinality as entries(a,ordinal)));
  elsif p_action='complete-job' then
    if v_job->>'status'<>'Execution linked' or v_job->>'linkedByActorId'=v_actor::text
      or v_deploy.state#>>'{workAcceptance,id}'<>v_job->>'workAcceptanceId'
      or v_deploy.state#>>'{workAcceptance,receipt}'<>'Accepted'
      or pg_catalog.jsonb_array_length(coalesce(v_job->'completionRefs','[]'::jsonb))=0
      or length(v_note)<20 then
      raise exception 'independent_service_completion_required' using errcode='42501'; end if;
    v_job:=v_job||pg_catalog.jsonb_build_object('status','Completed',
      'completedAt',v_now,'completedByActorId',v_actor,'completionReason',v_note);
  elsif p_action='resolve-request' then
    if v_job->>'status'<>'Completed' or v_request->>'status'<>'In progress'
      or coalesce(v_request->>'activePause','') not in ('','null')
      or length(trim(coalesce(p_input->>'resolution','')))<20 then
      raise exception 'reviewed_request_resolution_required' using errcode='23514'; end if;
    v_request:=v_request||pg_catalog.jsonb_build_object('status','Resolved',
      'resolution',trim(p_input->>'resolution'),
      'resolutionSource','Reviewed service job '||v_job_id,
      'resolutionEvidence',pg_catalog.jsonb_build_object('jobId',v_job_id,
        'workId',v_job->>'workId','reports',v_job->'evidence',
        'completions',v_job->'completionRefs'),
      'reviewedBy',v_actor,'resolvedAt',v_now);
  else
    if v_job->>'status'<>'Completed' or v_request->>'status'<>'Resolved'
      or v_request->>'reviewedBy'=v_actor::text or length(v_note)<20 then
      raise exception 'independent_request_close_required' using errcode='42501'; end if;
    v_request:=v_request||pg_catalog.jsonb_build_object('status','Closed',
      'closedByActorId',v_actor,'closedAt',v_now,'closeReason',v_note);
  end if;
  if p_action in ('link-execution','complete-job') then
    v_state:=pg_catalog.jsonb_set(v_state,'{jobs}',
      (select pg_catalog.jsonb_agg(case when j->>'id'=v_job_id then v_job else j end order by ordinal)
       from pg_catalog.jsonb_array_elements(v_state->'jobs') with ordinality as entries(j,ordinal)));
  else
    v_request:=pg_catalog.jsonb_set(v_request,'{history}',
      coalesce(v_request->'history','[]'::jsonb)||pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('at',v_now,'action',p_action,'actorId',v_actor,
          'note',case when p_action='resolve-request' then p_input->>'resolution' else v_note end)));
    v_state:=pg_catalog.jsonb_set(v_state,'{requests}',
      (select pg_catalog.jsonb_agg(case when r->>'id'=v_request_id then v_request else r end order by ordinal)
       from pg_catalog.jsonb_array_elements(v_state->'requests') with ordinality as entries(r,ordinal)));
  end if;
  v_revision:=v_operate.decision_revision+1;
  v_state:=v_state||pg_catalog.jsonb_build_object('authorityRevision',v_revision,
    'events',coalesce(v_state->'events','[]'::jsonb)||pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('id',gen_random_uuid(),'at',v_now,'commandId',p_command_id,
        'action',p_action,'actorId',v_actor,'membershipId',v_member.id,
        'sourceId',v_job_id,'note',v_note)));
  update d5o_hosted.connected_operate_states set decision_revision=v_revision,
    state=v_state,updated_at=v_now where workspace_id=v_workspace.id and work_id=v_parent_work.id;
  insert into d5o_hosted.connected_operate_events(workspace_id,work_id,decision_revision,
    command_id,action,actor_user_id,membership_id,deploy_revision,snapshot)
  values(v_workspace.id,v_parent_work.id,v_revision,p_command_id,p_action,
    v_actor,v_member.id,v_deploy.decision_revision,v_state);
  v_result:=public.d5o_hosted_prototype_read_v1(p_workspace_key,'work');
  insert into d5o_hosted.connected_operate_receipts(workspace_id,command_id,work_id,
    actor_user_id,fingerprint,result)
  values(v_workspace.id,p_command_id,v_parent_work.id,v_actor,v_fingerprint,v_result);
  return v_result;
end; $$;
revoke all on function public.d5o_hosted_service_return_command_v1(
  text,text,text,jsonb,text,bigint,integer,integer)
  from public,anon,service_role;
grant execute on function public.d5o_hosted_service_return_command_v1(
  text,text,text,jsonb,text,bigint,integer,integer) to authenticated;
