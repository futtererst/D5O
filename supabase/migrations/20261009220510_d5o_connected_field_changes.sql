-- A field-origin change is a typed, tenant-scoped decision stream on the canonical Work identity.
-- It cannot replace the accepted commercial/Design basis or authorize execution itself.
-- Extend the existing private-document custody contract for an exact field-change review.
alter table d5o_hosted.customer_decision_evidence
  drop constraint customer_decision_evidence_purpose_check;
alter table d5o_hosted.customer_decision_evidence
  add constraint customer_decision_evidence_purpose_check
  check (purpose in ('package-acceptance','work-acceptance','service-authorization','field-change-authorization'));
create or replace function public.d5o_hosted_register_customer_decision_evidence_v1(
  p_workspace_key text,p_presentation_id text,p_evidence_id uuid,
  p_purpose text,p_scope_id text,p_scope_revision integer,p_basis jsonb,
  p_checksum_sha256 text,p_filename text,p_uploader_id uuid
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_workspace d5o_hosted.workspaces%rowtype;
  v_work d5o_hosted.work_records%rowtype;
  v_member d5o_hosted.memberships%rowtype;
  v_object storage.objects%rowtype;v_path text;
begin
  if current_setting('role',true)<>'service_role' or p_evidence_id is null
    or p_purpose not in ('package-acceptance','work-acceptance','service-authorization','field-change-authorization')
    or p_scope_revision<1 or pg_catalog.jsonb_typeof(p_basis)<>'object'
    or p_checksum_sha256 !~ '^[0-9a-f]{64}$' or p_uploader_id is null then
    raise exception 'invalid_customer_evidence_registration' using errcode='42501'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  select w.* into v_work from d5o_hosted.work_records w
    join d5o_hosted.work_identity_links l on l.workspace_id=w.workspace_id and l.work_id=w.id
    where w.workspace_id=v_workspace.id and l.presentation_id=p_presentation_id;
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=p_uploader_id and status='active';
  if v_work.id is null or v_member.id is null or v_member.role not in
    ('project_manager','operations_leader','field_supervisor') then
    raise exception 'customer_evidence_scope_denied' using errcode='42501'; end if;
  v_path:=p_workspace_key||'/'||pg_catalog.encode(
    extensions.digest(p_presentation_id,'sha256'),'hex')||'/customer-decisions/'||p_evidence_id::text;
  select * into v_object from storage.objects
    where bucket_id='d5o-deploy-evidence' and name=v_path;
  if v_object.id is null or v_object.metadata->>'mimetype'<>'application/pdf'
    or (v_object.metadata->>'size')::bigint not between 1 and 10485760 then
    raise exception 'customer_evidence_object_missing' using errcode='23514'; end if;
  insert into d5o_hosted.customer_decision_evidence(
    id,workspace_id,work_id,presentation_id,purpose,scope_id,scope_revision,basis,
    object_path,storage_object_id,storage_updated_at,checksum_sha256,size_bytes,
    mime_type,filename,uploaded_by)
  values(p_evidence_id,v_workspace.id,v_work.id,p_presentation_id,p_purpose,
    p_scope_id,p_scope_revision,p_basis,v_path,v_object.id,v_object.updated_at,
    p_checksum_sha256,(v_object.metadata->>'size')::bigint,'application/pdf',
    left(p_filename,200),p_uploader_id);
  return pg_catalog.jsonb_build_object('evidenceId',p_evidence_id,
    'checksumSha256',p_checksum_sha256,'sizeBytes',(v_object.metadata->>'size')::bigint);
end; $$;

create table d5o_hosted.connected_field_changes (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  workspace_id uuid not null,
  work_id uuid not null,
  package_id text not null,
  opened_release_id text not null,
  opened_package_revision integer not null,
  report_id text,
  evidence_ids jsonb not null default '[]'::jsonb,
  revision integer not null default 1,
  status text not null check(status in ('Open','Query','Proposed','Internal review','Returned','Internally approved','Customer authorized','Resolved')),
  kind text check(kind in ('Correction','Clarification','Scope change')),
  title text not null,
  impact text not null,
  owner_role text not null,
  due_date date,
  facts jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id)
);
create table d5o_hosted.connected_field_change_events (
  workspace_id uuid not null,change_id uuid not null references d5o_hosted.connected_field_changes(id),
  revision integer not null,command_id text not null,
  actor_user_id uuid not null references auth.users(id),
  membership_id uuid not null references d5o_hosted.memberships(id),
  action text not null,snapshot jsonb not null,occurred_at timestamptz not null default now(),
  primary key(change_id,revision),unique(workspace_id,command_id)
);
create table d5o_hosted.connected_field_change_receipts (
  workspace_id uuid not null,command_id text not null,
  actor_user_id uuid not null references auth.users(id),fingerprint text not null,
  result jsonb not null,primary key(workspace_id,command_id)
);
alter table d5o_hosted.connected_field_changes enable row level security;
alter table d5o_hosted.connected_field_change_events enable row level security;
alter table d5o_hosted.connected_field_change_receipts enable row level security;
revoke all on d5o_hosted.connected_field_changes,d5o_hosted.connected_field_change_events,
  d5o_hosted.connected_field_change_receipts from public,anon,authenticated,service_role;

