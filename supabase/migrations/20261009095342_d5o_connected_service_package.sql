-- Reuse the protected package catalog and receipt ledger. The service branch
-- checks its own accepted source, never a commercial offer or Define baseline.
create function public.d5o_hosted_create_service_package_v1(
  p_workspace_key text,p_presentation_id text,p_name text,p_owner text,
  p_command_id text,p_expected_work_revision bigint,
  p_expected_catalog_revision bigint,p_expected_basis_revision integer,
  p_expected_package_count integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
  v_member d5o_hosted.memberships%rowtype;v_work d5o_hosted.work_records%rowtype;
  v_service d5o_hosted.connected_service_work%rowtype;
  v_work_state d5o_hosted.prototype_states%rowtype;
  v_catalog d5o_hosted.prototype_states%rowtype;
  v_basis d5o_hosted.connected_design_handoffs%rowtype;
  v_receipt d5o_hosted.connected_package_receipts%rowtype;
  v_fingerprint text;v_id text;v_package jsonb;v_result jsonb;
  v_count integer;v_source jsonb;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or length(coalesce(p_command_id,'')) not between 8 and 120
    or length(trim(coalesce(p_name,''))) not between 3 and 120
    or length(trim(coalesce(p_owner,''))) not between 2 and 120
    or p_expected_work_revision is null or p_expected_work_revision<1
    or p_expected_catalog_revision is null or p_expected_catalog_revision<1
    or p_expected_basis_revision is null or p_expected_basis_revision<1
    or p_expected_package_count is null or p_expected_package_count<0 then
    raise exception 'invalid_service_package_command' using errcode='22023'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('d5o-connected:'||v_workspace.id::text,0));
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor and status='active' for share;
  if not found or v_member.role<>'project_manager' then
    raise exception 'service_package_editor_denied' using errcode='42501'; end if;
  select w.* into v_work from d5o_hosted.work_records w
    join d5o_hosted.work_identity_links l on l.work_id=w.id and l.workspace_id=w.workspace_id
    where w.workspace_id=v_workspace.id and l.presentation_id=p_presentation_id
      and l.relation_kind='service_visit' for update of w;
  if not found then raise exception 'service_work_unavailable' using errcode='23503'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_workspace_key,
    p_presentation_id,trim(p_name),trim(p_owner),p_expected_work_revision,
    p_expected_catalog_revision,p_expected_basis_revision,p_expected_package_count)::text);
  select * into v_receipt from d5o_hosted.connected_package_receipts
    where workspace_id=v_workspace.id and command_id=p_command_id;
  if found then
    if v_receipt.work_id<>v_work.id or v_receipt.actor_user_id<>v_actor
      or v_receipt.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_receipt.result; end if;
  select * into v_work_state from d5o_hosted.prototype_states
    where workspace_id=v_workspace.id and state_key='work' for share;
  select * into v_catalog from d5o_hosted.prototype_states
    where workspace_id=v_workspace.id and state_key='catalog' for share;
  select * into v_basis from d5o_hosted.connected_design_handoffs
    where workspace_id=v_workspace.id and work_id=v_work.id for share;
  select * into v_service from d5o_hosted.connected_service_work
    where workspace_id=v_workspace.id and work_id=v_work.id for share;
  select count(*) into v_count from d5o_hosted.connected_package_states
    where workspace_id=v_workspace.id and work_id=v_work.id;
  if v_work_state.revision is distinct from p_expected_work_revision
    or v_catalog.revision is distinct from p_expected_catalog_revision
    or v_count<>p_expected_package_count or v_count>=500
    or v_basis.source_kind is distinct from 'service'
    or v_basis.status is distinct from 'accepted'
    or v_basis.revision<>p_expected_basis_revision
    or v_service.work_id is null
    or v_service.work_projection->>'canonicalWorkId' is distinct from v_work.id::text
    or v_service.work_projection->>'phaseConfigurationVersionId' is distinct from
      v_work.configuration_version_id::text then
    raise exception 'stale_service_package_basis' using errcode='23505'; end if;
  v_source:=d5o_hosted.current_service_source_v1(v_workspace.id,v_work.id);
  if v_basis.source_digest<>pg_catalog.md5(v_source::text)
    or v_basis.handoff#>>'{brief,configurationVersionId}' is distinct from
      v_work.configuration_version_id::text then
    raise exception 'service_source_changed' using errcode='23514'; end if;
  v_id:='wp-'||pg_catalog.replace(gen_random_uuid()::text,'-','');
  v_package:=pg_catalog.jsonb_build_object('id',v_id,'workId',p_presentation_id,
    'name',trim(p_name),'owner',trim(p_owner),'installed',0,'tested',0,
    'accepted',0,'status','planned','createdAt',now(),
    'createdBy',v_actor,'sourceKind','service',
    'sourceId',v_basis.handoff->>'id','sourceHandoffRevision',v_basis.revision);
  insert into d5o_hosted.connected_package_states(workspace_id,work_id,
    package_id,snapshot,created_by)
  values(v_workspace.id,v_work.id,v_id,v_package,v_actor);
  v_result:=pg_catalog.jsonb_build_object('created',v_package,
    'workRevision',v_work_state.revision,'catalogRevision',v_catalog.revision,
    'packageCount',v_count+1,'canonicalWorkId',v_work.id);
  insert into d5o_hosted.connected_package_receipts(workspace_id,command_id,
    work_id,actor_user_id,fingerprint,result)
  values(v_workspace.id,p_command_id,v_work.id,v_actor,v_fingerprint,v_result);
  return v_result;
end; $$;
revoke all on function public.d5o_hosted_create_service_package_v1(
  text,text,text,text,text,bigint,bigint,integer,integer)
  from public,anon,service_role;
grant execute on function public.d5o_hosted_create_service_package_v1(
  text,text,text,text,text,bigint,bigint,integer,integer) to authenticated;
