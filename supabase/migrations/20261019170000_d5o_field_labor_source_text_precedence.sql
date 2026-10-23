-- Preserve reviewed field-cost posting when a report has booked labor.
-- JSON extraction must be evaluated before building the human-readable
-- source label; otherwise concatenation can coerce plain text to jsonb.
create or replace function d5o_hosted.capture_reviewed_labor_v1() returns trigger
 language plpgsql volatile security definer set search_path='' as $$
declare report_item jsonb; prior jsonb; reservation d5o_hosted.labor_reservations%rowtype;
 hours numeric(8,2); amount bigint; cost_id uuid; reviewer uuid:=auth.uid();
begin
 if current_setting('role',true)<>'authenticated' or reviewer is null then
  raise exception 'reviewed_labor_actor_required' using errcode='42501'; end if;
 for report_item in select value from pg_catalog.jsonb_array_elements(
  coalesce(new.state->'reports','[]'::jsonb)) loop
  if report_item->>'status'<>'Reviewed' then continue; end if;
  select value into prior from pg_catalog.jsonb_array_elements(
   coalesce(old.state->'reports','[]'::jsonb))
   where value->>'id'=report_item->>'id';
  if prior is not null and prior->>'status'='Reviewed'
    and prior->>'revision'=report_item->>'revision' then continue; end if;
  if report_item->>'reviewerId'<>reviewer::text then
   raise exception 'reviewed_labor_actor_mismatch' using errcode='42501'; end if;
  hours:=(report_item->>'laborHours')::numeric;
  if hours is null or hours<0 then
   raise exception 'reviewed_labor_hours_invalid' using errcode='23514'; end if;
  if hours=0 then continue; end if;
  select * into reservation from d5o_hosted.labor_reservations r
   where r.workspace_id=new.workspace_id and r.work_id=new.work_id
    and r.assignment_id=report_item->>'bookingId'
    and r.person_user_id=(report_item->>'authorId')::uuid
    and r.package_id=report_item->>'packageId'
    and r.release_id=report_item->>'releaseId'
    and r.work_date=(report_item->>'date')::date
    and r.status='Active'
   order by r.approved_at desc limit 1;
  -- Legacy reports and bookings remain operational facts, without
  -- a fabricated rate or incurred cost.
  if reservation.id is null then continue; end if;
  amount:=pg_catalog.round(hours*reservation.rate_minor)::bigint;
  if amount<=0 then raise exception 'reviewed_labor_cost_invalid' using errcode='23514'; end if;
  insert into d5o_hosted.connected_job_costs(workspace_id,work_id,package_id,kind,
   category,amount_minor,cost_date,source,recorded_by)
   values(new.workspace_id,new.work_id,report_item->>'packageId','Incurred',
    'Labor',amount,(report_item->>'date')::date,
    'Reviewed field report ' || (report_item->>'id') ||
      ' revision ' || (report_item->>'revision'),
    reviewer) returning id into cost_id;
  insert into d5o_hosted.labor_actuals(workspace_id,work_id,reservation_id,
   report_id,report_revision,reviewed_hours,rate_minor,amount_minor,cost_id,reviewed_by)
   values(new.workspace_id,new.work_id,reservation.id,report_item->>'id',
    (report_item->>'revision')::integer,hours,reservation.rate_minor,amount,cost_id,reviewer);
 end loop;
 return new;
end; $$;