create function public.d5o_hosted_field_change_read_v1(p_workspace_key text,p_presentation_id text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace uuid;v_member d5o_hosted.memberships%rowtype;
  v_work uuid;v_source_revision bigint;v_design_revision integer;v_deploy_revision integer;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null then
    raise exception 'membership_required' using errcode='42501'; end if;
  select id into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace and actor_user_id=v_actor and status='active';
  select work_id into v_work from d5o_hosted.work_identity_links
    where workspace_id=v_workspace and presentation_id=p_presentation_id;
  if v_member.id is null or v_work is null or
    (v_member.role='field_worker' and not exists(select 1
      from d5o_hosted.crew_bindings b
      join d5o_hosted.connected_schedule_states s on s.workspace_id=b.workspace_id
      where b.workspace_id=v_workspace and b.actor_user_id=v_actor and b.active
        and exists(select 1 from pg_catalog.jsonb_array_elements(coalesce(s.state->'publications','[]'::jsonb)) pub,
          lateral pg_catalog.jsonb_array_elements(pub->'assignments') a
          where a->>'workId'=p_presentation_id and a->'people' ? b.person))) then
    raise exception 'field_change_scope_denied' using errcode='42501'; end if;
  select revision into v_source_revision from d5o_hosted.prototype_states where workspace_id=v_workspace and state_key='work';
  select decision_revision into v_design_revision from d5o_hosted.connected_design_states where workspace_id=v_workspace and work_id=v_work;
  select decision_revision into v_deploy_revision from d5o_hosted.connected_deploy_states where workspace_id=v_workspace and work_id=v_work;
  return pg_catalog.jsonb_build_object('sourceRevision',v_source_revision,
    'designRevision',v_design_revision,'deployRevision',coalesce(v_deploy_revision,0),
    'changes',coalesce((select pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object('id',c.id,'packageId',c.package_id,
      'releaseId',c.opened_release_id,'packageRevision',c.opened_package_revision,
      'reportId',c.report_id,'evidenceIds',c.evidence_ids,'revision',c.revision,
      'status',c.status,'kind',c.kind,'title',c.title,'impact',c.impact,
      'ownerRole',c.owner_role,'dueDate',c.due_date,'facts',c.facts,
      'createdBy',c.created_by,'createdAt',c.created_at,'updatedAt',c.updated_at)
    order by c.created_at,c.id) from d5o_hosted.connected_field_changes c
    where c.workspace_id=v_workspace and c.work_id=v_work and
      (v_member.role<>'field_worker' or exists(select 1
        from d5o_hosted.crew_bindings b
        join d5o_hosted.connected_schedule_states s on s.workspace_id=b.workspace_id
        where b.workspace_id=v_workspace and b.actor_user_id=v_actor and b.active
          and exists(select 1 from pg_catalog.jsonb_array_elements(coalesce(s.state->'publications','[]'::jsonb)) pub,
            lateral pg_catalog.jsonb_array_elements(pub->'assignments') a
            where a->>'workId'=p_presentation_id and a->>'packageId'=c.package_id
              and a->'people' ? b.person)))),'[]'::jsonb));
