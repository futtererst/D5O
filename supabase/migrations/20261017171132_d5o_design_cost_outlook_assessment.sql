-- Design actuals and outlook reviews are separate from spending permission.
-- No historical Design commitment is linked or realized by this migration.
alter table d5o_hosted.connected_job_costs drop constraint connected_job_costs_category_check;
alter table d5o_hosted.connected_job_costs add constraint connected_job_costs_category_check
 check(category in ('Design','Labor','Material','Equipment','Subcontract'));

create table d5o_hosted.design_cost_positions (
 workspace_id uuid not null, work_id uuid not null, revision integer not null default 0,
 primary key(workspace_id,work_id),
 foreign key(work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id));
create table d5o_hosted.design_cost_links (
 commitment_id uuid primary key references d5o_hosted.design_spend_commitments(id),
 workspace_id uuid not null, work_id uuid not null,
 ledger_cost_id uuid not null unique references d5o_hosted.connected_job_costs(id),
 linked_by uuid not null references auth.users(id), linked_at timestamptz not null default now(),
 foreign key(work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id));
create table d5o_hosted.design_cost_claims (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null, work_id uuid not null,
 commitment_id uuid not null references d5o_hosted.design_spend_commitments(id),
 root_id uuid not null, supersedes_id uuid references d5o_hosted.design_cost_claims(id),
 status text not null check(status in ('Prepared','Reviewed','Returned')),
 amount_minor bigint not null check(amount_minor>0 and amount_minor<=1000000000000),
 currency text not null check(currency='USD'), cost_date date not null,
 source_reference text not null check(length(trim(source_reference))>=8),
 evidence_note text not null check(length(trim(evidence_note))>=10),
 prepared_by uuid not null references auth.users(id), reviewed_by uuid references auth.users(id),
 review_note text, created_at timestamptz not null default now(), reviewed_at timestamptz,
 foreign key(work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id));
create index design_cost_claims_work on d5o_hosted.design_cost_claims(workspace_id,work_id,commitment_id);
create unique index design_cost_claims_one_successor on d5o_hosted.design_cost_claims(supersedes_id)
 where supersedes_id is not null and status='Reviewed';
create table d5o_hosted.outlook_assessments (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null, work_id uuid not null,
 status text not null check(status in ('Prepared','Complete','Reviewed with gaps','Returned')),
 source_digest text not null, source_basis jsonb not null,
 actual_cutoff date not null, category_basis jsonb not null,
 limitations text not null, source_reference text not null,
 prepared_by uuid not null references auth.users(id), reviewed_by uuid references auth.users(id),
 review_note text, created_at timestamptz not null default now(), reviewed_at timestamptz,
 foreign key(work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id));
create index outlook_assessments_work on d5o_hosted.outlook_assessments(workspace_id,work_id,created_at);
create table d5o_hosted.design_cost_events (
 workspace_id uuid not null,work_id uuid not null,revision integer not null,
 action text not null,command_id text not null,actor_user_id uuid not null references auth.users(id),
 membership_id uuid not null references d5o_hosted.memberships(id),subject_id uuid not null,
 basis jsonb not null,occurred_at timestamptz not null default now(),
 primary key(workspace_id,work_id,revision),unique(workspace_id,command_id));
create table d5o_hosted.design_cost_receipts (
 workspace_id uuid not null,command_id text not null,work_id uuid not null,
 actor_user_id uuid not null references auth.users(id),fingerprint text not null,result jsonb not null,
 primary key(workspace_id,command_id));
alter table d5o_hosted.design_cost_positions enable row level security;
alter table d5o_hosted.design_cost_links enable row level security;
alter table d5o_hosted.design_cost_claims enable row level security;
alter table d5o_hosted.outlook_assessments enable row level security;
alter table d5o_hosted.design_cost_events enable row level security;
alter table d5o_hosted.design_cost_receipts enable row level security;
revoke all on d5o_hosted.design_cost_positions,d5o_hosted.design_cost_links,
 d5o_hosted.design_cost_claims,d5o_hosted.outlook_assessments,
 d5o_hosted.design_cost_events,d5o_hosted.design_cost_receipts
 from public,anon,authenticated,service_role;

create function d5o_hosted.outlook_source_v1(p_ws uuid,p_work uuid) returns jsonb
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

create function public.d5o_hosted_design_cost_read_v1(p_workspace_key text,p_presentation_id text)
 returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a uuid:=auth.uid(); ws uuid; w uuid; src jsonb;
