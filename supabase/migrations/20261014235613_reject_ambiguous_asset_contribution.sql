-- Forward-only replacement: prevent an unresolved duplicate external identity from becoming an accepted delivery contribution.
-- An accepted delivery may contribute to a supported asset owned by another
-- Work Record. Keep one authoritative asset/history on its owner Work; retain
-- the exact accepted-source association on the contributing Work. The current
-- authenticated support owner independently accepts this additional scope.
create or replace function public.d5o_hosted_link_existing_asset_v1(
  p_workspace_key text,p_target_presentation_id text,
  p_owner_presentation_id text,p_asset_id text,p_note text,p_command_id text,
  p_expected_source_revision bigint,p_expected_target_deploy_revision integer,
  p_expected_target_operate_revision integer,p_expected_owner_operate_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
  v_member d5o_hosted.memberships%rowtype;v_target uuid;v_owner uuid;
  v_lock uuid;v_raw d5o_hosted.prototype_states%rowtype;
  v_target_operate d5o_hosted.connected_operate_states%rowtype;
  v_owner_operate d5o_hosted.connected_operate_states%rowtype;
  v_target_deploy d5o_hosted.connected_deploy_states%rowtype;
  v_owner_deploy_revision integer;v_receipt d5o_hosted.connected_operate_receipts%rowtype;
  v_target_record jsonb;v_owner_record jsonb;v_target_state jsonb;v_owner_state jsonb;
  v_acceptance jsonb;v_asset jsonb;v_link jsonb;v_note text:=pg_catalog.btrim(coalesce(p_note,''));
  v_now timestamptz:=now();v_fingerprint text;v_result jsonb;v_asset_uuid uuid;
  v_external_identity text;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or length(coalesce(p_command_id,'')) not between 8 and 90
    or length(v_note) not between 20 and 2000
    or p_expected_source_revision is null or p_expected_source_revision<1
    or p_expected_target_deploy_revision is null or p_expected_target_deploy_revision<1
    or p_expected_target_operate_revision is null or p_expected_target_operate_revision<1
    or p_expected_owner_operate_revision is null or p_expected_owner_operate_revision<1
    or p_target_presentation_id=p_owner_presentation_id then
    raise exception 'invalid_asset_link_command' using errcode='22023';
  end if;
  begin v_asset_uuid:=p_asset_id::uuid;
  exception when invalid_text_representation then
    raise exception 'invalid_asset_link_command' using errcode='22023'; end;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor and status='active' for share;
  if not found or v_member.role<>'operations_leader' then
    raise exception 'asset_link_owner_authority_required' using errcode='42501'; end if;
  select work_id into v_target from d5o_hosted.work_identity_links
    where workspace_id=v_workspace.id and presentation_id=p_target_presentation_id;
  select work_id into v_owner from d5o_hosted.work_identity_links
    where workspace_id=v_workspace.id and presentation_id=p_owner_presentation_id;
  if v_target is null or v_owner is null or v_target=v_owner then
    raise exception 'asset_link_work_unavailable' using errcode='42501'; end if;
  -- Both canonical Work rows are locked in a stable order before either state.
  for v_lock in select id from d5o_hosted.work_records
      where workspace_id=v_workspace.id and id in (v_target,v_owner)
      order by id for update loop null; end loop;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(
    p_workspace_key,p_target_presentation_id,p_owner_presentation_id,p_asset_id,
    v_note,p_expected_source_revision,p_expected_target_deploy_revision,
    p_expected_target_operate_revision,p_expected_owner_operate_revision)::text);
  select * into v_receipt from d5o_hosted.connected_operate_receipts
    where workspace_id=v_workspace.id and command_id=p_command_id;
  if found then
    if v_receipt.work_id<>v_target or v_receipt.actor_user_id<>v_actor
      or v_receipt.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_receipt.result;
  end if;
  select * into v_raw from d5o_hosted.prototype_states
    where workspace_id=v_workspace.id and state_key='work' for share;
  select * into v_target_deploy from d5o_hosted.connected_deploy_states
    where workspace_id=v_workspace.id and work_id=v_target for share;
  select * into v_target_operate from d5o_hosted.connected_operate_states
    where workspace_id=v_workspace.id and work_id=v_target for update;
  select * into v_owner_operate from d5o_hosted.connected_operate_states
    where workspace_id=v_workspace.id and work_id=v_owner for update;
  if v_raw.revision is distinct from p_expected_source_revision
    or v_target_deploy.decision_revision is distinct from p_expected_target_deploy_revision
    or v_target_operate.decision_revision is distinct from p_expected_target_operate_revision
    or v_owner_operate.decision_revision is distinct from p_expected_owner_operate_revision then
    raise exception 'stale_asset_link_basis' using errcode='23505'; end if;
  v_target_state:=v_target_operate.state;v_owner_state:=v_owner_operate.state;
  v_acceptance:=v_target_deploy.state->'workAcceptance';
  if v_target_state#>>'{source,kind}'<>'Accepted Deploy'
    or v_acceptance->>'receipt'<>'Accepted'
    or v_target_state#>>'{source,workAcceptanceId}' is distinct from v_acceptance->>'id'
    or v_target_state#>>'{source,revision}' is distinct from v_acceptance->>'revision'
    or v_target_state#>>'{source,acceptedByActorId}'=v_actor::text
    or not d5o_hosted.current_work_acceptance_scope_v1(
      v_workspace.id,v_target,v_acceptance,true) then
    raise exception 'current_received_scope_required' using errcode='23514'; end if;
  select item into v_target_record from pg_catalog.jsonb_array_elements(
    coalesce(v_raw.state_json->'records','[]'::jsonb)) item
    where item->>'id'=p_target_presentation_id;
  select item into v_owner_record from pg_catalog.jsonb_array_elements(
    coalesce(v_raw.state_json->'records','[]'::jsonb)) item
    where item->>'id'=p_owner_presentation_id;
  if v_target_record is null or v_owner_record is null
    or v_target_record#>>'{serviceSource,parentWorkId}' is not null
    or pg_catalog.lower(pg_catalog.btrim(coalesce(v_target_record->>'customer','')))
      is distinct from pg_catalog.lower(pg_catalog.btrim(coalesce(v_owner_record->>'customer','')))
    or pg_catalog.lower(pg_catalog.btrim(coalesce(v_target_record->>'site','')))
      is distinct from pg_catalog.lower(pg_catalog.btrim(coalesce(v_owner_record->>'site','')))
    or v_owner_state#>>'{support,ownerActorId}' is distinct from v_actor::text
    or v_owner_state#>>'{activation,status}'<>'Active' then
    raise exception 'supported_asset_owner_required' using errcode='42501'; end if;
  select item into v_asset from pg_catalog.jsonb_array_elements(
    coalesce(v_owner_state->'assets','[]'::jsonb)) item
    where item->>'id'=v_asset_uuid::text and item->>'status'='Supported';
  if v_asset is null or pg_catalog.lower(pg_catalog.btrim(coalesce(v_asset->>'customer','')))
      is distinct from pg_catalog.lower(pg_catalog.btrim(coalesce(v_target_record->>'customer','')))
    or pg_catalog.lower(pg_catalog.btrim(coalesce(v_asset->>'site','')))
      is distinct from pg_catalog.lower(pg_catalog.btrim(coalesce(v_target_record->>'site',''))) then
    raise exception 'supported_asset_identity_required' using errcode='23514'; end if;
  -- The prior add-asset command serializes this same tenant/identity pair.
  -- A retained duplicate cannot become an arbitrary accepted contribution.
  v_external_identity:=pg_catalog.lower(pg_catalog.btrim(coalesce(v_asset->>'externalId','')));
  if v_external_identity<>'' then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      v_workspace.id::text||':asset:'||v_external_identity,0));
    if (select count(*) from d5o_hosted.connected_operate_states o,
        lateral pg_catalog.jsonb_array_elements(coalesce(o.state->'assets','[]'::jsonb)) a
        where o.workspace_id=v_workspace.id
          and pg_catalog.lower(pg_catalog.btrim(coalesce(a->>'externalId','')))=v_external_identity) <> 1 then
      raise exception 'ambiguous_asset_identity' using errcode='23514';
    end if;
  end if;
  if exists(select 1 from pg_catalog.jsonb_array_elements(
      coalesce(v_target_state->'assetLinks','[]'::jsonb)) item
      where item->>'assetId'=v_asset_uuid::text and item->>'status'='Accepted')
    or coalesce(v_asset->'sourceWorkIds','[]'::jsonb) ? p_target_presentation_id then
    raise exception 'asset_contribution_exists' using errcode='23505'; end if;
  v_link:=pg_catalog.jsonb_build_object('id',gen_random_uuid(),
    'status','Accepted','assetId',v_asset_uuid,'ownerWorkId',p_owner_presentation_id,
    'workAcceptanceId',v_acceptance->>'id',
    'workAcceptanceRevision',(v_acceptance->>'revision')::integer,
    'acceptedAt',v_now,'acceptedByActorId',v_actor,'reason',v_note);
  v_target_state:=pg_catalog.jsonb_set(v_target_state,'{assetLinks}',
    coalesce(v_target_state->'assetLinks','[]'::jsonb)||pg_catalog.jsonb_build_array(v_link));
  v_target_state:=v_target_state||pg_catalog.jsonb_build_object(
    'authorityRevision',v_target_operate.decision_revision+1,
    'events',coalesce(v_target_state->'events','[]'::jsonb)||pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('id',gen_random_uuid(),'commandId',p_command_id,
        'fingerprint',v_fingerprint,'at',v_now,'actorId',v_actor,
        'membershipId',v_member.id,'action','link-existing-asset','detail',v_note)));
  v_asset:=pg_catalog.jsonb_set(v_asset,'{sourceWorkIds}',
    coalesce(v_asset->'sourceWorkIds','[]'::jsonb)||pg_catalog.jsonb_build_array(p_target_presentation_id));
  v_asset:=pg_catalog.jsonb_set(v_asset,'{history}',
    coalesce(v_asset->'history','[]'::jsonb)||pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('at',v_now,'action','Accepted delivery contribution',
        'source',p_target_presentation_id,'actorId',v_actor,
        'workAcceptanceId',v_acceptance->>'id','reason',v_note)));
  v_owner_state:=pg_catalog.jsonb_set(v_owner_state,'{assets}',
    (select pg_catalog.jsonb_agg(case when item->>'id'=v_asset_uuid::text
      then v_asset else item end order by ordinal)
      from pg_catalog.jsonb_array_elements(v_owner_state->'assets')
        with ordinality as entries(item,ordinal)));
  v_owner_state:=v_owner_state||pg_catalog.jsonb_build_object(
    'authorityRevision',v_owner_operate.decision_revision+1,
    'events',coalesce(v_owner_state->'events','[]'::jsonb)||pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('id',gen_random_uuid(),
        'commandId',p_command_id||':owner','fingerprint',v_fingerprint,
        'at',v_now,'actorId',v_actor,'membershipId',v_member.id,
        'action','accept-delivery-contribution','detail',v_note)));
  update d5o_hosted.connected_operate_states set
    decision_revision=v_target_operate.decision_revision+1,
    state=v_target_state,updated_at=v_now
    where workspace_id=v_workspace.id and work_id=v_target;
  update d5o_hosted.connected_operate_states set
    decision_revision=v_owner_operate.decision_revision+1,
    state=v_owner_state,updated_at=v_now
    where workspace_id=v_workspace.id and work_id=v_owner;
  insert into d5o_hosted.connected_operate_events(workspace_id,work_id,
    decision_revision,command_id,action,actor_user_id,membership_id,
    deploy_revision,snapshot)
  values(v_workspace.id,v_target,v_target_operate.decision_revision+1,
    p_command_id,'link-existing-asset',v_actor,v_member.id,
    v_target_deploy.decision_revision,v_target_state);
  select coalesce(decision_revision,0) into v_owner_deploy_revision
    from d5o_hosted.connected_deploy_states
    where workspace_id=v_workspace.id and work_id=v_owner;
  insert into d5o_hosted.connected_operate_events(workspace_id,work_id,
    decision_revision,command_id,action,actor_user_id,membership_id,
    deploy_revision,snapshot)
  values(v_workspace.id,v_owner,v_owner_operate.decision_revision+1,
    p_command_id||':owner','accept-delivery-contribution',v_actor,v_member.id,
    coalesce(v_owner_deploy_revision,0),v_owner_state);
  v_result:=public.d5o_hosted_prototype_read_v1(p_workspace_key,'work');
  insert into d5o_hosted.connected_operate_receipts(workspace_id,command_id,
    work_id,actor_user_id,fingerprint,result)
  values(v_workspace.id,p_command_id,v_target,v_actor,v_fingerprint,v_result);
  return v_result;
end; $$;
revoke all on function public.d5o_hosted_link_existing_asset_v1(
  text,text,text,text,text,text,bigint,integer,integer,integer)
  from public,anon,service_role;
grant execute on function public.d5o_hosted_link_existing_asset_v1(
  text,text,text,text,text,text,bigint,integer,integer,integer)
  to authenticated;
