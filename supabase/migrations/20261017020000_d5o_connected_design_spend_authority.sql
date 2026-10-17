-- Internal detailed-Design spending only. This does not grant PO, subcontract, crew or field authority.
create table d5o_hosted.design_spend_positions (
 workspace_id uuid not null, work_id uuid not null, revision integer not null default 0,
 updated_at timestamptz not null default now(), primary key(workspace_id,work_id),
 foreign key(work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id));
create table d5o_hosted.design_spend_authorities (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null, work_id uuid not null,
 status text not null check(status in ('Prepared','Approved','Returned','Revoked')),
 cap_minor bigint not null check(cap_minor>0), currency text not null check(currency ~ '^[A-Z]{3}$'),
 extent text not null, valid_from date not null, valid_until date not null,
 funding_source text not null, source_reference text not null, source_digest text not null,
 source_snapshot jsonb not null, prepared_by uuid not null references auth.users(id),
 reviewed_by uuid references auth.users(id), review_note text,
 supersedes_id uuid references d5o_hosted.design_spend_authorities(id),
 created_at timestamptz not null default now(), decided_at timestamptz,
 foreign key(work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id));
create index design_spend_authorities_work on d5o_hosted.design_spend_authorities(workspace_id,work_id,created_at);
create table d5o_hosted.design_spend_commitments (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null, work_id uuid not null,
 authority_id uuid not null references d5o_hosted.design_spend_authorities(id),
 status text not null check(status in ('Prepared','Approved','Returned')),
 amount_minor bigint not null check(amount_minor>0), currency text not null check(currency ~ '^[A-Z]{3}$'),
 activity text not null, source_reference text not null,
 prepared_by uuid not null references auth.users(id), reviewed_by uuid references auth.users(id),
 review_note text, supersedes_id uuid references d5o_hosted.design_spend_commitments(id),
 created_at timestamptz not null default now(), decided_at timestamptz,
 foreign key(work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id));
create index design_spend_commitments_work on d5o_hosted.design_spend_commitments(workspace_id,work_id,status);
create table d5o_hosted.design_spend_events (
 workspace_id uuid not null, work_id uuid not null, revision integer not null,
 action text not null, command_id text not null, actor_user_id uuid not null references auth.users(id),
 membership_id uuid not null references d5o_hosted.memberships(id),
 subject_id uuid not null, basis jsonb not null, occurred_at timestamptz not null default now(),
 primary key(workspace_id,work_id,revision), unique(workspace_id,command_id));
create table d5o_hosted.design_spend_receipts (
 workspace_id uuid not null, command_id text not null, work_id uuid not null,
 actor_user_id uuid not null references auth.users(id), fingerprint text not null, result jsonb not null,
 primary key(workspace_id,command_id));
alter table d5o_hosted.design_spend_positions enable row level security;
alter table d5o_hosted.design_spend_authorities enable row level security;
alter table d5o_hosted.design_spend_commitments enable row level security;
alter table d5o_hosted.design_spend_events enable row level security;
alter table d5o_hosted.design_spend_receipts enable row level security;
revoke all on d5o_hosted.design_spend_positions,d5o_hosted.design_spend_authorities,
 d5o_hosted.design_spend_commitments,d5o_hosted.design_spend_events,d5o_hosted.design_spend_receipts
 from public,anon,authenticated;

create function d5o_hosted.design_spend_source_v1(p_workspace uuid,p_work uuid) returns jsonb
 language plpgsql stable security definer set search_path='' as $$
declare d d5o_hosted.connected_define_states%rowtype;
 s d5o_hosted.connected_solution_states%rowtype;
 e d5o_hosted.connected_estimate_states%rowtype;
 o d5o_hosted.connected_offer_states%rowtype;
 r d5o_hosted.connected_rom_design_states%rowtype;
 result jsonb;
