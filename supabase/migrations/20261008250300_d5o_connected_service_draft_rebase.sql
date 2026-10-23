-- Projected service children are immutable through generic snapshot saves.
-- Draft correction may continue on unrelated Work Records after exact comparison.
create function d5o_hosted.connected_service_draft_rebase_v1(
  p_workspace uuid,p_submitted jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_service record;v_child jsonb;v_count integer;v_records jsonb;
begin
  if pg_catalog.jsonb_typeof(p_submitted->'records')<>'array' then
    raise exception 'invalid_records' using errcode='22023'; end if;
  for v_service in select presentation_id,work_projection
      from d5o_hosted.connected_service_work where workspace_id=p_workspace loop
    select count(*),(pg_catalog.jsonb_agg(item)->0) into v_count,v_child
      from pg_catalog.jsonb_array_elements(p_submitted->'records') item
      where item->>'id'=v_service.presentation_id;
    if v_count<>1 or v_child is distinct from (
      select item from pg_catalog.jsonb_array_elements(
        d5o_hosted.connected_package_projection_v1(p_workspace,
          pg_catalog.jsonb_build_object('records',pg_catalog.jsonb_build_array(v_service.work_projection)),
          'work')->'records') item where item->>'id'=v_service.presentation_id) then
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

create or replace function public.d5o_hosted_prototype_save_v1(
  p_workspace_key text,p_state_key text,p_expected_revision bigint,p_state jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_workspace uuid;v_membership d5o_hosted.memberships%rowtype;
  v_prior d5o_hosted.prototype_states%rowtype;v_state jsonb;v_input jsonb;
  v_projection jsonb;v_revision bigint;v_field text;
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
  v_projection:=d5o_hosted.connected_package_projection_v1(v_workspace,
    d5o_hosted.connected_operate_projection_v1(v_workspace,
      d5o_hosted.connected_deploy_projection_v1(v_workspace,
        d5o_hosted.connected_design_projection_v1(v_workspace,
          d5o_hosted.connected_define_projection_v1(v_workspace,v_prior.state_json)))),'work');
  v_input:=d5o_hosted.connected_service_draft_rebase_v1(v_workspace,p_state);
  foreach v_field in array array['pricingPolicies','activePricingPolicy','pricingPolicyHistory'] loop
    if p_state->v_field is distinct from v_projection->v_field then
      raise exception 'typed_policy_command_required' using errcode='42501'; end if;
    v_input:=v_input-v_field;
    if v_prior.state_json ? v_field then
      v_input:=v_input||pg_catalog.jsonb_build_object(v_field,v_prior.state_json->v_field);
    end if;
  end loop;
  v_state:=d5o_hosted.connected_draft_snapshot_v1(v_workspace,v_prior.state_json,
    d5o_hosted.connected_solution_draft_rebase_v1(v_workspace,v_prior.state_json,
      d5o_hosted.connected_estimate_draft_rebase_v1(v_workspace,v_prior.state_json,
        d5o_hosted.connected_offer_draft_rebase_v1(v_workspace,v_prior.state_json,
          d5o_hosted.connected_handoff_draft_rebase_v1(v_workspace,v_prior.state_json,
            d5o_hosted.connected_package_draft_rebase_v1(v_workspace,v_prior.state_json,
              d5o_hosted.connected_design_draft_rebase_v1(v_workspace,
                v_prior.state_json,d5o_hosted.connected_deploy_draft_rebase_v1(
                  v_workspace,v_prior.state_json,d5o_hosted.connected_operate_draft_rebase_v1(
                    v_workspace,v_prior.state_json,v_input)))))))),v_prior.revision+1);
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
end; $$;
revoke all on function public.d5o_hosted_prototype_save_v1(text,text,bigint,jsonb)
  from public,anon;
grant execute on function public.d5o_hosted_prototype_save_v1(text,text,bigint,jsonb)
  to authenticated,service_role;
