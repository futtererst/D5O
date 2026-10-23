-- A browser session may save drafts, but cannot write governed decisions or
-- schedule/catalog authority directly. Server commands use a separate RPC.
create or replace function d5o_hosted.protected_work_record_v1(p_record jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'id', p_record->'id',
    'definitionStatus', case when p_record#>>'{definition,status}' = 'Draft' then null else p_record#>'{definition,status}' end,
    'definitionReviews', p_record#>'{definition,reviews}',
    'definitionBaselines', p_record#>'{definition,approvedBaselines}',
    'definitionReceipt', p_record#>'{definition,developHandoff}',
    'definitionDecisions', p_record#>'{definition,decisions}',
    'definitionLocked', case when p_record#>>'{definition,status}' is distinct from 'Draft'
      then p_record->'definition' else null end,
    'pursuit', p_record#>'{discovery,pursuitControl}',
    'estimateStatus', p_record#>'{discovery,estimate,status}',
    'estimateReview', p_record#>'{discovery,estimate,review}',
    'estimateHistory', p_record#>'{discovery,estimate,pricingHistory}',
    'proposalStatus', p_record#>'{discovery,proposal,status}',
    'proposalReview', p_record#>'{discovery,proposal,review}',
    'proposalSubmission', p_record#>'{discovery,proposal,submission}',
    'proposalSubmissionHistory', p_record#>'{discovery,proposal,submissionHistory}',
    'proposalResponses', p_record#>'{discovery,proposal,responseEvents}',
    'customerOutcome', p_record#>'{discovery,outcome}',
    'designReceipt', p_record#>'{discovery,designHandoff}',
    'design', p_record->'design', 'deploy', p_record->'deploy',
    'operate', p_record->'operate', 'serviceSource', p_record->'serviceSource'
  );
$$;
revoke all on function d5o_hosted.protected_work_record_v1(jsonb) from public, anon, authenticated;

create or replace function d5o_hosted.guard_prototype_snapshot_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
declare old_record jsonb; new_record jsonb; old_package jsonb; new_package jsonb;
  pair record;
