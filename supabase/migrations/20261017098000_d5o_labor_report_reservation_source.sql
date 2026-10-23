-- Bind independently reviewed time to the retained publication reservation effective at server receipt. Historical unmatched reports remain operational evidence only.
create or replace function d5o_hosted.capture_reviewed_labor_v1() returns trigger
 language plpgsql volatile security definer set search_path='' as $$
declare report_item jsonb; prior_state jsonb; reservation d5o_hosted.labor_reservations%rowtype;
 prior_actual d5o_hosted.labor_actuals%rowtype; hours numeric(8,2); amount bigint;
 cost_id uuid; actual_id uuid; reviewer uuid:=auth.uid();
begin
 if current_setting('role',true)<>'authenticated' or reviewer is null then
  raise exception 'reviewed_labor_actor_required' using errcode='42501'; end if;
 for report_item in select value from pg_catalog.jsonb_array_elements(
   coalesce(new.state->'reports','[]'::jsonb)) loop
  if report_item->>'status'<>'Reviewed' then continue; end if;
  select value into prior_state from pg_catalog.jsonb_array_elements(
   coalesce(old.state->'reports','[]'::jsonb))
   where value->>'id'=report_item->>'id';
  if prior_state is not null and prior_state->>'status'='Reviewed'
   and prior_state->>'revision'=report_item->>'revision' then continue; end if;
  if report_item->>'reviewerId'<>reviewer::text then
   raise exception 'reviewed_labor_actor_mismatch' using errcode='42501'; end if;
  hours:=(report_item->>'laborHours')::numeric;
  if hours is null or hours<0 then
   raise exception 'reviewed_labor_hours_invalid' using errcode='23514'; end if;
  -- A later booking amendment does not erase the cost source of work already
  -- reported. Corrections stay with the original reservation and rate.
  select * into prior_actual from d5o_hosted.labor_actuals a
   where a.workspace_id=new.workspace_id and a.work_id=new.work_id
    and a.report_id=report_item->>'id'
   order by a.report_revision desc limit 1;
  if prior_actual.id is not null then
   select * into reservation from d5o_hosted.labor_reservations r
    where r.id=prior_actual.reservation_id;
  else
   select * into reservation from d5o_hosted.labor_reservations r
    where r.workspace_id=new.workspace_id and r.work_id=new.work_id
     and r.assignment_id=report_item->>'bookingId'
     and r.person_user_id=(report_item->>'authorId')::uuid
     and r.package_id=report_item->>'packageId'
     and r.release_id=report_item->>'releaseId'
     and r.work_date=(report_item->>'date')::date
     and r.approved_at<=(report_item->>'receivedAt')::timestamptz
     and (r.superseded_at is null
       or r.superseded_at>(report_item->>'receivedAt')::timestamptz)
    order by r.approved_at desc limit 1;
  end if;
  if reservation.id is null then continue; end if;
  if reservation.workspace_id<>new.workspace_id or reservation.work_id<>new.work_id
   or reservation.assignment_id<>report_item->>'bookingId'
   or reservation.person_user_id<>(report_item->>'authorId')::uuid
   or reservation.package_id<>report_item->>'packageId'
   or reservation.release_id<>report_item->>'releaseId'
   or reservation.work_date<>(report_item->>'date')::date then
   raise exception 'reviewed_labor_source_changed' using errcode='23514'; end if;
  amount:=pg_catalog.round(hours*reservation.rate_minor)::bigint;
  if prior_actual.id is null and amount=0 then continue; end if;
  cost_id:=null;
  if prior_actual.id is null then
   insert into d5o_hosted.connected_job_costs(workspace_id,work_id,package_id,kind,
    category,amount_minor,cost_date,source,recorded_by)
    values(new.workspace_id,new.work_id,report_item->>'packageId','Incurred',
     'Labor',amount,(report_item->>'date')::date,
     'Reviewed field report '||report_item->>'id'||' revision '||report_item->>'revision',
     reviewer) returning id into cost_id;
  end if;
  insert into d5o_hosted.labor_actuals(workspace_id,work_id,reservation_id,
   report_id,report_revision,reviewed_hours,rate_minor,amount_minor,cost_id,reviewed_by)
   values(new.workspace_id,new.work_id,reservation.id,report_item->>'id',
    (report_item->>'revision')::integer,hours,reservation.rate_minor,amount,cost_id,reviewer)
   returning id into actual_id;
  if prior_actual.id is not null then
   insert into d5o_hosted.labor_cost_adjustments(workspace_id,work_id,reservation_id,
    actual_id,prior_amount_minor,revised_amount_minor,delta_minor,report_id,
    report_revision,reviewed_by)
    values(new.workspace_id,new.work_id,reservation.id,actual_id,
     prior_actual.amount_minor,amount,amount-prior_actual.amount_minor,
     report_item->>'id',(report_item->>'revision')::integer,reviewer);
  end if;
 end loop;
 return new;
end; $$;