begin
 if current_setting('role',true)<>'authenticated' or a is null then raise exception 'workspace_forbidden' using errcode='42501'; end if;
 select id into ws from d5o_hosted.workspaces where workspace_key=p_workspace_key and status='active';
 if not exists(select 1 from d5o_hosted.memberships where workspace_id=ws and actor_user_id=a and status='active'
  and role in ('admin','project_manager','billing_commercial_lead')) then raise exception 'design_cost_scope_denied' using errcode='42501'; end if;
 select work_id into w from d5o_hosted.work_identity_links where workspace_id=ws and presentation_id=p_presentation_id;
 if w is null then raise exception 'connected_work_unavailable' using errcode='42501'; end if;
 src:=d5o_hosted.outlook_source_v1(ws,w);
 return pg_catalog.jsonb_build_object('revision',coalesce((select revision from d5o_hosted.design_cost_positions where workspace_id=ws and work_id=w),0),
  'sourceDigest',src->>'digest','sourceBasis',src->'basis',
  'commitments',coalesce((select pg_catalog.jsonb_agg(to_jsonb(c) order by c.created_at) from d5o_hosted.design_spend_commitments c where c.workspace_id=ws and c.work_id=w and c.status='Approved'),'[]'::jsonb),
  'links',coalesce((select pg_catalog.jsonb_agg(to_jsonb(l)) from d5o_hosted.design_cost_links l where l.workspace_id=ws and l.work_id=w),'[]'::jsonb),
  'claims',coalesce((select pg_catalog.jsonb_agg(to_jsonb(c) order by c.created_at) from d5o_hosted.design_cost_claims c where c.workspace_id=ws and c.work_id=w),'[]'::jsonb),
  'assessments',coalesce((select pg_catalog.jsonb_agg(to_jsonb(x) order by x.created_at) from d5o_hosted.outlook_assessments x where x.workspace_id=ws and x.work_id=w),'[]'::jsonb));
end; $$;
revoke all on function public.d5o_hosted_design_cost_read_v1(text,text) from public,anon,service_role;
grant execute on function public.d5o_hosted_design_cost_read_v1(text,text) to authenticated;

create function public.d5o_hosted_design_cost_actions_v1(p_workspace_key text) returns jsonb
 language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); ws uuid; member d5o_hosted.memberships%rowtype;
 result jsonb:='[]'::jsonb; work_item record; task_item record; rev integer; current_digest text;
