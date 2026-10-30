-- Customer administrators can add an independent administrator and later
-- restore that person's previous role. Both decisions are tenant-scoped,
-- revision-checked, replay-safe, and retained in the administration ledger.
create function public.d5o_hosted_customer_admin_succession_v1(
  p_workspace_key text,p_admin_user_id uuid,p_admin_membership_id uuid,
  p_target_email text,p_action text,p_expected_revision integer,
  p_reason text,p_command_id text
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_workspace uuid;v_target uuid;v_member d5o_hosted.memberships%rowtype;
  v_before jsonb;v_after jsonb;v_receipt d5o_hosted.org_admin_receipts%rowtype;
  v_prior_role text;v_last_action text;v_fingerprint text;v_result jsonb;
begin
  if current_setting('role',true) is distinct from 'service_role'
    or p_action not in ('grant','restore')
    or p_expected_revision is null or p_expected_revision<1
    or length(trim(coalesce(p_reason,''))) not between 12 and 500
    or length(coalesce(p_command_id,'')) not between 8 and 120
    or length(trim(coalesce(p_target_email,''))) not between 5 and 320 then
    raise exception 'invalid_admin_succession' using errcode='22023'; end if;
  select w.id into v_workspace from d5o_hosted.workspaces w
    where w.workspace_key=p_workspace_key and w.status='active';
  if v_workspace is null then raise exception 'admin_membership_required' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'd5o-admin-succession:'||v_workspace::text,0));
  if not exists(select 1 from d5o_hosted.memberships m
      where m.workspace_id=v_workspace and m.id=p_admin_membership_id
      and m.actor_user_id=p_admin_user_id and m.role='admin' and m.status='active') then
    raise exception 'admin_membership_required' using errcode='42501'; end if;
  select u.id into v_target from auth.users u
    where lower(u.email)=lower(trim(p_target_email)) and u.email_confirmed_at is not null;
  if v_target is null or v_target=p_admin_user_id then
    raise exception 'confirmed_independent_account_required' using errcode='23503'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(
    p_workspace_key,p_admin_user_id,v_target,p_action,p_expected_revision,trim(p_reason))::text);
  select * into v_receipt from d5o_hosted.org_admin_receipts
    where workspace_id=v_workspace and command_id=p_command_id;
  if found then
    if v_receipt.actor_user_id is distinct from p_admin_user_id
      or v_receipt.fingerprint is distinct from v_fingerprint then
      raise exception 'command_id_reused' using errcode='23505'; end if;
    return v_receipt.result||pg_catalog.jsonb_build_object('replay',true);
  end if;
  select * into v_member from d5o_hosted.memberships m
    where m.workspace_id=v_workspace and m.actor_user_id=v_target for update;
  if v_member.id is null then raise exception 'target_membership_required' using errcode='23503'; end if;
  if v_member.revision<>p_expected_revision then
    raise exception 'stale_revision' using errcode='23505'; end if;
  v_before:=to_jsonb(v_member);
  if p_action='grant' then
    if v_member.status<>'active' or v_member.role in ('admin','field_worker')
      or exists(select 1 from d5o_hosted.crew_bindings b
        where b.workspace_id=v_workspace and b.actor_user_id=v_target and b.active) then
      raise exception 'protected_membership' using errcode='42501'; end if;
    update d5o_hosted.memberships set role='admin',revision=revision+1
      where id=v_member.id returning to_jsonb(memberships.*) into v_after;
  else
    if v_member.status<>'active' or v_member.role<>'admin'
      or (select count(*) from d5o_hosted.memberships m
          where m.workspace_id=v_workspace and m.role='admin' and m.status='active')<2 then
      raise exception 'protected_membership' using errcode='42501'; end if;
    select e.action,e.before_state->>'role' into v_last_action,v_prior_role
      from d5o_hosted.org_admin_events e
      where e.workspace_id=v_workspace and e.subject_id=v_member.id
        and e.action in ('member.admin-grant','member.admin-restore')
      order by e.occurred_at desc,e.command_id desc limit 1;
    if v_last_action is distinct from 'member.admin-grant'
      or v_prior_role not in ('executive','operations_leader','business_development_lead',
      'project_manager','billing_commercial_lead','field_supervisor',
      'closeout_lead','read_only_auditor') then
      raise exception 'succession_record_required' using errcode='42501'; end if;
    update d5o_hosted.memberships set role=v_prior_role,revision=revision+1
      where id=v_member.id returning to_jsonb(memberships.*) into v_after;
  end if;
  v_result:=pg_catalog.jsonb_build_object('action',p_action,'userId',v_target,
    'role',v_after->>'role','revision',(v_after->>'revision')::integer);
  insert into d5o_hosted.org_admin_events(workspace_id,command_id,actor_user_id,
    action,subject_id,reason,before_state,after_state)
    values(v_workspace,p_command_id,p_admin_user_id,'member.admin-'||p_action,
      v_member.id,trim(p_reason),v_before,v_after);
  insert into d5o_hosted.org_admin_receipts(workspace_id,command_id,actor_user_id,fingerprint,result)
    values(v_workspace,p_command_id,p_admin_user_id,v_fingerprint,v_result);
  return v_result;
end $$;
revoke all on function public.d5o_hosted_customer_admin_succession_v1(
  text,uuid,uuid,text,text,integer,text,text) from public,anon,authenticated;
grant execute on function public.d5o_hosted_customer_admin_succession_v1(
  text,uuid,uuid,text,text,integer,text,text) to service_role;
