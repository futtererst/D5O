-- Add the server-only command writer before tightening generic snapshot writes.
-- This expansion is compatible with the currently deployed application and lets
-- the replacement build be qualified before the command-only cutover.
create function public.d5o_hosted_command_save_v1(
  p_workspace_key text, p_state_key text, p_expected_revision bigint, p_state jsonb,
  p_actor_user_id uuid, p_membership_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_workspace uuid; v_revision bigint;
begin
  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role' then
    raise exception 'server_command_required' using errcode='42501'; end if;
  if p_state_key not in ('work','catalog','schedule') or p_expected_revision < 0
    or p_state is null or pg_catalog.jsonb_typeof(p_state) <> 'object'
    or p_state->>'workspace' is distinct from p_workspace_key or p_state->>'schemaVersion' is distinct from '1'
    or pg_catalog.octet_length(p_state::text) > 2000000 then
    raise exception 'invalid_state' using errcode='22023'; end if;
  select w.id into v_workspace from d5o_hosted.workspaces w join d5o_hosted.memberships m on m.workspace_id=w.id
    where w.workspace_key=p_workspace_key and w.status='active' and m.id=p_membership_id
      and m.actor_user_id=p_actor_user_id and m.status='active';
  if v_workspace is null then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  if p_expected_revision=0 then
    insert into d5o_hosted.prototype_states(workspace_id,state_key,revision,state_json,updated_by)
      values(v_workspace,p_state_key,1,p_state,p_actor_user_id)
      on conflict(workspace_id,state_key) do nothing returning revision into v_revision;
  else
    update d5o_hosted.prototype_states set revision=revision+1,state_json=p_state,updated_by=p_actor_user_id,updated_at=now()
      where workspace_id=v_workspace and state_key=p_state_key and revision=p_expected_revision returning revision into v_revision;
  end if;
  if v_revision is null then raise exception 'stale_state' using errcode='23505'; end if;
  insert into d5o_hosted.prototype_state_revisions(workspace_id,state_key,revision,state_json,actor_user_id,membership_id)
    values(v_workspace,p_state_key,v_revision,p_state,p_actor_user_id,p_membership_id);
  return pg_catalog.jsonb_build_object('revision',v_revision,'state',p_state);
end; $$;
revoke all on function public.d5o_hosted_command_save_v1(text,text,bigint,jsonb,uuid,uuid) from public,anon,authenticated;
grant execute on function public.d5o_hosted_command_save_v1(text,text,bigint,jsonb,uuid,uuid) to service_role;