begin
 if current_setting('role',true)<>'authenticated' or actor is null then raise exception 'workspace_forbidden' using errcode='42501'; end if;
 select id into ws from d5o_hosted.workspaces where workspace_key=p_workspace_key and status='active';
 select * into member from d5o_hosted.memberships where workspace_id=ws and actor_user_id=actor and status='active';
 if member.id is null then raise exception 'workspace_forbidden' using errcode='42501'; end if;
 if member.role not in ('project_manager','billing_commercial_lead') then return result; end if;
 for work_item in select w.id,l.presentation_id,w.created_by from d5o_hosted.work_records w
  join d5o_hosted.work_identity_links l on l.work_id=w.id and l.workspace_id=w.workspace_id
  where w.workspace_id=ws and (member.role='billing_commercial_lead' or w.created_by=actor)
   and (exists(select 1 from d5o_hosted.design_spend_commitments c where c.workspace_id=ws and c.work_id=w.id and c.status='Approved')
     or exists(select 1 from d5o_hosted.outlook_assessments a where a.workspace_id=ws and a.work_id=w.id)) loop
  select coalesce(p.revision,0) into rev from d5o_hosted.design_cost_positions p where p.workspace_id=ws and p.work_id=work_item.id;
  rev:=coalesce(rev,0);
  current_digest:=d5o_hosted.outlook_source_v1(ws,work_item.id)->>'digest';
  if member.role='project_manager' then
   if exists(select 1 from d5o_hosted.design_spend_commitments c where c.workspace_id=ws and c.work_id=work_item.id and c.status='Approved'
    and not exists(select 1 from d5o_hosted.design_cost_links x where x.commitment_id=c.id)) then
    result:=result||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('kind','Link Design cost source','workId',work_item.presentation_id,
      'revision',rev,'status','Unlinked approved commitment','title','Link approved Design commitment to Finance',
      'phase','Operate','focus','finance','taskKind','design-cost','position','preparation','ownership','Assigned project manager',
      'blocker','Choose the exact approved Design commitment and retain its source.'));
   elsif exists(select 1 from d5o_hosted.design_cost_links x where x.workspace_id=ws and x.work_id=work_item.id) then
    result:=result||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('kind','Record Design cost','workId',work_item.presentation_id,
      'revision',rev,'status','Source-backed actual needed','title','Submit actual Design cost or correction',
      'phase','Operate','focus','finance','taskKind','design-cost','position','preparation','ownership','Assigned project manager',
      'blocker','Approval of the commitment does not establish incurred cost.'));
   end if;
   if not exists(select 1 from d5o_hosted.outlook_assessments a where a.workspace_id=ws and a.work_id=work_item.id
      and a.source_digest=current_digest and a.status in ('Prepared','Complete','Reviewed with gaps')) then
    result:=result||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('kind','Prepare Work cost outlook','workId',work_item.presentation_id,
      'revision',rev,'status','Missing or stale assessment','title','Prepare cost-outlook completeness assessment',
      'phase','Operate','focus','finance','taskKind','outlook-assessment','position','preparation','ownership','Assigned project manager',
      'blocker','Identify unresolved categories and forecast sources before independent Finance review.'));
   end if;
  else
   for task_item in select c.id,c.work_id,l.presentation_id,c.source_reference from d5o_hosted.design_cost_claims c
    join d5o_hosted.work_identity_links l on l.work_id=c.work_id and l.workspace_id=c.workspace_id
    where c.workspace_id=ws and c.work_id=work_item.id and c.status='Prepared' and c.prepared_by<>actor loop
    result:=result||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('kind','Review Design cost','workId',task_item.presentation_id,
      'revision',rev,'decisionId',task_item.id,'status','Prepared','title','Review sourced Design cost',
      'phase','Operate','focus','finance','taskKind','design-cost','position','action','ownership','Finance reviewer',
      'blocker',null));
   end loop;
   for task_item in select a.id,a.work_id,l.presentation_id from d5o_hosted.outlook_assessments a
    join d5o_hosted.work_identity_links l on l.work_id=a.work_id and l.workspace_id=a.workspace_id
    where a.workspace_id=ws and a.work_id=work_item.id and a.status='Prepared'
     and a.prepared_by<>actor and a.source_digest=current_digest loop
    result:=result||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('kind','Review Work cost outlook','workId',task_item.presentation_id,
      'revision',rev,'decisionId',task_item.id,'status','Prepared','title','Review cost-outlook completeness',
      'phase','Operate','focus','finance','taskKind','outlook-assessment','position','action','ownership','Finance reviewer',
      'blocker',null));
   end loop;
  end if;
 end loop;
 return result;
end; $$;
revoke all on function public.d5o_hosted_design_cost_actions_v1(text) from public,anon,service_role;
grant execute on function public.d5o_hosted_design_cost_actions_v1(text) to authenticated;

create function public.d5o_hosted_design_cost_command_v1(
 p_workspace_key text,p_presentation_id text,p_action text,p_input jsonb,p_command_id text,
 p_expected_revision integer,p_expected_source_digest text) returns jsonb
 language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); ws uuid; member d5o_hosted.memberships%rowtype;
 w d5o_hosted.work_records%rowtype; pos d5o_hosted.design_cost_positions%rowtype;
 receipt d5o_hosted.design_cost_receipts%rowtype; commitment d5o_hosted.design_spend_commitments%rowtype;
 link d5o_hosted.design_cost_links%rowtype; claim d5o_hosted.design_cost_claims%rowtype;
 prior d5o_hosted.design_cost_claims%rowtype; assessment d5o_hosted.outlook_assessments%rowtype;
 src jsonb; fingerprint text; result jsonb; subject uuid; amount bigint; category text; item jsonb; status text;