end; $$;
revoke all on function public.d5o_hosted_field_change_read_v1(text,text) from public,anon,service_role;
grant execute on function public.d5o_hosted_field_change_read_v1(text,text) to authenticated;

create function public.d5o_hosted_field_change_command_v1(
  p_workspace_key text,p_presentation_id text,p_package_id text,
  p_change_id uuid,p_action text,p_input jsonb,p_command_id text,
  p_expected_source_revision bigint,p_expected_design_revision integer,
  p_expected_deploy_revision integer,p_expected_change_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace uuid;v_member d5o_hosted.memberships%rowtype;
  v_work d5o_hosted.work_records%rowtype;v_raw d5o_hosted.prototype_states%rowtype;
  v_design d5o_hosted.connected_design_states%rowtype;
  v_deploy d5o_hosted.connected_deploy_states%rowtype;
  v_change d5o_hosted.connected_field_changes%rowtype;
  v_receipt d5o_hosted.connected_field_change_receipts%rowtype;
  v_release jsonb;v_new_release jsonb;v_report jsonb;v_evidence jsonb;
  v_facts jsonb;v_status text;v_kind text;v_result jsonb;v_document jsonb;
  v_fingerprint text;v_now timestamptz:=now();v_due date;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or p_action not in ('raise','assess','answer-query','propose','submit-review',
      'review','record-customer','resolve')
    or pg_catalog.jsonb_typeof(p_input)<>'object'
    or length(coalesce(p_command_id,'')) not between 8 and 120
    or length(coalesce(p_package_id,'')) not between 2 and 120
    or p_expected_source_revision is null or p_expected_design_revision is null
    or p_expected_deploy_revision is null or p_expected_change_revision is null then
    raise exception 'invalid_field_change_command' using errcode='22023'; end if;
  select id into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace and actor_user_id=v_actor and status='active' for share;
  select w.* into v_work from d5o_hosted.work_records w
    join d5o_hosted.work_identity_links l on l.workspace_id=w.workspace_id and l.work_id=w.id
    where w.workspace_id=v_workspace and l.presentation_id=p_presentation_id for update of w;
  if v_member.id is null or v_work.id is null then
    raise exception 'field_change_scope_denied' using errcode='42501'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_workspace_key,
    p_presentation_id,p_package_id,p_change_id,p_action,p_input,
    p_expected_source_revision,p_expected_design_revision,
    p_expected_deploy_revision,p_expected_change_revision)::text);
  select * into v_receipt from d5o_hosted.connected_field_change_receipts
    where workspace_id=v_workspace and command_id=p_command_id;
  if found then
    if v_receipt.actor_user_id<>v_actor or v_receipt.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_receipt.result; end if;
  select * into v_raw from d5o_hosted.prototype_states
    where workspace_id=v_workspace and state_key='work' for share;
  select * into v_design from d5o_hosted.connected_design_states
    where workspace_id=v_workspace and work_id=v_work.id for share;
  select * into v_deploy from d5o_hosted.connected_deploy_states
    where workspace_id=v_workspace and work_id=v_work.id for update;
  if v_raw.revision is distinct from p_expected_source_revision
    or v_design.decision_revision is distinct from p_expected_design_revision
    or coalesce(v_deploy.decision_revision,0)<>p_expected_deploy_revision then
    raise exception 'stale_field_change_basis' using errcode='23505'; end if;
  select r into v_release from pg_catalog.jsonb_array_elements(
    coalesce(v_design.state->'releases','[]'::jsonb)) r
    where r->>'packageId'=p_package_id order by r->>'issuedAt' desc limit 1;
  if v_release is null or v_release->>'status'<>'Accepted' then
    raise exception 'accepted_release_required' using errcode='23514'; end if;
  if p_action='raise' then
    if v_deploy.state ? 'workAcceptance' then
      raise exception 'accepted_work_requires_service_or_amendment' using errcode='23514'; end if;
    if p_change_id is not null or p_expected_change_revision<>0
      or length(trim(coalesce(p_input->>'title','')))<8
      or length(trim(coalesce(p_input->>'impact','')))<10 then
      raise exception 'field_issue_incomplete' using errcode='22023'; end if;
    if v_member.role='field_worker' then
      if not exists(select 1 from d5o_hosted.crew_bindings b
        join d5o_hosted.connected_schedule_states s on s.workspace_id=b.workspace_id
        where b.workspace_id=v_workspace and b.actor_user_id=v_actor and b.active
          and exists(select 1 from pg_catalog.jsonb_array_elements(
            coalesce(s.state->'publications','[]'::jsonb)) pub,
            lateral pg_catalog.jsonb_array_elements(pub->'assignments') a
            where a->>'workId'=p_presentation_id and a->>'packageId'=p_package_id
              and a->'people' ? b.person)) then
        raise exception 'assignment_required' using errcode='42501'; end if;
    elsif v_member.role not in ('field_supervisor','operations_leader','project_manager','admin') then
      raise exception 'field_issue_role_denied' using errcode='42501'; end if;
    if nullif(p_input->>'reportId','') is not null then
      select r into v_report from pg_catalog.jsonb_array_elements(
        coalesce(v_deploy.state->'reports','[]'::jsonb)) r
        where r->>'id'=p_input->>'reportId' and r->>'packageId'=p_package_id
          and r->>'releaseId'=v_release->>'id';
      if v_report is null then raise exception 'issue_report_scope_invalid' using errcode='23514'; end if;
    end if;
    for v_evidence in select value from pg_catalog.jsonb_array_elements(
      coalesce(p_input->'evidenceIds','[]'::jsonb)) loop
      if not exists(select 1 from pg_catalog.jsonb_array_elements(
        coalesce(v_deploy.state->'evidence','[]'::jsonb)) e
        where e->>'id'=v_evidence#>>'{}' and e->>'packageId'=p_package_id
          and e->>'releaseId'=v_release->>'id') then
        raise exception 'issue_evidence_scope_invalid' using errcode='23514'; end if;
    end loop;
    insert into d5o_hosted.connected_field_changes(workspace_id,work_id,
      package_id,opened_release_id,opened_package_revision,report_id,evidence_ids,
      status,title,impact,owner_role,due_date,created_by)
    values(v_workspace,v_work.id,p_package_id,v_release->>'id',
      (v_release->>'packageRevision')::integer,nullif(p_input->>'reportId',''),
      coalesce(p_input->'evidenceIds','[]'::jsonb),'Open',trim(p_input->>'title'),
      trim(p_input->>'impact'),'operations_leader',
      nullif(p_input->>'dueDate','')::date,v_actor) returning * into v_change;
    -- The separate guard rejects new authorization while the issue is open.
    -- Existing factual reports remain available for truthful historical reporting.
  else
    select * into v_change from d5o_hosted.connected_field_changes
      where workspace_id=v_workspace and work_id=v_work.id and id=p_change_id
        and package_id=p_package_id for update;
    if v_change.id is null or v_change.revision<>p_expected_change_revision then
      raise exception 'stale_field_change' using errcode='23505'; end if;
    if v_change.status='Resolved' then raise exception 'change_already_resolved' using errcode='23514'; end if;
    v_facts:=v_change.facts;v_status:=v_change.status;v_kind:=v_change.kind;
    if p_action='assess' then
      if v_change.status<>'Open' or v_actor=v_change.created_by
        or v_member.role not in ('field_supervisor','operations_leader','project_manager')
        or p_input->>'kind' not in ('Correction','Clarification','Scope change')
        or length(trim(coalesce(p_input->>'reason','')))<15 then
        raise exception 'independent_issue_assessment_required' using errcode='42501'; end if;
      v_kind:=p_input->>'kind';v_status:=case when v_kind='Clarification' then 'Query' else 'Open' end;
      v_facts:=v_facts||pg_catalog.jsonb_build_object('assessment',p_input->>'reason',
        'assessedBy',v_actor,'assessedAt',v_now);
    elsif p_action='answer-query' then
      if v_change.status<>'Query' or v_member.role not in ('admin','project_manager')
        or length(trim(coalesce(p_input->>'response','')))<15 then
        raise exception 'technical_response_required' using errcode='42501'; end if;
      v_status:='Open';v_facts:=v_facts||pg_catalog.jsonb_build_object(
        'queryResponse',p_input->>'response','queryRespondedBy',v_actor,
        'queryRespondedAt',v_now);
    elsif p_action='propose' then
      if v_deploy.state ? 'workAcceptance' then
        raise exception 'accepted_scope_requires_amendment_work' using errcode='23514'; end if;
      if v_kind<>'Scope change' or v_change.status not in ('Open','Returned')
        or v_member.role not in ('project_manager','billing_commercial_lead')
        or length(trim(coalesce(p_input->>'scopeDifference','')))<15
        or length(trim(coalesce(p_input->>'costBasis','')))<10
        or length(trim(coalesce(p_input->>'priceBasis','')))<10
        or coalesce(p_input->>'currency','')!~'^[A-Z]{3}$'
        or coalesce(p_input->>'priceAmount','')!~'^\d+(\.\d{1,2})?$'
        or length(trim(coalesce(p_input->>'scheduleImpact','')))<5 then
        raise exception 'change_proposal_incomplete' using errcode='22023'; end if;
      v_status:='Proposed';v_facts:=v_facts||pg_catalog.jsonb_build_object(
        'proposal',pg_catalog.jsonb_build_object('revision',v_change.revision+1,
          'scopeDifference',p_input->>'scopeDifference','costBasis',p_input->>'costBasis',
          'priceBasis',p_input->>'priceBasis','priceAmount',p_input->>'priceAmount',
          'currency',p_input->>'currency','scheduleImpact',p_input->>'scheduleImpact',
          'assumptions',p_input->>'assumptions','proposedBy',v_actor,'at',v_now));
    elsif p_action='submit-review' then
      if v_status<>'Proposed' or v_member.role not in ('project_manager','billing_commercial_lead')
        or length(trim(coalesce(p_input->>'reason','')))<10 then
        raise exception 'change_submission_denied' using errcode='42501'; end if;
      v_status:='Internal review';v_facts:=v_facts||pg_catalog.jsonb_build_object(
        'submittedBy',v_actor,'submittedAt',v_now,'submissionReason',p_input->>'reason');
    elsif p_action='review' then
      if v_status<>'Internal review' or v_actor::text=v_facts->>'submittedBy'
        or v_member.role not in ('billing_commercial_lead','admin')
        or p_input->>'decision' not in ('Approved','Returned')
        or length(trim(coalesce(p_input->>'reason','')))<15 then
        raise exception 'independent_change_review_required' using errcode='42501'; end if;
      v_status:=case when p_input->>'decision'='Approved' then 'Internally approved' else 'Returned' end;
      v_facts:=v_facts||pg_catalog.jsonb_build_object('internalReview',
        pg_catalog.jsonb_build_object('decision',p_input->>'decision','actorId',v_actor,
          'at',v_now,'reason',p_input->>'reason'));
    elsif p_action='record-customer' then
      if v_status<>'Internally approved' or v_member.role not in ('project_manager','operations_leader')
        or length(trim(coalesce(p_input->>'customerRepresentative','')))<4
        or length(trim(coalesce(p_input->>'authorityBasis','')))<10
        or nullif(p_input->>'evidenceId','') is null then
        raise exception 'customer_change_source_required' using errcode='42501'; end if;
      v_document:=d5o_hosted.require_customer_decision_evidence_v1(
        v_workspace,v_work.id,p_input->>'evidenceId','field-change-authorization',
        v_change.id::text,v_change.revision,
        pg_catalog.jsonb_build_object('packageId',p_package_id,
          'proposal',v_facts->'proposal','internalReview',v_facts->'internalReview'));
      v_status:='Customer authorized';v_facts:=v_facts||pg_catalog.jsonb_build_object(
        'customerAuthorization',pg_catalog.jsonb_build_object(
          'representative',p_input->>'customerRepresentative',
          'organization',p_input->>'organization','authorityBasis',p_input->>'authorityBasis',
          'source','evidence:'||(p_input->>'evidenceId'),'document',v_document,
          'recordedBy',v_actor,'at',v_now));
    elsif p_action='resolve' then
      if v_member.role not in ('project_manager','operations_leader')
        or v_actor=v_change.created_by or length(trim(coalesce(p_input->>'reason','')))<15 then
        raise exception 'independent_change_resolution_required' using errcode='42501'; end if;
      if v_kind='Scope change' then
        if v_status<>'Customer authorized' then
          raise exception 'customer_change_authorization_required' using errcode='23514'; end if;
        select r into v_new_release from pg_catalog.jsonb_array_elements(
          coalesce(v_design.state->'releases','[]'::jsonb)) r
          where r->>'packageId'=p_package_id order by r->>'issuedAt' desc limit 1;
        if v_new_release->>'status'<>'Accepted' or
          (v_new_release->>'packageRevision')::integer<=v_change.opened_package_revision
          or v_new_release->>'id'=v_change.opened_release_id then
          raise exception 'revised_design_receipt_required' using errcode='23514'; end if;
        v_facts:=v_facts||pg_catalog.jsonb_build_object('revisedReleaseId',v_new_release->>'id',
          'revisedPackageRevision',v_new_release->>'packageRevision');
      elsif v_kind='Clarification' and coalesce(v_facts->>'queryResponse','')='' then
        raise exception 'technical_response_required' using errcode='23514'; end if;
      v_status:='Resolved';v_facts:=v_facts||pg_catalog.jsonb_build_object(
        'resolution',p_input->>'reason','resolvedBy',v_actor,'resolvedAt',v_now);
    end if;
    update d5o_hosted.connected_field_changes set kind=v_kind,status=v_status,
      owner_role=case when v_status in ('Proposed','Internal review') then 'billing_commercial_lead'
        when v_status='Internally approved' then 'project_manager'
        when v_status='Query' then 'project_manager'
        else 'operations_leader' end,
      facts=v_facts,revision=revision+1,updated_at=v_now
      where id=v_change.id returning * into v_change;
  end if;
  v_result:=pg_catalog.jsonb_build_object('id',v_change.id,'revision',v_change.revision,
    'status',v_change.status,'packageId',v_change.package_id,'facts',v_change.facts);
  insert into d5o_hosted.connected_field_change_events(workspace_id,change_id,
    revision,command_id,actor_user_id,membership_id,action,snapshot)
    values(v_workspace,v_change.id,v_change.revision,p_command_id,v_actor,
      v_member.id,p_action,pg_catalog.to_jsonb(v_change));
  insert into d5o_hosted.connected_field_change_receipts(
    workspace_id,command_id,actor_user_id,fingerprint,result)
    values(v_workspace,p_command_id,v_actor,v_fingerprint,v_result);
  return v_result;
