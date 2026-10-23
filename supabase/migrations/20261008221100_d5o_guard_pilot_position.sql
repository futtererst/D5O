-- The legacy Work Record position is presentation state. A generic browser
-- snapshot cannot turn it into a decision or rewrite the pinned basis. Existing
-- command routes continue to use the server-only writer and remain auditable.
create or replace function d5o_hosted.protected_work_record_v1(p_record jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'id', p_record->'id', 'workspace', p_record->'workspace',
    'stage', p_record->'stage', 'status', p_record->'status',
    'progress', p_record->'progress',
    'phaseConfigurationVersionId', p_record->'phaseConfigurationVersionId',
    'prototypeDecisionRights', p_record->'prototypeDecisionRights',
    'heldFrom', p_record->'heldFrom',
    'heldNextAction', p_record->'heldNextAction',
    'heldNextActionDue', p_record->'heldNextActionDue',
    'heldNextActionImpact', p_record->'heldNextActionImpact',
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

-- Direct snapshot inserts remain prohibited by the existing trigger. New work
-- added to an existing snapshot may only enter as an unadvanced draft.
create or replace function d5o_hosted.guard_prototype_snapshot_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
declare old_record jsonb; new_record jsonb; old_package jsonb; new_package jsonb;
  catalog_record jsonb; pair record;
begin
  if current_setting('role', true) = 'service_role' then return new; end if;
  if tg_op = 'INSERT' or new.state_key <> 'work' then
    raise exception 'command_only_state' using errcode = '42501'; end if;
  if old.state_json->'pricingPolicies' is distinct from new.state_json->'pricingPolicies'
    or old.state_json->'activePricingPolicy' is distinct from new.state_json->'activePricingPolicy'
    or old.state_json->'pricingPolicyHistory' is distinct from new.state_json->'pricingPolicyHistory' then
    raise exception 'protected_policy_changed' using errcode = '42501'; end if;
  if pg_catalog.jsonb_typeof(new.state_json->'records') is distinct from 'array' then
    raise exception 'invalid_records' using errcode = '22023'; end if;
  if (select count(*) from pg_catalog.jsonb_array_elements(new.state_json->'records'))
    <> (select count(distinct item->>'id') from pg_catalog.jsonb_array_elements(new.state_json->'records') item) then
    raise exception 'duplicate_work_id' using errcode = '22023'; end if;
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
      raise exception 'protected_decision_changed' using errcode = '42501'; end if;
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
      select item into catalog_record
        from d5o_hosted.prototype_states c,
          lateral pg_catalog.jsonb_array_elements(coalesce(c.state_json->'records', '[]'::jsonb)) item
        where c.workspace_id = new.workspace_id and c.state_key = 'catalog'
          and item->>'id' = new_record->>'id';
      if catalog_record is null or catalog_record->>'workspace' is distinct from new_record->>'workspace'
        or catalog_record->>'stage' is distinct from new_record->>'stage'
        or catalog_record->'progress' is distinct from new_record->'progress'
        or catalog_record->>'status' is distinct from new_record->>'status'
        or catalog_record->>'phaseConfigurationVersionId' is distinct from new_record->>'phaseConfigurationVersionId' then
        raise exception 'unregistered_work_import' using errcode = '42501'; end if;
      if new_record->'design' is not null or new_record->'deploy' is not null or new_record->'operate' is not null
        or new_record->'serviceSource' is not null or new_record->>'status' = 'complete'
        or new_record->'prototypeDecisionRights' is not null or new_record->'heldFrom' is not null
        or (new_record#>>'{definition,status}' is not null and new_record#>>'{definition,status}' <> 'Draft')
        or new_record#>'{definition,reviews}' is not null or new_record#>'{definition,developHandoff}' is not null
        or new_record#>'{definition,approvedBaselines}' is not null or new_record#>'{definition,decisions}' is not null
        or new_record#>'{discovery,pursuitControl}' is not null then
        raise exception 'protected_work_import' using errcode = '42501'; end if;
    end if;
  end loop;
  return new;
end; $$;
revoke all on function d5o_hosted.guard_prototype_snapshot_v1() from public, anon, authenticated;
