-- Cache unchanged authoritative projections once per draft-save call.
-- Every submitted record is still compared with its exact projected protected
-- fields; no command authority or snapshot guard changes here.

-- connected_deploy_draft_rebase_v1
CREATE OR REPLACE FUNCTION d5o_hosted.connected_deploy_draft_rebase_v1(p_workspace uuid, p_raw jsonb, p_submitted jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_projection jsonb; v_new jsonb;v_old jsonb;v_expected jsonb;v_records jsonb:='[]'::jsonb;
begin
  for v_new in select value from pg_catalog.jsonb_array_elements(p_submitted->'records') loop
    select value into v_old from pg_catalog.jsonb_array_elements(p_raw->'records')
      where value->>'id'=v_new->>'id';
    if exists(select 1 from d5o_hosted.work_identity_links l
      join d5o_hosted.connected_deploy_states d on d.workspace_id=l.workspace_id
        and d.work_id=l.work_id
      where l.workspace_id=p_workspace and l.presentation_id=v_new->>'id') then
      if v_projection is null then
        v_projection := d5o_hosted.connected_deploy_projection_v1(p_workspace,p_raw);
      end if;
      select value into v_expected from pg_catalog.jsonb_array_elements(
        v_projection->'records')
        where value->>'id'=v_new->>'id';
      if v_new->'deploy' is distinct from v_expected->'deploy' then
        raise exception 'typed_deploy_command_required' using errcode='42501'; end if;
      if v_old->'deploy' is null then v_new:=v_new-'deploy';
      else v_new:=pg_catalog.jsonb_set(v_new,'{deploy}',v_old->'deploy',true); end if;
    end if;
    v_records:=v_records||pg_catalog.jsonb_build_array(v_new);
  end loop;
  return pg_catalog.jsonb_set(p_submitted,'{records}',v_records);
end; $function$;

-- connected_design_draft_rebase_v1
CREATE OR REPLACE FUNCTION d5o_hosted.connected_design_draft_rebase_v1(p_workspace uuid, p_raw jsonb, p_submitted jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_projection jsonb; v_new jsonb;v_old jsonb;v_expected jsonb;v_records jsonb:='[]'::jsonb;
begin
  for v_new in select value from pg_catalog.jsonb_array_elements(p_submitted->'records') loop
    select value into v_old from pg_catalog.jsonb_array_elements(p_raw->'records')
      where value->>'id'=v_new->>'id';
    if exists(select 1 from d5o_hosted.work_identity_links l
      join d5o_hosted.connected_design_states d on d.workspace_id=l.workspace_id
        and d.work_id=l.work_id
      where l.workspace_id=p_workspace and l.presentation_id=v_new->>'id') then
      if v_projection is null then
        v_projection := d5o_hosted.connected_design_projection_v1(p_workspace,
          d5o_hosted.connected_define_projection_v1(p_workspace,p_raw));
      end if;
      select value into v_expected from pg_catalog.jsonb_array_elements(
        v_projection->'records')
        where value->>'id'=v_new->>'id';
      if v_new->'design' is distinct from v_expected->'design' then
        raise exception 'typed_design_command_required' using errcode='42501'; end if;
      if v_old->'design' is null then v_new:=v_new-'design';
      else v_new:=pg_catalog.jsonb_set(v_new,'{design}',v_old->'design',true); end if;
    end if;
    v_records:=v_records||pg_catalog.jsonb_build_array(v_new);
  end loop;
  return pg_catalog.jsonb_set(p_submitted,'{records}',v_records);
end; $function$;

-- connected_estimate_draft_rebase_v1
CREATE OR REPLACE FUNCTION d5o_hosted.connected_estimate_draft_rebase_v1(p_workspace uuid, p_raw jsonb, p_submitted jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_projection jsonb; v_new jsonb;v_old jsonb;v_expected jsonb;v_records jsonb:='[]'::jsonb;
begin
  for v_new in select value from pg_catalog.jsonb_array_elements(p_submitted->'records') loop
    select value into v_old from pg_catalog.jsonb_array_elements(p_raw->'records')
      where value->>'id'=v_new->>'id';
    if exists(select 1 from d5o_hosted.work_identity_links l
      join d5o_hosted.connected_estimate_states e on e.workspace_id=l.workspace_id
        and e.work_id=l.work_id
      where l.workspace_id=p_workspace and l.presentation_id=v_new->>'id') then
      if v_projection is null then
        v_projection := d5o_hosted.connected_define_projection_v1(p_workspace,p_raw);
      end if;
      select value into v_expected from pg_catalog.jsonb_array_elements(
        v_projection->'records')
        where value->>'id'=v_new->>'id';
      if v_new#>'{discovery,estimate}' is distinct from
        v_expected#>'{discovery,estimate}' then
        raise exception 'typed_estimate_command_required' using errcode='42501'; end if;
      v_new:=pg_catalog.jsonb_set(v_new,'{discovery,estimate}',
        v_old#>'{discovery,estimate}',true);
    end if;
    v_records:=v_records||pg_catalog.jsonb_build_array(v_new);
  end loop;
  return pg_catalog.jsonb_set(p_submitted,'{records}',v_records);
end; $function$;

-- connected_handoff_draft_rebase_v1
CREATE OR REPLACE FUNCTION d5o_hosted.connected_handoff_draft_rebase_v1(p_workspace uuid, p_raw jsonb, p_submitted jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_projection jsonb; v_new jsonb;v_old jsonb;v_expected jsonb;v_records jsonb:='[]'::jsonb;
begin
  for v_new in select value from pg_catalog.jsonb_array_elements(p_submitted->'records') loop
    select value into v_old from pg_catalog.jsonb_array_elements(p_raw->'records')
      where value->>'id'=v_new->>'id';
    if exists(select 1 from d5o_hosted.work_identity_links l
      join d5o_hosted.connected_design_handoffs h on h.workspace_id=l.workspace_id
        and h.work_id=l.work_id
      where l.workspace_id=p_workspace and l.presentation_id=v_new->>'id') then
      if v_projection is null then
        v_projection := d5o_hosted.connected_define_projection_v1(p_workspace,p_raw);
      end if;
      select value into v_expected from pg_catalog.jsonb_array_elements(
        v_projection->'records')
        where value->>'id'=v_new->>'id';
      if v_new#>'{discovery,designHandoff}' is distinct from
          v_expected#>'{discovery,designHandoff}' then
        raise exception 'typed_handoff_command_required' using errcode='42501'; end if;
      if v_old#>'{discovery,designHandoff}' is null then
        v_new:=v_new#-'{discovery,designHandoff}';
      else
        v_new:=pg_catalog.jsonb_set(v_new,'{discovery,designHandoff}',
          v_old#>'{discovery,designHandoff}',true);
      end if;
    end if;
    v_records:=v_records||pg_catalog.jsonb_build_array(v_new);
  end loop;
  return pg_catalog.jsonb_set(p_submitted,'{records}',v_records);
end; $function$;

-- connected_offer_draft_rebase_v1
CREATE OR REPLACE FUNCTION d5o_hosted.connected_offer_draft_rebase_v1(p_workspace uuid, p_raw jsonb, p_submitted jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_projection jsonb; v_new jsonb;v_old jsonb;v_expected jsonb;v_records jsonb:='[]'::jsonb;
begin
  for v_new in select value from pg_catalog.jsonb_array_elements(p_submitted->'records') loop
    select value into v_old from pg_catalog.jsonb_array_elements(p_raw->'records')
      where value->>'id'=v_new->>'id';
    if v_projection is null then
      v_projection := d5o_hosted.connected_define_projection_v1(p_workspace,p_raw);
    end if;
    select value into v_expected from pg_catalog.jsonb_array_elements(
      v_projection->'records')
      where value->>'id'=v_new->>'id';
    if exists(select 1 from d5o_hosted.work_identity_links l
      join d5o_hosted.connected_offer_states o on o.workspace_id=l.workspace_id
        and o.work_id=l.work_id
      where l.workspace_id=p_workspace and l.presentation_id=v_new->>'id') then
      if v_new#>'{discovery,proposal}' is distinct from
          v_expected#>'{discovery,proposal}'
        or v_new#>'{discovery,phase}' is distinct from
          v_expected#>'{discovery,phase}'
        or v_new#>'{discovery,outcome}' is distinct from
          v_expected#>'{discovery,outcome}' then
        raise exception 'typed_offer_command_required' using errcode='42501'; end if;
      v_new:=pg_catalog.jsonb_set(v_new,'{discovery,proposal}',
        v_old#>'{discovery,proposal}',true);
      v_new:=pg_catalog.jsonb_set(v_new,'{discovery,phase}',
        v_old#>'{discovery,phase}',true);
      if v_old#>'{discovery,outcome}' is null then
        v_new:=v_new#-'{discovery,outcome}';
      else
        v_new:=pg_catalog.jsonb_set(v_new,'{discovery,outcome}',
          v_old#>'{discovery,outcome}',true);
      end if;
      v_new:=v_new||pg_catalog.jsonb_build_object('nextAction',v_expected->'nextAction');
    elsif v_new#>'{discovery,proposal}' is distinct from
        v_old#>'{discovery,proposal}' then
      v_new:=v_new||pg_catalog.jsonb_build_object('nextAction',v_expected->'nextAction');
    end if;
    v_records:=v_records||pg_catalog.jsonb_build_array(v_new);
  end loop;
  return pg_catalog.jsonb_set(p_submitted,'{records}',v_records);
end; $function$;

-- connected_operate_draft_rebase_v1
CREATE OR REPLACE FUNCTION d5o_hosted.connected_operate_draft_rebase_v1(p_workspace uuid, p_raw jsonb, p_submitted jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_projection jsonb; v_new jsonb;v_old jsonb;v_expected jsonb;v_records jsonb:='[]'::jsonb;
begin
  for v_new in select value from pg_catalog.jsonb_array_elements(p_submitted->'records') loop
    select value into v_old from pg_catalog.jsonb_array_elements(p_raw->'records')
      where value->>'id'=v_new->>'id';
    if exists(select 1 from d5o_hosted.work_identity_links l
      join d5o_hosted.connected_operate_states o on o.workspace_id=l.workspace_id
        and o.work_id=l.work_id
      where l.workspace_id=p_workspace and l.presentation_id=v_new->>'id') then
      if v_projection is null then
        v_projection := d5o_hosted.connected_operate_projection_v1(p_workspace,p_raw);
      end if;
      select value into v_expected from pg_catalog.jsonb_array_elements(
        v_projection->'records')
        where value->>'id'=v_new->>'id';
      if v_new->'operate' is distinct from v_expected->'operate' then
        raise exception 'typed_operate_command_required' using errcode='42501'; end if;
      if v_old->'operate' is null then v_new:=v_new-'operate';
      else v_new:=pg_catalog.jsonb_set(v_new,'{operate}',v_old->'operate',true); end if;
    end if;
    v_records:=v_records||pg_catalog.jsonb_build_array(v_new);
  end loop;
  return pg_catalog.jsonb_set(p_submitted,'{records}',v_records);
end; $function$;

-- connected_package_draft_rebase_v1
CREATE OR REPLACE FUNCTION d5o_hosted.connected_package_draft_rebase_v1(p_workspace uuid, p_raw jsonb, p_submitted jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_projection jsonb; v_new jsonb;v_old jsonb;v_expected jsonb;v_records jsonb:='[]'::jsonb;
begin
  for v_new in select value from pg_catalog.jsonb_array_elements(p_submitted->'records') loop
    select value into v_old from pg_catalog.jsonb_array_elements(p_raw->'records')
      where value->>'id'=v_new->>'id';
    if exists(select 1 from d5o_hosted.work_identity_links l
      join d5o_hosted.connected_package_states p on p.workspace_id=l.workspace_id
        and p.work_id=l.work_id
      where l.workspace_id=p_workspace and l.presentation_id=v_new->>'id') then
      if v_projection is null then
        v_projection := d5o_hosted.connected_package_projection_v1(p_workspace,
          d5o_hosted.connected_define_projection_v1(p_workspace,p_raw),'work');
      end if;
      select value into v_expected from pg_catalog.jsonb_array_elements(
        v_projection->'records')
        where value->>'id'=v_new->>'id';
      if v_new->'packages' is distinct from v_expected->'packages' then
        raise exception 'typed_package_command_required' using errcode='42501'; end if;
      if v_old->'packages' is null then v_new:=v_new-'packages';
      else v_new:=pg_catalog.jsonb_set(v_new,'{packages}',v_old->'packages',true); end if;
    end if;
    v_records:=v_records||pg_catalog.jsonb_build_array(v_new);
  end loop;
  return pg_catalog.jsonb_set(p_submitted,'{records}',v_records);
end; $function$;

-- connected_service_draft_rebase_v1
CREATE OR REPLACE FUNCTION d5o_hosted.connected_service_draft_rebase_v1(p_workspace uuid, p_submitted jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_projection jsonb; v_service record;v_child jsonb;v_expected jsonb;
  v_count integer;v_records jsonb;
begin
  if pg_catalog.jsonb_typeof(p_submitted->'records')<>'array' then
    raise exception 'invalid_records' using errcode='22023'; end if;
  for v_service in select presentation_id
      from d5o_hosted.connected_service_work where workspace_id=p_workspace loop
    select count(*),(pg_catalog.jsonb_agg(item)->0) into v_count,v_child
      from pg_catalog.jsonb_array_elements(p_submitted->'records') item
      where item->>'id'=v_service.presentation_id;
    if v_projection is null then
      v_projection := d5o_hosted.connected_package_projection_v1(p_workspace,
        d5o_hosted.connected_service_projection_v1(p_workspace,
          pg_catalog.jsonb_build_object('records','[]'::jsonb),'work'),'work');
    end if;
    select item into v_expected from pg_catalog.jsonb_array_elements(
      v_projection->'records') item
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
end; $function$;

-- connected_solution_draft_rebase_v1
CREATE OR REPLACE FUNCTION d5o_hosted.connected_solution_draft_rebase_v1(p_workspace uuid, p_raw jsonb, p_submitted jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_projection jsonb; v_new jsonb;v_old jsonb;v_expected jsonb;v_control record;
  v_records jsonb:='[]'::jsonb;v_plan jsonb;v_prior_plan jsonb;
begin
  v_projection:=d5o_hosted.connected_define_projection_v1(p_workspace,p_raw);
  for v_new in select value from pg_catalog.jsonb_array_elements(p_submitted->'records') loop
    select value into v_old from pg_catalog.jsonb_array_elements(p_raw->'records')
      where value->>'id'=v_new->>'id';
    select value into v_expected from pg_catalog.jsonb_array_elements(
      v_projection->'records')
      where value->>'id'=v_new->>'id';
    select s.review,s.decision_revision,d.next_action as define_next,
      p.next_action as pursuit_next into v_control
      from d5o_hosted.work_identity_links l
      join d5o_hosted.connected_solution_states s on s.workspace_id=l.workspace_id
        and s.work_id=l.work_id
      left join d5o_hosted.connected_define_states d on d.workspace_id=l.workspace_id
        and d.work_id=l.work_id
      left join d5o_hosted.connected_pursuit_states p on p.workspace_id=l.workspace_id
        and p.work_id=l.work_id
      where l.workspace_id=p_workspace and l.presentation_id=v_new->>'id';
    if found then
      if v_new#>'{develop,review}' is distinct from v_control.review
        or v_new#>>'{develop,authorityRevision}' is distinct from
          v_control.decision_revision::text
        or v_new->>'nextAction' is distinct from v_expected->>'nextAction' then
        raise exception 'typed_solution_command_required' using errcode='42501'; end if;
      v_plan:=v_new->'develop';v_prior_plan:=v_old->'develop';
      v_plan:=v_plan-'review'-'authorityRevision';
      if v_prior_plan ? 'review' then
        v_plan:=v_plan||pg_catalog.jsonb_build_object('review',v_prior_plan->'review'); end if;
      if v_prior_plan ? 'authorityRevision' then
        v_plan:=v_plan||pg_catalog.jsonb_build_object(
          'authorityRevision',v_prior_plan->'authorityRevision'); end if;
      v_new:=pg_catalog.jsonb_set(v_new,'{develop}',v_plan);
      v_new:=v_new||pg_catalog.jsonb_build_object('nextAction',
        coalesce(v_control.define_next,v_control.pursuit_next,v_old->>'nextAction'));
    end if;
    v_records:=v_records||pg_catalog.jsonb_build_array(v_new);
  end loop;
  return pg_catalog.jsonb_set(p_submitted,'{records}',v_records);
end; $function$;
