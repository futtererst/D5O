-- Assets added after activation need their own Operations acceptance.
create function public.d5o_hosted_accept_supported_asset_v1(
  p_workspace_key text,p_parent_presentation_id text,p_asset_id text,
  p_documentation_source text,p_reason text,p_command_id text,
  p_expected_source_revision bigint,p_expected_operate_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
  v_member d5o_hosted.memberships%rowtype;v_parent d5o_hosted.work_records%rowtype;
  v_raw d5o_hosted.prototype_states%rowtype;
  v_operate d5o_hosted.connected_operate_states%rowtype;
  v_receipt d5o_hosted.connected_operate_receipts%rowtype;
  v_asset jsonb;v_state jsonb;v_fingerprint text;v_result jsonb;v_now timestamptz:=now();
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or length(trim(coalesce(p_documentation_source,'')))<10
    or length(trim(coalesce(p_reason,'')))<10
    or length(coalesce(p_command_id,'')) not between 8 and 120
    or p_expected_source_revision is null or p_expected_operate_revision is null then
    raise exception 'invalid_asset_acceptance' using errcode='22023'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('d5o-connected:'||v_workspace.id::text,0));
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor and status='active' for share;
  if not found or v_member.role<>'operations_leader' then
    raise exception 'operations_asset_authority_required' using errcode='42501'; end if;
  select w.* into v_parent from d5o_hosted.work_records w
    join d5o_hosted.work_identity_links l on l.workspace_id=w.workspace_id and l.work_id=w.id
    where w.workspace_id=v_workspace.id and l.presentation_id=p_parent_presentation_id
      and l.parent_work_id is null for update of w;
  if not found then raise exception 'canonical_parent_required' using errcode='23503'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(
    p_workspace_key,p_parent_presentation_id,p_asset_id,
    trim(p_documentation_source),trim(p_reason),p_expected_source_revision,
    p_expected_operate_revision)::text);
  select * into v_receipt from d5o_hosted.connected_operate_receipts
    where workspace_id=v_workspace.id and command_id=p_command_id;
  if found then
    if v_receipt.actor_user_id<>v_actor or v_receipt.work_id<>v_parent.id
      or v_receipt.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_receipt.result; end if;
  select * into v_raw from d5o_hosted.prototype_states
    where workspace_id=v_workspace.id and state_key='work' for share;
  select * into v_operate from d5o_hosted.connected_operate_states
    where workspace_id=v_workspace.id and work_id=v_parent.id for update;
  if v_raw.revision is distinct from p_expected_source_revision
    or v_operate.decision_revision is distinct from p_expected_operate_revision then
    raise exception 'stale_asset_acceptance_basis' using errcode='23505'; end if;
  if v_operate.state#>>'{activation,status}'<>'Active'
    or v_operate.state->'support' is null
    or v_operate.state->'source' is null then
    raise exception 'active_support_basis_required' using errcode='23514'; end if;
  select item into v_asset from pg_catalog.jsonb_array_elements(v_operate.state->'assets') item
    where item->>'id'=p_asset_id;
  if v_asset is null or v_asset->>'status'<>'Pending'
    or v_asset->>'sourceTurnoverId' is distinct from
      v_operate.state#>>'{source,workAcceptanceId}'
    or nullif(trim(coalesce(v_asset->>'location','')),'') is null then
    raise exception 'pending_asset_source_required' using errcode='23514'; end if;
  v_asset:=v_asset||pg_catalog.jsonb_build_object('status','Supported',
    'acceptedAt',v_now,'acceptedByActorId',v_actor,
    'acceptanceSource',trim(p_documentation_source),
    'history',coalesce(v_asset->'history','[]'::jsonb)||pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('at',v_now,'action','Support accepted',
        'source',trim(p_documentation_source),'actorId',v_actor,'reason',trim(p_reason))));
  v_state:=pg_catalog.jsonb_set(v_operate.state,'{assets}',
    (select pg_catalog.jsonb_agg(case when item->>'id'=p_asset_id then v_asset
      else item end order by ordinal) from pg_catalog.jsonb_array_elements(v_operate.state->'assets')
      with ordinality as entries(item,ordinal)));
  v_state:=v_state||pg_catalog.jsonb_build_object(
    'authorityRevision',v_operate.decision_revision+1,
    'events',v_operate.state->'events'||pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('id',gen_random_uuid(),
        'commandId',p_command_id,'fingerprint',v_fingerprint,'at',v_now,
        'actorId',v_actor,'membershipId',v_member.id,
        'action','accept-asset','detail',p_asset_id)));
  update d5o_hosted.connected_operate_states set decision_revision=decision_revision+1,
    state=v_state,updated_at=v_now where workspace_id=v_workspace.id and work_id=v_parent.id;
  insert into d5o_hosted.connected_operate_events(workspace_id,work_id,
    decision_revision,command_id,action,actor_user_id,membership_id,
    deploy_revision,snapshot)
  values(v_workspace.id,v_parent.id,v_operate.decision_revision+1,p_command_id,
    'accept-asset',v_actor,v_member.id,
    (select decision_revision from d5o_hosted.connected_deploy_states
      where workspace_id=v_workspace.id and work_id=v_parent.id),v_state);
  v_result:=public.d5o_hosted_prototype_read_v1(p_workspace_key,'work');
  insert into d5o_hosted.connected_operate_receipts(workspace_id,command_id,
    work_id,actor_user_id,fingerprint,result)
  values(v_workspace.id,p_command_id,v_parent.id,v_actor,v_fingerprint,v_result);
  return v_result;
end; $$;
revoke all on function public.d5o_hosted_accept_supported_asset_v1(
  text,text,text,text,text,text,bigint,integer) from public,anon,service_role;
grant execute on function public.d5o_hosted_accept_supported_asset_v1(
  text,text,text,text,text,text,bigint,integer) to authenticated;
