-- A canonical Discover draft must remain editable while governed positions
-- stay command-only. This isolated probe rolls back its draft revision.
begin;
create function public.d5o_pilot_draft_probe()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_workspace uuid; v_state d5o_hosted.prototype_states%rowtype;
  v_actor uuid; v_member uuid; v_alias text; v_next jsonb; v_result jsonb;
begin
  select id into v_workspace from d5o_hosted.workspaces
    where workspace_key='rybex' and display_name='Rybex Isolated Pilot';
  if v_workspace is null then raise exception 'wrong_database_target'; end if;
  select actor_user_id,id into v_actor,v_member from d5o_hosted.memberships
    where workspace_id=v_workspace and role='project_manager' and status='active' limit 1;
  select * into v_state from d5o_hosted.prototype_states
    where workspace_id=v_workspace and state_key='work';
  select item->>'id' into v_alias from pg_catalog.jsonb_array_elements(
    v_state.state_json->'records') item where item->'discovery' is not null
      and item->>'canonicalWorkId' is not null limit 1;
  if v_alias is null then raise exception 'connected_discover_draft_missing'; end if;
  v_next := pg_catalog.jsonb_set(v_state.state_json,'{records}',
    (select pg_catalog.jsonb_agg(case when item->>'id'=v_alias
      then pg_catalog.jsonb_set(item,'{discovery,need}',
        pg_catalog.to_jsonb('Isolated draft correction'::text))
      else item end) from pg_catalog.jsonb_array_elements(v_state.state_json->'records') item));
  v_result := public.d5o_hosted_command_save_v1('rybex','work',v_state.revision,
    v_next,v_actor,v_member);
  if (v_result->>'revision')::bigint <> v_state.revision+1
    or not exists(select 1 from pg_catalog.jsonb_array_elements(
      v_result#>'{state,records}') item where item->>'id'=v_alias
        and item#>>'{discovery,need}'='Isolated draft correction') then
    raise exception 'connected_draft_not_saved'; end if;
  raise notice 'PASS: connected Discover draft remains editable';
end; $$;
revoke all on function public.d5o_pilot_draft_probe()
  from public,anon,authenticated;
grant execute on function public.d5o_pilot_draft_probe() to service_role;
set local role service_role;
select public.d5o_pilot_draft_probe();
rollback;
