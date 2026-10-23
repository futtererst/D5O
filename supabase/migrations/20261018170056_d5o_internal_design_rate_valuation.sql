-- Finance-owned internal Design cost rates and server-valued effort claims.
-- This schedule is internal cost only. It does not alter customer ROM pricing.
create table d5o_hosted.design_internal_rate_positions (
 workspace_id uuid primary key references d5o_hosted.workspaces(id), revision integer not null default 0
);
create table d5o_hosted.design_internal_rates (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references d5o_hosted.workspaces(id),
 rate_key text not null check(rate_key ~ '^[a-z][a-z0-9_-]{2,39}$'),
 status text not null check(status in ('Prepared','Approved','Returned','Retired')),
 currency text not null check(currency='USD'), base_rate_minor bigint not null check(base_rate_minor>0),
 burden_basis_points integer not null check(burden_basis_points between 0 and 10000),
 effective_from date not null, effective_until date not null check(effective_until>=effective_from),
 source_reference text not null check(length(trim(source_reference))>=8),
 basis_note text not null check(length(trim(basis_note))>=10),
 prepared_by uuid not null references auth.users(id), reviewed_by uuid references auth.users(id),
 review_note text, created_at timestamptz not null default now(), decided_at timestamptz
);
create index design_internal_rates_scope on d5o_hosted.design_internal_rates(workspace_id,rate_key,effective_from,effective_until);
create table d5o_hosted.design_internal_rate_events (
 workspace_id uuid not null, revision integer not null, command_id text not null, action text not null,
 actor_user_id uuid not null references auth.users(id), membership_id uuid not null references d5o_hosted.memberships(id),
 rate_id uuid not null references d5o_hosted.design_internal_rates(id), basis jsonb not null,
 occurred_at timestamptz not null default now(), primary key(workspace_id,revision), unique(workspace_id,command_id)
);
create table d5o_hosted.design_internal_rate_receipts (
 workspace_id uuid not null, command_id text not null, actor_user_id uuid not null references auth.users(id),
 fingerprint text not null, result jsonb not null, primary key(workspace_id,command_id)
);
create table d5o_hosted.design_cost_rate_basis (
 claim_id uuid primary key references d5o_hosted.design_cost_claims(id),
 workspace_id uuid not null references d5o_hosted.workspaces(id), work_id uuid not null,
 rate_id uuid not null references d5o_hosted.design_internal_rates(id), rate_revision integer not null,
 person_hours_hundredths bigint not null check(person_hours_hundredths>0),
 base_rate_minor bigint not null check(base_rate_minor>0),
 burden_basis_points integer not null check(burden_basis_points between 0 and 10000),
 calculated_minor bigint not null check(calculated_minor>0), currency text not null check(currency='USD'),
 foreign key(work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id)
);
create index design_cost_rate_basis_work on d5o_hosted.design_cost_rate_basis(workspace_id,work_id);
alter table d5o_hosted.design_internal_rate_positions enable row level security;
alter table d5o_hosted.design_internal_rates enable row level security;
alter table d5o_hosted.design_internal_rate_events enable row level security;
alter table d5o_hosted.design_internal_rate_receipts enable row level security;
alter table d5o_hosted.design_cost_rate_basis enable row level security;
revoke all on d5o_hosted.design_internal_rate_positions,d5o_hosted.design_internal_rates,
 d5o_hosted.design_internal_rate_events,d5o_hosted.design_internal_rate_receipts,
 d5o_hosted.design_cost_rate_basis from public,anon,authenticated,service_role;

create function public.d5o_design_internal_rate_read_v1(p_workspace_key text) returns jsonb
 language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); ws uuid; role_name text;
begin
 if current_setting('role',true)<>'authenticated' or actor is null then
  raise exception 'workspace_forbidden' using errcode='42501'; end if;
 select id into ws from d5o_hosted.workspaces where workspace_key=p_workspace_key and status='active';
 select role into role_name from d5o_hosted.memberships where workspace_id=ws and actor_user_id=actor and status='active';
 if role_name is null or role_name not in ('admin','project_manager','billing_commercial_lead') then
  raise exception 'internal_rate_scope_denied' using errcode='42501'; end if;
 return pg_catalog.jsonb_build_object(
  'revision',coalesce((select revision from d5o_hosted.design_internal_rate_positions where workspace_id=ws),0),
  'rates',coalesce((select pg_catalog.jsonb_agg(to_jsonb(r) order by r.created_at)
   from d5o_hosted.design_internal_rates r where r.workspace_id=ws
    and (role_name<>'project_manager' or r.status='Approved')),'[]'::jsonb));