end; $$;
revoke all on function public.d5o_hosted_field_change_command_v1(
  text,text,text,uuid,text,jsonb,text,bigint,integer,integer,integer)
  from public,anon,service_role;
grant execute on function public.d5o_hosted_field_change_command_v1(
  text,text,text,uuid,text,jsonb,text,bigint,integer,integer,integer)
  to authenticated;

-- Do not allow a later permit, completion, or acceptance to bypass an unresolved
-- field-origin condition through any alternate state writer.
create function d5o_hosted.guard_field_change_deploy_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from d5o_hosted.connected_field_changes c
    where c.workspace_id=new.workspace_id and c.work_id=new.work_id
      and c.status<>'Resolved') then
    if tg_op='INSERT' then
      if exists(select 1 from pg_catalog.jsonb_array_elements(coalesce(new.state->'permits','[]'::jsonb)) p
        where p->>'status'='Authorized' and p->>'packageId' in
          (select c.package_id from d5o_hosted.connected_field_changes c
            where c.workspace_id=new.workspace_id and c.work_id=new.work_id and c.status<>'Resolved')
          and not exists(select 1 from pg_catalog.jsonb_array_elements(coalesce(new.state->'permits','[]'::jsonb)) newer
            where newer->>'packageId'=p->>'packageId' and (newer->>'at')::timestamptz>(p->>'at')::timestamptz))
        or exists(select 1 from pg_catalog.jsonb_array_elements(coalesce(new.state->'completions','[]'::jsonb)) completed
          join d5o_hosted.connected_field_changes c on c.workspace_id=new.workspace_id
            and c.work_id=new.work_id and c.status<>'Resolved'
            and c.package_id=completed->>'packageId')
        or coalesce(new.state->'turnovers','[]'::jsonb)<>'[]'::jsonb
        or new.state ? 'workAcceptance' then
        raise exception 'open_field_change_blocks_decision' using errcode='23514'; end if;
    else
      if new.state->'permits' is distinct from old.state->'permits' and
        exists(select 1 from pg_catalog.jsonb_array_elements(coalesce(new.state->'permits','[]'::jsonb)) p
          where p->>'status'='Authorized' and p->>'packageId' in
            (select c.package_id from d5o_hosted.connected_field_changes c
              where c.workspace_id=new.workspace_id and c.work_id=new.work_id and c.status<>'Resolved')
            and not exists(select 1 from pg_catalog.jsonb_array_elements(coalesce(new.state->'permits','[]'::jsonb)) newer
              where newer->>'packageId'=p->>'packageId' and (newer->>'at')::timestamptz>(p->>'at')::timestamptz)) then
        raise exception 'open_field_change_blocks_start' using errcode='23514'; end if;
      if exists(select 1 from d5o_hosted.connected_field_changes c
        where c.workspace_id=new.workspace_id and c.work_id=new.work_id
          and c.status<>'Resolved' and
          coalesce((select pg_catalog.jsonb_agg(x) from pg_catalog.jsonb_array_elements(coalesce(new.state->'completions','[]'::jsonb)) x where x->>'packageId'=c.package_id),'[]'::jsonb)
          is distinct from
          coalesce((select pg_catalog.jsonb_agg(x) from pg_catalog.jsonb_array_elements(coalesce(old.state->'completions','[]'::jsonb)) x where x->>'packageId'=c.package_id),'[]'::jsonb))
        or new.state->'turnovers' is distinct from old.state->'turnovers'
        or new.state->'workAcceptance' is distinct from old.state->'workAcceptance' then
        raise exception 'open_field_change_blocks_completion' using errcode='23514'; end if;
    end if;
  end if;
  return new;
