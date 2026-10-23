-- Run only against the disposable d5o-pilot-isolated-a78a4c1 Postgres container.
-- No changes survive this transaction.
begin;
do $$
declare
  v_workspace uuid;
  v_alias text;
  v_revision bigint;
  v_original jsonb;
  v_rejected boolean;
begin
  select id into v_workspace from d5o_hosted.workspaces
    where workspace_key='rybex' and display_name='Rybex Isolated Pilot';
  if v_workspace is null then raise exception 'wrong_database_target'; end if;
  select presentation_id into v_alias from d5o_hosted.work_identity_links
    where workspace_id=v_workspace order by created_at limit 1;
  if v_alias is null then raise exception 'connected_pilot_work_missing'; end if;
  select revision,state_json into v_revision,v_original
    from d5o_hosted.prototype_states where workspace_id=v_workspace and state_key='work';
  v_rejected := false;
  begin
    update d5o_hosted.prototype_states set state_json=pg_catalog.jsonb_set(
      state_json,'{records}',(select pg_catalog.jsonb_agg(item)
        from pg_catalog.jsonb_array_elements(state_json->'records') item
        where item->>'id'<>v_alias))
      where workspace_id=v_workspace and state_key='work';
  exception when insufficient_privilege then v_rejected := true;
  end;
  if not v_rejected then raise exception 'direct_work_identity_delete_was_allowed'; end if;
  if (select revision from d5o_hosted.prototype_states where workspace_id=v_workspace and state_key='work') <> v_revision
    or (select state_json from d5o_hosted.prototype_states where workspace_id=v_workspace and state_key='work') is distinct from v_original
    then raise exception 'rejected_work_write_changed_state'; end if;
  v_rejected := false;
  begin
    update d5o_hosted.prototype_states set state_json=pg_catalog.jsonb_set(
      state_json,'{records}',(select pg_catalog.jsonb_agg(
        case when item->>'id'=v_alias then pg_catalog.jsonb_set(item,'{canonicalWorkId}',
          pg_catalog.to_jsonb('00000000-0000-0000-0000-000000000001'::text)) else item end)
        from pg_catalog.jsonb_array_elements(state_json->'records') item))
      where workspace_id=v_workspace and state_key='catalog';
  exception when insufficient_privilege then v_rejected := true;
  end;
  if not v_rejected then raise exception 'direct_catalog_identity_rewrite_was_allowed'; end if;
  raise notice 'PASS: direct work deletion and catalog identity rewrite rejected without changing state';
end $$;
rollback;
