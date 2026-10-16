-- A schedule-only hold must not become a route to change approved technical or
-- commercial scope. Compare every newly saved package revision with the exact
-- retained snapshot on the latest schedule-held release until a new release
-- becomes current. Ordinary field-change authority remains a separate path.
create function d5o_hosted.guard_schedule_hold_package_scope_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_package jsonb;v_previous jsonb;v_release jsonb;
begin
  if new.state->'packages' is not distinct from old.state->'packages' then return new; end if;
  for v_package in select value from pg_catalog.jsonb_array_elements(
      coalesce(new.state->'packages','[]'::jsonb)) loop
    select item into v_previous from pg_catalog.jsonb_array_elements(
      coalesce(old.state->'packages','[]'::jsonb)) item
      where item->>'packageId'=v_package->>'packageId';
    if v_previous is null or v_previous->>'revision' is not distinct from v_package->>'revision' then continue; end if;
    select item into v_release from pg_catalog.jsonb_array_elements(
      coalesce(old.state->'releases','[]'::jsonb)) item
      where item->>'packageId'=v_package->>'packageId'
      order by item->>'issuedAt' desc limit 1;
    if v_release->>'holdKind'='Schedule correction'
      and v_release->>'status' in ('Held','Hold pending acknowledgment')
      and (v_package-'revision'-'status'-'windowStart'-'windowEnd'-'targetReleaseDate')
        is distinct from
          ((v_release->'snapshot')-'revision'-'status'-'windowStart'-'windowEnd'-'targetReleaseDate') then
      raise exception 'schedule_hold_scope_change_denied' using errcode='23514';
    end if;
  end loop;
  return new;
end; $$;
revoke all on function d5o_hosted.guard_schedule_hold_package_scope_v1()
  from public,anon,authenticated,service_role;
create trigger guard_schedule_hold_package_scope
  before update of state on d5o_hosted.connected_design_states
  for each row execute function d5o_hosted.guard_schedule_hold_package_scope_v1();