begin
 select * into d from d5o_hosted.connected_define_states where workspace_id=p_workspace and work_id=p_work;
 select * into s from d5o_hosted.connected_solution_states where workspace_id=p_workspace and work_id=p_work;
 select * into e from d5o_hosted.connected_estimate_states where workspace_id=p_workspace and work_id=p_work;
 select * into o from d5o_hosted.connected_offer_states where workspace_id=p_workspace and work_id=p_work;
 select * into r from d5o_hosted.connected_rom_design_states where workspace_id=p_workspace and work_id=p_work;
 if d.status is distinct from 'Approved' or d.projection#>>'{developHandoff,status}' is distinct from 'accepted'
  or s.status is distinct from 'Approved' or e.status is distinct from 'Approved'
  or e.estimate#>>'{detailed,input,estimateMaturity}' is distinct from 'ROM'
  or e.definition_revision is distinct from d.definition_revision or e.solution_digest is distinct from s.source_digest
  or o.status is distinct from 'Submitted' or o.estimate_revision is distinct from e.estimate_revision
  or r.status is distinct from 'Design authorized' or r.estimate_revision is distinct from e.estimate_revision
  or r.offer_revision is distinct from o.offer_revision or r.definition_revision is distinct from d.definition_revision
  or r.solution_digest is distinct from s.source_digest or r.design_authorization is null then
  return null; end if;
 result:=pg_catalog.jsonb_build_object('defineRevision',d.definition_revision,'solutionDigest',s.source_digest,
  'estimateRevision',e.estimate_revision,'offerRevision',o.offer_revision,'designDecisionRevision',r.decision_revision,
  'authorization',r.design_authorization,
  'approverRole',e.estimate#>>'{detailed,policySnapshot,proposalApproverRole}');
 return result||pg_catalog.jsonb_build_object('digest',pg_catalog.md5(result::text));
end; $$;
revoke all on function d5o_hosted.design_spend_source_v1(uuid,uuid) from public,anon,authenticated,service_role;

create function public.d5o_hosted_design_spend_read_v1(p_workspace_key text,p_presentation_id text) returns jsonb
 language plpgsql stable security definer set search_path='' as $$
declare a uuid:=auth.uid(); ws uuid; w uuid; rev integer; src jsonb; cap bigint; used bigint;
begin
 if current_setting('role',true)<>'authenticated' or a is null then raise exception 'workspace_forbidden' using errcode='42501'; end if;
 select id into ws from d5o_hosted.workspaces where workspace_key=p_workspace_key and status='active';
 if not exists(select 1 from d5o_hosted.memberships where workspace_id=ws and actor_user_id=a and status='active'
  and role in ('admin','project_manager','operations_leader','billing_commercial_lead')) then raise exception 'workspace_forbidden' using errcode='42501'; end if;
 select work_id into w from d5o_hosted.work_identity_links where workspace_id=ws and presentation_id=p_presentation_id;
 if w is null then raise exception 'connected_work_unavailable' using errcode='42501'; end if;
 select revision into rev from d5o_hosted.design_spend_positions where workspace_id=ws and work_id=w;
 src:=d5o_hosted.design_spend_source_v1(ws,w);
 select coalesce(sum(amount_minor),0) into used from d5o_hosted.design_spend_commitments
  where workspace_id=ws and work_id=w and status='Approved';
 cap:=case when src is not null then (src#>>'{authorization,spendCapMinor}')::bigint else null end;
 return pg_catalog.jsonb_build_object('revision',coalesce(rev,0),'source',src,'committedMinor',used,
  'remainingMinor',case when cap is null then null else cap-used end,
  'authorities',coalesce((select pg_catalog.jsonb_agg(to_jsonb(x) order by x.created_at) from d5o_hosted.design_spend_authorities x
    where x.workspace_id=ws and x.work_id=w),'[]'::jsonb),
  'commitments',coalesce((select pg_catalog.jsonb_agg(to_jsonb(x) order by x.created_at) from d5o_hosted.design_spend_commitments x
    where x.workspace_id=ws and x.work_id=w),'[]'::jsonb));
end; $$;
revoke all on function public.d5o_hosted_design_spend_read_v1(text,text) from public,anon,service_role;
grant execute on function public.d5o_hosted_design_spend_read_v1(text,text) to authenticated;

create function public.d5o_hosted_design_spend_command_v1(
 p_workspace_key text,p_presentation_id text,p_action text,p_input jsonb,p_command_id text,
 p_expected_revision integer,p_expected_source_digest text) returns jsonb
 language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); ws d5o_hosted.workspaces%rowtype; member d5o_hosted.memberships%rowtype;
 work d5o_hosted.work_records%rowtype; pos d5o_hosted.design_spend_positions%rowtype;
 authz d5o_hosted.design_spend_authorities%rowtype; commitment d5o_hosted.design_spend_commitments%rowtype;
 prior_authz d5o_hosted.design_spend_authorities%rowtype; prior_commit d5o_hosted.design_spend_commitments%rowtype;
 receipt d5o_hosted.design_spend_receipts%rowtype; src jsonb; fingerprint text; subject uuid;
 amount bigint; cap bigint; used bigint; result jsonb; next_revision integer; approver text;
begin
 if current_setting('role',true)<>'authenticated' or actor is null or p_action not in
  ('prepare-authority','approve-authority','return-authority','revoke-authority',
   'prepare-commitment','approve-commitment','return-commitment')
  or pg_catalog.jsonb_typeof(p_input)<>'object' or length(coalesce(p_command_id,'')) not between 8 and 120
  or p_expected_revision is null or p_expected_revision<0 then
  raise exception 'invalid_design_spend_command' using errcode='22023'; end if;
 select * into ws from d5o_hosted.workspaces where workspace_key=p_workspace_key and status='active';
 if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
 select * into member from d5o_hosted.memberships where workspace_id=ws.id and actor_user_id=actor and status='active' for share;
 if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
 select w.* into work from d5o_hosted.work_records w join d5o_hosted.work_identity_links l
  on l.workspace_id=w.workspace_id and l.work_id=w.id
  where w.workspace_id=ws.id and l.presentation_id=p_presentation_id for update of w;
 if not found then raise exception 'connected_work_unavailable' using errcode='42501'; end if;
 fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_workspace_key,p_presentation_id,p_action,p_input,
  p_expected_revision,p_expected_source_digest)::text);
 select * into receipt from d5o_hosted.design_spend_receipts where workspace_id=ws.id and command_id=p_command_id;
 if found then
  if receipt.work_id<>work.id or receipt.actor_user_id<>actor or receipt.fingerprint<>fingerprint then
   raise exception 'command_reuse_conflict' using errcode='23505'; end if;
  return receipt.result; end if;
 insert into d5o_hosted.design_spend_positions(workspace_id,work_id,revision)
  values(ws.id,work.id,0) on conflict do nothing;
 select * into pos from d5o_hosted.design_spend_positions where workspace_id=ws.id and work_id=work.id for update;
 if pos.revision<>p_expected_revision then raise exception 'stale_design_spend_revision' using errcode='23505'; end if;
 src:=d5o_hosted.design_spend_source_v1(ws.id,work.id);
 if p_action<>'revoke-authority' and (src is null or src->>'digest' is distinct from p_expected_source_digest) then
  raise exception 'design_spend_source_changed' using errcode='23514'; end if;
 approver:=src->>'approverRole';
 if p_action='revoke-authority' then
  select * into authz from d5o_hosted.design_spend_authorities
   where id=(p_input->>'authorityId')::uuid and workspace_id=ws.id and work_id=work.id;
  approver:=authz.source_snapshot->>'approverRole';
 end if;
 if p_action in ('prepare-authority','prepare-commitment') then
  if member.role<>'project_manager' or work.created_by<>actor then
   raise exception 'design_spend_preparer_required' using errcode='42501'; end if;
 else
  if member.role<>approver or approver not in ('admin','operations_leader') then
   raise exception 'independent_design_spend_authority_required' using errcode='42501'; end if;
 end if;
 if p_action='prepare-authority' then
  if coalesce(p_input->>'capMinor','') !~ '^[1-9][0-9]*$'
   or coalesce(p_input->>'validFrom','') !~ '^\d{4}-\d{2}-\d{2}$'
   or coalesce(p_input->>'validUntil','') !~ '^\d{4}-\d{2}-\d{2}$'
   or length(trim(coalesce(p_input->>'extent',''))) not between 10 and 2000
   or length(trim(coalesce(p_input->>'sourceReference',''))) not between 5 and 500 then
   raise exception 'invalid_design_spend_authority_basis' using errcode='22023'; end if;
  cap:=(p_input->>'capMinor')::bigint;
  if cap>(src#>>'{authorization,spendCapMinor}')::bigint
   or (p_input->>'validFrom')::date>(p_input->>'validUntil')::date
   or (p_input->>'validUntil')::date<current_date
   or src#>>'{authorization,currency}' !~ '^[A-Z]{3}$' then
   raise exception 'design_spend_cap_or_dates_invalid' using errcode='23514'; end if;
  if exists(select 1 from d5o_hosted.design_spend_authorities
    where workspace_id=ws.id and work_id=work.id and status='Approved' and source_digest=src->>'digest') then
   raise exception 'active_design_spend_authority_exists' using errcode='23514'; end if;
  if p_input ? 'supersedesId' then
   select * into prior_authz from d5o_hosted.design_spend_authorities
    where id=(p_input->>'supersedesId')::uuid and workspace_id=ws.id and work_id=work.id;
   if prior_authz.id is null or prior_authz.status not in ('Returned','Revoked') then
    raise exception 'returned_or_revoked_authority_required' using errcode='23514'; end if;
  end if;
  insert into d5o_hosted.design_spend_authorities(workspace_id,work_id,status,cap_minor,currency,extent,
   valid_from,valid_until,funding_source,source_reference,source_digest,source_snapshot,prepared_by,supersedes_id)
   values(ws.id,work.id,'Prepared',cap,src#>>'{authorization,currency}',trim(p_input->>'extent'),
    (p_input->>'validFrom')::date,(p_input->>'validUntil')::date,
    src#>>'{authorization,fundingSource}',trim(p_input->>'sourceReference'),src->>'digest',src,actor,prior_authz.id)
   returning * into authz;
  subject:=authz.id;
 elsif p_action in ('approve-authority','return-authority','revoke-authority') then
  select * into authz from d5o_hosted.design_spend_authorities
   where id=(p_input->>'authorityId')::uuid and workspace_id=ws.id and work_id=work.id for update;
  if authz.id is null then raise exception 'design_spend_authority_not_found' using errcode='23514'; end if;
  if p_action='revoke-authority' then
   if authz.status<>'Approved' or length(trim(coalesce(p_input->>'reason',''))) < 10 then
    raise exception 'approved_authority_and_reason_required' using errcode='23514'; end if;
   update d5o_hosted.design_spend_authorities set status='Revoked',reviewed_by=actor,
    review_note=trim(p_input->>'reason'),decided_at=now() where id=authz.id;
  else
   if authz.status<>'Prepared' or authz.prepared_by=actor
    or length(trim(coalesce(p_input->>'reason',''))) < 10 then
    raise exception 'independent_authority_review_required' using errcode='42501'; end if;
   if p_action='approve-authority' then
    if authz.source_digest<>src->>'digest' or authz.valid_until<current_date
     or exists(select 1 from d5o_hosted.design_spend_authorities
      where workspace_id=ws.id and work_id=work.id and status='Approved' and source_digest=src->>'digest') then
     raise exception 'design_spend_authority_stale_or_duplicate' using errcode='23514'; end if;
   end if;
   update d5o_hosted.design_spend_authorities set
    status=case when p_action='approve-authority' then 'Approved' else 'Returned' end,
    reviewed_by=actor,review_note=trim(p_input->>'reason'),decided_at=now() where id=authz.id;
  end if;
  subject:=authz.id;
 elsif p_action='prepare-commitment' then
  select * into authz from d5o_hosted.design_spend_authorities
   where id=(p_input->>'authorityId')::uuid and workspace_id=ws.id and work_id=work.id for update;
  if authz.id is null or authz.status<>'Approved' or authz.source_digest<>src->>'digest'
   or current_date not between authz.valid_from and authz.valid_until then
   raise exception 'current_design_spend_authority_required' using errcode='23514'; end if;
  if coalesce(p_input->>'amountMinor','') !~ '^[1-9][0-9]*$'
   or length(trim(coalesce(p_input->>'activity',''))) not between 10 and 1000
   or length(trim(coalesce(p_input->>'sourceReference',''))) not between 5 and 500 then
   raise exception 'invalid_design_spend_commitment_basis' using errcode='22023'; end if;
  if p_input ? 'supersedesId' then
   select * into prior_commit from d5o_hosted.design_spend_commitments
    where id=(p_input->>'supersedesId')::uuid and workspace_id=ws.id and work_id=work.id and authority_id=authz.id;
   if prior_commit.id is null or prior_commit.status<>'Returned' then
    raise exception 'returned_commitment_required' using errcode='23514'; end if;
  end if;
  insert into d5o_hosted.design_spend_commitments(workspace_id,work_id,authority_id,status,amount_minor,
   currency,activity,source_reference,prepared_by,supersedes_id)
   values(ws.id,work.id,authz.id,'Prepared',(p_input->>'amountMinor')::bigint,authz.currency,
    trim(p_input->>'activity'),trim(p_input->>'sourceReference'),actor,prior_commit.id)
   returning * into commitment;
  subject:=commitment.id;
 else
  select * into commitment from d5o_hosted.design_spend_commitments
   where id=(p_input->>'commitmentId')::uuid and workspace_id=ws.id and work_id=work.id for update;
  if commitment.id is null or commitment.status<>'Prepared' or commitment.prepared_by=actor
   or length(trim(coalesce(p_input->>'reason',''))) < 10 then
   raise exception 'independent_commitment_review_required' using errcode='42501'; end if;
  select * into authz from d5o_hosted.design_spend_authorities where id=commitment.authority_id for update;
  if p_action='approve-commitment' then
   if authz.status<>'Approved' or authz.source_digest<>src->>'digest'
    or current_date not between authz.valid_from and authz.valid_until then
    raise exception 'current_design_spend_authority_required' using errcode='23514'; end if;
   select coalesce(sum(amount_minor),0) into used from d5o_hosted.design_spend_commitments
    where workspace_id=ws.id and work_id=work.id and status='Approved';
   if commitment.amount_minor>authz.cap_minor-used
    or commitment.amount_minor>(src#>>'{authorization,spendCapMinor}')::bigint-used then
    raise exception 'design_spend_cap_exceeded' using errcode='23514'; end if;
  end if;
  update d5o_hosted.design_spend_commitments set
   status=case when p_action='approve-commitment' then 'Approved' else 'Returned' end,
   reviewed_by=actor,review_note=trim(p_input->>'reason'),decided_at=now() where id=commitment.id;
  subject:=commitment.id;
 end if;
 next_revision:=pos.revision+1;
 update d5o_hosted.design_spend_positions set revision=next_revision,updated_at=now()
  where workspace_id=ws.id and work_id=work.id;
 insert into d5o_hosted.design_spend_events(workspace_id,work_id,revision,action,command_id,
  actor_user_id,membership_id,subject_id,basis)
  values(ws.id,work.id,next_revision,p_action,p_command_id,actor,member.id,subject,
   pg_catalog.jsonb_build_object('input',p_input,'source',src));
 result:=pg_catalog.jsonb_build_object('revision',next_revision,'subjectId',subject,'action',p_action,
  'status',case when p_action like 'prepare-%' then 'Prepared'
   when p_action like 'approve-%' then 'Approved'
   when p_action='revoke-authority' then 'Revoked' else 'Returned' end);
 insert into d5o_hosted.design_spend_receipts(workspace_id,command_id,work_id,actor_user_id,fingerprint,result)
  values(ws.id,p_command_id,work.id,actor,fingerprint,result);
 return result;
end; $$;
revoke all on function public.d5o_hosted_design_spend_command_v1(text,text,text,jsonb,text,integer,text)
 from public,anon,service_role;
grant execute on function public.d5o_hosted_design_spend_command_v1(text,text,text,jsonb,text,integer,text)
 to authenticated;



create function public.d5o_hosted_design_spend_actions_v1(p_workspace_key text) returns jsonb
 language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); ws uuid; role_name text; item record; src jsonb;
 authority d5o_hosted.design_spend_authorities%rowtype;
 pending_authority d5o_hosted.design_spend_authorities%rowtype;
 pending_commit d5o_hosted.design_spend_commitments%rowtype;
 used bigint; remaining bigint; result jsonb:='[]'::jsonb;
begin
 if current_setting('role',true)<>'authenticated' or actor is null then raise exception 'workspace_forbidden' using errcode='42501'; end if;
 select id into ws from d5o_hosted.workspaces where workspace_key=p_workspace_key and status='active';
 select role into role_name from d5o_hosted.memberships where workspace_id=ws and actor_user_id=actor and status='active';
 if role_name is null then raise exception 'workspace_forbidden' using errcode='42501'; end if;
 if role_name not in ('admin','project_manager','operations_leader') then return result; end if;
 for item in select w.id,w.title,w.created_by,l.presentation_id,coalesce(p.revision,0) revision
  from d5o_hosted.connected_rom_design_states r
  join d5o_hosted.work_records w on w.id=r.work_id and w.workspace_id=r.workspace_id
  join d5o_hosted.work_identity_links l on l.work_id=w.id and l.workspace_id=w.workspace_id
  left join d5o_hosted.design_spend_positions p on p.work_id=w.id and p.workspace_id=w.workspace_id
  where r.workspace_id=ws and r.status='Design authorized' loop
  src:=d5o_hosted.design_spend_source_v1(ws,item.id);
  if src is null then continue; end if;
  select * into authority from d5o_hosted.design_spend_authorities
   where workspace_id=ws and work_id=item.id and status='Approved' and source_digest=src->>'digest'
   order by created_at desc limit 1;
  select * into pending_authority from d5o_hosted.design_spend_authorities
   where workspace_id=ws and work_id=item.id and status='Prepared' and source_digest=src->>'digest'
   order by created_at desc limit 1;
  if pending_authority.id is not null and role_name=src->>'approverRole' and pending_authority.prepared_by<>actor then
   result:=result||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('kind','Review Design spending window',
    'phase','Develop','focus','design-spend-authority-review','workId',item.presentation_id,'workTitle',item.title,
    'revision',item.revision,'decisionId',pending_authority.id,'dueDate',pending_authority.valid_until,
    'status','Prepared','ownership','Eligible independent Design spending authority',
    'blocker','Confirm activity, funding source, expiry and cap against the approved Design permission.'));
  elsif authority.id is null and pending_authority.id is null and role_name='project_manager' and item.created_by=actor then
   result:=result||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('kind','Prepare Design spending window',
    'phase','Develop','focus','design-spend-authority-prep','workId',item.presentation_id,'workTitle',item.title,
    'revision',item.revision,'status','Preparation','ownership','Assigned project manager',
    'blocker','Propose the permitted activity and expiry within the independently approved Design cap.'));
  end if;
  if authority.id is not null and current_date between authority.valid_from and authority.valid_until then
   select coalesce(sum(amount_minor),0) into used from d5o_hosted.design_spend_commitments
    where workspace_id=ws and work_id=item.id and status='Approved';
   remaining:=pg_catalog.least(authority.cap_minor,(src#>>'{authorization,spendCapMinor}')::bigint)-used;
   select * into pending_commit from d5o_hosted.design_spend_commitments
    where workspace_id=ws and work_id=item.id and authority_id=authority.id and status='Prepared'
    order by created_at desc limit 1;
   if pending_commit.id is not null and role_name=src->>'approverRole' and pending_commit.prepared_by<>actor then
    result:=result||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('kind','Review Design effort commitment',
     'phase','Develop','focus','design-spend-commitment-review','workId',item.presentation_id,'workTitle',item.title,
     'revision',item.revision,'decisionId',pending_commit.id,'dueDate',authority.valid_until,
     'status','Prepared','ownership','Eligible independent Design spending authority',
     'blocker',case when pending_commit.amount_minor>remaining then 'Prepared amount exceeds the remaining authorized cap; return for correction.' else null end));
   elsif pending_commit.id is null and remaining>0 and role_name='project_manager' and item.created_by=actor then
    result:=result||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('kind','Prepare Design effort commitment',
     'phase','Develop','focus','design-spend-commitment-prep','workId',item.presentation_id,'workTitle',item.title,
     'revision',item.revision,'decisionId',authority.id,'dueDate',authority.valid_until,
     'status','Preparation','ownership','Assigned project manager',
     'blocker','A draft does not commit spend; independent approval consumes the cap.'));
   end if;
  end if;
 end loop;
 return result;
end; $$;
revoke all on function public.d5o_hosted_design_spend_actions_v1(text) from public,anon,service_role;
grant execute on function public.d5o_hosted_design_spend_actions_v1(text) to authenticated;