begin
  -- The service credential is restricted to server-owned command paths.
  if current_setting('role', true) = 'service_role' then return new; end if;
  if tg_op = 'INSERT' then raise exception 'command_only_state' using errcode = '42501'; end if;
  if new.state_key <> 'work' then
    raise exception 'command_only_state' using errcode = '42501';
  end if;
  if old.state_json->'pricingPolicies' is distinct from new.state_json->'pricingPolicies'
    or old.state_json->'activePricingPolicy' is distinct from new.state_json->'activePricingPolicy'
    or old.state_json->'pricingPolicyHistory' is distinct from new.state_json->'pricingPolicyHistory' then
    raise exception 'protected_policy_changed' using errcode = '42501';
  end if;
  if pg_catalog.jsonb_typeof(new.state_json->'records') is distinct from 'array' then
    raise exception 'invalid_records' using errcode = '22023';
  end if;
  if (select count(*) from pg_catalog.jsonb_array_elements(new.state_json->'records'))
    <> (select count(distinct item->>'id') from pg_catalog.jsonb_array_elements(new.state_json->'records') item) then
    raise exception 'duplicate_work_id' using errcode = '22023';
  end if;
  for old_record in select value from pg_catalog.jsonb_array_elements(coalesce(old.state_json->'records','[]'::jsonb)) loop
    select value into new_record from pg_catalog.jsonb_array_elements(new.state_json->'records')
      where value->>'id' = old_record->>'id';
    if new_record is null then raise exception 'work_deletion_requires_command' using errcode = '42501'; end if;
    if old_record->'definition' is not null and old_record#>'{definition,revision}' is distinct from new_record#>'{definition,revision}' then
      raise exception 'protected_definition_revision_changed' using errcode = '42501'; end if;
    if old_record->'definition' is null and new_record->'definition' is not null
      and (new_record#>>'{definition,status}' <> 'Draft' or new_record#>>'{definition,revision}' <> '1') then
      raise exception 'protected_definition_import' using errcode = '42501'; end if;
    if d5o_hosted.protected_work_record_v1(old_record) is distinct from d5o_hosted.protected_work_record_v1(new_record) then
      raise exception 'protected_decision_changed' using errcode = '42501';
    end if;
    for pair in select key, value from pg_catalog.jsonb_each(coalesce(old_record->'phaseRegisters','{}'::jsonb)) where key like 'design.%' loop
      if pair.value is distinct from new_record->'phaseRegisters'->pair.key then
        raise exception 'protected_design_register_changed' using errcode = '42501'; end if;
    end loop;
    for pair in select key, value from pg_catalog.jsonb_each(coalesce(new_record->'phaseRegisters','{}'::jsonb)) where key like 'design.%' loop
      if pair.value is distinct from old_record->'phaseRegisters'->pair.key then
        raise exception 'protected_design_register_changed' using errcode = '42501'; end if;
    end loop;
    for old_package in select value from pg_catalog.jsonb_array_elements(coalesce(old_record->'packages','[]'::jsonb)) loop
      select value into new_package from pg_catalog.jsonb_array_elements(coalesce(new_record->'packages','[]'::jsonb))
        where value->>'id' = old_package->>'id';
      if new_package is null or pg_catalog.jsonb_build_array(old_package->'installed',old_package->'tested',old_package->'accepted',old_package->'status')
        is distinct from pg_catalog.jsonb_build_array(new_package->'installed',new_package->'tested',new_package->'accepted',new_package->'status') then
        raise exception 'protected_execution_changed' using errcode = '42501'; end if;
    end loop;
  end loop;
  for new_record in select value from pg_catalog.jsonb_array_elements(new.state_json->'records') loop
    if not exists(select 1 from pg_catalog.jsonb_array_elements(coalesce(old.state_json->'records','[]'::jsonb)) item where item->>'id'=new_record->>'id') then
      if new_record->'design' is not null or new_record->'deploy' is not null or new_record->'operate' is not null
        or new_record->'serviceSource' is not null or (new_record#>>'{definition,status}' is not null and new_record#>>'{definition,status}' <> 'Draft')
        or new_record#>'{definition,reviews}' is not null or new_record#>'{definition,developHandoff}' is not null
        or new_record#>'{definition,approvedBaselines}' is not null or new_record#>'{definition,decisions}' is not null
        or new_record#>'{discovery,pursuitControl}' is not null then
        raise exception 'protected_work_import' using errcode = '42501'; end if;
    end if;
  end loop;
  return new;
end; $$;
revoke all on function d5o_hosted.guard_prototype_snapshot_v1() from public, anon, authenticated;
create trigger d5o_hosted_prototype_guard before insert or update of state_json on d5o_hosted.prototype_states
  for each row execute function d5o_hosted.guard_prototype_snapshot_v1();

-- Generic client snapshots can never replace catalog or schedule authority.
create or replace function public.d5o_hosted_prototype_save_v1(
  p_workspace_key text, p_state_key text, p_expected_revision bigint, p_state jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_workspace uuid; v_membership d5o_hosted.memberships%rowtype; v_revision bigint;
begin
  if auth.uid() is null or p_state_key is distinct from 'work' or p_expected_revision is null
    or p_expected_revision < 1 or p_state is null or pg_catalog.jsonb_typeof(p_state) <> 'object'
    or p_state->>'workspace' is distinct from p_workspace_key or p_state->>'schemaVersion' is distinct from '1'
    or pg_catalog.octet_length(p_state::text) > 2000000 then
    raise exception 'invalid_prototype_state' using errcode = '22023'; end if;
  select m.* into v_membership from d5o_hosted.workspaces w join d5o_hosted.memberships m on m.workspace_id=w.id
    where w.workspace_key=p_workspace_key and w.status='active' and m.actor_user_id=auth.uid() and m.status='active';
  v_workspace := v_membership.workspace_id;
  if v_workspace is null or v_membership.role not in ('admin','operations_leader','project_manager','field_supervisor') then
    raise exception 'prototype_write_forbidden' using errcode = '42501'; end if;
  update d5o_hosted.prototype_states set revision=revision+1,state_json=p_state,updated_by=auth.uid(),updated_at=now()
    where workspace_id=v_workspace and state_key='work' and revision=p_expected_revision returning revision into v_revision;
  if v_revision is null then raise exception 'stale_prototype_state' using errcode='23505'; end if;
  insert into d5o_hosted.prototype_state_revisions(workspace_id,state_key,revision,state_json,actor_user_id,membership_id)
    values(v_workspace,'work',v_revision,p_state,auth.uid(),v_membership.id);
  return pg_catalog.jsonb_build_object('revision',v_revision,'state',p_state);
end; $$;
