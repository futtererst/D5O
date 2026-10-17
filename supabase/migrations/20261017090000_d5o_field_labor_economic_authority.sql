-- Field labor is a Work-level commitment only when a reviewed rate and labor
-- allocation exist. Draft bookings and historical publications remain unchanged.
create table d5o_hosted.labor_authority_positions (
  workspace_id uuid not null, work_id uuid not null, revision integer not null default 0,
  primary key(workspace_id,work_id),
  foreign key(work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id)
);
create table d5o_hosted.labor_authorities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null, work_id uuid not null,
  parent_authority_id uuid not null references d5o_hosted.purchase_authorities(id),
  status text not null check(status in ('Prepared','Approved','Returned','Revoked')),
  currency text not null check(currency='USD'),
  cap_minor bigint not null check(cap_minor>0),
  rate_minor bigint not null check(rate_minor>0),
  rate_version text not null check(length(trim(rate_version)) between 4 and 120),
  rate_source text not null check(length(trim(rate_source)) between 8 and 500),
  rate_basis text not null check(length(trim(rate_basis)) between 10 and 1000),
  scope text not null check(length(trim(scope)) between 10 and 2000),
  conditions text not null check(length(trim(conditions)) between 10 and 2000),
  valid_from date not null, valid_until date not null,
  source_digest text not null,
  prepared_by uuid not null references auth.users(id),
  reviewed_by uuid references auth.users(id),
  review_reason text,
  created_at timestamptz not null default now(), decided_at timestamptz,
  supersedes_id uuid references d5o_hosted.labor_authorities(id),
  foreign key(work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id),
  check(valid_from<=valid_until)
);
create unique index labor_one_current_approved_authority
 on d5o_hosted.labor_authorities(workspace_id,work_id) where status='Approved';
create table d5o_hosted.labor_booking_intents (
  workspace_id uuid not null, assignment_id text not null,
  work_id uuid not null, package_id text not null,
  assignment_digest text not null,
  person_hours_per_worker numeric(8,2) not null check(person_hours_per_worker>0 and person_hours_per_worker<=24),
  schedule_revision integer not null,
  prepared_by uuid not null references auth.users(id),
  prepared_at timestamptz not null default now(),
  primary key(workspace_id,assignment_id),
  foreign key(work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id)
);
create table d5o_hosted.labor_reservations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null, work_id uuid not null,
  labor_authority_id uuid not null references d5o_hosted.labor_authorities(id),
  publication_id text not null, assignment_id text not null, assignment_digest text not null,
  person text not null, person_user_id uuid not null references auth.users(id),
  package_id text not null, design_revision integer not null,
  demand_revision integer not null, release_id text not null,
  work_date date not null, shift text not null,
  authorized_hours numeric(8,2) not null check(authorized_hours>0),
  rate_minor bigint not null check(rate_minor>0),
  amount_minor bigint not null check(amount_minor>0),
  currency text not null check(currency='USD'),
  status text not null check(status in ('Active','Superseded')),
  approved_by uuid not null references auth.users(id),
  approved_at timestamptz not null default now(),
  superseded_at timestamptz,
  foreign key(work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id),
  unique(workspace_id,publication_id,assignment_id,person)
);
create index labor_active_reservations on d5o_hosted.labor_reservations(workspace_id,work_id,status);
create table d5o_hosted.labor_actuals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null, work_id uuid not null,
  reservation_id uuid not null references d5o_hosted.labor_reservations(id),
  report_id text not null, report_revision integer not null,
  reviewed_hours numeric(8,2) not null check(reviewed_hours>0),
  rate_minor bigint not null check(rate_minor>0),
  amount_minor bigint not null check(amount_minor>0),
  cost_id uuid not null unique references d5o_hosted.connected_job_costs(id),
  reviewed_by uuid not null references auth.users(id),
  reviewed_at timestamptz not null default now(),
  foreign key(work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id),
  unique(workspace_id,work_id,report_id,report_revision)
);
create table d5o_hosted.labor_authority_events (
  workspace_id uuid not null, work_id uuid not null, revision integer not null,
  action text not null, command_id text not null,
  actor_user_id uuid not null references auth.users(id),
  membership_id uuid not null references d5o_hosted.memberships(id),
  subject_id uuid, basis jsonb not null, occurred_at timestamptz not null default now(),
  primary key(workspace_id,work_id,revision), unique(workspace_id,command_id)
);
create table d5o_hosted.labor_authority_receipts (
  workspace_id uuid not null, command_id text not null, work_id uuid not null,
  actor_user_id uuid not null references auth.users(id),
  fingerprint text not null, result jsonb not null,
  primary key(workspace_id,command_id)
);
alter table d5o_hosted.labor_authority_positions enable row level security;
alter table d5o_hosted.labor_authorities enable row level security;
alter table d5o_hosted.labor_booking_intents enable row level security;
alter table d5o_hosted.labor_reservations enable row level security;
alter table d5o_hosted.labor_actuals enable row level security;
alter table d5o_hosted.labor_authority_events enable row level security;
alter table d5o_hosted.labor_authority_receipts enable row level security;
revoke all on d5o_hosted.labor_authority_positions,d5o_hosted.labor_authorities,
 d5o_hosted.labor_booking_intents,d5o_hosted.labor_reservations,d5o_hosted.labor_actuals,
 d5o_hosted.labor_authority_events,d5o_hosted.labor_authority_receipts
 from public,anon,authenticated,service_role;

