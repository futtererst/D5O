-- Server-only projection after the authenticated worker context has checked
-- membership and the account-to-person binding. It does not grant writes.
create function public.d5o_hosted_server_connected_read_v1(
  p_workspace_key text,p_state_key text
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_workspace uuid;v_state d5o_hosted.prototype_states%rowtype;
  v_schedule d5o_hosted.connected_schedule_states%rowtype;v_projected jsonb;
begin
  if current_setting('role',true)<>'service_role'
    or p_state_key not in ('work','schedule') then
    raise exception 'server_connected_read_forbidden' using errcode='42501'; end if;
  select id into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  if v_workspace is null then raise exception 'workspace_unavailable' using errcode='42501'; end if;
  select * into v_state from d5o_hosted.prototype_states
    where workspace_id=v_workspace and state_key=p_state_key;
  if not found then return pg_catalog.jsonb_build_object('revision',0,'state',null); end if;
  if p_state_key='schedule' then
    select * into v_schedule from d5o_hosted.connected_schedule_states
      where workspace_id=v_workspace;
    return pg_catalog.jsonb_build_object(
      'revision',coalesce(v_schedule.decision_revision,v_state.revision,0),
      'state',d5o_hosted.connected_schedule_projection_v1(
        v_workspace,p_workspace_key,v_state.state_json));
  end if;
  v_projected:=d5o_hosted.connected_deploy_projection_v1(v_workspace,
    d5o_hosted.connected_design_projection_v1(v_workspace,
      d5o_hosted.connected_define_projection_v1(v_workspace,v_state.state_json)));
  return pg_catalog.jsonb_build_object('revision',v_state.revision,'state',
    d5o_hosted.connected_package_projection_v1(v_workspace,v_projected,'work'));
end; $$;
revoke all on function public.d5o_hosted_server_connected_read_v1(text,text)
  from public,anon,authenticated;
grant execute on function public.d5o_hosted_server_connected_read_v1(text,text)
  to service_role;