begin
 if current_setting('role',true)<>'authenticated' or actor is null
  or p_action not in ('link-commitment','prepare-cost','review-cost','prepare-assessment','review-assessment')
  or pg_catalog.jsonb_typeof(p_input)<>'object' or length(coalesce(p_command_id,'')) not between 8 and 120
  or p_expected_revision is null or p_expected_revision<0 then raise exception 'invalid_design_cost_command' using errcode='22023'; end if;
 select id into ws from d5o_hosted.workspaces where workspace_key=p_workspace_key and status='active';
 select * into member from d5o_hosted.memberships where workspace_id=ws and actor_user_id=actor and status='active' for share;
 if member.id is null then raise exception 'workspace_forbidden' using errcode='42501'; end if;
 select r.* into w from d5o_hosted.work_records r join d5o_hosted.work_identity_links l on l.workspace_id=r.workspace_id and l.work_id=r.id
  where r.workspace_id=ws and l.presentation_id=p_presentation_id for update of r;
 if w.id is null then raise exception 'connected_work_unavailable' using errcode='42501'; end if;
 fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_workspace_key,p_presentation_id,p_action,p_input,p_expected_revision,p_expected_source_digest)::text);
 select * into receipt from d5o_hosted.design_cost_receipts where workspace_id=ws and command_id=p_command_id;
 if receipt.command_id is not null then
  if receipt.work_id<>w.id or receipt.actor_user_id<>actor or receipt.fingerprint<>fingerprint then raise exception 'command_reuse_conflict' using errcode='23505'; end if;
  return receipt.result; end if;
 insert into d5o_hosted.design_cost_positions(workspace_id,work_id) values(ws,w.id) on conflict do nothing;
 select * into pos from d5o_hosted.design_cost_positions where workspace_id=ws and work_id=w.id for update;
 if pos.revision<>p_expected_revision then raise exception 'stale_design_cost_revision' using errcode='23505'; end if;
 src:=d5o_hosted.outlook_source_v1(ws,w.id);
 if src->>'digest' is distinct from p_expected_source_digest then raise exception 'outlook_source_changed' using errcode='23514'; end if;
 if p_action in ('link-commitment','prepare-cost','prepare-assessment') then
  if member.role<>'project_manager' or w.created_by<>actor then raise exception 'assigned_pm_required' using errcode='42501'; end if;
 else
  if member.role<>'billing_commercial_lead' then raise exception 'independent_finance_review_required' using errcode='42501'; end if;
 end if;
 if p_action='link-commitment' then
  select * into commitment from d5o_hosted.design_spend_commitments where id=(p_input->>'commitmentId')::uuid
   and workspace_id=ws and work_id=w.id and status='Approved' for update;
  if commitment.id is null or commitment.currency<>'USD' or exists(select 1 from d5o_hosted.design_cost_links where commitment_id=commitment.id)
   then raise exception 'eligible_unlinked_design_commitment_required' using errcode='23514'; end if;
  if length(trim(coalesce(p_input->>'source','')))<8 then raise exception 'design_commitment_source_required' using errcode='22023'; end if;
  insert into d5o_hosted.connected_job_costs(workspace_id,work_id,kind,category,amount_minor,cost_date,source,recorded_by)
   values(ws,w.id,'Committed','Design',commitment.amount_minor,current_date,
    'Design commitment '||commitment.id||' · '||trim(p_input->>'source'),actor) returning id into subject;
  insert into d5o_hosted.design_cost_links(commitment_id,workspace_id,work_id,ledger_cost_id,linked_by)
   values(commitment.id,ws,w.id,subject,actor);
 elsif p_action='prepare-cost' then
  select * into commitment from d5o_hosted.design_spend_commitments where id=(p_input->>'commitmentId')::uuid
   and workspace_id=ws and work_id=w.id and status='Approved';
  select * into link from d5o_hosted.design_cost_links where commitment_id=commitment.id and workspace_id=ws and work_id=w.id;
  if commitment.id is null or link.commitment_id is null then raise exception 'linked_design_commitment_required' using errcode='23514'; end if;
  if coalesce(p_input->>'amountMinor','') !~ '^[1-9][0-9]*$' or coalesce(p_input->>'costDate','') !~ '^\d{4}-\d{2}-\d{2}$'
   or length(trim(coalesce(p_input->>'sourceReference','')))<8 or length(trim(coalesce(p_input->>'evidenceNote','')))<10 then
   raise exception 'sourced_design_cost_required' using errcode='22023'; end if;
  amount:=(p_input->>'amountMinor')::bigint;
  if amount>1000000000000 or (p_input->>'costDate')::date>current_date then raise exception 'design_cost_amount_or_date_invalid' using errcode='23514'; end if;
  if p_input ? 'supersedesId' then
   select * into prior from d5o_hosted.design_cost_claims where id=(p_input->>'supersedesId')::uuid
    and workspace_id=ws and work_id=w.id and commitment_id=commitment.id and status='Reviewed';
   if prior.id is null or exists(select 1 from d5o_hosted.design_cost_claims x where x.supersedes_id=prior.id and x.status='Reviewed')
    then raise exception 'current_reviewed_cost_required' using errcode='23514'; end if;
  end if;
  if exists(select 1 from d5o_hosted.design_cost_claims where workspace_id=ws and work_id=w.id
   and status in ('Prepared','Reviewed') and commitment_id=commitment.id and source_reference=trim(p_input->>'sourceReference')
   and (prior.id is null or id<>prior.id)) then raise exception 'duplicate_design_cost_source' using errcode='23505'; end if;
  insert into d5o_hosted.design_cost_claims(id,workspace_id,work_id,commitment_id,root_id,supersedes_id,status,
   amount_minor,currency,cost_date,source_reference,evidence_note,prepared_by)
   values(gen_random_uuid(),ws,w.id,commitment.id,coalesce(prior.root_id,gen_random_uuid()),prior.id,'Prepared',
    amount,'USD',(p_input->>'costDate')::date,trim(p_input->>'sourceReference'),trim(p_input->>'evidenceNote'),actor)
   returning id into subject;
  if prior.id is null then update d5o_hosted.design_cost_claims set root_id=subject where id=subject; end if;
 elsif p_action='review-cost' then
  select * into claim from d5o_hosted.design_cost_claims where id=(p_input->>'claimId')::uuid
   and workspace_id=ws and work_id=w.id for update;
  if claim.id is null or claim.status<>'Prepared' or claim.prepared_by=actor
   or length(trim(coalesce(p_input->>'reason','')))<10 or p_input->>'decision' not in ('Reviewed','Returned')
   then raise exception 'independent_design_cost_review_required' using errcode='23514'; end if;
  if claim.supersedes_id is not null and not exists(select 1 from d5o_hosted.design_cost_claims
   where id=claim.supersedes_id and status='Reviewed') then raise exception 'design_cost_source_changed' using errcode='23514'; end if;
  update d5o_hosted.design_cost_claims set status=p_input->>'decision',reviewed_by=actor,
   review_note=trim(p_input->>'reason'),reviewed_at=now() where id=claim.id;
  subject:=claim.id;
 elsif p_action='prepare-assessment' then
  if pg_catalog.jsonb_typeof(p_input->'categories')<>'object' or length(trim(coalesce(p_input->>'limitations','')))<10
   or length(trim(coalesce(p_input->>'sourceReference','')))<8
   or coalesce(p_input->>'actualCutoff','') !~ '^\d{4}-\d{2}-\d{2}$'
   then raise exception 'outlook_assessment_basis_required' using errcode='22023'; end if;
  foreach category in array array['Design','Material','Equipment','Subcontract','Labor','Other'] loop
   item:=p_input->'categories'->category; status:=item->>'status';
   if status is null or status not in ('Resolved','Unknown','Not applicable') or length(trim(coalesce(item->>'reason','')))<8
    then raise exception 'cost_category_disposition_required: %',category using errcode='23514'; end if;
  end loop;
  insert into d5o_hosted.outlook_assessments(workspace_id,work_id,status,source_digest,source_basis,actual_cutoff,
   category_basis,limitations,source_reference,prepared_by)
   values(ws,w.id,'Prepared',src->>'digest',src->'basis',(p_input->>'actualCutoff')::date,
    p_input->'categories',trim(p_input->>'limitations'),trim(p_input->>'sourceReference'),actor)
   returning id into subject;
 else
  select * into assessment from d5o_hosted.outlook_assessments where id=(p_input->>'assessmentId')::uuid
   and workspace_id=ws and work_id=w.id for update;
  if assessment.id is null or assessment.status<>'Prepared' or assessment.prepared_by=actor
   or assessment.source_digest<>src->>'digest' or p_input->>'decision' not in ('Complete','Reviewed with gaps','Returned')
   or length(trim(coalesce(p_input->>'reason','')))<10 then raise exception 'current_independent_outlook_review_required' using errcode='23514'; end if;
  if p_input->>'decision'='Complete' then
   if exists(select 1 from pg_catalog.jsonb_each(assessment.category_basis) c where c.value->>'status'='Unknown')
    or exists(select 1 from d5o_hosted.design_spend_commitments c where c.workspace_id=ws and c.work_id=w.id and c.status='Approved'
     and not exists(select 1 from d5o_hosted.design_cost_links l where l.commitment_id=c.id))
    or exists(select 1 from d5o_hosted.design_cost_claims c where c.workspace_id=ws and c.work_id=w.id and c.status='Prepared')
    or exists(select 1 from pg_catalog.jsonb_each(assessment.category_basis) c where c.value->>'status'='Not applicable'
      and exists(select 1 from d5o_hosted.connected_job_costs j where j.workspace_id=ws and j.work_id=w.id and j.category=c.key))
    or (assessment.category_basis->'Design'->>'status'='Not applicable' and exists(select 1 from d5o_hosted.design_spend_commitments c
      where c.workspace_id=ws and c.work_id=w.id and c.status='Approved'))
    or (assessment.category_basis->'Labor'->>'status'='Not applicable' and exists(select 1 from d5o_hosted.labor_reservations r
      where r.workspace_id=ws and r.work_id=w.id))
    or not exists(select 1 from d5o_hosted.connected_job_finance_states f where f.workspace_id=ws and f.work_id=w.id
     and f.remaining_forecast_minor is not null and length(trim(coalesce(f.forecast_source,'')))>=8)
    then raise exception 'outlook_has_unresolved_sources' using errcode='23514'; end if;
  end if;
  update d5o_hosted.outlook_assessments set status=p_input->>'decision',reviewed_by=actor,
   review_note=trim(p_input->>'reason'),reviewed_at=now() where id=assessment.id;
  subject:=assessment.id;
 end if;
 update d5o_hosted.design_cost_positions set revision=revision+1 where workspace_id=ws and work_id=w.id;
 result:=pg_catalog.jsonb_build_object('revision',pos.revision+1,'subjectId',subject,'action',p_action);
 insert into d5o_hosted.design_cost_events(workspace_id,work_id,revision,action,command_id,actor_user_id,membership_id,subject_id,basis)
  values(ws,w.id,pos.revision+1,p_action,p_command_id,actor,member.id,subject,pg_catalog.jsonb_build_object('input',p_input,'sourceDigest',src->>'digest'));
 insert into d5o_hosted.design_cost_receipts(workspace_id,command_id,work_id,actor_user_id,fingerprint,result)
  values(ws,p_command_id,w.id,actor,fingerprint,result);
 return result;