end; $$;
revoke all on function d5o_hosted.guard_field_change_deploy_v1() from public,anon,authenticated,service_role;
create trigger guard_field_change_deploy before insert or update on d5o_hosted.connected_deploy_states
  for each row execute function d5o_hosted.guard_field_change_deploy_v1();

-- An approved price/customer decision is necessary but insufficient to issue
-- additional Design scope. The exact field change must be recorded in Design,
-- independently reviewed on the newer package revision, and released normally.
create function d5o_hosted.guard_field_change_design_release_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_release jsonb;v_change d5o_hosted.connected_field_changes%rowtype;
begin
  for v_release in select value from pg_catalog.jsonb_array_elements(
    coalesce(new.state->'releases','[]'::jsonb)) loop
    if tg_op='UPDATE' and exists(select 1 from pg_catalog.jsonb_array_elements(
      coalesce(old.state->'releases','[]'::jsonb)) prior
      where prior->>'id'=v_release->>'id') then continue; end if;
    -- A resolved field change remains part of the exact design source. Never
    -- let resolution erase the requirement for its reviewed revised basis.
    for v_change in select * from d5o_hosted.connected_field_changes c
      where c.workspace_id=new.workspace_id and c.work_id=new.work_id
        and c.package_id=v_release->>'packageId' and c.kind='Scope change' loop
      if v_change.status not in ('Customer authorized','Resolved')
        or not (v_change.facts ? 'customerAuthorization') then
        raise exception 'customer_change_authorization_required' using errcode='23514'; end if;
      if (v_release->>'packageRevision')::integer<=v_change.opened_package_revision
        or not exists(select 1 from pg_catalog.jsonb_array_elements(
          coalesce(new.state->'changes','[]'::jsonb)) item
          where item->>'packageId'=v_change.package_id
            and item->>'source'=('field-change:'||(v_change.id::text))
            and item->>'status'='Resolved'
            and (item->>'openedRevision')::integer=v_change.opened_package_revision) then
        raise exception 'field_change_design_revision_required' using errcode='23514'; end if;
    end loop;
  end loop;
  return new;
end; $$;revoke all on function d5o_hosted.guard_field_change_design_release_v1()
  from public,anon,authenticated,service_role;
create trigger guard_field_change_design_release before insert or update
  on d5o_hosted.connected_design_states for each row
  execute function d5o_hosted.guard_field_change_design_release_v1();
