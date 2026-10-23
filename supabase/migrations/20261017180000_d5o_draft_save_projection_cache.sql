-- Reuse the same authoritative Define projection within one protected draft save.

CREATE OR REPLACE FUNCTION d5o_hosted.connected_handoff_draft_rebase_cached_v1(p_workspace uuid, p_raw jsonb, p_submitted jsonb, p_expected_projection jsonb)
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
        v_projection := p_expected_projection;
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

revoke all on function d5o_hosted.connected_handoff_draft_rebase_cached_v1(uuid,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION d5o_hosted.connected_offer_draft_rebase_cached_v1(p_workspace uuid, p_raw jsonb, p_submitted jsonb, p_expected_projection jsonb)
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
      v_projection := p_expected_projection;
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

revoke all on function d5o_hosted.connected_offer_draft_rebase_cached_v1(uuid,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION d5o_hosted.connected_estimate_draft_rebase_cached_v1(p_workspace uuid, p_raw jsonb, p_submitted jsonb, p_expected_projection jsonb)
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
        v_projection := p_expected_projection;
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

revoke all on function d5o_hosted.connected_estimate_draft_rebase_cached_v1(uuid,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION d5o_hosted.connected_solution_draft_rebase_cached_v1(p_workspace uuid, p_raw jsonb, p_submitted jsonb, p_expected_projection jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_projection jsonb; v_new jsonb;v_old jsonb;v_expected jsonb;v_control record;
  v_records jsonb:='[]'::jsonb;v_plan jsonb;v_prior_plan jsonb;
begin
  v_projection := p_expected_projection;
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

revoke all on function d5o_hosted.connected_solution_draft_rebase_cached_v1(uuid,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.d5o_hosted_prototype_save_internal_v1(p_workspace_key text, p_state_key text, p_expected_revision bigint, p_state jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_workspace uuid;v_membership d5o_hosted.memberships%rowtype;
  v_prior d5o_hosted.prototype_states%rowtype;v_state jsonb;v_input jsonb;
  v_projection jsonb;v_define_projection jsonb;v_revision bigint;v_field text;
begin
  if auth.uid() is null or p_state_key is distinct from 'work'
    or p_expected_revision is null or p_expected_revision<1 or p_state is null
    or pg_catalog.jsonb_typeof(p_state)<>'object'
    or p_state->>'workspace' is distinct from p_workspace_key
    or p_state->>'schemaVersion' is distinct from '1'
    or pg_catalog.octet_length(p_state::text)>2000000 then
    raise exception 'invalid_prototype_state' using errcode='22023'; end if;
  select m.* into v_membership from d5o_hosted.workspaces w
    join d5o_hosted.memberships m on m.workspace_id=w.id
    where w.workspace_key=p_workspace_key and w.status='active'
      and m.actor_user_id=auth.uid() and m.status='active';
  v_workspace:=v_membership.workspace_id;
  if v_workspace is null or v_membership.role not in
    ('admin','operations_leader','project_manager','field_supervisor') then
    raise exception 'prototype_write_forbidden' using errcode='42501'; end if;
  select * into v_prior from d5o_hosted.prototype_states
    where workspace_id=v_workspace and state_key='work' for update;
  if not found or v_prior.revision<>p_expected_revision then
    raise exception 'stale_prototype_state' using errcode='23505'; end if;
  v_define_projection:=d5o_hosted.connected_define_projection_v1(v_workspace,v_prior.state_json);
  v_projection:=d5o_hosted.connected_package_projection_v1(v_workspace,
    d5o_hosted.connected_operate_projection_v1(v_workspace,
      d5o_hosted.connected_deploy_projection_v1(v_workspace,
        d5o_hosted.connected_design_projection_v1(v_workspace,v_define_projection))),'work');
  v_input:=d5o_hosted.connected_service_draft_rebase_v1(v_workspace,p_state);
  foreach v_field in array array['pricingPolicies','activePricingPolicy','pricingPolicyHistory'] loop
    if p_state->v_field is distinct from v_projection->v_field then
      raise exception 'typed_policy_command_required' using errcode='42501'; end if;
    v_input:=v_input-v_field;
    if v_prior.state_json ? v_field then
      v_input:=v_input||pg_catalog.jsonb_build_object(v_field,v_prior.state_json->v_field);
    end if;
  end loop;
  v_input:=d5o_hosted.connected_operate_draft_rebase_v1(v_workspace,v_prior.state_json,v_input);
  v_input:=d5o_hosted.connected_deploy_draft_rebase_v1(v_workspace,v_prior.state_json,v_input);
  v_input:=d5o_hosted.connected_design_draft_rebase_v1(v_workspace,v_prior.state_json,v_input);
  v_input:=d5o_hosted.connected_package_draft_rebase_v1(v_workspace,v_prior.state_json,v_input);
  v_input:=d5o_hosted.connected_handoff_draft_rebase_cached_v1(v_workspace,v_prior.state_json,v_input,v_define_projection);
  v_input:=d5o_hosted.connected_offer_draft_rebase_cached_v1(v_workspace,v_prior.state_json,v_input,v_define_projection);
  v_input:=d5o_hosted.connected_estimate_draft_rebase_cached_v1(v_workspace,v_prior.state_json,v_input,v_define_projection);
  v_input:=d5o_hosted.connected_solution_draft_rebase_cached_v1(v_workspace,v_prior.state_json,v_input,v_define_projection);
  v_state:=d5o_hosted.connected_draft_snapshot_v1(v_workspace,v_prior.state_json,v_input,v_prior.revision+1);
  update d5o_hosted.prototype_states set revision=revision+1,state_json=v_state,
    updated_by=auth.uid(),updated_at=now()
    where workspace_id=v_workspace and state_key='work' returning revision into v_revision;
  insert into d5o_hosted.prototype_state_revisions(
    workspace_id,state_key,revision,state_json,actor_user_id,membership_id)
  values(v_workspace,'work',v_revision,v_state,auth.uid(),v_membership.id);
  return pg_catalog.jsonb_build_object('revision',v_revision,'state',
    d5o_hosted.connected_package_projection_v1(v_workspace,
      d5o_hosted.connected_operate_projection_v1(v_workspace,
        d5o_hosted.connected_deploy_projection_v1(v_workspace,
          d5o_hosted.connected_design_projection_v1(v_workspace,
            d5o_hosted.connected_define_projection_v1(v_workspace,
              d5o_hosted.connected_service_projection_v1(
                v_workspace,v_state,'work'))))),'work'));
end; $function$;