-- Active reservations consume their greater authorized or reviewed actual cost.
-- A superseded unworked booking releases only its unincurred future reservation.
create function d5o_hosted.labor_exposure_v1(p_ws uuid,p_work uuid) returns bigint
 language sql volatile security definer set search_path='' as $$
 select coalesce(sum(greatest(
   case when r.status='Active' then r.amount_minor else 0 end,
   coalesce((select sum(a.amount_minor) from d5o_hosted.labor_actuals a
      where a.reservation_id=r.id),0))),0)::bigint
 from d5o_hosted.labor_reservations r
 where r.workspace_id=p_ws and r.work_id=p_work;
$$;
revoke all on function d5o_hosted.labor_exposure_v1(uuid,uuid) from public,anon,authenticated,service_role;

-- PO, subcontract, Design and labor share the same canonical Work lock/cap.
create or replace function d5o_hosted.guard_combined_work_authority_v1() returns trigger
 language plpgsql volatile security definer set search_path='' as $$
declare ws uuid; w uuid; cap bigint; design_used bigint; po_used bigint; sub_used bigint; labor_used bigint; source jsonb;
begin
 ws:=new.workspace_id; w:=new.work_id;
 if tg_table_name='subcontract_reservations' and new.amount_minor<0 then return new; end if;
 if tg_table_name='design_spend_commitments' and new.status<>'Approved' then return new; end if;
 if tg_table_name='labor_reservations' and new.status<>'Active' then return new; end if;
 source:=d5o_hosted.purchase_basis_v1(ws,w);
 select parent_cap_minor into cap from d5o_hosted.purchase_authorities
  where workspace_id=ws and work_id=w and status='Approved'
   and source_digest=source->>'digest' and current_date between valid_from and valid_until
  order by created_at desc limit 1;
 if cap is null then
  if tg_table_name in ('subcontract_reservations','labor_reservations') then
   raise exception 'current_work_economic_authority_required' using errcode='23514';
  end if;
  return new;
 end if;
 select coalesce(sum(amount_minor),0) into design_used from d5o_hosted.design_spend_commitments
  where workspace_id=ws and work_id=w and status='Approved';
 select coalesce(sum(amount_minor),0) into po_used from d5o_hosted.purchase_reservations
  where workspace_id=ws and work_id=w and status='Reserved';
 select coalesce(sum(amount_minor),0) into sub_used from d5o_hosted.subcontract_reservations
  where workspace_id=ws and work_id=w;
 labor_used:=d5o_hosted.labor_exposure_v1(ws,w);
 if design_used+po_used+sub_used+labor_used>cap then
  raise exception 'work_economic_cap_exceeded' using errcode='23514'; end if;
 return new;
end; $$;
revoke all on function d5o_hosted.guard_combined_work_authority_v1() from public,anon,authenticated,service_role;
create trigger combined_labor_cap after insert on d5o_hosted.labor_reservations
 for each row execute function d5o_hosted.guard_combined_work_authority_v1();

