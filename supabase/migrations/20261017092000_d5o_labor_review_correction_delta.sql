-- A corrected reviewed report is a new version of one labor fact, not a second shift.
-- Retain the first posted cost and each later signed difference as append-only facts.
alter table d5o_hosted.labor_actuals alter column cost_id drop not null;
alter table d5o_hosted.labor_actuals drop constraint labor_actuals_reviewed_hours_check;
alter table d5o_hosted.labor_actuals add constraint labor_actuals_reviewed_hours_check check(reviewed_hours>=0);
alter table d5o_hosted.labor_actuals drop constraint labor_actuals_amount_minor_check;
alter table d5o_hosted.labor_actuals add constraint labor_actuals_amount_minor_check check(amount_minor>=0);

create table d5o_hosted.labor_cost_adjustments (
 id uuid primary key default pg_catalog.gen_random_uuid(),
 workspace_id uuid not null, work_id uuid not null,
 reservation_id uuid not null references d5o_hosted.labor_reservations(id),
 actual_id uuid not null unique references d5o_hosted.labor_actuals(id),
 prior_amount_minor bigint not null check(prior_amount_minor>=0),
 revised_amount_minor bigint not null check(revised_amount_minor>=0),
 delta_minor bigint not null,
 report_id text not null, report_revision integer not null,
 reviewed_by uuid not null references auth.users(id),
 recorded_at timestamptz not null default now(),
 foreign key(work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id),
 check(delta_minor=revised_amount_minor-prior_amount_minor)
);
alter table d5o_hosted.labor_cost_adjustments enable row level security;
revoke all on d5o_hosted.labor_cost_adjustments from public,anon,authenticated,service_role;

create or replace function d5o_hosted.labor_exposure_v1(p_ws uuid,p_work uuid) returns bigint
 language sql volatile security definer set search_path='' as $$
 select coalesce(sum(greatest(
  case when r.status='Active' then r.amount_minor else 0 end,
  coalesce((select sum(latest.amount_minor) from (
   select distinct on (a.report_id) a.report_id,a.amount_minor
   from d5o_hosted.labor_actuals a where a.reservation_id=r.id
   order by a.report_id,a.report_revision desc
  ) latest),0))),0)::bigint
 from d5o_hosted.labor_reservations r
 where r.workspace_id=p_ws and r.work_id=p_work;
$$;

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
  select * into reservation from d5o_hosted.labor_reservations r
   where r.workspace_id=new.workspace_id and r.work_id=new.work_id
    and r.assignment_id=report_item->>'bookingId'
    and r.person_user_id=(report_item->>'authorId')::uuid
    and r.package_id=report_item->>'packageId'
    and r.release_id=report_item->>'releaseId'
    and r.work_date=(report_item->>'date')::date and r.status='Active'
   order by r.approved_at desc limit 1;
  if reservation.id is null then continue; end if;
  amount:=pg_catalog.round(hours*reservation.rate_minor)::bigint;
  select * into prior_actual from d5o_hosted.labor_actuals a
   where a.reservation_id=reservation.id and a.report_id=report_item->>'id'
   order by a.report_revision desc limit 1;
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

alter function public.d5o_hosted_job_finance_read_v1(text,text)
 rename to d5o_hosted_job_finance_read_pre_labor_correction_v1;
revoke all on function public.d5o_hosted_job_finance_read_pre_labor_correction_v1(text,text)
 from public,anon,authenticated,service_role;
create function public.d5o_hosted_job_finance_read_v1(p_workspace_key text,p_presentation_id text)
 returns jsonb language plpgsql stable security definer set search_path='' as $$
declare base jsonb; ws uuid; w uuid; corrections jsonb; reservations jsonb;
begin
 base:=public.d5o_hosted_job_finance_read_pre_labor_v1(p_workspace_key,p_presentation_id);
 select id into ws from d5o_hosted.workspaces where workspace_key=p_workspace_key and status='active';
 select work_id into w from d5o_hosted.work_identity_links
  where workspace_id=ws and presentation_id=p_presentation_id;
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'id',j.id,'kind','Incurred','category','Labor','amount_minor',j.delta_minor,
   'cost_date',j.recorded_at::date,'package_id',r.package_id,
   'source','Reviewed field report correction '||j.report_id||' revision '||j.report_revision,
   'reconciles_id',null) order by j.recorded_at),'[]'::jsonb) into corrections
 from d5o_hosted.labor_cost_adjustments j join d5o_hosted.labor_reservations r
  on r.id=j.reservation_id where j.workspace_id=ws and j.work_id=w and j.delta_minor<>0;
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'id',r.id,'packageId',r.package_id,'person',r.person,'workDate',r.work_date,
   'publicationId',r.publication_id,'authorizedHours',r.authorized_hours,
   'rateVersion',(select rate_version from d5o_hosted.labor_authorities a where a.id=r.labor_authority_id),
   'reservedMinor',r.amount_minor,'status',r.status,
   'actualHours',coalesce((select sum(latest.reviewed_hours) from (
    select distinct on (a.report_id) a.report_id,a.reviewed_hours
    from d5o_hosted.labor_actuals a where a.reservation_id=r.id
    order by a.report_id,a.report_revision desc) latest),0),
   'incurredMinor',coalesce((select sum(latest.amount_minor) from (
    select distinct on (a.report_id) a.report_id,a.amount_minor
    from d5o_hosted.labor_actuals a where a.reservation_id=r.id
    order by a.report_id,a.report_revision desc) latest),0)) order by r.approved_at),'[]'::jsonb)
 into reservations from d5o_hosted.labor_reservations r
 where r.workspace_id=ws and r.work_id=w;
 return base||pg_catalog.jsonb_build_object(
  'costs',coalesce(base->'costs','[]'::jsonb)||corrections,
  'laborReservations',reservations);
end; $$;
revoke all on function public.d5o_hosted_job_finance_read_v1(text,text)
 from public,anon,service_role;
grant execute on function public.d5o_hosted_job_finance_read_v1(text,text) to authenticated;
