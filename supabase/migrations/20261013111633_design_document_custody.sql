-- Immutable private-file receipts for exact Design document revisions.
-- Files use the existing private D5O evidence bucket; these rows only bind bytes
-- and storage identity to one canonical Work/document revision.
create table d5o_hosted.design_document_evidence (
  id uuid primary key,
  workspace_id uuid not null references d5o_hosted.workspaces(id),
  work_id uuid not null references d5o_hosted.work_records(id),
  presentation_id text not null,
  document_id text not null,
  document_revision integer not null check (document_revision > 0),
  object_path text not null unique,
  storage_object_id uuid not null unique,
  storage_updated_at timestamptz not null,
  checksum_sha256 text not null check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  filename text not null,
  uploaded_by uuid not null references auth.users(id),
  uploaded_at timestamptz not null default now(),
  unique (workspace_id,work_id,document_id,document_revision)
);
alter table d5o_hosted.design_document_evidence enable row level security;
revoke all on d5o_hosted.design_document_evidence from public,anon,authenticated,service_role;

create function public.d5o_hosted_register_design_document_evidence_v1(
  p_workspace_key text,p_presentation_id text,p_document_id text,
  p_document_revision integer,p_evidence_id uuid,p_checksum_sha256 text,
  p_filename text,p_uploader_id uuid
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_workspace d5o_hosted.workspaces%rowtype;
  v_work d5o_hosted.work_records%rowtype;
  v_member d5o_hosted.memberships%rowtype;
  v_design d5o_hosted.connected_design_states%rowtype;
  v_document jsonb;v_object storage.objects%rowtype;v_path text;
begin
  if current_setting('role',true)<>'service_role' or p_evidence_id is null
    or p_document_revision<1 or p_checksum_sha256 !~ '^[0-9a-f]{64}$'
    or p_uploader_id is null or length(coalesce(p_filename,'')) not between 1 and 200 then
    raise exception 'invalid_design_document_registration' using errcode='42501'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  select w.* into v_work from d5o_hosted.work_records w
    join d5o_hosted.work_identity_links l on l.workspace_id=w.workspace_id and l.work_id=w.id
    where w.workspace_id=v_workspace.id and l.presentation_id=p_presentation_id for share of w;
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=p_uploader_id
      and status='active' and role in ('project_manager','admin') for share;
  select * into v_design from d5o_hosted.connected_design_states
    where workspace_id=v_workspace.id and work_id=v_work.id for share;
  select d into v_document from pg_catalog.jsonb_array_elements(
    coalesce(v_design.state->'documents','[]'::jsonb)) d
    where d->>'id'=p_document_id and (d->>'revision')::integer=p_document_revision;
  if v_work.id is null or v_member.id is null or v_document is null
    or v_document->>'status'<>'Draft' then
    raise exception 'design_document_upload_denied' using errcode='42501'; end if;
  v_path:=p_workspace_key||'/'||pg_catalog.encode(
    extensions.digest(p_presentation_id,'sha256'),'hex')||'/design-documents/'||p_evidence_id::text;
  select * into v_object from storage.objects
    where bucket_id='d5o-deploy-evidence' and name=v_path;
  if v_object.id is null or v_object.metadata->>'mimetype'<>'application/pdf'
    or (v_object.metadata->>'size')::bigint not between 1 and 10485760 then
    raise exception 'design_document_object_missing' using errcode='23514'; end if;
  insert into d5o_hosted.design_document_evidence(id,workspace_id,work_id,
    presentation_id,document_id,document_revision,object_path,storage_object_id,
    storage_updated_at,checksum_sha256,size_bytes,filename,uploaded_by)
  values(p_evidence_id,v_workspace.id,v_work.id,p_presentation_id,p_document_id,
    p_document_revision,v_path,v_object.id,v_object.updated_at,p_checksum_sha256,
    (v_object.metadata->>'size')::bigint,left(p_filename,200),p_uploader_id);
  return pg_catalog.jsonb_build_object('evidenceId',p_evidence_id,
    'checksumSha256',p_checksum_sha256,'filename',left(p_filename,200));
end; $$;
revoke all on function public.d5o_hosted_register_design_document_evidence_v1(
  text,text,text,integer,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.d5o_hosted_register_design_document_evidence_v1(
  text,text,text,integer,uuid,text,text,uuid) to service_role;

create function public.d5o_hosted_design_document_evidence_read_v1(
  p_workspace_key text,p_presentation_id text,p_document_id text,
  p_document_revision integer
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_evidence d5o_hosted.design_document_evidence%rowtype;
begin
  if current_setting('role',true)<>'service_role' then
    raise exception 'server_only' using errcode='42501'; end if;
  select e.* into v_evidence from d5o_hosted.design_document_evidence e
    join d5o_hosted.workspaces w on w.id=e.workspace_id
    where w.workspace_key=p_workspace_key and e.presentation_id=p_presentation_id
      and e.document_id=p_document_id and e.document_revision=p_document_revision;
  if not found then return null; end if;
  return pg_catalog.jsonb_build_object('evidenceId',v_evidence.id,
    'documentId',v_evidence.document_id,'documentRevision',v_evidence.document_revision,
    'objectPath',v_evidence.object_path,'checksumSha256',v_evidence.checksum_sha256,
    'filename',v_evidence.filename,'sizeBytes',v_evidence.size_bytes,
    'uploadedBy',v_evidence.uploaded_by,'uploadedAt',v_evidence.uploaded_at);
end; $$;
revoke all on function public.d5o_hosted_design_document_evidence_read_v1(
  text,text,text,integer) from public,anon,authenticated;
grant execute on function public.d5o_hosted_design_document_evidence_read_v1(
  text,text,text,integer) to service_role;

create function d5o_hosted.require_design_document_evidence_v1(
  p_workspace_id uuid,p_work_id uuid,p_document_id text,
  p_document_revision integer,p_evidence_id text
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_evidence d5o_hosted.design_document_evidence%rowtype;
  v_object storage.objects%rowtype;
begin
  select * into v_evidence from d5o_hosted.design_document_evidence
    where id::text=p_evidence_id and workspace_id=p_workspace_id and work_id=p_work_id
      and document_id=p_document_id and document_revision=p_document_revision;
  if not found then raise exception 'exact_design_document_evidence_required' using errcode='23514'; end if;
  select * into v_object from storage.objects
    where bucket_id='d5o-deploy-evidence' and name=v_evidence.object_path;
  if v_object.id is distinct from v_evidence.storage_object_id
    or v_object.updated_at is distinct from v_evidence.storage_updated_at
    or (v_object.metadata->>'size')::bigint is distinct from v_evidence.size_bytes
    or v_object.metadata->>'mimetype' is distinct from 'application/pdf' then
    raise exception 'design_document_bytes_changed' using errcode='23514'; end if;
  return pg_catalog.jsonb_build_object('evidenceId',v_evidence.id,
    'checksumSha256',v_evidence.checksum_sha256,'filename',v_evidence.filename,
    'sizeBytes',v_evidence.size_bytes,'uploadedBy',v_evidence.uploaded_by,
    'uploadedAt',v_evidence.uploaded_at);
end; $$;
revoke all on function d5o_hosted.require_design_document_evidence_v1(
  uuid,uuid,text,integer,text) from public,anon,authenticated,service_role;

create or replace function public.d5o_hosted_design_review_command_v1(
  p_workspace_key text,p_presentation_id text,p_action text,p_input jsonb,
  p_command_id text,p_expected_source_revision bigint,
  p_expected_decision_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
  v_member d5o_hosted.memberships%rowtype;v_work d5o_hosted.work_records%rowtype;
  v_raw d5o_hosted.prototype_states%rowtype;
  v_handoff d5o_hosted.connected_design_handoffs%rowtype;
  v_design d5o_hosted.connected_design_states%rowtype;
  v_receipt d5o_hosted.connected_design_receipts%rowtype;
  v_fingerprint text;v_state jsonb;v_result jsonb;v_target jsonb;v_evidence jsonb;
  v_documents jsonb;v_reviews jsonb;v_packages jsonb;v_policy jsonb;
  v_now timestamptz:=now();v_id text;v_revision integer;v_package text;
  v_discipline text;v_note text:=trim(coalesce(p_input->>'note',''));
  v_due text;v_decision text;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or p_action not in ('submit-document','return-document','approve-document','issue-document',
      'request-review','decide-review')
    or p_input is null or pg_catalog.jsonb_typeof(p_input)<>'object'
    or length(coalesce(p_command_id,'')) not between 8 and 120
    or p_expected_source_revision is null or p_expected_source_revision<1
    or p_expected_decision_revision is null or p_expected_decision_revision<1 then
    raise exception 'invalid_design_review_command' using errcode='22023'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor and status='active' for share;
  if not found then raise exception 'design_review_role_denied' using errcode='42501'; end if;
  select w.* into v_work from d5o_hosted.work_records w
    join d5o_hosted.work_identity_links l on l.work_id=w.id and l.workspace_id=w.workspace_id
    where w.workspace_id=v_workspace.id and l.presentation_id=p_presentation_id
    for update of w;
  if not found then raise exception 'connected_work_unavailable' using errcode='42501'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_workspace_key,
    p_presentation_id,p_action,p_input,p_expected_source_revision,
    p_expected_decision_revision)::text);
  select * into v_receipt from d5o_hosted.connected_design_receipts
    where workspace_id=v_workspace.id and command_id=p_command_id;
  if found then
    if v_receipt.work_id<>v_work.id or v_receipt.actor_user_id<>v_actor
      or v_receipt.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_receipt.result;
  end if;
  select * into v_raw from d5o_hosted.prototype_states
    where workspace_id=v_workspace.id and state_key='work' for share;
  select * into v_handoff from d5o_hosted.connected_design_handoffs
    where workspace_id=v_workspace.id and work_id=v_work.id for share;
  select * into v_design from d5o_hosted.connected_design_states
    where workspace_id=v_workspace.id and work_id=v_work.id for update;
  if v_raw.revision is distinct from p_expected_source_revision
    or v_design.decision_revision is distinct from p_expected_decision_revision
    or v_handoff.status is distinct from 'accepted'
    or v_design.source_handoff_revision<>v_handoff.revision then
    raise exception 'stale_design_review_basis' using errcode='23505'; end if;
  select wt->'designControls' into v_policy
    from d5o_hosted.configuration_versions c,
      lateral pg_catalog.jsonb_array_elements(
        c.manifest_json#>'{d5oPresentation,phaseContract,workTypes}') wt
    where c.id=v_work.configuration_version_id
      and wt->>'workTypeKey'=v_work.work_type_key;
  if v_policy is null or v_policy->>'schemaVersion'<>'1' then
    raise exception 'pinned_design_policy_unavailable' using errcode='23514'; end if;
  v_state:=v_design.state;
  v_documents:=v_state->'documents';v_reviews:=v_state->'reviews';
  v_packages:=v_state->'packages';
  if p_action in ('submit-document','return-document','approve-document','issue-document') then
    v_id:=p_input->>'documentId';
    v_revision:=(p_input->>'documentRevision')::integer;
    select d into v_target from pg_catalog.jsonb_array_elements(v_documents) d
      where d->>'id'=v_id and (d->>'revision')::integer=v_revision;
    if v_target is null then raise exception 'document_revision_missing' using errcode='23514'; end if;
    if p_action='submit-document' then
      if v_member.role not in ('project_manager','admin')
        or v_target->>'status'<>'Draft' then
        raise exception 'document_submission_denied' using errcode='42501'; end if;
      v_evidence:=d5o_hosted.require_design_document_evidence_v1(
        v_workspace.id,v_work.id,v_id,v_revision,p_input->>'evidenceId');
      v_target:=v_target||pg_catalog.jsonb_build_object('status','In review',
        'submittedByActorId',v_actor,'submittedAt',v_now,
        'evidenceId',v_evidence->>'evidenceId',
        'evidenceChecksumSha256',v_evidence->>'checksumSha256');
    elsif p_action='return-document' then
      if v_member.role<>'operations_leader'
        or v_target->>'status'<>'In review'
        or v_target->>'submittedByActorId'=v_actor::text
        or length(v_note)<15 then
        raise exception 'independent_document_return_required' using errcode='42501'; end if;
      v_target:=v_target||pg_catalog.jsonb_build_object('status','Returned',
        'returnedByActorId',v_actor,'returnedAt',v_now,'returnNote',v_note);
    elsif p_action='approve-document' then
      if v_member.role<>'operations_leader'
        or v_target->>'status'<>'In review'
        or v_target->>'submittedByActorId'=v_actor::text
        or length(v_note)<15 then
        raise exception 'independent_document_review_required' using errcode='42501'; end if;
      v_evidence:=d5o_hosted.require_design_document_evidence_v1(
        v_workspace.id,v_work.id,v_id,v_revision,v_target->>'evidenceId');
      if v_target->>'evidenceChecksumSha256'<>v_evidence->>'checksumSha256' then
        raise exception 'design_document_checksum_changed' using errcode='23514'; end if;
      v_target:=v_target||pg_catalog.jsonb_build_object('status','Approved',
        'approvedByActorId',v_actor,'approvedByMembershipId',v_member.id,
        'approvedAt',v_now,'reviewNote',v_note);
    else
      if v_member.role not in ('project_manager','admin')
        or v_target->>'status'<>'Approved'
        or v_target->>'approvedByActorId'=v_actor::text then
        raise exception 'independent_document_issue_required' using errcode='42501'; end if;
      v_evidence:=d5o_hosted.require_design_document_evidence_v1(
        v_workspace.id,v_work.id,v_id,v_revision,v_target->>'evidenceId');
      if v_target->>'evidenceChecksumSha256'<>v_evidence->>'checksumSha256' then
        raise exception 'design_document_checksum_changed' using errcode='23514'; end if;
      if exists(select 1 from pg_catalog.jsonb_array_elements(v_state->'releases') r
        where r->>'status' in ('Awaiting receipt','Accepted')
          and r->'documentRefs' ? (v_id||'@'||v_revision::text)) then
        raise exception 'active_field_revision_locked' using errcode='23514'; end if;
      v_target:=v_target||pg_catalog.jsonb_build_object('status','Issued for use',
        'issuedAt',v_now,'issuedBy',v_actor);
    end if;
    v_documents:=(select pg_catalog.jsonb_agg(case when d->>'id'=v_id
      and (d->>'revision')::integer=v_revision then v_target else d end order by ordinal)
      from pg_catalog.jsonb_array_elements(v_documents)
        with ordinality as entries(d,ordinal));
    v_state:=pg_catalog.jsonb_set(v_state,'{documents}',v_documents);
  elsif p_action='request-review' then
    v_package:=p_input->>'packageId';
    v_discipline:=p_input->>'discipline';
    v_due:=p_input->>'dueDate';
    select p into v_target from pg_catalog.jsonb_array_elements(v_packages) p
      where p->>'packageId'=v_package;
    if v_member.role not in ('project_manager','admin') or v_target is null
      or v_discipline is null or not (v_policy->'requiredReviews' ? v_discipline)
      or v_due is null or v_due !~ '^\d{4}-\d{2}-\d{2}$'
      or p_input->>'assignee' is distinct from v_discipline||' review queue'
      or exists(select 1 from pg_catalog.jsonb_array_elements(v_reviews) r
        where r->>'packageId'=v_package
          and r->>'revision'=v_target->>'revision'
          and r->>'discipline'=v_discipline and r->>'status'='Requested') then
      raise exception 'package_review_request_invalid' using errcode='23514'; end if;
    v_id:=gen_random_uuid()::text;
    v_revision:=(v_target->>'revision')::integer;
    v_reviews:=v_reviews||pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('id',v_id,'packageId',v_package,
        'revision',v_revision,'discipline',v_discipline,'status','Requested',
        'assignee',v_discipline||' review queue','dueDate',v_due,
        'requestedAt',v_now,'requestedByActorId',v_actor,
        'requestedByMembershipId',v_member.id));
    v_state:=pg_catalog.jsonb_set(v_state,'{reviews}',v_reviews);
    v_packages:=(select pg_catalog.jsonb_agg(case when p->>'packageId'=v_package
      then p||pg_catalog.jsonb_build_object('status','In review') else p end order by ordinal)
      from pg_catalog.jsonb_array_elements(v_packages)
        with ordinality as entries(p,ordinal));
    v_state:=pg_catalog.jsonb_set(v_state,'{packages}',v_packages);
  else
    v_id:=p_input->>'reviewId';
    v_decision:=p_input->>'decision';
    select r into v_target from pg_catalog.jsonb_array_elements(v_reviews) r
      where r->>'id'=v_id;
    v_package:=v_target->>'packageId';
    v_revision:=(v_target->>'revision')::integer;
    if v_member.role<>'operations_leader' or v_target is null
      or v_target->>'status'<>'Requested'
      or v_target->>'requestedByActorId'=v_actor::text
      or v_decision not in ('Approved','Returned')
      or length(v_note)<15
      or not exists(select 1 from pg_catalog.jsonb_array_elements(v_packages) p
        where p->>'packageId'=v_package
          and (p->>'revision')::integer=v_revision) then
      raise exception 'independent_package_review_required' using errcode='42501'; end if;
    v_target:=v_target||pg_catalog.jsonb_build_object('status',v_decision,
      'decidedAt',v_now,'decidedByActorId',v_actor,
      'decidedByMembershipId',v_member.id,'note',v_note);
    v_reviews:=(select pg_catalog.jsonb_agg(case when r->>'id'=v_id
      then v_target else r end order by ordinal)
      from pg_catalog.jsonb_array_elements(v_reviews)
        with ordinality as entries(r,ordinal));
    v_state:=pg_catalog.jsonb_set(v_state,'{reviews}',v_reviews);
    if v_decision='Returned' then
      v_packages:=(select pg_catalog.jsonb_agg(case when p->>'packageId'=v_package
        then p||pg_catalog.jsonb_build_object('status','Returned') else p end order by ordinal)
        from pg_catalog.jsonb_array_elements(v_packages)
          with ordinality as entries(p,ordinal));
      v_state:=pg_catalog.jsonb_set(v_state,'{packages}',v_packages);
    end if;
  end if;
  v_state:=v_state||pg_catalog.jsonb_build_object(
    'authorityRevision',v_design.decision_revision+1,
    'history',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'at',v_now,'actorId',v_actor,'membershipId',v_member.id,
      'action',p_action||' · '||p_command_id,'note',v_note,
      'packageId',v_package,'revision',v_revision))||
      coalesce(v_state->'history','[]'::jsonb));
  update d5o_hosted.connected_design_states set
    decision_revision=decision_revision+1,state=v_state,updated_at=v_now
    where workspace_id=v_workspace.id and work_id=v_work.id;
  insert into d5o_hosted.connected_design_events(workspace_id,work_id,
    decision_revision,command_id,action,actor_user_id,membership_id,
    source_handoff_revision,snapshot,reason)
  values(v_workspace.id,v_work.id,v_design.decision_revision+1,p_command_id,
    p_action,v_actor,v_member.id,v_handoff.revision,v_state,v_note);
  v_result:=public.d5o_hosted_prototype_read_v1(p_workspace_key,'work');
  insert into d5o_hosted.connected_design_receipts(workspace_id,command_id,
    work_id,actor_user_id,fingerprint,result)
  values(v_workspace.id,p_command_id,v_work.id,v_actor,v_fingerprint,v_result);
  return v_result;
end; $$;
revoke all on function public.d5o_hosted_design_review_command_v1(
  text,text,text,jsonb,text,bigint,integer) from public,anon,service_role;
grant execute on function public.d5o_hosted_design_review_command_v1(
  text,text,text,jsonb,text,bigint,integer) to authenticated;