create function public.d5o_labor_authority_read_v1(p_workspace_key text,p_presentation_id text)
 returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); ws uuid; w uuid; role_name text; source jsonb;
 parent d5o_hosted.purchase_authorities%rowtype; labor d5o_hosted.labor_authorities%rowtype;
 used bigint; design_used bigint; po_used bigint; sub_used bigint;
begin
 if current_setting('role',true)<>'authenticated' or actor is null then
  raise exception 'labor_scope_denied' using errcode='42501'; end if;
 select id into ws from d5o_hosted.workspaces where workspace_key=p_workspace_key and status='active';
 select role into role_name from d5o_hosted.memberships
  where workspace_id=ws and actor_user_id=actor and status='active';
 select work_id into w from d5o_hosted.work_identity_links
  where workspace_id=ws and presentation_id=p_presentation_id;
 if w is null or role_name not in ('admin','project_manager','operations_leader','billing_commercial_lead') then
  raise exception 'labor_scope_denied' using errcode='42501'; end if;
 source:=d5o_hosted.purchase_basis_v1(ws,w);
 select * into parent from d5o_hosted.purchase_authorities
  where workspace_id=ws and work_id=w and status='Approved'
   and source_digest=source->>'digest' and current_date between valid_from and valid_until
  order by created_at desc limit 1;
 select * into labor from d5o_hosted.labor_authorities
  where workspace_id=ws and work_id=w and status='Approved'
   and parent_authority_id=parent.id and source_digest=source->>'digest'
   and current_date between valid_from and valid_until
  order by created_at desc limit 1;
 used:=d5o_hosted.labor_exposure_v1(ws,w);
 select coalesce(sum(amount_minor),0) into design_used from d5o_hosted.design_spend_commitments
  where workspace_id=ws and work_id=w and status='Approved';
 select coalesce(sum(amount_minor),0) into po_used from d5o_hosted.purchase_reservations
  where workspace_id=ws and work_id=w and status='Reserved';
 select coalesce(sum(amount_minor),0) into sub_used from d5o_hosted.subcontract_reservations
  where workspace_id=ws and work_id=w;
 return pg_catalog.jsonb_build_object(
  'revision',coalesce((select revision from d5o_hosted.labor_authority_positions
    where workspace_id=ws and work_id=w),0),
  'source',source,'parentAuthorityId',parent.id,'parentCapMinor',parent.parent_cap_minor,
  'parentRemainingMinor',case when parent.id is null then null
    else parent.parent_cap_minor-design_used-po_used-sub_used-used end,
  'laborAuthorityId',labor.id,'laborCapMinor',labor.cap_minor,
  'laborRemainingMinor',case when labor.id is null then null else labor.cap_minor-used end,
  'laborExposureMinor',used,'designConsumedMinor',design_used,
  'purchaseConsumedMinor',po_used,'subcontractConsumedMinor',sub_used,
  'authorities',coalesce((select pg_catalog.jsonb_agg(to_jsonb(a) order by a.created_at)
    from d5o_hosted.labor_authorities a where a.workspace_id=ws and a.work_id=w),'[]'::jsonb),
  'reservations',coalesce((select pg_catalog.jsonb_agg(
    to_jsonb(r)||pg_catalog.jsonb_build_object(
     'reviewedHours',coalesce((select sum(a.reviewed_hours) from d5o_hosted.labor_actuals a
       where a.reservation_id=r.id),0),
     'incurredMinor',coalesce((select sum(a.amount_minor) from d5o_hosted.labor_actuals a
       where a.reservation_id=r.id),0))
    order by r.approved_at) from d5o_hosted.labor_reservations r
    where r.workspace_id=ws and r.work_id=w),'[]'::jsonb),
  'actuals',coalesce((select pg_catalog.jsonb_agg(to_jsonb(a) order by a.reviewed_at)
    from d5o_hosted.labor_actuals a where a.workspace_id=ws and a.work_id=w),'[]'::jsonb));
end; $$;
revoke all on function public.d5o_labor_authority_read_v1(text,text) from public,anon,service_role;
grant execute on function public.d5o_labor_authority_read_v1(text,text) to authenticated;

