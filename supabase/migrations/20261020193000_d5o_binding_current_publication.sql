-- Preserve immutable publication and acknowledgment history while permitting an
-- account-binding correction once a governed newer publication for that week
-- no longer assigns the person. Draft assignments and the latest publication
-- for each week still block correction; the protected Admin wrapper and exact
-- revision/replay contract remain in force.
create or replace function public.d5o_hosted_correct_worker_binding_v1(
  p_workspace_key text,p_person_id uuid,p_new_email text,p_reason text,
  p_expected_revision integer,p_command_id text
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace uuid;
  v_profile d5o_hosted.connected_crew_profiles%rowtype;
  v_state d5o_hosted.connected_workforce_states%rowtype;
  v_new_user uuid;v_prior d5o_hosted.admin_binding_corrections%rowtype;
  v_fingerprint text;v_result jsonb;
begin
  if current_setting('role',true) is distinct from 'authenticated' or v_actor is null
    or length(trim(coalesce(p_reason,''))) not between 12 and 500
    or length(coalesce(p_command_id,'')) not between 8 and 120
    or p_expected_revision is null or p_expected_revision<0 then
    raise exception 'invalid_binding_correction' using errcode='22023'; end if;
  select w.id into v_workspace from d5o_hosted.workspaces w
    join d5o_hosted.memberships m on m.workspace_id=w.id
    where w.workspace_key=p_workspace_key and w.status='active'
      and m.actor_user_id=v_actor and m.status='active' and m.role='admin';
  if v_workspace is null then raise exception 'admin_membership_required' using errcode='42501'; end if;
  select * into v_state from d5o_hosted.connected_workforce_states
    where workspace_id=v_workspace for update;
  if not found then raise exception 'workforce_missing' using errcode='23503'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(
    p_workspace_key,p_person_id,lower(trim(p_new_email)),trim(p_reason),p_expected_revision)::text);
  select * into v_prior from d5o_hosted.admin_binding_corrections
    where workspace_id=v_workspace and command_id=p_command_id;
  if found then
    if v_prior.actor_user_id<>v_actor or v_prior.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return pg_catalog.jsonb_build_object('personId',p_person_id,
      'newUserId',v_prior.new_user_id,'revision',v_prior.workforce_revision,'replay',true);
  end if;
  if v_state.revision<>p_expected_revision then
    raise exception 'stale_workforce' using errcode='23505'; end if;
  select * into v_profile from d5o_hosted.connected_crew_profiles
    where workspace_id=v_workspace and id=p_person_id for update;
  if not found or v_profile.actor_user_id is null then
    raise exception 'current_binding_required' using errcode='23514'; end if;
  select id into v_new_user from auth.users
    where lower(email)=lower(trim(p_new_email)) and email_confirmed_at is not null;
  if v_new_user is null or v_new_user=v_actor or v_new_user=v_profile.actor_user_id then
    raise exception 'different_confirmed_account_required' using errcode='23503'; end if;
  if exists(select 1 from d5o_hosted.memberships m
      where m.workspace_id=v_workspace and m.actor_user_id=v_new_user
        and m.role<>'field_worker')
    or exists(select 1 from d5o_hosted.connected_crew_profiles p
      where p.workspace_id=v_workspace and p.actor_user_id=v_new_user)
    or exists(select 1 from d5o_hosted.crew_bindings b
      where b.workspace_id=v_workspace and b.actor_user_id=v_new_user) then
    raise exception 'replacement_account_already_bound' using errcode='23505'; end if;
  if exists(select 1 from d5o_hosted.connected_schedule_states s,
      lateral pg_catalog.jsonb_array_elements(coalesce(s.state->'assignments','[]'::jsonb)) a
      where s.workspace_id=v_workspace and a->'people' ? v_profile.person
        and (a->>'date')::date>=current_date)
    or exists(select 1 from d5o_hosted.connected_schedule_states s,
      lateral pg_catalog.jsonb_array_elements(coalesce(s.state->'publications','[]'::jsonb))
        with ordinality pub(value,position),
      lateral pg_catalog.jsonb_array_elements(coalesce(pub.value->'assignments','[]'::jsonb)) a
      where s.workspace_id=v_workspace and a->'people' ? v_profile.person
        and (a->>'date')::date>=current_date
        and not exists(select 1 from pg_catalog.jsonb_array_elements(
          coalesce(s.state->'publications','[]'::jsonb))
          with ordinality newer(value,position)
          where newer.value->>'week'=pub.value->>'week'
            and newer.position>pub.position)) then
    raise exception 'future_booking_requires_schedule_correction' using errcode='23514'; end if;
  update d5o_hosted.memberships set status='suspended'
    where workspace_id=v_workspace and actor_user_id=v_profile.actor_user_id
      and role='field_worker';
  delete from d5o_hosted.crew_bindings where workspace_id=v_workspace
    and actor_user_id=v_profile.actor_user_id and person=v_profile.person;
  insert into d5o_hosted.memberships(workspace_id,actor_user_id,role,status)
    values(v_workspace,v_new_user,'field_worker','active')
    on conflict(workspace_id,actor_user_id) do update set status='active'
      where d5o_hosted.memberships.role='field_worker';
  insert into d5o_hosted.crew_bindings(workspace_id,actor_user_id,person,active)
    values(v_workspace,v_new_user,v_profile.person,v_profile.active);
  update d5o_hosted.connected_crew_profiles set actor_user_id=v_new_user,revision=revision+1
    where workspace_id=v_workspace and id=p_person_id;
  update d5o_hosted.connected_workforce_states set revision=revision+1
    where workspace_id=v_workspace;
  insert into d5o_hosted.admin_binding_corrections
    (workspace_id,command_id,person_id,old_user_id,new_user_id,actor_user_id,
      reason,fingerprint,workforce_revision)
    values(v_workspace,p_command_id,p_person_id,v_profile.actor_user_id,v_new_user,
      v_actor,trim(p_reason),v_fingerprint,v_state.revision+1);
  v_result:=pg_catalog.jsonb_build_object('personId',p_person_id,
    'newUserId',v_new_user,'revision',v_state.revision+1);
  return v_result;
end; $$;
revoke all on function public.d5o_hosted_correct_worker_binding_v1(text,uuid,text,text,integer,text)
  from public,anon,authenticated,service_role;

