-- A service job creates a canonical child Work whose presentation is retained
-- in connected_service_work, not in the raw parent Work state. The original
-- identity trigger required every link to appear in raw records, so any later
-- legitimate Work write failed with connected_identity_changed. Continue to
-- verify each child identity against its authoritative typed projection.
do $migration$
declare
  v_original text;
  v_definition text;
begin
  select pg_get_functiondef('d5o_hosted.guard_connected_identity_v1()'::regprocedure)
    into v_original;
  v_definition := replace(v_original,
    'select work_id,presentation_id from d5o_hosted.work_identity_links',
    'select work_id,presentation_id,relation_kind from d5o_hosted.work_identity_links');
  if v_definition = v_original then
    raise exception 'connected_identity_link_anchor_not_found';
  end if;
  v_original := v_definition;
  v_definition := regexp_replace(v_definition,
    'where workspace_id=new.workspace_id loop[[:space:]]+select count\(\*\)',
    'where workspace_id=new.workspace_id loop'
      || chr(10) || '    if v_link.relation_kind=''service_visit'' then'
      || chr(10) || '      if not exists (select 1 from d5o_hosted.connected_service_work child'
      || chr(10) || '        where child.workspace_id=new.workspace_id and child.work_id=v_link.work_id'
      || chr(10) || '          and child.presentation_id=v_link.presentation_id'
      || chr(10) || '          and child.work_projection->>''id''=v_link.presentation_id'
      || chr(10) || '          and child.work_projection->>''canonicalWorkId''=v_link.work_id::text'
      || chr(10) || '          and child.work_projection->>''workspace''=('
      || chr(10) || '            select workspace_key from d5o_hosted.workspaces where id=new.workspace_id)) then'
      || chr(10) || '        raise exception ''connected_identity_changed'' using errcode=''42501''; end if;'
      || chr(10) || '      continue;'
      || chr(10) || '    end if;'
      || chr(10) || '    select count(*)');
  if v_definition = v_original then
    raise exception 'connected_identity_child_guard_anchor_not_found';
  end if;
  execute v_definition;
end $migration$;