create function public.d5o_labor_authority_command_v1(
 p_workspace_key text,p_presentation_id text,p_action text,p_input jsonb,p_command_id text,
 p_expected_revision integer,p_expected_source_digest text) returns jsonb
 language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); ws d5o_hosted.workspaces%rowtype; member d5o_hosted.memberships%rowtype;
 work d5o_hosted.work_records%rowtype; parent d5o_hosted.purchase_authorities%rowtype;
 authority d5o_hosted.labor_authorities%rowtype; prior d5o_hosted.labor_authorities%rowtype;
 existing d5o_hosted.labor_authority_receipts%rowtype; source jsonb; fp text; result jsonb;
 rev integer; used bigint;
begin
 if current_setting('role',true)<>'authenticated' or actor is null
  or p_action not in ('prepare','approve','return','revoke')
  or pg_catalog.jsonb_typeof(p_input)<>'object'
  or length(coalesce(p_command_id,'')) not between 8 and 120
  or p_expected_revision is null or p_expected_revision<0 then
  raise exception 'invalid_labor_authority_command' using errcode='22023'; end if;
 select * into ws from d5o_hosted.workspaces where workspace_key=p_workspace_key and status='active';
 select * into member from d5o_hosted.memberships where workspace_id=ws.id
  and actor_user_id=actor and status='active' for share;
 select w.* into work from d5o_hosted.work_records w
  join d5o_hosted.work_identity_links l on l.workspace_id=w.workspace_id and l.work_id=w.id
  where w.workspace_id=ws.id and l.presentation_id=p_presentation_id for update of w;
 if member.id is null or work.id is null then raise exception 'labor_scope_denied' using errcode='42501'; end if;
 fp:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_workspace_key,p_presentation_id,p_action,p_input,
  p_expected_revision,p_expected_source_digest)::text);
 select * into existing from d5o_hosted.labor_authority_receipts
  where workspace_id=ws.id and command_id=p_command_id;
 if found then
  if existing.work_id<>work.id or existing.actor_user_id<>actor or existing.fingerprint<>fp then
   raise exception 'command_reuse_conflict' using errcode='23505'; end if;
  return existing.result;
 end if;
 insert into d5o_hosted.labor_authority_positions(workspace_id,work_id)
  values(ws.id,work.id) on conflict do nothing;
 select revision into rev from d5o_hosted.labor_authority_positions
  where workspace_id=ws.id and work_id=work.id for update;
 if rev<>p_expected_revision then raise exception 'stale_labor_authority_revision' using errcode='23505'; end if;
 source:=d5o_hosted.purchase_basis_v1(ws.id,work.id);
 if source is null or source->>'digest' is distinct from p_expected_source_digest then
  raise exception 'labor_authority_source_changed' using errcode='23514'; end if;
 select * into parent from d5o_hosted.purchase_authorities
  where workspace_id=ws.id and work_id=work.id and status='Approved'
   and source_digest=source->>'digest' and current_date between valid_from and valid_until
  order by created_at desc limit 1 for update;
 if parent.id is null then raise exception 'current_work_economic_authority_required' using errcode='23514'; end if;
 if p_action='prepare' then
  if member.role<>'project_manager' or work.created_by<>actor then
   raise exception 'labor_authority_preparer_required' using errcode='42501'; end if;
  if coalesce(p_input->>'capMinor','') !~ '^[1-9][0-9]*$'
   or coalesce(p_input->>'rateMinor','') !~ '^[1-9][0-9]*$'
   or coalesce(p_input->>'validFrom','') !~ '^\d{4}-\d{2}-\d{2}$'
   or coalesce(p_input->>'validUntil','') !~ '^\d{4}-\d{2}-\d{2}$'
   or length(trim(coalesce(p_input->>'rateVersion',''))) not between 4 and 120
   or length(trim(coalesce(p_input->>'rateSource',''))) not between 8 and 500
   or length(trim(coalesce(p_input->>'rateBasis',''))) not between 10 and 1000
   or length(trim(coalesce(p_input->>'scope',''))) not between 10 and 2000
   or length(trim(coalesce(p_input->>'conditions',''))) not between 10 and 2000 then
   raise exception 'labor_rate_and_scope_required' using errcode='22023'; end if;
  if (p_input->>'validFrom')::date>(p_input->>'validUntil')::date
   or (p_input->>'validUntil')::date<current_date
   or (p_input->>'capMinor')::bigint>parent.parent_cap_minor
   or (p_input->>'validFrom')::date<parent.valid_from
   or (p_input->>'validUntil')::date>parent.valid_until then
   raise exception 'labor_authority_cap_or_dates_invalid' using errcode='23514'; end if;
  if exists(select 1 from d5o_hosted.labor_authorities
   where workspace_id=ws.id and work_id=work.id and status='Approved') then
   raise exception 'active_labor_authority_exists' using errcode='23514'; end if;
  if p_input ? 'supersedesId' and nullif(p_input->>'supersedesId','') is not null then
   select * into prior from d5o_hosted.labor_authorities
    where id=(p_input->>'supersedesId')::uuid and workspace_id=ws.id and work_id=work.id;
   if prior.id is null or prior.status not in ('Returned','Revoked') then
    raise exception 'returned_or_revoked_labor_authority_required' using errcode='23514'; end if;
  end if;
  insert into d5o_hosted.labor_authorities(workspace_id,work_id,parent_authority_id,status,
   currency,cap_minor,rate_minor,rate_version,rate_source,rate_basis,scope,conditions,
   valid_from,valid_until,source_digest,prepared_by,supersedes_id)
   values(ws.id,work.id,parent.id,'Prepared','USD',(p_input->>'capMinor')::bigint,
    (p_input->>'rateMinor')::bigint,trim(p_input->>'rateVersion'),trim(p_input->>'rateSource'),
    trim(p_input->>'rateBasis'),trim(p_input->>'scope'),trim(p_input->>'conditions'),
    (p_input->>'validFrom')::date,(p_input->>'validUntil')::date,source->>'digest',actor,prior.id)
   returning * into authority;
 else
  if member.role<>'admin' then raise exception 'independent_labor_authority_required' using errcode='42501'; end if;
  select * into authority from d5o_hosted.labor_authorities
   where id=(p_input->>'authorityId')::uuid and workspace_id=ws.id and work_id=work.id for update;
  if authority.id is null or length(trim(coalesce(p_input->>'reason','')))<10 then
   raise exception 'labor_authority_and_reason_required' using errcode='23514'; end if;
  if p_action='revoke' then
   if authority.status<>'Approved' then raise exception 'approved_labor_authority_required' using errcode='23514'; end if;
  elsif authority.status<>'Prepared' or authority.prepared_by=actor then
   raise exception 'independent_labor_authority_required' using errcode='42501'; end if;
  if p_action='approve' then
   if authority.parent_authority_id<>parent.id or authority.source_digest<>source->>'digest'
    or current_date not between authority.valid_from and authority.valid_until then
    raise exception 'labor_authority_source_changed' using errcode='23514'; end if;
   if exists(select 1 from d5o_hosted.labor_authorities
     where workspace_id=ws.id and work_id=work.id and status='Approved') then
    raise exception 'active_labor_authority_exists' using errcode='23514'; end if;
   used:=d5o_hosted.labor_exposure_v1(ws.id,work.id);
   if used>authority.cap_minor then raise exception 'labor_sublimit_below_commitments' using errcode='23514'; end if;
  end if;
  update d5o_hosted.labor_authorities set
   status=case p_action when 'approve' then 'Approved' when 'return' then 'Returned' else 'Revoked' end,
   reviewed_by=actor,review_reason=trim(p_input->>'reason'),decided_at=now() where id=authority.id;
 end if;
 update d5o_hosted.labor_authority_positions set revision=revision+1
  where workspace_id=ws.id and work_id=work.id;
 insert into d5o_hosted.labor_authority_events(workspace_id,work_id,revision,action,command_id,
  actor_user_id,membership_id,subject_id,basis)
  values(ws.id,work.id,rev+1,p_action,p_command_id,actor,member.id,authority.id,
   pg_catalog.jsonb_build_object('input',p_input,'source',source,'parentAuthorityId',parent.id));
 result:=pg_catalog.jsonb_build_object('revision',rev+1,'subjectId',authority.id,
  'status',case p_action when 'prepare' then 'Prepared' when 'approve' then 'Approved'
   when 'return' then 'Returned' else 'Revoked' end);
 insert into d5o_hosted.labor_authority_receipts(workspace_id,command_id,work_id,
  actor_user_id,fingerprint,result) values(ws.id,p_command_id,work.id,actor,fp,result);
 return result;
