-- Tighten the schedule-hold scope trigger for every state transition, including
-- an in-place package edit or omission by another callable persistence path.
create or replace function d5o_hosted.guard_schedule_hold_package_scope_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_package jsonb;v_previous jsonb;v_release jsonb;
begin
  if new.state->'packages' is not distinct from old.state->'packages' then return new; end if;
  for v_previous in select value from pg_catalog.jsonb_array_elements(
      coalesce(old.state->'packages','[]'::jsonb)) loop
    select item into v_release from pg_catalog.jsonb_array_elements(
      coalesce(old.state->'releases','[]'::jsonb)) item
      where item->>'packageId'=v_previous->>'packageId'
      order by item->>'issuedAt' desc limit 1;
    if v_release->>'holdKind' is distinct from 'Schedule correction'
      or v_release->>'status' not in ('Held','Hold pending acknowledgment') then continue; end if;
    select item into v_package from pg_catalog.jsonb_array_elements(
      coalesce(new.state->'packages','[]'::jsonb)) item
      where item->>'packageId'=v_previous->>'packageId';
    if v_package is null or
      (v_package-'revision'-'status'-'windowStart'-'windowEnd'-'targetReleaseDate')
        is distinct from
          ((v_release->'snapshot')-'revision'-'status'-'windowStart'-'windowEnd'-'targetReleaseDate') then
      raise exception 'schedule_hold_scope_change_denied' using errcode='23514';
    end if;
  end loop;
  return new;
end; $$;
revoke all on function d5o_hosted.guard_schedule_hold_package_scope_v1()
  from public,anon,authenticated,service_role;
