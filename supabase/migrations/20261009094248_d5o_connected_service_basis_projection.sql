-- A service receipt is displayed under its own source label, never as a
-- fictitious Discover/Develop commercial handoff.
create or replace function d5o_hosted.connected_define_projection_v1(
  p_workspace uuid,p_state jsonb
) returns jsonb language sql stable security definer set search_path='' as $$
  select case when p_state is null then null else
    pg_catalog.jsonb_set(projected,'{records}',coalesce((
      select pg_catalog.jsonb_agg(case when h.work_id is null then item else
        pg_catalog.jsonb_set(item,'{discovery,designHandoff}',h.handoff,true)||
          pg_catalog.jsonb_build_object('nextAction',case h.status
            when 'submitted' then 'Accept or return Design handoff revision '||h.revision::text
            when 'returned' then 'Correct and resubmit Design handoff'
            else 'Prepare executable Work Packages in Design' end)
        end order by ordinal)
      from pg_catalog.jsonb_array_elements(coalesce(projected->'records','[]'::jsonb))
        with ordinality as records(item,ordinal)
      left join d5o_hosted.work_identity_links l on l.workspace_id=p_workspace
        and l.presentation_id=item->>'id'
      left join d5o_hosted.connected_design_handoffs h on h.workspace_id=p_workspace
        and h.work_id=l.work_id and h.source_kind='commercial'
    ),'[]'::jsonb)) end
  from (select d5o_hosted.connected_customer_projection_v1(p_workspace,p_state)
    as projected) source;
$$;
revoke all on function d5o_hosted.connected_define_projection_v1(uuid,jsonb)
  from public,anon,authenticated,service_role;

-- Service work remains in its command-owned row. Its independent basis and
-- downstream decisions are projected from their protected rows at read time.
create or replace function d5o_hosted.connected_service_projection_v1(
  p_workspace uuid,p_state jsonb,p_state_key text
) returns jsonb language sql stable security definer set search_path='' as $$
  select pg_catalog.jsonb_set(p_state,'{records}',
    coalesce(p_state->'records','[]'::jsonb)||coalesce((
      select pg_catalog.jsonb_agg(case when p_state_key='catalog' then
        s.catalog_projection else
        s.work_projection
          ||case when h.work_id is null then '{}'::jsonb else
            pg_catalog.jsonb_build_object('serviceExecutionBasis',h.handoff,
              'nextAction',case h.status
                when 'draft' then 'Submit the service execution basis for review'
                when 'submitted' then 'Operations: accept or return the service basis'
                when 'returned' then 'Correct and resubmit the service basis'
                else 'Prepare and release the accepted service scope' end) end
          ||case when d.work_id is null then '{}'::jsonb else
            pg_catalog.jsonb_build_object('design',d.state) end
          ||case when dep.work_id is null then '{}'::jsonb else
            pg_catalog.jsonb_build_object('deploy',dep.state) end
        end order by s.created_at,s.work_id)
      from d5o_hosted.connected_service_work s
      left join d5o_hosted.connected_design_handoffs h
        on h.workspace_id=s.workspace_id and h.work_id=s.work_id
          and h.source_kind='service'
      left join d5o_hosted.connected_design_states d
        on d.workspace_id=s.workspace_id and d.work_id=s.work_id
      left join d5o_hosted.connected_deploy_states dep
        on dep.workspace_id=s.workspace_id and dep.work_id=s.work_id
      where s.workspace_id=p_workspace
    ),'[]'::jsonb));
$$;
revoke all on function d5o_hosted.connected_service_projection_v1(uuid,jsonb,text)
  from public,anon,authenticated,service_role;

-- Compare the full command-owned projection before removing service children
-- from an ordinary draft save. No accepted basis or downstream state can be
-- replaced through the generic snapshot writer.
create or replace function d5o_hosted.connected_service_draft_rebase_v1(
  p_workspace uuid,p_submitted jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_service record;v_child jsonb;v_expected jsonb;
  v_count integer;v_records jsonb;
begin
  if pg_catalog.jsonb_typeof(p_submitted->'records')<>'array' then
    raise exception 'invalid_records' using errcode='22023'; end if;
  for v_service in select presentation_id
      from d5o_hosted.connected_service_work where workspace_id=p_workspace loop
    select count(*),(pg_catalog.jsonb_agg(item)->0) into v_count,v_child
      from pg_catalog.jsonb_array_elements(p_submitted->'records') item
      where item->>'id'=v_service.presentation_id;
    select item into v_expected from pg_catalog.jsonb_array_elements(
      d5o_hosted.connected_package_projection_v1(p_workspace,
        d5o_hosted.connected_service_projection_v1(p_workspace,
          pg_catalog.jsonb_build_object('records','[]'::jsonb),'work'),'work')->'records') item
      where item->>'id'=v_service.presentation_id;
    if v_count<>1 or v_child is distinct from v_expected then
      raise exception 'typed_service_work_command_required' using errcode='42501'; end if;
  end loop;
  select coalesce(pg_catalog.jsonb_agg(item order by ordinal),'[]'::jsonb)
    into v_records from pg_catalog.jsonb_array_elements(p_submitted->'records')
      with ordinality as entries(item,ordinal)
      where not exists(select 1 from d5o_hosted.connected_service_work s
        where s.workspace_id=p_workspace and s.presentation_id=item->>'id');
  return pg_catalog.jsonb_set(p_submitted,'{records}',v_records);
end; $$;
revoke all on function d5o_hosted.connected_service_draft_rebase_v1(uuid,jsonb)
  from public,anon,authenticated,service_role;