end; $$;
revoke all on function public.d5o_labor_authority_command_v1(text,text,text,jsonb,text,integer,text)
 from public,anon,service_role;
grant execute on function public.d5o_labor_authority_command_v1(text,text,text,jsonb,text,integer,text)
 to authenticated;

-- Preserve the existing eligibility, release, revision and worker-response
-- function. Wrap only draft-hour capture and the publication commitment point.
alter function public.d5o_hosted_crew_command_v1(text,text,jsonb,text,integer)
 rename to d5o_hosted_crew_command_pre_labor_v1;
revoke all on function public.d5o_hosted_crew_command_pre_labor_v1(text,text,jsonb,text,integer)
 from public,anon,authenticated,service_role;
create function public.d5o_hosted_crew_command_v1(
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

-- A reviewed field report is the cost source. Overrun is recorded truthfully
-- even when the resulting Work exposure exceeds the approved cap.
create function d5o_hosted.capture_reviewed_labor_v1() returns trigger
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
  -- Legacy reports and bookings remain valid operational facts; they do not
  -- acquire a fabricated rate or incurred cost.
  if reservation.id is null then continue; end if;
  amount:=pg_catalog.round(hours*reservation.rate_minor)::bigint;
  if amount<=0 then raise exception 'reviewed_labor_cost_invalid' using errcode='23514'; end if;
  insert into d5o_hosted.connected_job_costs(workspace_id,work_id,package_id,kind,
   category,amount_minor,cost_date,source,recorded_by)
   values(new.workspace_id,new.work_id,report_item->>'packageId','Incurred',
    'Labor',amount,(report_item->>'date')::date,
    'Reviewed field report '||report_item->>'id'||' revision '||report_item->>'revision',
    reviewer) returning id into cost_id;
  insert into d5o_hosted.labor_actuals(workspace_id,work_id,reservation_id,
   report_id,report_revision,reviewed_hours,rate_minor,amount_minor,cost_id,reviewed_by)
   values(new.workspace_id,new.work_id,reservation.id,report_item->>'id',
    (report_item->>'revision')::integer,hours,reservation.rate_minor,amount,cost_id,reviewer);
 end loop;
 return new;
end; $$;
revoke all on function d5o_hosted.capture_reviewed_labor_v1() from public,anon,authenticated,service_role;
create trigger capture_reviewed_labor after update on d5o_hosted.connected_deploy_states
 for each row when (old.state is distinct from new.state)
 execute function d5o_hosted.capture_reviewed_labor_v1();

-- Keep the existing invoice/forecast projection and add exact labor economics
-- only for its already-authorized non-worker readership.
alter function public.d5o_hosted_job_finance_read_v1(text,text)
 rename to d5o_hosted_job_finance_read_pre_labor_v1;
revoke all on function public.d5o_hosted_job_finance_read_pre_labor_v1(text,text)
 from public,anon,authenticated,service_role;
create function public.d5o_hosted_job_finance_read_v1(p_workspace_key text,p_presentation_id text)
 returns jsonb language plpgsql stable security definer set search_path='' as $$
declare base jsonb; ws uuid; w uuid;
begin
 base:=public.d5o_hosted_job_finance_read_pre_labor_v1(p_workspace_key,p_presentation_id);
 select id into ws from d5o_hosted.workspaces where workspace_key=p_workspace_key and status='active';
 select work_id into w from d5o_hosted.work_identity_links
  where workspace_id=ws and presentation_id=p_presentation_id;
 return base||pg_catalog.jsonb_build_object(
  'laborReservations',coalesce((select pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
     'id',r.id,'packageId',r.package_id,'person',r.person,
     'workDate',r.work_date,'publicationId',r.publication_id,
     'authorizedHours',r.authorized_hours,'rateVersion',
      (select rate_version from d5o_hosted.labor_authorities a where a.id=r.labor_authority_id),
     'reservedMinor',r.amount_minor,'status',r.status,
     'actualHours',coalesce((select sum(a.reviewed_hours) from d5o_hosted.labor_actuals a
       where a.reservation_id=r.id),0),
     'incurredMinor',coalesce((select sum(a.amount_minor) from d5o_hosted.labor_actuals a
       where a.reservation_id=r.id),0))
    order by r.approved_at) from d5o_hosted.labor_reservations r
    where r.workspace_id=ws and r.work_id=w),'[]'::jsonb));
