-- A newly introduced draft must not bring preapproved commercial state into
-- the shared snapshot, including legacy records without pursuitControl.
create function d5o_hosted.guard_new_commercial_import_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
declare new_record jsonb; old_record jsonb;
begin
  if current_setting('role', true) = 'service_role'
    or new.state_key <> 'work' then return new; end if;
  for old_record in select value from pg_catalog.jsonb_array_elements(coalesce(old.state_json->'records', '[]'::jsonb)) loop
    select value into new_record from pg_catalog.jsonb_array_elements(coalesce(new.state_json->'records', '[]'::jsonb))
      where value->>'id' = old_record->>'id';
    if new_record is null then continue; end if;
    if old_record#>>'{discovery,estimate,status}' not in ('Not started', 'Draft')
        and old_record#>'{discovery,estimate}' is distinct from new_record#>'{discovery,estimate}'
      or old_record#>>'{discovery,proposal,status}' not in ('Not started', 'Draft')
        and old_record#>'{discovery,proposal}' is distinct from new_record#>'{discovery,proposal}'
      or old_record#>'{develop,review}' is not null
        and old_record->'develop' is distinct from new_record->'develop' then
      raise exception 'protected_commercial_basis_changed' using errcode = '42501';
    end if;
  end loop;
  for new_record in select value from pg_catalog.jsonb_array_elements(coalesce(new.state_json->'records', '[]'::jsonb)) loop
    if exists (select 1 from pg_catalog.jsonb_array_elements(coalesce(old.state_json->'records', '[]'::jsonb)) item
      where item->>'id' = new_record->>'id') then continue; end if;
    if new_record#>>'{discovery,estimate,status}' not in ('Not started', 'Draft')
      or new_record#>>'{discovery,proposal,status}' not in ('Not started', 'Draft')
      or new_record#>'{discovery,estimate,detailed}' is not null
      or new_record#>'{discovery,estimate,review}' is not null
      or pg_catalog.jsonb_array_length(case when pg_catalog.jsonb_typeof(new_record#>'{discovery,estimate,pricingHistory}') = 'array'
        then new_record#>'{discovery,estimate,pricingHistory}' else '[]'::jsonb end) > 0
      or new_record#>'{discovery,proposal,review}' is not null
      or new_record#>'{discovery,proposal,submission}' is not null
      or exists (select 1 from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(new_record#>'{discovery,proposal,history}') = 'array'
        then new_record#>'{discovery,proposal,history}' else '[]'::jsonb end) event
        where event->>'state' in ('Approved', 'Internal review', 'Submitted to customer'))
      or pg_catalog.jsonb_array_length(case when pg_catalog.jsonb_typeof(new_record#>'{discovery,proposal,submissionHistory}') = 'array'
        then new_record#>'{discovery,proposal,submissionHistory}' else '[]'::jsonb end) > 0
      or pg_catalog.jsonb_array_length(case when pg_catalog.jsonb_typeof(new_record#>'{discovery,proposal,responseEvents}') = 'array'
        then new_record#>'{discovery,proposal,responseEvents}' else '[]'::jsonb end) > 0
      or new_record#>'{discovery,outcome}' is not null
      or new_record#>'{discovery,designHandoff}' is not null
      or pg_catalog.jsonb_array_length(case when pg_catalog.jsonb_typeof(new_record#>'{discovery,designHandoffHistory}') = 'array'
        then new_record#>'{discovery,designHandoffHistory}' else '[]'::jsonb end) > 0
      or new_record#>'{develop,review}' is not null
      or pg_catalog.jsonb_array_length(case when pg_catalog.jsonb_typeof(new_record#>'{prototypeDecisionRights}') = 'array'
        then new_record#>'{prototypeDecisionRights}' else '[]'::jsonb end) > 0 then
      raise exception 'protected_commercial_import' using errcode = '42501';
    end if;
  end loop;
  return new;
end; $$;
revoke all on function d5o_hosted.guard_new_commercial_import_v1() from public, anon, authenticated;
create trigger d5o_hosted_new_commercial_import_guard
  before update of state_json on d5o_hosted.prototype_states
  for each row execute function d5o_hosted.guard_new_commercial_import_v1();
