-- The protected catalog is command-only. Replace the direct authenticated entry
-- with the established server-authenticated, service-only command pattern.
drop function public.d5o_hosted_correct_work_title_v1(text,text,text,integer,bigint,bigint,text,text,text);

create function public.d5o_hosted_correct_work_title_v1(
  p_workspace_key text, p_presentation_id text, p_command_id text,
  p_expected_record_version integer, p_expected_work_revision bigint,
  p_expected_catalog_revision bigint, p_expected_title text,
  p_new_title text, p_reason text, p_actor_user_id uuid, p_membership_id uuid
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := p_actor_user_id;
  v_workspace d5o_hosted.workspaces%rowtype;
  v_member d5o_hosted.memberships%rowtype;
  v_link d5o_hosted.work_identity_links%rowtype;
  v_work d5o_hosted.work_records%rowtype;
  v_work_state d5o_hosted.prototype_states%rowtype;
  v_catalog_state d5o_hosted.prototype_states%rowtype;
  v_receipt d5o_hosted.work_command_receipts%rowtype;
  v_fingerprint text;
  v_new_work jsonb;
  v_new_catalog jsonb;
  v_result jsonb;
  v_now timestamptz := pg_catalog.now();
begin
  if current_setting('role',true) is distinct from 'service_role' or v_actor is null or p_membership_id is null then
    raise exception 'server_command_required' using errcode='42501'; end if;
  if p_workspace_key is null or p_presentation_id is null
    or p_command_id is null or length(p_command_id) not between 8 and 120
    or p_expected_record_version is null or p_expected_record_version < 1
    or p_expected_work_revision is null or p_expected_work_revision < 1
    or p_expected_catalog_revision is null or p_expected_catalog_revision < 1
    or p_expected_title is null or length(pg_catalog.btrim(p_expected_title)) not between 1 and 240
    or p_new_title is null or length(pg_catalog.btrim(p_new_title)) not between 1 and 240
    or p_reason is null or length(pg_catalog.btrim(p_reason)) not between 10 and 500
    or pg_catalog.btrim(p_new_title)=pg_catalog.btrim(p_expected_title) then
    raise exception 'invalid_title_correction' using errcode='22023';
  end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('d5o-connected:' || v_workspace.id::text,0));
  select * into v_member from d5o_hosted.memberships
    where id=p_membership_id and workspace_id=v_workspace.id and actor_user_id=v_actor and status='active'
      and role in ('admin','project_manager') for share;
  if not found then raise exception 'work_title_role_denied' using errcode='42501'; end if;
  select * into v_link from d5o_hosted.work_identity_links
    where workspace_id=v_workspace.id and presentation_id=p_presentation_id;
  if not found then raise exception 'work_not_found' using errcode='42501'; end if;
  select * into v_work from d5o_hosted.work_records
    where id=v_link.work_id and workspace_id=v_workspace.id for update;
  if not found then raise exception 'work_not_found' using errcode='42501'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(
    p_workspace_key,p_presentation_id,v_actor,p_membership_id,p_expected_record_version,
    p_expected_work_revision,p_expected_catalog_revision,p_expected_title,
    pg_catalog.btrim(p_new_title),pg_catalog.btrim(p_reason))::text);
  select * into v_receipt from d5o_hosted.work_command_receipts
    where workspace_id=v_workspace.id and command_id=p_command_id;
  if found then
    if v_receipt.work_id is distinct from v_work.id
      or v_receipt.request_fingerprint is distinct from v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505';
    end if;
    return v_receipt.result;
  end if;
  if v_work.record_version <> p_expected_record_version
    or v_work.title is distinct from p_expected_title then
    raise exception 'stale_work_title' using errcode='23505'; end if;
  select * into v_work_state from d5o_hosted.prototype_states
    where workspace_id=v_workspace.id and state_key='work' for update;
  select * into v_catalog_state from d5o_hosted.prototype_states
    where workspace_id=v_workspace.id and state_key='catalog' for update;
  if not found or v_work_state.revision <> p_expected_work_revision
    or v_catalog_state.revision <> p_expected_catalog_revision then
    raise exception 'stale_state' using errcode='23505'; end if;
  if (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(v_work_state.state_json->'records') r
      where r->>'id'=p_presentation_id and r->>'title'=p_expected_title
        and r->>'canonicalWorkId'=v_work.id::text) <> 1
    or (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(v_catalog_state.state_json->'records') r
      where r->>'id'=p_presentation_id and r->>'title'=p_expected_title
        and r->>'canonicalWorkId'=v_work.id::text) <> 1 then
    raise exception 'title_projection_mismatch' using errcode='23514';
  end if;
  select pg_catalog.jsonb_set(v_work_state.state_json,'{records}',
    pg_catalog.jsonb_agg(case when r->>'id'=p_presentation_id
      then pg_catalog.jsonb_set(r,'{title}',pg_catalog.to_jsonb(pg_catalog.btrim(p_new_title)))
      else r end order by ord))
    into v_new_work
    from pg_catalog.jsonb_array_elements(v_work_state.state_json->'records')
      with ordinality as records(r,ord);
  select pg_catalog.jsonb_set(v_catalog_state.state_json,'{records}',
    pg_catalog.jsonb_agg(case when r->>'id'=p_presentation_id
      then pg_catalog.jsonb_set(r,'{title}',pg_catalog.to_jsonb(pg_catalog.btrim(p_new_title)))
      else r end order by ord))
    into v_new_catalog
    from pg_catalog.jsonb_array_elements(v_catalog_state.state_json->'records')
      with ordinality as records(r,ord);
  v_new_work:=pg_catalog.jsonb_set(v_new_work,'{revision}',
    pg_catalog.to_jsonb(v_work_state.revision+1));
  v_new_catalog:=pg_catalog.jsonb_set(v_new_catalog,'{revision}',
    pg_catalog.to_jsonb(v_catalog_state.revision+1));
  update d5o_hosted.work_records set title=pg_catalog.btrim(p_new_title),
    record_version=record_version+1 where id=v_work.id;
  update d5o_hosted.prototype_states set revision=revision+1,
    state_json=v_new_work,updated_by=v_actor,updated_at=v_now
    where workspace_id=v_workspace.id and state_key='work';
  update d5o_hosted.prototype_states set revision=revision+1,
    state_json=v_new_catalog,updated_by=v_actor,updated_at=v_now
    where workspace_id=v_workspace.id and state_key='catalog';
  insert into d5o_hosted.prototype_state_revisions(
    workspace_id,state_key,revision,state_json,actor_user_id,membership_id)
  values(v_workspace.id,'work',v_work_state.revision+1,v_new_work,v_actor,v_member.id),
    (v_workspace.id,'catalog',v_catalog_state.revision+1,v_new_catalog,v_actor,v_member.id);
  insert into d5o_hosted.work_events(workspace_id,work_id,event_type,record_version,
    actor_user_id,membership_id,authority_role,configuration_version_id,
    configuration_digest,payload)
  values(v_workspace.id,v_work.id,'work_title_corrected',v_work.record_version+1,
    v_actor,v_member.id,v_member.role,v_work.configuration_version_id,
    v_work.configuration_digest,pg_catalog.jsonb_build_object(
      'oldTitle',v_work.title,'newTitle',pg_catalog.btrim(p_new_title),
      'reason',pg_catalog.btrim(p_reason),'presentationId',p_presentation_id));
  v_result:=pg_catalog.jsonb_build_object('presentationId',p_presentation_id,
    'oldTitle',v_work.title,'title',pg_catalog.btrim(p_new_title),
    'recordVersion',v_work.record_version+1,'workRevision',v_work_state.revision+1,
    'catalogRevision',v_catalog_state.revision+1);
  insert into d5o_hosted.work_command_receipts(
    workspace_id,command_id,request_fingerprint,work_id,result)
  values(v_workspace.id,p_command_id,v_fingerprint,v_work.id,v_result);
  return v_result;
end; $$;
revoke all on function public.d5o_hosted_correct_work_title_v1(
  text,text,text,integer,bigint,bigint,text,text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.d5o_hosted_correct_work_title_v1(
  text,text,text,integer,bigint,bigint,text,text,text,uuid,uuid) to service_role;