end; $$;
revoke all on function public.d5o_hosted_job_finance_read_v1(text,text)
 from public,anon,service_role;
grant execute on function public.d5o_hosted_job_finance_read_v1(text,text) to authenticated;

-- Reviewed booked labor is sourced by the field-report review and posted once
-- by capture_reviewed_labor_v1. A second manual Labor cost against a Work
-- with governed labor authority would duplicate that fact.
alter function public.d5o_hosted_job_finance_command_v1(text,text,text,jsonb,text,integer)
 rename to d5o_hosted_job_finance_command_pre_labor_v1;
revoke all on function public.d5o_hosted_job_finance_command_pre_labor_v1(text,text,text,jsonb,text,integer)
 from public,anon,authenticated,service_role;
create function public.d5o_hosted_job_finance_command_v1(
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

create function public.d5o_labor_authority_actions_v1(p_workspace_key text) returns jsonb
 language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); ws uuid; role_name text; item record; source jsonb;
 parent d5o_hosted.purchase_authorities%rowtype;
 approved d5o_hosted.labor_authorities%rowtype; pending d5o_hosted.labor_authorities%rowtype;
 actions jsonb:='[]'::jsonb;
begin
 if current_setting('role',true)<>'authenticated' or actor is null then
  raise exception 'workspace_forbidden' using errcode='42501'; end if;
 select id into ws from d5o_hosted.workspaces where workspace_key=p_workspace_key and status='active';
 select role into role_name from d5o_hosted.memberships
  where workspace_id=ws and actor_user_id=actor and status='active';
 if role_name is null then raise exception 'workspace_forbidden' using errcode='42501'; end if;
 if role_name not in ('admin','project_manager') then return actions; end if;
 for item in select w.id,w.title,w.created_by,l.presentation_id,coalesce(p.revision,0) revision
  from d5o_hosted.work_records w
  join d5o_hosted.work_identity_links l on l.workspace_id=w.workspace_id and l.work_id=w.id
  left join d5o_hosted.labor_authority_positions p on p.workspace_id=w.workspace_id and p.work_id=w.id
  where w.workspace_id=ws loop
  source:=d5o_hosted.purchase_basis_v1(ws,item.id);
  if source is null then continue; end if;
  select * into parent from d5o_hosted.purchase_authorities
   where workspace_id=ws and work_id=item.id and status='Approved'
    and source_digest=source->>'digest' and current_date between valid_from and valid_until
   order by created_at desc limit 1;
  if parent.id is null then continue; end if;
  select * into approved from d5o_hosted.labor_authorities
   where workspace_id=ws and work_id=item.id and status='Approved'
    and parent_authority_id=parent.id and source_digest=source->>'digest'
    and current_date between valid_from and valid_until
   order by created_at desc limit 1;
  select * into pending from d5o_hosted.labor_authorities
   where workspace_id=ws and work_id=item.id and status='Prepared'
    and parent_authority_id=parent.id and source_digest=source->>'digest'
   order by created_at desc limit 1;
  if pending.id is not null and role_name='admin' and pending.prepared_by<>actor then
   actions:=actions||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'kind','Review field labor authority','phase','Labor','focus','review',
    'workId',item.presentation_id,'workTitle',item.title,'revision',item.revision,
    'decisionId',pending.id,'status','Prepared','dueDate',pending.valid_until,
    'ownership','Independent workspace administrator',
    'blocker','Review the Work and labor caps, rate source, scope, conditions and expiry.'));
  elsif approved.id is null and pending.id is null and role_name='project_manager' and item.created_by=actor then
   actions:=actions||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'kind','Prepare field labor authority','phase','Labor','focus','prepare',
    'workId',item.presentation_id,'workTitle',item.title,'revision',item.revision,
    'status','Preparation','position','preparation','ownership','Assigned project manager',
    'blocker','Published worker assignments require a reviewed rate and labor allocation. Draft booking remains available.'));
  end if;
 end loop;
 return actions;
end; $$;
revoke all on function public.d5o_labor_authority_actions_v1(text) from public,anon,service_role;
grant execute on function public.d5o_labor_authority_actions_v1(text) to authenticated;



