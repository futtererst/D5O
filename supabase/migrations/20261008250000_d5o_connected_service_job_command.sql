-- A service visit is created from request intent, never caller-produced parent or child snapshots.
-- Chargeable/partial coverage remains held until its pricing and customer authority are connected.
create table d5o_hosted.connected_service_work (
  workspace_id uuid not null,work_id uuid not null,parent_work_id uuid not null,
  presentation_id text not null,request_id text not null,asset_id text not null,
  work_projection jsonb not null,catalog_projection jsonb not null,
  created_at timestamptz not null default now(),
  primary key(workspace_id,work_id),unique(workspace_id,presentation_id),
  foreign key(work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id),
  foreign key(parent_work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id)
);
alter table d5o_hosted.connected_service_work enable row level security;
revoke all on d5o_hosted.connected_service_work from public,anon,authenticated,service_role;
create function public.d5o_hosted_service_job_command_v1(
  p_workspace_key text,p_parent_presentation_id text,p_request_id text,
  p_due_date date,p_owner text,p_command_id text,p_expected_work_revision bigint,
  p_expected_catalog_revision bigint,p_expected_operate_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
  v_member d5o_hosted.memberships%rowtype;v_parent d5o_hosted.work_records%rowtype;
  v_work d5o_hosted.prototype_states%rowtype;v_catalog d5o_hosted.prototype_states%rowtype;
  v_operate d5o_hosted.connected_operate_states%rowtype;
  v_receipt d5o_hosted.connected_create_receipts%rowtype;
  v_parent_raw jsonb;v_request jsonb;v_asset jsonb;v_child jsonb;
  v_catalog_child jsonb;v_after_operate jsonb;
  v_job jsonb;v_fingerprint text;v_result jsonb;v_child_id uuid:=gen_random_uuid();
  v_job_id uuid:=gen_random_uuid();v_alias text;v_type d5o_hosted.configuration_work_types%rowtype;
  v_now timestamptz:=now();v_request_cycle text;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or p_request_id is null or p_command_id is null or length(p_command_id) not between 8 and 120
    or p_due_date is null or p_due_date<current_date
    or length(trim(coalesce(p_owner,''))) not between 3 and 120
    or p_expected_work_revision is null or p_expected_catalog_revision is null
    or p_expected_operate_revision is null then
    raise exception 'invalid_service_job_command' using errcode='22023'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('d5o-connected:'||v_workspace.id::text,0));
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor and status='active' for share;
  if not found or v_member.role not in ('project_manager','operations_leader') then
    raise exception 'service_job_authority_required' using errcode='42501'; end if;
  select w.* into v_parent from d5o_hosted.work_records w
    join d5o_hosted.work_identity_links l on l.workspace_id=w.workspace_id and l.work_id=w.id
    where w.workspace_id=v_workspace.id and l.presentation_id=p_parent_presentation_id
      and l.parent_work_id is null for update of w;
  if not found then raise exception 'canonical_parent_required' using errcode='23503'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(
    p_workspace_key,p_parent_presentation_id,p_request_id,p_due_date,p_owner)::text);
  select * into v_receipt from d5o_hosted.connected_create_receipts
    where workspace_id=v_workspace.id and command_id=p_command_id;
  if found then
    if v_receipt.actor_user_id<>v_actor or v_receipt.request_fingerprint<>v_fingerprint
      then raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_receipt.result; end if;
  select * into v_work from d5o_hosted.prototype_states
    where workspace_id=v_workspace.id and state_key='work' for update;
  select * into v_catalog from d5o_hosted.prototype_states
    where workspace_id=v_workspace.id and state_key='catalog' for update;
  select * into v_operate from d5o_hosted.connected_operate_states
    where workspace_id=v_workspace.id and work_id=v_parent.id for update;
  if v_work.revision is distinct from p_expected_work_revision
    or v_catalog.revision is distinct from p_expected_catalog_revision
    or v_operate.decision_revision is distinct from p_expected_operate_revision then
    raise exception 'stale_service_job_basis' using errcode='23505'; end if;
  select item into v_parent_raw from pg_catalog.jsonb_array_elements(v_work.state_json->'records') item
    where item->>'id'=p_parent_presentation_id and item->>'canonicalWorkId'=v_parent.id::text;
  if v_parent_raw is null or v_parent_raw->>'phaseConfigurationVersionId'
      is distinct from v_parent.configuration_version_id::text
    or v_operate.state#>>'{activation,status}'<>'Active' then
    raise exception 'active_canonical_support_required' using errcode='23514'; end if;
  select item into v_request from pg_catalog.jsonb_array_elements(v_operate.state->'requests') item
    where item->>'id'=p_request_id and item->>'status' in ('Triaged','In progress');
  if v_request is null then raise exception 'triaged_request_required' using errcode='23514'; end if;
  if v_request->>'coverage'<>'Covered' then
    raise exception 'authoritative_service_pricing_required' using errcode='23514'; end if;
  select item into v_asset from pg_catalog.jsonb_array_elements(v_operate.state->'assets') item
    where item->>'id'=v_request->>'assetId' and item->>'status'='Supported';
  if v_asset is null then raise exception 'supported_asset_required' using errcode='23514'; end if;
  v_request_cycle:=coalesce(v_request->>'reopenedAt',v_request->>'reportedAt');
  if exists(select 1 from pg_catalog.jsonb_array_elements(v_operate.state->'jobs') item
    where item->>'requestId'=p_request_id and item->>'requestCycleAt'=v_request_cycle
      and item->>'dueDate'=p_due_date::text and item->>'status'<>'Cancelled') then
    raise exception 'duplicate_service_visit' using errcode='23505'; end if;
  select * into v_type from d5o_hosted.configuration_work_types
    where configuration_version_id=v_parent.configuration_version_id
      and display_name='Lifecycle service' and status='active';
  if not found or not exists(select 1 from d5o_hosted.configuration_create_rights
      where configuration_version_id=v_parent.configuration_version_id
        and work_type_key=v_type.work_type_key and workspace_role=v_member.role) then
    raise exception 'service_work_type_right_unavailable' using errcode='42501'; end if;
  v_alias:=p_workspace_key||'-'||pg_catalog.replace(v_child_id::text,'-','');
  v_job:=pg_catalog.jsonb_build_object('id',v_job_id,'workId',v_alias,
    'assetIds',pg_catalog.jsonb_build_array(v_asset->>'id'),'requestId',p_request_id,
    'requestCycleAt',v_request_cycle,'dueDate',p_due_date,'status','Generated',
    'evidence','[]'::jsonb,'createdAt',v_now,'createdByActorId',v_actor);
  v_child:=pg_catalog.jsonb_build_object('id',v_alias,'canonicalWorkId',v_child_id,
    'workspace',p_workspace_key,'title',(v_request->>'title')||' · '||(v_asset->>'name'),
    'type',v_type.display_name,'customer',v_parent_raw->>'customer',
    'site',v_parent_raw->>'site','stage','Design','owner',trim(p_owner),
    'nextAction','Prepare and approve service execution basis before Design release',
    'progress',0,'value','Covered service obligation','status','attention',
    'proof','[]'::jsonb,'blockers','[]'::jsonb,
    'history',pg_catalog.jsonb_build_array(v_now::text||' · Service visit created from accepted support; field execution is not authorized.'),
    'phaseConfigurationVersionId',v_parent.configuration_version_id,
    'serviceSource',pg_catalog.jsonb_build_object('parentWorkId',p_parent_presentation_id,
      'assetIds',pg_catalog.jsonb_build_array(v_asset->>'id'),'requestId',p_request_id,
      'requestCycleAt',v_request_cycle,'coverage','Covered'));
  v_catalog_child:=v_child-'serviceSource'||pg_catalog.jsonb_build_object(
    'createdAt',v_now,'createdBy',v_actor);
  insert into d5o_hosted.work_records(id,workspace_id,configuration_tenant_id,
    configuration_version_id,configuration_digest,work_type_key,title,created_by)
  values(v_child_id,v_workspace.id,v_parent.configuration_tenant_id,
    v_parent.configuration_version_id,v_parent.configuration_digest,v_type.work_type_key,
    v_child->>'title',v_actor);
  insert into d5o_hosted.work_identity_links(workspace_id,work_id,presentation_id,
    parent_work_id,relation_kind)
  values(v_workspace.id,v_child_id,v_alias,v_parent.id,'service_visit');
  insert into d5o_hosted.connected_service_work(workspace_id,work_id,parent_work_id,
    presentation_id,request_id,asset_id,work_projection,catalog_projection)
  values(v_workspace.id,v_child_id,v_parent.id,v_alias,p_request_id,
    v_asset->>'id',v_child,v_catalog_child);
  v_request:=v_request||pg_catalog.jsonb_build_object('status','In progress',
    'jobIds',coalesce(v_request->'jobIds','[]'::jsonb)||pg_catalog.jsonb_build_array(v_job_id),
    'currentCycleJobIds',coalesce(v_request->'currentCycleJobIds','[]'::jsonb)
      ||pg_catalog.jsonb_build_array(v_job_id));
  v_after_operate:=pg_catalog.jsonb_set(v_operate.state,'{requests}',
    (select pg_catalog.jsonb_agg(case when item->>'id'=p_request_id then v_request
      else item end order by ordinal) from pg_catalog.jsonb_array_elements(v_operate.state->'requests')
      with ordinality as entries(item,ordinal)));
  v_after_operate:=pg_catalog.jsonb_set(v_after_operate,'{jobs}',
    v_operate.state->'jobs'||pg_catalog.jsonb_build_array(v_job));
  v_after_operate:=v_after_operate||pg_catalog.jsonb_build_object(
    'authorityRevision',v_operate.decision_revision+1,
    'events',v_operate.state->'events'||pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('id',gen_random_uuid(),'commandId',p_command_id,
        'fingerprint',v_fingerprint,'at',v_now,'actorId',v_actor,
        'membershipId',v_member.id,'action','create-job','detail',v_alias)));
  update d5o_hosted.connected_operate_states set decision_revision=decision_revision+1,
    state=v_after_operate,updated_at=v_now where workspace_id=v_workspace.id and work_id=v_parent.id;
  insert into d5o_hosted.connected_operate_events(workspace_id,work_id,decision_revision,
    command_id,action,actor_user_id,membership_id,deploy_revision,snapshot)
  values(v_workspace.id,v_parent.id,v_operate.decision_revision+1,p_command_id,
    'create-job',v_actor,v_member.id,
    (select decision_revision from d5o_hosted.connected_deploy_states
      where workspace_id=v_workspace.id and work_id=v_parent.id),v_after_operate);
  insert into d5o_hosted.work_events(workspace_id,work_id,event_type,record_version,
    actor_user_id,membership_id,authority_role,configuration_version_id,
    configuration_digest,payload) values(v_workspace.id,v_child_id,'work_created',1,
    v_actor,v_member.id,v_member.role,v_parent.configuration_version_id,
    v_parent.configuration_digest,pg_catalog.jsonb_build_object('parentWorkId',v_parent.id,
      'relationKind','service_visit','presentationId',v_alias,'requestId',p_request_id,
      'requestCycleAt',v_request_cycle,'commandId',p_command_id));
  v_result:=pg_catalog.jsonb_build_object('workId',v_child_id,'presentationId',v_alias,
    'parentWorkId',v_parent.id,'jobId',v_job_id,'workRevision',v_work.revision,
    'catalogRevision',v_catalog.revision,'operateRevision',v_operate.decision_revision+1);
  insert into d5o_hosted.connected_create_receipts(workspace_id,command_id,
    actor_user_id,request_fingerprint,work_id,result)
  values(v_workspace.id,p_command_id,v_actor,v_fingerprint,v_child_id,v_result);
  return v_result;
end; $$;
revoke all on function public.d5o_hosted_service_job_command_v1(
  text,text,text,date,text,text,bigint,bigint,integer) from public,anon,service_role;
grant execute on function public.d5o_hosted_service_job_command_v1(
  text,text,text,date,text,text,bigint,bigint,integer) to authenticated;
-- The former service-role helper accepted caller-supplied snapshots. It is no
-- longer a permitted write path in the isolated connected pilot.
revoke execute on function public.d5o_hosted_create_related_work_v1(
  text,text,text,text,bigint,bigint,jsonb,jsonb,uuid,uuid) from service_role;
