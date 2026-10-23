create function public.d5o_platform_template_command_v1(
  p_template_key text,p_action text,p_version_id uuid,p_payload jsonb,
  p_command_id text,p_reason text
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_template d5o_hosted.configuration_templates%rowtype;
  v_version d5o_hosted.configuration_template_versions%rowtype;
  v_prior d5o_hosted.platform_command_receipts%rowtype;
  v_manifest jsonb;v_types jsonb;v_roles jsonb;v_routes jsonb;
  v_fp text;v_before jsonb;v_result jsonb;v_new uuid;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null or not exists
    (select 1 from d5o_hosted.platform_administrators where actor_user_id=v_actor and status='active') then
    raise exception 'platform_administrator_required' using errcode='42501'; end if;
  if p_action not in ('create-draft','save','validate','publish','retire') or
    length(coalesce(p_command_id,'')) not between 8 and 120 or
    length(trim(coalesce(p_reason,''))) not between 8 and 500 then
    raise exception 'invalid_template_command' using errcode='22023'; end if;
  v_fp:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_template_key,p_action,p_version_id,
    p_payload,trim(p_reason))::text);
  select * into v_prior from d5o_hosted.platform_command_receipts where command_id=p_command_id;
  if found then
    if v_prior.actor_user_id<>v_actor or v_prior.fingerprint<>v_fp then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_prior.result; end if;
  select * into v_template from d5o_hosted.configuration_templates
    where template_key=p_template_key for update;
  if not found then raise exception 'template_missing' using errcode='23503'; end if;
  if v_template.status='retired' and p_action<>'retire' then
    raise exception 'template_retired' using errcode='23514'; end if;
  if p_action='create-draft' then
    select * into v_version from d5o_hosted.configuration_template_versions
      where template_id=v_template.id and status='published'
      order by version_number desc limit 1;
    if not found then raise exception 'template_source_missing' using errcode='23503'; end if;
    v_before:=pg_catalog.to_jsonb(v_version);v_new:=gen_random_uuid();
    insert into d5o_hosted.configuration_template_versions(id,template_id,version_number,status,
      manifest_json,work_types_json,create_roles_json,routes_json,source_sha256)
      values(v_new,v_template.id,(select max(version_number)+1 from d5o_hosted.configuration_template_versions
        where template_id=v_template.id),'draft',v_version.manifest_json,v_version.work_types_json,
        v_version.create_roles_json,v_version.routes_json,v_version.source_sha256);
  elsif p_action='retire' then
    if v_template.status='retired' then raise exception 'template_retired' using errcode='23514'; end if;
    v_before:=pg_catalog.to_jsonb(v_template);
    update d5o_hosted.configuration_templates set status='retired' where id=v_template.id;
    v_new:=null;
  else
    select * into v_version from d5o_hosted.configuration_template_versions
      where id=p_version_id and template_id=v_template.id for update;
    if not found then raise exception 'template_version_missing' using errcode='23503'; end if;
    v_before:=pg_catalog.to_jsonb(v_version);v_new:=v_version.id;
    if p_action='save' then
      if v_version.status<>'draft' then raise exception 'template_not_draft' using errcode='23514'; end if;
      v_manifest:=p_payload->'manifest';v_types:=p_payload->'workTypes';
      v_roles:=p_payload->'createRoles';v_routes:=p_payload->'routes';
      if pg_catalog.jsonb_typeof(v_manifest)<>'object' or pg_catalog.jsonb_typeof(v_types)<>'array'
        or pg_catalog.jsonb_typeof(v_roles)<>'array' or pg_catalog.jsonb_typeof(v_routes)<>'object' then
        raise exception 'invalid_template_payload' using errcode='22023'; end if;
      update d5o_hosted.configuration_template_versions set manifest_json=v_manifest,
        work_types_json=v_types,create_roles_json=v_roles,routes_json=v_routes,
        source_sha256=pg_catalog.encode(extensions.digest(v_manifest::text,'sha256'),'hex'),
        validated_at=null where id=v_new;
    elsif p_action='validate' then
      if v_version.status<>'draft' or not d5o_hosted.template_payload_valid_v1(
        v_version.manifest_json,v_version.work_types_json,v_version.create_roles_json,v_version.routes_json) then
        raise exception 'template_validation_failed' using errcode='23514'; end if;
      update d5o_hosted.configuration_template_versions set status='validated',validated_at=now()
        where id=v_new;
    else
      if v_version.status<>'validated' or not d5o_hosted.template_payload_valid_v1(
        v_version.manifest_json,v_version.work_types_json,v_version.create_roles_json,v_version.routes_json) then
        raise exception 'template_not_validated' using errcode='23514'; end if;
      update d5o_hosted.configuration_template_versions set status='published',
        published_at=now(),published_by=v_actor where id=v_new;
    end if;
  end if;
  v_result:=pg_catalog.jsonb_build_object('templateKey',p_template_key,'action',p_action,
    'versionId',v_new,'status',case when p_action='retire' then 'retired'
      else (select status from d5o_hosted.configuration_template_versions where id=v_new) end);
  insert into d5o_hosted.platform_events(command_id,actor_user_id,template_version_id,
    action,reason,before_state,after_state) values(p_command_id,v_actor,v_new,
    'template.'||p_action,trim(p_reason),v_before,v_result);
  insert into d5o_hosted.platform_command_receipts(command_id,actor_user_id,fingerprint,result)
    values(p_command_id,v_actor,v_fp,v_result);
  return v_result;
end $$;
revoke all on function public.d5o_platform_template_command_v1(text,text,uuid,jsonb,text,text)
  from public,anon,service_role;
grant execute on function public.d5o_platform_template_command_v1(text,text,uuid,jsonb,text,text)
  to authenticated;