end; $$;
revoke all on function public.d5o_design_internal_rate_read_v1(text) from public,anon,service_role;
grant execute on function public.d5o_design_internal_rate_read_v1(text) to authenticated;

create function public.d5o_design_internal_rate_command_v1(
 p_workspace_key text,p_action text,p_input jsonb,p_command_id text,p_expected_revision integer) returns jsonb
 language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); ws uuid; member d5o_hosted.memberships%rowtype;
 pos d5o_hosted.design_internal_rate_positions%rowtype; rate d5o_hosted.design_internal_rates%rowtype;
 receipt d5o_hosted.design_internal_rate_receipts%rowtype; fp text; result jsonb;
begin
 if current_setting('role',true)<>'authenticated' or actor is null
  or p_action not in ('prepare','approve','return','retire') or pg_catalog.jsonb_typeof(p_input)<>'object'
  or length(coalesce(p_command_id,'')) not between 8 and 120 or p_expected_revision is null or p_expected_revision<0
  then raise exception 'invalid_internal_rate_command' using errcode='22023'; end if;
 select id into ws from d5o_hosted.workspaces where workspace_key=p_workspace_key and status='active';
 select * into member from d5o_hosted.memberships where workspace_id=ws and actor_user_id=actor and status='active' for share;
 if member.id is null then raise exception 'workspace_forbidden' using errcode='42501'; end if;
 fp:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_workspace_key,p_action,p_input,p_expected_revision)::text);
 select * into receipt from d5o_hosted.design_internal_rate_receipts where workspace_id=ws and command_id=p_command_id;
 if found then
  if receipt.actor_user_id<>actor or receipt.fingerprint<>fp then raise exception 'command_reuse_conflict' using errcode='23505'; end if;
  return receipt.result; end if;
 insert into d5o_hosted.design_internal_rate_positions(workspace_id) values(ws) on conflict do nothing;
 select * into pos from d5o_hosted.design_internal_rate_positions where workspace_id=ws for update;
 if pos.revision<>p_expected_revision then raise exception 'stale_internal_rate_revision' using errcode='23505'; end if;
 if p_action='prepare' then
  if member.role<>'billing_commercial_lead' then raise exception 'finance_rate_preparer_required' using errcode='42501'; end if;
  if coalesce(p_input->>'rateKey','') !~ '^[a-z][a-z0-9_-]{2,39}$'
   or coalesce(p_input->>'baseRateMinor','') !~ '^[1-9][0-9]*$'
   or coalesce(p_input->>'burdenBasisPoints','') !~ '^(0|[1-9][0-9]*)$'
   or coalesce(p_input->>'effectiveFrom','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
   or coalesce(p_input->>'effectiveUntil','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
   or length(trim(coalesce(p_input->>'sourceReference','')))<8
   or length(trim(coalesce(p_input->>'basisNote','')))<10 then
   raise exception 'internal_rate_basis_required' using errcode='22023'; end if;
  if (p_input->>'baseRateMinor')::bigint>100000000 or (p_input->>'burdenBasisPoints')::integer>10000
   or (p_input->>'effectiveFrom')::date>(p_input->>'effectiveUntil')::date
   or (p_input->>'effectiveUntil')::date<current_date then
   raise exception 'internal_rate_basis_invalid' using errcode='23514'; end if;
  insert into d5o_hosted.design_internal_rates(workspace_id,rate_key,status,currency,base_rate_minor,
   burden_basis_points,effective_from,effective_until,source_reference,basis_note,prepared_by)
   values(ws,p_input->>'rateKey','Prepared','USD',(p_input->>'baseRateMinor')::bigint,
    (p_input->>'burdenBasisPoints')::integer,(p_input->>'effectiveFrom')::date,
    (p_input->>'effectiveUntil')::date,trim(p_input->>'sourceReference'),trim(p_input->>'basisNote'),actor)
   returning * into rate;
 else
  if member.role<>'admin' then raise exception 'independent_internal_rate_reviewer_required' using errcode='42501'; end if;
  if coalesce(p_input->>'rateId','') !~ '^[0-9a-fA-F-]{36}$' or length(trim(coalesce(p_input->>'reason','')))<10 then
   raise exception 'internal_rate_decision_basis_required' using errcode='22023'; end if;
  select * into rate from d5o_hosted.design_internal_rates where id=(p_input->>'rateId')::uuid
   and workspace_id=ws for update;
  if rate.id is null then raise exception 'internal_rate_missing' using errcode='23514'; end if;
  if p_action='retire' then
   if rate.status<>'Approved' then raise exception 'approved_internal_rate_required' using errcode='23514'; end if;
  elsif rate.status<>'Prepared' or rate.prepared_by=actor then
   raise exception 'independent_internal_rate_reviewer_required' using errcode='42501'; end if;
  if p_action='approve' then
   if rate.effective_until<current_date or exists(select 1 from d5o_hosted.design_internal_rates x
     where x.workspace_id=ws and x.rate_key=rate.rate_key and x.currency=rate.currency
      and x.status='Approved' and x.id<>rate.id
      and x.effective_from<=rate.effective_until and x.effective_until>=rate.effective_from) then
    raise exception 'overlapping_or_expired_internal_rate' using errcode='23514'; end if;
  end if;
  update d5o_hosted.design_internal_rates set
   status=case p_action when 'approve' then 'Approved' when 'return' then 'Returned' else 'Retired' end,
   reviewed_by=actor,review_note=trim(p_input->>'reason'),decided_at=now() where id=rate.id;
 end if;
 update d5o_hosted.design_internal_rate_positions set revision=revision+1 where workspace_id=ws;
 result:=pg_catalog.jsonb_build_object('revision',pos.revision+1,'rateId',rate.id,
  'status',case p_action when 'prepare' then 'Prepared' when 'approve' then 'Approved'
   when 'return' then 'Returned' else 'Retired' end);
 insert into d5o_hosted.design_internal_rate_events(workspace_id,revision,command_id,action,actor_user_id,membership_id,rate_id,basis)
  values(ws,pos.revision+1,p_command_id,p_action,actor,member.id,rate.id,
   pg_catalog.jsonb_build_object('input',p_input,'rate',to_jsonb(rate)));
 insert into d5o_hosted.design_internal_rate_receipts(workspace_id,command_id,actor_user_id,fingerprint,result)
  values(ws,p_command_id,actor,fp,result);
 return result;
end; $$;
revoke all on function public.d5o_design_internal_rate_command_v1(text,text,jsonb,text,integer) from public,anon,service_role;
grant execute on function public.d5o_design_internal_rate_command_v1(text,text,jsonb,text,integer) to authenticated;

-- A rated claim retains its exact rate snapshot in the outlook basis. Published
-- rate changes do not revalue historical reviewed costs.
create or replace function d5o_hosted.outlook_source_v1(p_ws uuid,p_work uuid) returns jsonb
 language plpgsql stable security definer set search_path='' as $$
declare b jsonb; f d5o_hosted.connected_job_finance_states%rowtype;
begin
 select * into f from d5o_hosted.connected_job_finance_states where workspace_id=p_ws and work_id=p_work;
 b:=pg_catalog.jsonb_build_object(
  'work',(select to_jsonb(w) from d5o_hosted.work_records w where w.workspace_id=p_ws and w.id=p_work),
  'define',(select to_jsonb(x) from d5o_hosted.connected_define_states x where x.workspace_id=p_ws and x.work_id=p_work),
  'design',(select to_jsonb(x) from d5o_hosted.connected_design_states x where x.workspace_id=p_ws and x.work_id=p_work),
  'deploy',(select pg_catalog.md5(x.state::text) from d5o_hosted.connected_deploy_states x where x.workspace_id=p_ws and x.work_id=p_work),
  'designSpend',(select coalesce(pg_catalog.jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from d5o_hosted.design_spend_commitments x where x.workspace_id=p_ws and x.work_id=p_work),
  'designCosts',(select coalesce(pg_catalog.jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from d5o_hosted.design_cost_claims x where x.workspace_id=p_ws and x.work_id=p_work),
  'designRateBasis',(select coalesce(pg_catalog.jsonb_agg(to_jsonb(x) order by x.claim_id),'[]'::jsonb) from d5o_hosted.design_cost_rate_basis x where x.workspace_id=p_ws and x.work_id=p_work),
  'financeCosts',(select coalesce(pg_catalog.jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from d5o_hosted.connected_job_costs x where x.workspace_id=p_ws and x.work_id=p_work),
  'purchase',(select to_jsonb(x) from d5o_hosted.graybar_states x where x.workspace_id=p_ws and x.work_id=p_work),
  'purchaseReservations',(select coalesce(pg_catalog.jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from d5o_hosted.purchase_reservations x where x.workspace_id=p_ws and x.work_id=p_work),
  'subcontract',(select to_jsonb(x) from d5o_hosted.subcontract_states x where x.workspace_id=p_ws and x.work_id=p_work),
  'subcontractReservations',(select coalesce(pg_catalog.jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from d5o_hosted.subcontract_reservations x where x.workspace_id=p_ws and x.work_id=p_work),
  'laborReservations',(select coalesce(pg_catalog.jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from d5o_hosted.labor_reservations x where x.workspace_id=p_ws and x.work_id=p_work),
  'laborActuals',(select coalesce(pg_catalog.jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from d5o_hosted.labor_actuals x where x.workspace_id=p_ws and x.work_id=p_work),
  'forecast',pg_catalog.jsonb_build_object('revision',f.revision,'amount',f.remaining_forecast_minor,'source',f.forecast_source,'at',f.forecast_at));
 return pg_catalog.jsonb_build_object('digest',pg_catalog.md5(b::text),'basis',b);
end; $$;
revoke all on function d5o_hosted.outlook_source_v1(uuid,uuid) from public,anon,authenticated,service_role;

alter function public.d5o_hosted_design_cost_read_v1(text,text) rename to d5o_hosted_design_cost_read_pre_rate_v1;
revoke all on function public.d5o_hosted_design_cost_read_pre_rate_v1(text,text) from public,anon,authenticated,service_role;
create function public.d5o_hosted_design_cost_read_v1(p_workspace_key text,p_presentation_id text) returns jsonb
 language plpgsql stable security definer set search_path='' as $$
declare base jsonb; ws uuid; w uuid;
begin
 base:=public.d5o_hosted_design_cost_read_pre_rate_v1(p_workspace_key,p_presentation_id);
 select id into ws from d5o_hosted.workspaces where workspace_key=p_workspace_key and status='active';
 select work_id into w from d5o_hosted.work_identity_links where workspace_id=ws and presentation_id=p_presentation_id;
 return base||pg_catalog.jsonb_build_object('ratedBases',coalesce((select pg_catalog.jsonb_agg(to_jsonb(x) order by x.claim_id)
  from d5o_hosted.design_cost_rate_basis x where x.workspace_id=ws and x.work_id=w),'[]'::jsonb));
end; $$;
revoke all on function public.d5o_hosted_design_cost_read_v1(text,text) from public,anon,service_role;
grant execute on function public.d5o_hosted_design_cost_read_v1(text,text) to authenticated;

-- Intercept only rated preparation. All historical manual/external-source
-- commands and Finance review retain their installed implementation.
alter function public.d5o_hosted_design_cost_command_v1(text,text,text,jsonb,text,integer,text)
 rename to d5o_hosted_design_cost_command_pre_rate_v1;
revoke all on function public.d5o_hosted_design_cost_command_pre_rate_v1(text,text,text,jsonb,text,integer,text)
 from public,anon,authenticated,service_role;
create function public.d5o_hosted_design_cost_command_v1(
 p_workspace_key text,p_presentation_id text,p_action text,p_input jsonb,p_command_id text,
 p_expected_revision integer,p_expected_source_digest text) returns jsonb
 language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); ws uuid; member d5o_hosted.memberships%rowtype;
 work d5o_hosted.work_records%rowtype; pos d5o_hosted.design_cost_positions%rowtype;
 commitment d5o_hosted.design_spend_commitments%rowtype; rate d5o_hosted.design_internal_rates%rowtype;
 prior d5o_hosted.design_cost_claims%rowtype; claim d5o_hosted.design_cost_claims%rowtype;
 receipt d5o_hosted.design_cost_receipts%rowtype; src jsonb; fp text; result jsonb;
 rate_revision integer; hours_hundredths bigint; amount bigint;
begin
 if p_action<>'prepare-rated-cost' then
  return public.d5o_hosted_design_cost_command_pre_rate_v1(p_workspace_key,p_presentation_id,
   p_action,p_input,p_command_id,p_expected_revision,p_expected_source_digest); end if;
 if current_setting('role',true)<>'authenticated' or actor is null
  or pg_catalog.jsonb_typeof(p_input)<>'object' or length(coalesce(p_command_id,'')) not between 8 and 120
  or p_expected_revision is null or p_expected_revision<0 then
  raise exception 'invalid_design_cost_command' using errcode='22023'; end if;
 select id into ws from d5o_hosted.workspaces where workspace_key=p_workspace_key and status='active';
 select * into member from d5o_hosted.memberships where workspace_id=ws and actor_user_id=actor and status='active' for share;
 if member.id is null then raise exception 'workspace_forbidden' using errcode='42501'; end if;
 select x.* into work from d5o_hosted.work_records x join d5o_hosted.work_identity_links l
  on l.workspace_id=x.workspace_id and l.work_id=x.id
  where x.workspace_id=ws and l.presentation_id=p_presentation_id for update of x;
 if work.id is null or member.role<>'project_manager' or work.created_by<>actor then
  raise exception 'assigned_pm_required' using errcode='42501'; end if;
 fp:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_workspace_key,p_presentation_id,p_action,p_input,p_expected_revision,p_expected_source_digest)::text);
 select * into receipt from d5o_hosted.design_cost_receipts where workspace_id=ws and command_id=p_command_id;
 if found then
  if receipt.work_id<>work.id or receipt.actor_user_id<>actor or receipt.fingerprint<>fp then
   raise exception 'command_reuse_conflict' using errcode='23505'; end if;
  return receipt.result; end if;
 insert into d5o_hosted.design_cost_positions(workspace_id,work_id) values(ws,work.id) on conflict do nothing;
 select * into pos from d5o_hosted.design_cost_positions where workspace_id=ws and work_id=work.id for update;
 if pos.revision<>p_expected_revision then raise exception 'stale_design_cost_revision' using errcode='23505'; end if;
 src:=d5o_hosted.outlook_source_v1(ws,work.id);
 if src->>'digest' is distinct from p_expected_source_digest then raise exception 'outlook_source_changed' using errcode='23514'; end if;
 if coalesce(p_input->>'commitmentId','') !~ '^[0-9a-fA-F-]{36}$'
  or coalesce(p_input->>'rateId','') !~ '^[0-9a-fA-F-]{36}$'
  or coalesce(p_input->>'hoursHundredths','') !~ '^[1-9][0-9]*$'
  or coalesce(p_input->>'rateRevision','') !~ '^(0|[1-9][0-9]*)$'
  or coalesce(p_input->>'costDate','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or length(trim(coalesce(p_input->>'sourceReference','')))<8
  or length(trim(coalesce(p_input->>'evidenceNote','')))<10
  or p_input ? 'amountMinor' then raise exception 'rated_design_cost_basis_required' using errcode='22023'; end if;
 hours_hundredths:=(p_input->>'hoursHundredths')::bigint;
 rate_revision:=(p_input->>'rateRevision')::integer;
 if hours_hundredths>100000 or (p_input->>'costDate')::date>current_date then
  raise exception 'rated_design_cost_hours_or_date_invalid' using errcode='23514'; end if;
 select * into commitment from d5o_hosted.design_spend_commitments where id=(p_input->>'commitmentId')::uuid
  and workspace_id=ws and work_id=work.id and status='Approved';
 if commitment.id is null or not exists(select 1 from d5o_hosted.design_cost_links l
  where l.commitment_id=commitment.id and l.workspace_id=ws and l.work_id=work.id) then
  raise exception 'linked_design_commitment_required' using errcode='23514'; end if;
 select revision into rate_revision from d5o_hosted.design_internal_rate_positions where workspace_id=ws;
 if rate_revision is distinct from (p_input->>'rateRevision')::integer then
  raise exception 'stale_internal_rate_revision' using errcode='23505'; end if;
 select * into rate from d5o_hosted.design_internal_rates where id=(p_input->>'rateId')::uuid
  and workspace_id=ws and status='Approved' and currency=commitment.currency
  and (p_input->>'costDate')::date between effective_from and effective_until;
 if rate.id is null then raise exception 'approved_effective_internal_rate_required' using errcode='23514'; end if;
 amount:=pg_catalog.round(hours_hundredths::numeric*rate.base_rate_minor::numeric*
  (10000+rate.burden_basis_points)::numeric/1000000,0)::bigint;
 if amount<1 or amount>1000000000000 then raise exception 'rated_design_cost_amount_invalid' using errcode='23514'; end if;
 if p_input ? 'supersedesId' then
  if coalesce(p_input->>'supersedesId','') !~ '^[0-9a-fA-F-]{36}$' then
   raise exception 'current_reviewed_cost_required' using errcode='22023'; end if;
  select * into prior from d5o_hosted.design_cost_claims where id=(p_input->>'supersedesId')::uuid
   and workspace_id=ws and work_id=work.id and commitment_id=commitment.id and status='Reviewed';
  if prior.id is null or exists(select 1 from d5o_hosted.design_cost_claims x
   where x.supersedes_id=prior.id and x.status='Reviewed') then
   raise exception 'current_reviewed_cost_required' using errcode='23514'; end if;
 end if;
 if exists(select 1 from d5o_hosted.design_cost_claims x where x.workspace_id=ws and x.work_id=work.id
  and x.status in ('Prepared','Reviewed') and x.commitment_id=commitment.id
  and x.source_reference=trim(p_input->>'sourceReference') and (prior.id is null or x.id<>prior.id)) then
  raise exception 'duplicate_design_cost_source' using errcode='23505'; end if;
 insert into d5o_hosted.design_cost_claims(id,workspace_id,work_id,commitment_id,root_id,supersedes_id,status,
  amount_minor,currency,cost_date,source_reference,evidence_note,prepared_by)
  values(gen_random_uuid(),ws,work.id,commitment.id,coalesce(prior.root_id,gen_random_uuid()),prior.id,'Prepared',
   amount,'USD',(p_input->>'costDate')::date,trim(p_input->>'sourceReference'),trim(p_input->>'evidenceNote'),actor)
  returning * into claim;
 if prior.id is null then update d5o_hosted.design_cost_claims set root_id=claim.id where id=claim.id; end if;
 insert into d5o_hosted.design_cost_rate_basis(claim_id,workspace_id,work_id,rate_id,rate_revision,
  person_hours_hundredths,base_rate_minor,burden_basis_points,calculated_minor,currency)
  values(claim.id,ws,work.id,rate.id,rate_revision,hours_hundredths,rate.base_rate_minor,
   rate.burden_basis_points,amount,'USD');
 update d5o_hosted.design_cost_positions set revision=revision+1 where workspace_id=ws and work_id=work.id;
 result:=pg_catalog.jsonb_build_object('revision',pos.revision+1,'subjectId',claim.id,
  'action',p_action,'amountMinor',amount,'rateId',rate.id);
 insert into d5o_hosted.design_cost_events(workspace_id,work_id,revision,action,command_id,
  actor_user_id,membership_id,subject_id,basis)
  values(ws,work.id,pos.revision+1,p_action,p_command_id,actor,member.id,claim.id,
   pg_catalog.jsonb_build_object('input',p_input,'sourceDigest',src->>'digest','ratedAmountMinor',amount,'rateId',rate.id));
 insert into d5o_hosted.design_cost_receipts(workspace_id,command_id,work_id,actor_user_id,fingerprint,result)
  values(ws,p_command_id,work.id,actor,fp,result);
 return result;
end; $$;
revoke all on function public.d5o_hosted_design_cost_command_v1(text,text,text,jsonb,text,integer,text) from public,anon,service_role;
grant execute on function public.d5o_hosted_design_cost_command_v1(text,text,text,jsonb,text,integer,text) to authenticated;
