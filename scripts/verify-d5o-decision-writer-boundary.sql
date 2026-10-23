-- The service-role replacement writer must not advance a connected Work Record
-- without a typed phase command. The transaction rolls back in every case.
begin;
create function public.d5o_pilot_decision_writer_probe()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_workspace uuid; v_state d5o_hosted.prototype_states%rowtype;
  v_actor uuid; v_member uuid; v_alias text; v_next jsonb; v_allowed boolean := false;
begin
  select id into v_workspace from d5o_hosted.workspaces
    where workspace_key='rybex' and display_name='Rybex Isolated Pilot';
  if v_workspace is null then raise exception 'wrong_database_target'; end if;
  select actor_user_id,id into v_actor,v_member from d5o_hosted.memberships
    where workspace_id=v_workspace and role='project_manager' and status='active' limit 1;
  select * into v_state from d5o_hosted.prototype_states
    where workspace_id=v_workspace and state_key='work';
  select presentation_id into v_alias from d5o_hosted.work_identity_links
    where workspace_id=v_workspace order by created_at limit 1;
  v_next := pg_catalog.jsonb_set(v_state.state_json,'{records}',
    (select pg_catalog.jsonb_agg(case when item->>'id'=v_alias
      then pg_catalog.jsonb_set(item,'{stage}',pg_catalog.to_jsonb('Operate'::text))
      else item end) from pg_catalog.jsonb_array_elements(v_state.state_json->'records') item));
  begin
    perform public.d5o_hosted_command_save_v1('rybex','work',v_state.revision,
      v_next,v_actor,v_member);
    v_allowed := true;
  exception when insufficient_privilege then v_allowed := false;
  end;
  if v_allowed then raise exception 'privileged_decision_bypass'; end if;
  raise notice 'PASS: privileged replacement writer rejected protected stage change';
end; $$;
revoke all on function public.d5o_pilot_decision_writer_probe()
  from public,anon,authenticated;
grant execute on function public.d5o_pilot_decision_writer_probe() to service_role;
set local role service_role;
select public.d5o_pilot_decision_writer_probe();
rollback;
