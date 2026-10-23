-- Forward correction: preserve unchanged legacy publications; prevent duplicate manual labor cost after a later authority revocation.
create or replace function public.d5o_hosted_crew_command_v1(
 p_workspace_key text,p_action text,p_input jsonb,p_command_id text,p_expected_revision integer)
 returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); ws uuid; role_name text; schedule d5o_hosted.connected_schedule_states%rowtype;
 result jsonb; item jsonb; publication jsonb; person_item jsonb; demand jsonb; release_row jsonb;
 intent d5o_hosted.labor_booking_intents%rowtype; authority d5o_hosted.labor_authorities%rowtype;
 parent d5o_hosted.purchase_authorities%rowtype; v_work_id uuid; person_user uuid;
 source jsonb; hours numeric(8,2); cost bigint; used bigint; digest text; week_start date;
begin
 if current_setting('role',true)<>'authenticated' or actor is null then
  raise exception 'crew_membership_required' using errcode='42501'; end if;
 select id into ws from d5o_hosted.workspaces where workspace_key=p_workspace_key and status='active';
 select role into role_name from d5o_hosted.memberships
  where workspace_id=ws and actor_user_id=actor and status='active';
 if ws is null or role_name is null then raise exception 'workspace_forbidden' using errcode='42501'; end if;
 if p_action not in ('save-booking','publish-week') then
  return public.d5o_hosted_crew_command_pre_labor_v1(
   p_workspace_key,p_action,p_input,p_command_id,p_expected_revision); end if;
 if role_name not in ('admin','project_manager','operations_leader') then
  raise exception 'scheduling_authority_required' using errcode='42501'; end if;
 -- The original receipt owns replay identity; do not re-evaluate or mutate labor.
 if exists(select 1 from d5o_hosted.connected_schedule_receipts
  where workspace_id=ws and command_id=p_command_id) then
  return public.d5o_hosted_crew_command_pre_labor_v1(
   p_workspace_key,p_action,p_input,p_command_id,p_expected_revision); end if;
 if p_action='save-booking' then
  result:=public.d5o_hosted_crew_command_pre_labor_v1(
   p_workspace_key,p_action,p_input,p_command_id,p_expected_revision);
  select * into schedule from d5o_hosted.connected_schedule_states where workspace_id=ws;
  select value into item from pg_catalog.jsonb_array_elements(schedule.state->'assignments')
   where value->>'id'=p_input#>>'{assignment,id}';
  select l.work_id into v_work_id from d5o_hosted.work_identity_links l
   where l.workspace_id=ws and l.presentation_id=item->>'workId';
  if item is null or v_work_id is null then
   raise exception 'booking_labor_source_unavailable' using errcode='23514'; end if;
  select * into intent from d5o_hosted.labor_booking_intents
   where workspace_id=ws and assignment_id=item->>'id';
  if p_input->'assignment' ? 'personHoursPerWorker' then
   if coalesce(p_input#>>'{assignment,personHoursPerWorker}','') !~ '^\d+(\.\d{1,2})?$'
    or (p_input#>>'{assignment,personHoursPerWorker}')::numeric<=0
    or (p_input#>>'{assignment,personHoursPerWorker}')::numeric>24 then
    raise exception 'authorized_person_hours_invalid' using errcode='22023'; end if;
   hours:=(p_input#>>'{assignment,personHoursPerWorker}')::numeric;
  elsif intent.workspace_id is not null and intent.work_id=v_work_id
    and intent.package_id=item->>'packageId' then
   hours:=intent.person_hours_per_worker;
  else
   raise exception 'authorized_person_hours_required' using errcode='23514';
  end if;
  insert into d5o_hosted.labor_booking_intents(workspace_id,assignment_id,work_id,package_id,
   assignment_digest,person_hours_per_worker,schedule_revision,prepared_by)
   values(ws,item->>'id',v_work_id,item->>'packageId',pg_catalog.md5(item::text),
    hours,schedule.decision_revision,actor)
   on conflict(workspace_id,assignment_id) do update set
    work_id=excluded.work_id,package_id=excluded.package_id,
    assignment_digest=excluded.assignment_digest,
    person_hours_per_worker=excluded.person_hours_per_worker,
    schedule_revision=excluded.schedule_revision,prepared_by=excluded.prepared_by,prepared_at=now();  return result;
 end if;
 -- A Work lock is taken before the existing schedule lock. All affected Works
 -- are locked in stable order; PO, subcontract and Design use this same row.
 select * into schedule from d5o_hosted.connected_schedule_states where workspace_id=ws;
 if schedule.workspace_id is null then
  raise exception 'empty_publication' using errcode='23514'; end if;
 for v_work_id in select distinct l.work_id from d5o_hosted.work_identity_links l
  join lateral pg_catalog.jsonb_array_elements(schedule.state->'assignments') a on
   a->>'workId'=l.presentation_id and (a->>'week')::integer=(p_input->>'week')::integer
  where l.workspace_id=ws order by l.work_id loop
  perform 1 from d5o_hosted.work_records w
   where w.workspace_id=ws and w.id=v_work_id for update;
 end loop;
 result:=public.d5o_hosted_crew_command_pre_labor_v1(
  p_workspace_key,p_action,p_input,p_command_id,p_expected_revision);
 select * into schedule from d5o_hosted.connected_schedule_states where workspace_id=ws;
 select value into publication from pg_catalog.jsonb_array_elements(schedule.state->'publications')
  with ordinality as entries(value,ordinal)
  where (value->>'week')::integer=(p_input->>'week')::integer
  order by ordinal desc limit 1;
 if publication is null then raise exception 'publication_labor_basis_unavailable' using errcode='23514'; end if;
 week_start:=(publication->>'weekStart')::date;
 -- Supersede only unworked reservations on the replaced week. Reviewed costs
 -- remain consumed and retain their original published assignment source.
 update d5o_hosted.labor_reservations r set status='Superseded',superseded_at=now()
  where r.workspace_id=ws and r.status='Active'
   and r.work_date>=week_start and r.work_date<week_start+7
   and not exists(select 1 from d5o_hosted.labor_actuals a where a.reservation_id=r.id)
   and not exists(select 1 from pg_catalog.jsonb_array_elements(publication->'assignments') a
    where a->>'id'=r.assignment_id and pg_catalog.md5(a::text)=r.assignment_digest
     and a->'people' ? r.person);
 for item in select value from pg_catalog.jsonb_array_elements(publication->'assignments') loop
  select l.work_id into v_work_id from d5o_hosted.work_identity_links l
   where l.workspace_id=ws and l.presentation_id=item->>'workId';
  select * into intent from d5o_hosted.labor_booking_intents
   where workspace_id=ws and assignment_id=item->>'id';
  digest:=pg_catalog.md5(item::text);
  if intent.workspace_id is null or intent.work_id<>v_work_id
   or intent.package_id<>item->>'packageId' or intent.assignment_digest<>digest then
   -- An unchanged historical publication retains its worker response. Do not
   -- fabricate a rate or consume new labor authority for its prior commitment.
   if intent.workspace_id is null and exists(
    select 1 from pg_catalog.jsonb_array_elements(schedule.state->'publications') old_pub
    cross join lateral pg_catalog.jsonb_array_elements(old_pub->'assignments') old_assignment
    where old_pub->>'id'<>publication->>'id' and old_assignment.value=item
     and exists(select 1 from d5o_hosted.connected_design_states ds
      cross join lateral pg_catalog.jsonb_array_elements(ds.state->'demands') current_demand
      where ds.workspace_id=ws and ds.work_id=v_work_id
       and current_demand.value->>'packageId'=item->>'packageId'
       and old_pub->'packageDemands' @> pg_catalog.jsonb_build_array(current_demand.value))) then
    continue;
   end if;
   raise exception 'authorized_person_hours_required' using errcode='23514'; end if;
  hours:=intent.person_hours_per_worker;
  source:=d5o_hosted.purchase_basis_v1(ws,v_work_id);
  select * into parent from d5o_hosted.purchase_authorities
   where workspace_id=ws and work_id=v_work_id and status='Approved'
    and source_digest=source->>'digest' and current_date between valid_from and valid_until
   order by created_at desc limit 1 for update;
  select * into authority from d5o_hosted.labor_authorities
   where workspace_id=ws and work_id=v_work_id and status='Approved'
    and parent_authority_id=parent.id and source_digest=source->>'digest'
    and (item->>'date')::date between valid_from and valid_until
   order by created_at desc limit 1;
  if authority.id is null then raise exception 'approved_labor_authority_required' using errcode='23514'; end if;
  select d.value into demand from d5o_hosted.connected_design_states ds,
   lateral pg_catalog.jsonb_array_elements(ds.state->'demands') d
   where ds.workspace_id=ws and ds.work_id=v_work_id
    and d->>'packageId'=item->>'packageId';
  select r.value into release_row from d5o_hosted.connected_design_states ds,
   lateral pg_catalog.jsonb_array_elements(ds.state->'releases') r
   where ds.workspace_id=ws and ds.work_id=v_work_id
    and r->>'packageId'=item->>'packageId' and r->>'status'='Accepted'
    and r->>'packageRevision'=demand->>'designPackageRevision'
   order by r->>'issuedAt' desc limit 1;
  if release_row is null then raise exception 'current_release_required' using errcode='23514'; end if;
  for person_item in select value from pg_catalog.jsonb_array_elements(item->'people') loop
   select b.actor_user_id into person_user from d5o_hosted.crew_bindings b
    where b.workspace_id=ws and b.person=person_item#>>'{}' and b.active;
   if person_user is null then raise exception 'qualified_bound_worker_required' using errcode='23514'; end if;
   if exists(select 1 from d5o_hosted.labor_reservations r where r.workspace_id=ws
    and r.assignment_id=item->>'id' and r.person=person_item#>>'{}' and r.status='Active'
    and r.assignment_digest=digest and r.authorized_hours=hours) then continue; end if;
   cost:=pg_catalog.round(hours*authority.rate_minor)::bigint;
   used:=d5o_hosted.labor_exposure_v1(ws,v_work_id);
   if used+cost>authority.cap_minor then
    raise exception 'labor_sublimit_exceeded' using errcode='23514'; end if;
   insert into d5o_hosted.labor_reservations(workspace_id,work_id,labor_authority_id,
    publication_id,assignment_id,assignment_digest,person,person_user_id,package_id,
    design_revision,demand_revision,release_id,work_date,shift,authorized_hours,
    rate_minor,amount_minor,currency,status,approved_by)
    values(ws,v_work_id,authority.id,publication->>'id',item->>'id',digest,person_item#>>'{}',
     person_user,item->>'packageId',
     (select decision_revision from d5o_hosted.connected_design_states
       where workspace_id=ws and work_id=v_work_id),
     (demand->>'designPackageRevision')::integer,release_row->>'id',
     (item->>'date')::date,item->>'shift',hours,authority.rate_minor,cost,'USD','Active',actor);
  end loop;
 end loop;
 return result;
end; $$;
revoke all on function public.d5o_hosted_crew_command_v1(text,text,jsonb,text,integer)
 from public,anon,service_role;
grant execute on function public.d5o_hosted_crew_command_v1(text,text,jsonb,text,integer)
 to authenticated;


create or replace function public.d5o_hosted_job_finance_command_v1(
 p_workspace_key text,p_presentation_id text,p_action text,p_input jsonb,
 p_command_id text,p_expected_revision integer) returns jsonb
 language plpgsql volatile security definer set search_path='' as $$
declare result jsonb; ws uuid; w uuid;
begin
 result:=public.d5o_hosted_job_finance_command_pre_labor_v1(
  p_workspace_key,p_presentation_id,p_action,p_input,p_command_id,p_expected_revision);
 if p_action='add-cost' and p_input->>'category'='Labor' then
  select id into ws from d5o_hosted.workspaces where workspace_key=p_workspace_key;
  select work_id into w from d5o_hosted.work_identity_links
   where workspace_id=ws and presentation_id=p_presentation_id;
  if exists(select 1 from d5o_hosted.labor_authorities
   where workspace_id=ws and work_id=w and status='Approved') then
   raise exception 'reviewed_labor_cost_is_field_sourced' using errcode='23514';
  end if;
 end if;
 return result;
end; $$;
revoke all on function public.d5o_hosted_job_finance_command_v1(text,text,text,jsonb,text,integer)
 from public,anon,service_role;
grant execute on function public.d5o_hosted_job_finance_command_v1(text,text,text,jsonb,text,integer)
 to authenticated;


