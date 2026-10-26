create function public.d5o_platform_provisioning_directory_v1() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null or not exists
    (select 1 from d5o_hosted.platform_administrators where actor_user_id=v_actor and status='active') then
    raise exception 'platform_administrator_required' using errcode='42501'; end if;
  return coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'workspaceId',w.id,'workspaceKey',w.workspace_key,'name',w.display_name,'legalName',w.legal_name,
    'country',p.country,'timeZone',w.time_zone,'currency',w.default_currency,
    'status',coalesce(p.lifecycle,w.status),'revision',p.revision,
    'templateName',t.name,'templateVersion',tv.version_number,
    'templateVersionId',tv.id,'initialAdministrator',p.initial_admin_email,
    'invitationId',p.initial_invitation_id,'invitationStatus',i.status,
    'invitationExpiresAt',i.expires_at,'configurationVersion',v.version_number,
    'configurationVersionId',v.id,'serviceApproval',v.manifest_json->'serviceWorkApproval',
    'createdAt',w.created_at,'failureCode',p.failure_code,
    'audit',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'action',e.action,'actorUserId',e.actor_user_id,'occurredAt',e.occurred_at,
      'reason',e.reason) order by e.occurred_at desc) from d5o_hosted.platform_events e
      where e.workspace_id=w.id),'[]'::jsonb)) order by w.created_at desc)
    from d5o_hosted.workspaces w
    left join d5o_hosted.tenant_provisioning p on p.workspace_id=w.id
    left join d5o_hosted.configuration_template_versions tv on tv.id=p.template_version_id
    left join d5o_hosted.configuration_templates t on t.id=tv.template_id
    left join d5o_hosted.admin_identity_requests i on i.workspace_id=w.id and i.command_id=p.initial_invitation_id
    left join d5o_hosted.configuration_tenants ct on ct.workspace_id=w.id and ct.status='active'
    left join d5o_hosted.configuration_versions v on v.tenant_id=ct.id and v.status='published'
      and v.effective_from<=now() and (v.effective_to is null or v.effective_to>now())),'[]'::jsonb);
end $$;
revoke all on function public.d5o_platform_provisioning_directory_v1() from public,anon,service_role;
grant execute on function public.d5o_platform_provisioning_directory_v1() to authenticated;

create function public.d5o_platform_invitation_recover_v1(
  p_workspace_key text,p_command_id text,p_reason text
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_provision d5o_hosted.tenant_provisioning%rowtype;
  v_workspace uuid;v_old d5o_hosted.admin_identity_requests%rowtype;
  v_user uuid;v_status text;v_invite text;v_fp text;v_prior d5o_hosted.platform_command_receipts%rowtype;
  v_result jsonb;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null or not exists
    (select 1 from d5o_hosted.platform_administrators where actor_user_id=v_actor and status='active') then
    raise exception 'platform_administrator_required' using errcode='42501'; end if;
  if length(coalesce(p_command_id,'')) not between 8 and 100 or
    length(trim(coalesce(p_reason,''))) not between 8 and 500 then
    raise exception 'invalid_recovery' using errcode='22023'; end if;
  v_fp:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_workspace_key,trim(p_reason))::text);
  select * into v_prior from d5o_hosted.platform_command_receipts where command_id=p_command_id;
  if found then
    if v_prior.actor_user_id<>v_actor or v_prior.fingerprint<>v_fp then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_prior.result; end if;
  select id into v_workspace from d5o_hosted.workspaces where workspace_key=p_workspace_key;
  select * into v_provision from d5o_hosted.tenant_provisioning where workspace_id=v_workspace for update;
  if v_provision.lifecycle not in ('awaiting_admin','failed') then
    raise exception 'recovery_not_allowed' using errcode='23514'; end if;
  select * into v_old from d5o_hosted.admin_identity_requests where workspace_id=v_workspace
    and command_id=v_provision.initial_invitation_id for update;
  if v_old.status='accepted' then raise exception 'invitation_already_accepted' using errcode='23514'; end if;
  update d5o_hosted.admin_identity_requests set status='revoked',revoked_at=now()
    where workspace_id=v_workspace and command_id=v_old.command_id;
  select id into v_user from auth.users where lower(email)=v_provision.initial_admin_email
    and email_confirmed_at is not null limit 1;
  v_status:=case when v_user is null then 'pending' else 'existing_confirmed' end;
  v_invite:='initial:'||p_command_id;
  update d5o_hosted.tenant_provisioning set initial_invitation_id=v_invite,
    lifecycle='awaiting_admin',failure_code=null,revision=revision+1,updated_at=now()
    where workspace_id=v_workspace;
  insert into d5o_hosted.admin_identity_requests(workspace_id,command_id,actor_user_id,
    action,target_email,reason,fingerprint,status,provider_user_id,requested_role,
    expires_at,provisioning_workspace_id)
    values(v_workspace,v_invite,v_actor,'invite',v_provision.initial_admin_email,trim(p_reason),v_fp,
      v_status,v_user,'admin',now()+interval '14 days',v_workspace);
  v_result:=pg_catalog.jsonb_build_object('workspaceKey',p_workspace_key,'invitationId',v_invite,
    'invitationStatus',v_status,'adminEmail',v_provision.initial_admin_email,'lifecycle','awaiting_admin');
  insert into d5o_hosted.platform_events(command_id,actor_user_id,workspace_id,
    action,reason,before_state,after_state) values(p_command_id,v_actor,v_workspace,
    'tenant.recover',trim(p_reason),pg_catalog.to_jsonb(v_old),v_result);
  insert into d5o_hosted.platform_command_receipts(command_id,actor_user_id,fingerprint,result)
    values(p_command_id,v_actor,v_fp,v_result);
  return v_result;
end $$;
revoke all on function public.d5o_platform_invitation_recover_v1(text,text,text)
  from public,anon,service_role;
grant execute on function public.d5o_platform_invitation_recover_v1(text,text,text) to authenticated;
