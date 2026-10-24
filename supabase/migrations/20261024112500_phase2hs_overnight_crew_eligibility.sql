-- Field-start permits already support an overnight published shift. The
-- workforce writer must assess that same shift for availability and capacity.
-- Preserve weekday booking dates, published shift identity and command receipts.
create or replace function d5o_hosted.crew_booking_eligibility_v1(
  p_workspace uuid,p_state jsonb,p_assignment jsonb
) returns void language plpgsql volatile security definer set search_path='' as $$
declare v_item jsonb;v_profile d5o_hosted.connected_crew_profiles%rowtype;
  v_person text;v_hours numeric;v_used numeric;v_shift text;
  v_start integer;v_end integer;v_duration integer;v_overnight boolean;
  v_assignment jsonb;v_booking_date date;
begin
  v_shift:=p_assignment->>'shift';
  if coalesce(v_shift,'') !~ '^\d\d:\d\d[–-]\d\d:\d\d$' then
    raise exception 'invalid_booking_shift' using errcode='23514'; end if;
  v_start:=left(v_shift,2)::integer*60+substring(v_shift from 4 for 2)::integer;
  v_end:=substring(v_shift from 7 for 2)::integer*60+right(v_shift,2)::integer;
  if v_start>=1440 or v_end>=1440 or substring(v_shift from 4 for 2)::integer>=60
    or right(v_shift,2)::integer>=60 then
    raise exception 'invalid_booking_shift' using errcode='23514'; end if;
  v_overnight:=v_end<=v_start;
  v_duration:=v_end-v_start+case when v_overnight then 1440 else 0 end;
  if v_duration<1 or v_duration>960 then
    raise exception 'invalid_booking_shift' using errcode='23514'; end if;
  v_hours:=(v_duration-case when v_duration>=360 then 30 else 0 end)::numeric/60;
  v_booking_date:=(p_assignment->>'date')::date;
  for v_item in select value from pg_catalog.jsonb_array_elements(p_assignment->'people') loop
    v_person:=v_item#>>'{}';
    select * into v_profile from d5o_hosted.connected_crew_profiles
      where workspace_id=p_workspace and person=v_person and active;
    if not found or v_profile.actor_user_id is null
      or not exists(select 1 from d5o_hosted.crew_bindings b
        join d5o_hosted.memberships m on m.workspace_id=b.workspace_id
          and m.actor_user_id=b.actor_user_id and m.status='active' and m.role='field_worker'
        where b.workspace_id=p_workspace and b.actor_user_id=v_profile.actor_user_id
          and b.person=v_person and b.active) then
      raise exception 'qualified_bound_worker_required' using errcode='23514'; end if;
    if exists(select 1 from pg_catalog.jsonb_array_elements(
        coalesce(p_state->'availabilityBlocks','[]'::jsonb)) b
        where b->>'person'=v_person and (
          b->>'date'=p_assignment->>'date' or
          v_overnight and b->>'date'=to_char(v_booking_date+1,'YYYY-MM-DD'))) then
      raise exception 'worker_unavailable_for_shift' using errcode='23514'; end if;
    v_used:=0;
    for v_assignment in select a from pg_catalog.jsonb_array_elements(
      coalesce(p_state->'assignments','[]'::jsonb)) a
      where a->>'id'<>p_assignment->>'id'
        and (a->>'week')::integer=(p_assignment->>'week')::integer
        and a->'people' ? v_person loop
      v_shift:=v_assignment->>'shift';
      if coalesce(v_shift,'') !~ '^\d\d:\d\d[–-]\d\d:\d\d$' then
        raise exception 'invalid_existing_booking_shift' using errcode='23514'; end if;
      v_start:=left(v_shift,2)::integer*60+substring(v_shift from 4 for 2)::integer;
      v_end:=substring(v_shift from 7 for 2)::integer*60+right(v_shift,2)::integer;
      v_duration:=v_end-v_start+case when v_end<=v_start then 1440 else 0 end;
      if v_duration<1 or v_duration>960 then
        raise exception 'invalid_existing_booking_shift' using errcode='23514'; end if;
      v_used:=v_used+(v_duration-case when v_duration>=360 then 30 else 0 end)::numeric/60;
    end loop;
    if v_used+v_hours>v_profile.weekly_capacity_hours then
      raise exception 'worker_weekly_capacity_exceeded' using errcode='23514'; end if;
  end loop;
end; $$;
revoke all on function d5o_hosted.crew_booking_eligibility_v1(uuid,jsonb,jsonb)
  from public,anon,authenticated,service_role;
