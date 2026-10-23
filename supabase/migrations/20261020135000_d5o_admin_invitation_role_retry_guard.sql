-- Pending invitations serialize by recipient, regardless of a competing role request.
-- A changed role requires a fresh governed decision after the pending setup resolves.
create or replace function public.d5o_hosted_admin_identity_intent_v2(
  p_workspace_key text,p_admin_user_id uuid,p_admin_membership_id uuid,
  p_action text,p_target_email text,p_requested_role text,p_reason text,p_command_id text
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_workspace uuid;v_prior d5o_hosted.admin_identity_requests%rowtype;
  v_fingerprint text;v_existing uuid;v_confirmed timestamptz;v_status text;
begin
  if current_setting('role',true) is distinct from 'service_role'
    or p_action not in ('invite','recovery')
    or (p_action='invite' and (p_requested_role is null or p_requested_role not in
      ('executive','operations_leader','business_development_lead',
       'project_manager','billing_commercial_lead','field_supervisor',
       'closeout_lead','read_only_auditor')))
    or (p_action='recovery' and p_requested_role is not null)
    or lower(trim(coalesce(p_target_email,''))) !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
    or length(trim(coalesce(p_reason,''))) not between 8 and 500
    or length(coalesce(p_command_id,'')) not between 8 and 120 then
    raise exception 'invalid_identity_request' using errcode='22023'; end if;
  select w.id into v_workspace from d5o_hosted.workspaces w
    join d5o_hosted.memberships m on m.workspace_id=w.id
    where w.workspace_key=p_workspace_key and w.status='active'
      and m.id=p_admin_membership_id and m.actor_user_id=p_admin_user_id
      and m.role='admin' and m.status='active';
  if v_workspace is null then raise exception 'admin_membership_required' using errcode='42501'; end if;
  select u.id,u.email_confirmed_at into v_existing,v_confirmed from auth.users u
    where lower(u.email)=lower(trim(p_target_email));
  if p_action='recovery' and not exists(select 1 from d5o_hosted.memberships m
      where m.workspace_id=v_workspace and m.actor_user_id=v_existing) then
    raise exception 'workspace_account_required' using errcode='23503'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(
    p_workspace_key,p_admin_user_id,p_action,lower(trim(p_target_email)),
    p_requested_role,trim(p_reason))::text);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'd5o-identity:'||v_workspace::text||':'||p_action||':'||lower(trim(p_target_email)),0));
  select * into v_prior from d5o_hosted.admin_identity_requests
    where workspace_id=v_workspace and command_id=p_command_id for update;
  if found then
    if v_prior.fingerprint<>v_fingerprint then
      raise exception 'command_id_reused' using errcode='23505'; end if;
    return pg_catalog.jsonb_build_object('fresh',false,'status',v_prior.status,
      'requestedRole',v_prior.requested_role);
  end if;
  select * into v_prior from d5o_hosted.admin_identity_requests
    where workspace_id=v_workspace and action=p_action
      and target_email=lower(trim(p_target_email))
      and (status in ('pending','uncertain')
        or (status='provider_accepted' and created_at>now()-interval '10 minutes'))
    order by created_at desc limit 1;
  if found then
    if v_prior.requested_role is distinct from p_requested_role then
      raise exception 'pending_invitation_role_conflict' using errcode='23505'; end if;
    return pg_catalog.jsonb_build_object('fresh',false,'status',v_prior.status,
      'requestedRole',v_prior.requested_role,'priorRequest',true);
  end if;
  v_status:=case when p_action='invite' and v_confirmed is not null
    then 'existing_confirmed' else 'pending' end;
  insert into d5o_hosted.admin_identity_requests
    (workspace_id,command_id,actor_user_id,action,target_email,requested_role,
     reason,fingerprint,status,provider_user_id,resolved_at)
    values(v_workspace,p_command_id,p_admin_user_id,p_action,
      lower(trim(p_target_email)),p_requested_role,trim(p_reason),v_fingerprint,
      v_status,case when v_status='existing_confirmed' then v_existing else null end,
      case when v_status='existing_confirmed' then now() else null end);
  return pg_catalog.jsonb_build_object('fresh',true,'status',v_status,
    'providerRequired',v_status='pending','requestedRole',p_requested_role);
end; $$;
