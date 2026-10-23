-- Rollback-only probe for the original isolated partially covered visit.
begin;
do $$
declare v_parent d5o_hosted.connected_operate_states%rowtype;
  v_handoff d5o_hosted.connected_design_handoffs%rowtype;
  v_raw jsonb; v_original jsonb; v_modified jsonb;
  v_case text; v_rejected boolean;
begin
  select * into v_parent from d5o_hosted.connected_operate_states
    where work_id='a8fd95e7-e20d-4bb3-881c-3549459c99e0' for update;
  select * into v_handoff from d5o_hosted.connected_design_handoffs
    where work_id='a11c09e6-03a2-4835-9205-ec84f0af4ae8';
  select state_json into v_raw from d5o_hosted.prototype_states
    where workspace_id=v_parent.workspace_id and state_key='work';
  if v_parent.work_id is null or v_handoff.status<>'accepted' then
    raise exception 'partial_pilot_basis_missing'; end if;
  perform d5o_hosted.connected_design_source_v1(v_parent.workspace_id,v_handoff.work_id,v_raw);
  v_original:=v_parent.state;
  foreach v_case in array array['coverage','estimate','authorization','cycle'] loop
    select pg_catalog.jsonb_set(v_original,'{requests}',pg_catalog.jsonb_agg(
      case when r.item->>'id'<>'abe94af3-bdc5-435b-b6ad-ca810293988e' then r.item
      when v_case='coverage' then pg_catalog.jsonb_set(r.item,'{coverage}','"Covered"'::jsonb)
      when v_case='estimate' then pg_catalog.jsonb_set(r.item,'{serviceEstimate,revision}','3'::jsonb)
      when v_case='authorization' then pg_catalog.jsonb_set(r.item,'{serviceAuthorization,source}',
        '"evidence:different-customer-decision"'::jsonb)
      else pg_catalog.jsonb_set(r.item,'{reopenedAt}',
        '"2026-10-09T18:00:00Z"'::jsonb) end order by r.ordinality))
      into v_modified from pg_catalog.jsonb_array_elements(v_original->'requests')
      with ordinality as r(item,ordinality);
    update d5o_hosted.connected_operate_states set state=v_modified
      where workspace_id=v_parent.workspace_id and work_id=v_parent.work_id;
    v_rejected:=false;
    begin
      perform d5o_hosted.connected_design_source_v1(v_parent.workspace_id,v_handoff.work_id,v_raw);
    exception when others then v_rejected:=true; end;
    if not v_rejected then raise exception 'stale_%_source_was_accepted',v_case; end if;
    update d5o_hosted.connected_operate_states set state=v_original
      where workspace_id=v_parent.workspace_id and work_id=v_parent.work_id;
  end loop;
  raise notice 'partial_service_coverage_estimate_authorization_cycle_invalidation_passed';
end $$;
rollback;