end; $$;
revoke all on function public.d5o_hosted_design_cost_command_v1(text,text,text,jsonb,text,integer,text) from public,anon,service_role;
grant execute on function public.d5o_hosted_design_cost_command_v1(text,text,text,jsonb,text,integer,text) to authenticated;

-- Finance's existing read keeps historical facts and receives only the latest
-- independently reviewed revision of each Design source, never a fabricated cost.
alter function public.d5o_hosted_job_finance_read_v1(text,text)
 rename to d5o_hosted_job_finance_read_pre_design_cost_v1;
revoke all on function public.d5o_hosted_job_finance_read_pre_design_cost_v1(text,text) from public,anon,authenticated,service_role;
create function public.d5o_hosted_job_finance_read_v1(p_workspace_key text,p_presentation_id text)
 returns jsonb language plpgsql stable security definer set search_path='' as $$
declare base jsonb; ws uuid; w uuid; actuals jsonb;
begin
 base:=public.d5o_hosted_job_finance_read_pre_design_cost_v1(p_workspace_key,p_presentation_id);
 select id into ws from d5o_hosted.workspaces where workspace_key=p_workspace_key and status='active';
 select work_id into w from d5o_hosted.work_identity_links where workspace_id=ws and presentation_id=p_presentation_id;
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
  'id',c.id,'kind','Incurred','category','Design','amount_minor',c.amount_minor,
  'cost_date',c.cost_date,'package_id',null,'source',c.source_reference,
  'reconciles_id',l.ledger_cost_id) order by c.reviewed_at),'[]'::jsonb) into actuals
 from d5o_hosted.design_cost_claims c join d5o_hosted.design_cost_links l on l.commitment_id=c.commitment_id
 where c.workspace_id=ws and c.work_id=w and c.status='Reviewed'
  and not exists(select 1 from d5o_hosted.design_cost_claims n where n.root_id=c.root_id and n.supersedes_id=c.id and n.status='Reviewed');
 return base||pg_catalog.jsonb_build_object('costs',coalesce(base->'costs','[]'::jsonb)||actuals);
end; $$;
revoke all on function public.d5o_hosted_job_finance_read_v1(text,text) from public,anon,service_role;
grant execute on function public.d5o_hosted_job_finance_read_v1(text,text) to authenticated;
