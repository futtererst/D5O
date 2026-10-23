-- Private, immutable document receipts for external customer decisions.
-- The server verifies bytes and SHA-256 before registering a receipt; authenticated
-- users can only reference an existing receipt in typed decision commands.
create table if not exists d5o_hosted.customer_decision_evidence (
  id uuid primary key,
  workspace_id uuid not null references d5o_hosted.workspaces(id),
  work_id uuid not null references d5o_hosted.work_records(id),
  presentation_id text not null,
  purpose text not null check (purpose in ('package-acceptance','work-acceptance','service-authorization')),
  scope_id text not null,
  scope_revision integer not null check (scope_revision > 0),
  basis jsonb not null,
  object_path text not null unique,
  storage_object_id uuid not null unique,
  storage_updated_at timestamptz not null,
  checksum_sha256 text not null check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  mime_type text not null check (mime_type = 'application/pdf'),
  filename text not null,
  uploaded_by uuid not null,
  uploaded_at timestamptz not null default now(),
  unique (workspace_id,id,work_id)
);
alter table d5o_hosted.customer_decision_evidence enable row level security;
revoke all on d5o_hosted.customer_decision_evidence from public,anon,authenticated;

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
    or p_purpose not in ('package-acceptance','work-acceptance','service-authorization')
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
revoke all on function public.d5o_hosted_register_customer_decision_evidence_v1(
  text,text,uuid,text,text,integer,jsonb,text,text,uuid) from public,anon,authenticated;
grant execute on function public.d5o_hosted_register_customer_decision_evidence_v1(
  text,text,uuid,text,text,integer,jsonb,text,text,uuid) to service_role;

create or replace function public.d5o_hosted_customer_decision_evidence_read_v1(
  p_workspace_key text,p_presentation_id text,p_evidence_id uuid
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_evidence d5o_hosted.customer_decision_evidence%rowtype;
begin
  if current_setting('role',true)<>'service_role' then
    raise exception 'server_only' using errcode='42501'; end if;
  select e.* into v_evidence from d5o_hosted.customer_decision_evidence e
    join d5o_hosted.workspaces w on w.id=e.workspace_id
    where w.workspace_key=p_workspace_key and e.presentation_id=p_presentation_id
      and e.id=p_evidence_id;
  if not found then raise exception 'evidence_missing' using errcode='23503'; end if;
  return pg_catalog.jsonb_build_object('objectPath',v_evidence.object_path,
    'checksumSha256',v_evidence.checksum_sha256,'filename',v_evidence.filename);
end; $$;
revoke all on function public.d5o_hosted_customer_decision_evidence_read_v1(
  text,text,uuid) from public,anon,authenticated;
grant execute on function public.d5o_hosted_customer_decision_evidence_read_v1(
  text,text,uuid) to service_role;

create or replace function d5o_hosted.require_customer_decision_evidence_v1(
  p_workspace_id uuid,p_work_id uuid,p_evidence_id text,p_purpose text,
  p_scope_id text,p_scope_revision integer,p_basis jsonb
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_evidence d5o_hosted.customer_decision_evidence%rowtype;
  v_object storage.objects%rowtype;
begin
  select * into v_evidence from d5o_hosted.customer_decision_evidence
    where id::text=p_evidence_id and workspace_id=p_workspace_id
      and work_id=p_work_id and purpose=p_purpose and scope_id=p_scope_id
      and scope_revision=p_scope_revision and basis=p_basis;
  if not found then raise exception 'exact_customer_evidence_required' using errcode='23514'; end if;
  select * into v_object from storage.objects
    where bucket_id='d5o-deploy-evidence' and name=v_evidence.object_path;
  if v_object.id is distinct from v_evidence.storage_object_id
    or v_object.updated_at is distinct from v_evidence.storage_updated_at
    or (v_object.metadata->>'size')::bigint is distinct from v_evidence.size_bytes
    or v_object.metadata->>'mimetype' is distinct from v_evidence.mime_type then
    raise exception 'customer_evidence_bytes_changed' using errcode='23514'; end if;
  return pg_catalog.jsonb_build_object('id',v_evidence.id,
    'checksumSha256',v_evidence.checksum_sha256,
    'sizeBytes',v_evidence.size_bytes,'uploadedBy',v_evidence.uploaded_by,
    'uploadedAt',v_evidence.uploaded_at,'storageObjectId',v_evidence.storage_object_id,
    'filename',v_evidence.filename,'purpose',v_evidence.purpose,
    'scopeId',v_evidence.scope_id,'scopeRevision',v_evidence.scope_revision);
end; $$;
revoke all on function d5o_hosted.require_customer_decision_evidence_v1(
  uuid,uuid,text,text,text,integer,jsonb) from public,anon,authenticated,service_role;
-- Scoped turnover and whole-Work acceptance are separate from field reporting
-- and from independent Operations receipt. All facts are resolved in one lock.
create or replace function public.d5o_hosted_acceptance_command_v1(
  p_workspace_key text,p_presentation_id text,p_package_id text,
  p_action text,p_input jsonb,p_command_id text,
  p_expected_source_revision bigint,p_expected_design_revision integer,
  p_expected_deploy_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
  v_member d5o_hosted.memberships%rowtype;v_work d5o_hosted.work_records%rowtype;
  v_raw d5o_hosted.prototype_states%rowtype;
  v_design d5o_hosted.connected_design_states%rowtype;
  v_schedule d5o_hosted.connected_schedule_states%rowtype;
  v_deploy d5o_hosted.connected_deploy_states%rowtype;
  v_receipt d5o_hosted.connected_deploy_receipts%rowtype;
  v_state jsonb;v_release jsonb;v_turnover jsonb;v_acceptance jsonb;v_evidence jsonb;
  v_item jsonb;v_requirement text;v_package text;v_current jsonb;
  v_all_turnovers jsonb:='[]'::jsonb;v_release_ids jsonb:='[]'::jsonb;
  v_now timestamptz:=now();v_fingerprint text;v_result jsonb;
  v_note text:=trim(coalesce(p_input->>'note',''));
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or p_action not in ('assemble-turnover','accept-client','accept-work',
      'respond-operate','respond-operate-work')
    or pg_catalog.jsonb_typeof(p_input)<>'object'
    or length(coalesce(p_command_id,'')) not between 8 and 120
    or p_expected_source_revision is null or p_expected_source_revision<1
    or p_expected_design_revision is null or p_expected_design_revision<1
    or p_expected_deploy_revision is null or p_expected_deploy_revision<1 then
    raise exception 'invalid_acceptance_command' using errcode='22023'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor and status='active' for share;
  if not found then raise exception 'acceptance_membership_required' using errcode='42501'; end if;
  select w.* into v_work from d5o_hosted.work_records w
    join d5o_hosted.work_identity_links l on l.work_id=w.id
      and l.workspace_id=w.workspace_id
    where w.workspace_id=v_workspace.id and l.presentation_id=p_presentation_id
      for update of w;
  if not found then raise exception 'connected_work_unavailable' using errcode='42501'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_workspace_key,
    p_presentation_id,p_package_id,p_action,p_input,p_expected_source_revision,
    p_expected_design_revision,p_expected_deploy_revision)::text);
  select * into v_receipt from d5o_hosted.connected_deploy_receipts
    where workspace_id=v_workspace.id and command_id=p_command_id;
  if found then
    if v_receipt.work_id<>v_work.id or v_receipt.actor_user_id<>v_actor
      or v_receipt.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_receipt.result; end if;
  select * into v_raw from d5o_hosted.prototype_states
    where workspace_id=v_workspace.id and state_key='work' for share;
  select * into v_design from d5o_hosted.connected_design_states
    where workspace_id=v_workspace.id and work_id=v_work.id for share;
  select * into v_schedule from d5o_hosted.connected_schedule_states
    where workspace_id=v_workspace.id for share;
  select * into v_deploy from d5o_hosted.connected_deploy_states
    where workspace_id=v_workspace.id and work_id=v_work.id for update;
  if v_raw.revision is distinct from p_expected_source_revision
    or v_design.decision_revision is distinct from p_expected_design_revision
    or v_deploy.decision_revision is distinct from p_expected_deploy_revision then
    raise exception 'stale_acceptance_basis' using errcode='23505'; end if;
  v_state:=v_deploy.state;
  if p_action in ('assemble-turnover','accept-client','respond-operate') then
    select r into v_release from pg_catalog.jsonb_array_elements(v_design.state->'releases') r
      where r->>'packageId'=p_package_id order by r->>'issuedAt' desc limit 1;
    if v_release is null or v_release->>'status'<>'Accepted'
      or (v_release->>'packageRevision')::integer<>
        (select (p->>'revision')::integer from pg_catalog.jsonb_array_elements(
          v_design.state->'packages') p where p->>'packageId'=p_package_id) then
      raise exception 'current_accepted_release_required' using errcode='23514'; end if;
  end if;
  if p_action='assemble-turnover' then
    if v_member.role not in ('project_manager','field_supervisor')
      or length(trim(coalesce(p_input->>'operateOwner','')))<3 then
      raise exception 'turnover_assembly_authority_required' using errcode='42501'; end if;
    if not exists(select 1 from pg_catalog.jsonb_array_elements(v_state->'completions') c
      where c->>'packageId'=p_package_id and c->>'releaseId'=v_release->>'id'
        and c->>'status'='Reviewed') then
      raise exception 'reviewed_completion_required' using errcode='23514'; end if;
    if exists(select 1 from pg_catalog.jsonb_array_elements(v_state->'issues') i
      where i->>'packageId'=p_package_id and i->>'status'='Open') then
      raise exception 'open_issue_blocks_turnover' using errcode='23514'; end if;
    if exists(select 1 from pg_catalog.jsonb_array_elements(v_state->'turnovers') t
      where t->'releaseIds' ? (v_release->>'id') and t->>'status' in
        ('Draft','Client accepted','Conditionally accepted')) then
      raise exception 'current_turnover_already_exists' using errcode='23514'; end if;
    v_turnover:=pg_catalog.jsonb_build_object('id',gen_random_uuid(),
      'revision',1,'releaseIds',pg_catalog.jsonb_build_array(v_release->>'id'),
      'packageId',p_package_id,'reportIds',
        (select pg_catalog.jsonb_agg(r->>'id') from pg_catalog.jsonb_array_elements(v_state->'reports') r
          where r->>'packageId'=p_package_id and r->>'releaseId'=v_release->>'id'
            and r->>'status'='Reviewed'),
      'inspectionIds',
        (select pg_catalog.jsonb_agg(i->>'id') from pg_catalog.jsonb_array_elements(v_state->'inspections') i
          where i->>'packageId'=p_package_id and i->>'releaseId'=v_release->>'id'
            and i->>'status'='Verified' and i->>'result'='Pass'),
      'evidenceIds',
        (select pg_catalog.jsonb_agg(e->>'id') from pg_catalog.jsonb_array_elements(v_state->'evidence') e
          where e->>'packageId'=p_package_id and e->>'releaseId'=v_release->>'id'
            and e->>'state'='Reviewed'),
      'completionId',(select c->>'id' from pg_catalog.jsonb_array_elements(v_state->'completions') c
        where c->>'packageId'=p_package_id and c->>'releaseId'=v_release->>'id'
          and c->>'status'='Reviewed' limit 1),
      'assembledAt',v_now,'assembledByActorId',v_actor,
      'membershipId',v_member.id,'status','Draft',
      'operateOwner',trim(p_input->>'operateOwner'),
      'obligations',trim(coalesce(p_input->>'obligations','')),'receipt','Awaiting');
    v_state:=pg_catalog.jsonb_set(v_state,'{turnovers}',
      v_state->'turnovers'||pg_catalog.jsonb_build_array(v_turnover));
  elsif p_action='accept-client' then
    if v_member.role not in ('project_manager','operations_leader')
      or length(trim(coalesce(p_input->>'signerName','')))<3
      or length(trim(coalesce(p_input->>'signerOrganization','')))<3
      or length(trim(coalesce(p_input->>'authorityBasis','')))<10
      or length(trim(coalesce(p_input->>'signerRole','')))<3
      or p_input->>'evidenceId' is null then
      raise exception 'customer_acceptance_recording_incomplete' using errcode='42501'; end if;
    select t into v_turnover from pg_catalog.jsonb_array_elements(v_state->'turnovers') t
      where t->>'id'=p_input->>'turnoverId' and t->>'status'='Draft'
        and t->'releaseIds' ? (v_release->>'id');
    if v_turnover is null or v_turnover->>'assembledByActorId'=v_actor::text
      or not exists(select 1 from pg_catalog.jsonb_array_elements(v_state->'completions') c
        where c->>'id'=v_turnover->>'completionId' and c->>'status'='Reviewed') then
      raise exception 'independent_current_turnover_required' using errcode='42501'; end if;
    for v_item in select value from pg_catalog.jsonb_array_elements(
      v_release#>'{snapshot,requirementIds}') loop
      v_requirement:=v_item#>>'{}';
      if not exists(select 1 from pg_catalog.jsonb_array_elements(v_state->'inspections') i
        where i->>'id' in (select pg_catalog.jsonb_array_elements_text(v_turnover->'inspectionIds'))
          and i->>'requirementId'=v_requirement and i->>'result'='Pass'
          and i->>'status'='Verified' and i->>'releaseId'=v_release->>'id') then
        raise exception 'turnover_verification_incomplete' using errcode='23514'; end if;
    end loop;
    if exists(select 1 from pg_catalog.jsonb_array_elements(v_state->'issues') i
      where i->>'packageId'=p_package_id and i->>'status'='Open') then
      raise exception 'open_issue_blocks_acceptance' using errcode='23514'; end if;
    v_evidence:=d5o_hosted.require_customer_decision_evidence_v1(
      v_workspace.id,v_work.id,p_input->>'evidenceId','package-acceptance',
      v_turnover->>'id',(v_turnover->>'revision')::integer,
      pg_catalog.jsonb_build_object('releaseIds',v_turnover->'releaseIds',
        'designRevision',v_design.decision_revision));
    v_turnover:=v_turnover||pg_catalog.jsonb_build_object(
      'status',case when trim(coalesce(p_input->>'conditions',''))=''
        then 'Client accepted' else 'Conditionally accepted' end,
      'acceptedAt',v_now,'recordedByActorId',v_actor,'signerName',trim(p_input->>'signerName'),
      'signerOrganization',trim(p_input->>'signerOrganization'),
      'signerRole',trim(p_input->>'signerRole'),
      'authorityBasis',trim(p_input->>'authorityBasis'),
      'source','evidence:'||(v_evidence->>'id'),'customerEvidence',v_evidence,
      'conditions',trim(coalesce(p_input->>'conditions','')),
      'exclusions',trim(coalesce(p_input->>'exclusions','')));
    v_state:=pg_catalog.jsonb_set(v_state,'{turnovers}',
      (select pg_catalog.jsonb_agg(case when t->>'id'=v_turnover->>'id' then v_turnover
        else t end order by ordinal) from pg_catalog.jsonb_array_elements(v_state->'turnovers')
          with ordinality as entries(t,ordinal)));
    v_state:=pg_catalog.jsonb_set(v_state,'{signoffs}',v_state->'signoffs'||
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',gen_random_uuid(),
        'kind','Customer scope acceptance','recordId',v_turnover->>'id',
        'recordRevision',1,'releaseIds',v_turnover->'releaseIds',
        'scope',p_package_id,'statement','Customer acceptance applies only to this exact turnover revision.',
        'signerName',v_turnover->>'signerName',
        'signerOrganization',v_turnover->>'signerOrganization',
        'method','Externally signed document','authorityBasis',v_turnover->>'authorityBasis',
        'source',v_turnover->>'source','capturedByActorId',v_actor,
        'at',v_now,'outcome',case when v_turnover->>'conditions'=''
          then 'Accepted' else 'Conditional' end,
        'conditions',v_turnover->>'conditions','snapshot',v_turnover)));
  elsif p_action='accept-work' then
    if v_member.role not in ('project_manager','operations_leader')
      or v_state->'workAcceptance' is not null
      or length(trim(coalesce(p_input->>'signerName','')))<3
      or length(trim(coalesce(p_input->>'signerOrganization','')))<3
      or length(trim(coalesce(p_input->>'signerRole','')))<3
      or length(trim(coalesce(p_input->>'authorityBasis','')))<10
      or p_input->>'evidenceId' is null
      or trim(coalesce(p_input->>'conditions',''))<>'' then
      raise exception 'whole_work_acceptance_incomplete' using errcode='42501'; end if;
    for v_item in select value from pg_catalog.jsonb_array_elements(v_design.state->'packages') loop
      v_package:=v_item->>'packageId';
      select r into v_current from pg_catalog.jsonb_array_elements(v_design.state->'releases') r
        where r->>'packageId'=v_package order by r->>'issuedAt' desc limit 1;
      select t into v_turnover from pg_catalog.jsonb_array_elements(v_state->'turnovers') t
        where t->>'packageId'=v_package and t->>'status'='Client accepted'
          and t->'releaseIds' ? (v_current->>'id');
      if v_current is null or v_current->>'status'<>'Accepted'
        or v_turnover is null or v_turnover->>'assembledByActorId'=v_actor::text
        or not exists(select 1 from pg_catalog.jsonb_array_elements(v_state->'completions') c
          where c->>'id'=v_turnover->>'completionId' and c->>'status'='Reviewed') then
        raise exception 'all_current_packages_require_acceptance' using errcode='23514'; end if;
      v_all_turnovers:=v_all_turnovers||pg_catalog.jsonb_build_array(v_turnover->>'id');
      v_release_ids:=v_release_ids||pg_catalog.jsonb_build_array(v_current->>'id');
    end loop;
    if pg_catalog.jsonb_array_length(v_all_turnovers)=0 or
      exists(select 1 from pg_catalog.jsonb_array_elements(v_state->'issues') i
        where i->>'status'='Open') then
      raise exception 'whole_work_scope_incomplete' using errcode='23514'; end if;
    v_evidence:=d5o_hosted.require_customer_decision_evidence_v1(
      v_workspace.id,v_work.id,p_input->>'evidenceId','work-acceptance',
      p_presentation_id,1,pg_catalog.jsonb_build_object(
        'turnoverIds',v_all_turnovers,'releaseIds',v_release_ids,
        'designRevision',v_design.decision_revision));
    v_acceptance:=pg_catalog.jsonb_build_object('id',gen_random_uuid(),
      'revision',1,'turnoverIds',v_all_turnovers,'releaseIds',v_release_ids,
      'acceptedAt',v_now,'recordedByActorId',v_actor,
      'signerName',trim(p_input->>'signerName'),
      'signerOrganization',trim(p_input->>'signerOrganization'),
      'signerRole',trim(p_input->>'signerRole'),
      'authorityBasis',trim(p_input->>'authorityBasis'),
      'source','evidence:'||(v_evidence->>'id'),'customerEvidence',v_evidence,
      'conditions','','receipt','Awaiting');
    v_state:=pg_catalog.jsonb_set(v_state,'{workAcceptance}',v_acceptance);
    v_state:=pg_catalog.jsonb_set(v_state,'{signoffs}',v_state->'signoffs'||
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',gen_random_uuid(),
        'kind','Final client acceptance','recordId',v_acceptance->>'id',
        'recordRevision',1,'releaseIds',v_release_ids,'scope',p_presentation_id,
        'statement','Customer accepts the exact listed package turnovers; Operations receipt is separate.',
        'signerName',v_acceptance->>'signerName',
        'signerOrganization',v_acceptance->>'signerOrganization',
        'method','Externally signed document','authorityBasis',v_acceptance->>'authorityBasis',
        'source',v_acceptance->>'source','capturedByActorId',v_actor,
        'at',v_now,'outcome','Accepted','conditions','','snapshot',v_acceptance)));
  elsif p_action='respond-operate' then
    if v_member.role<>'operations_leader'
      or p_input->>'decision' not in ('Accepted','Declined') or length(v_note)<15 then
      raise exception 'operations_receipt_authority_required' using errcode='42501'; end if;
    select t into v_turnover from pg_catalog.jsonb_array_elements(v_state->'turnovers') t
      where t->>'id'=p_input->>'turnoverId' and t->>'status'='Client accepted'
        and t->>'receipt'='Awaiting' and t->'releaseIds' ? (v_release->>'id');
    if v_turnover is null or v_turnover->>'recordedByActorId'=v_actor::text
      or v_turnover->>'assembledByActorId'=v_actor::text then
      raise exception 'independent_exact_turnover_required' using errcode='42501'; end if;
    v_turnover:=v_turnover||pg_catalog.jsonb_build_object('receipt',
      case when p_input->>'decision'='Accepted' then 'Accepted' else 'Returned' end,
      'receivedByActorId',v_actor,'receivedAt',v_now,'receiptNote',v_note);
    v_state:=pg_catalog.jsonb_set(v_state,'{turnovers}',
      (select pg_catalog.jsonb_agg(case when t->>'id'=v_turnover->>'id' then v_turnover
        else t end order by ordinal) from pg_catalog.jsonb_array_elements(v_state->'turnovers')
          with ordinality as entries(t,ordinal)));
  else
    if v_member.role<>'operations_leader'
      or p_input->>'decision' not in ('Accepted','Declined') or length(v_note)<15 then
      raise exception 'operations_receipt_authority_required' using errcode='42501'; end if;
    v_acceptance:=v_state->'workAcceptance';
    if v_acceptance is null or v_acceptance->>'receipt'<>'Awaiting'
      or v_acceptance->>'recordedByActorId'=v_actor::text then
      raise exception 'independent_work_receipt_required' using errcode='42501'; end if;
    if exists(select 1 from pg_catalog.jsonb_array_elements(v_state->'turnovers') t
      where t->>'id' in (select pg_catalog.jsonb_array_elements_text(v_acceptance->'turnoverIds'))
        and t->>'receipt'<>'Accepted') then
      raise exception 'package_receipts_required' using errcode='23514'; end if;
    if exists(select 1 from pg_catalog.jsonb_array_elements(v_design.state->'releases') r
      where r->>'status'='Accepted' and not (v_acceptance->'releaseIds' ? (r->>'id'))) then
      raise exception 'work_release_basis_stale' using errcode='23514'; end if;
    v_acceptance:=v_acceptance||pg_catalog.jsonb_build_object(
      'receipt',case when p_input->>'decision'='Accepted' then 'Accepted' else 'Returned' end,
      'receivedByActorId',v_actor,'receivedAt',v_now,'receiptNote',v_note);
    v_state:=pg_catalog.jsonb_set(v_state,'{workAcceptance}',v_acceptance);
  end if;
  v_state:=v_state||pg_catalog.jsonb_build_object(
    'authorityRevision',v_deploy.decision_revision+1,
    'events',v_state->'events'||pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('id',gen_random_uuid(),
        'commandId',p_command_id,'at',v_now,'actorId',v_actor,
        'membershipId',v_member.id,'action',p_action,
        'packageId',p_package_id,'note',v_note)));
  update d5o_hosted.connected_deploy_states set
    decision_revision=decision_revision+1,state=v_state,updated_at=v_now
    where workspace_id=v_workspace.id and work_id=v_work.id;
  insert into d5o_hosted.connected_deploy_events(workspace_id,work_id,
    decision_revision,command_id,action,actor_user_id,membership_id,
    design_revision,schedule_revision,snapshot)
  values(v_workspace.id,v_work.id,v_deploy.decision_revision+1,p_command_id,
    p_action,v_actor,v_member.id,v_design.decision_revision,
    v_schedule.decision_revision,v_state);
  v_result:=public.d5o_hosted_prototype_read_v1(p_workspace_key,'work');
  insert into d5o_hosted.connected_deploy_receipts(workspace_id,command_id,
    work_id,actor_user_id,fingerprint,result)
  values(v_workspace.id,p_command_id,v_work.id,v_actor,v_fingerprint,v_result);
  return v_result;
end; $$;
revoke all on function public.d5o_hosted_acceptance_command_v1(
  text,text,text,text,jsonb,text,bigint,integer,integer)
  from public,anon,service_role;
grant execute on function public.d5o_hosted_acceptance_command_v1(
  text,text,text,text,jsonb,text,bigint,integer,integer)
  to authenticated;
-- Service pricing retains its narrow published labor-rate calculation; only
-- the external authorization source is strengthened by the exact receipt.
-- A partial service request retains its coverage classification. Only the
-- uncovered, explicitly priced scope can proceed after an independent review
-- and a source-backed customer decision. This narrow contract supports one
-- sourced labor line from an active published tenant catalog; other methods
-- remain unavailable rather than accepting an unverified client calculation.
create or replace function public.d5o_hosted_service_pricing_command_v1(
  p_workspace_key text,p_parent_presentation_id text,p_request_id text,
  p_action text,p_input jsonb,p_command_id text,p_expected_work_revision bigint,
  p_expected_operate_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
  v_member d5o_hosted.memberships%rowtype;v_parent d5o_hosted.work_records%rowtype;
  v_raw d5o_hosted.prototype_states%rowtype;
  v_operate d5o_hosted.connected_operate_states%rowtype;
  v_receipt d5o_hosted.connected_operate_receipts%rowtype;
  v_request jsonb;v_policy jsonb;v_rate jsonb;v_line jsonb;v_input jsonb;
  v_estimate jsonb;v_eval jsonb;v_auth jsonb;v_state jsonb;v_result jsonb;v_evidence jsonb;
  v_cycle text;v_fingerprint text;v_now timestamptz:=now();
  v_qty numeric;v_cost numeric;v_direct bigint;v_overhead bigint;
  v_contingency bigint;v_included bigint;v_price bigint;v_base bigint;
  v_discount bigint;v_margin numeric;v_target numeric;v_floor numeric;
  v_discount_pct numeric;v_revision integer;v_reason text:=trim(coalesce(p_input->>'note',''));
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or p_action not in ('save-service-estimate','submit-service-pricing',
      'approve-service-pricing','return-service-pricing','record-service-authorization')
    or pg_catalog.jsonb_typeof(p_input)<>'object'
    or length(coalesce(p_command_id,'')) not between 8 and 120
    or p_expected_work_revision is null or p_expected_work_revision<1
    or p_expected_operate_revision is null or p_expected_operate_revision<1 then
    raise exception 'invalid_service_pricing_command' using errcode='22023'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('d5o-connected:'||v_workspace.id::text,0));
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor and status='active' for share;
  if not found then raise exception 'service_pricing_authority_required' using errcode='42501'; end if;
  select w.* into v_parent from d5o_hosted.work_records w
    join d5o_hosted.work_identity_links l on l.workspace_id=w.workspace_id
      and l.work_id=w.id and l.parent_work_id is null
    where w.workspace_id=v_workspace.id and l.presentation_id=p_parent_presentation_id
      for update of w;
  if not found then raise exception 'canonical_parent_required' using errcode='23503'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(
    p_workspace_key,p_parent_presentation_id,p_request_id,p_action,p_input,
    p_expected_work_revision,p_expected_operate_revision)::text);
  select * into v_receipt from d5o_hosted.connected_operate_receipts
    where workspace_id=v_workspace.id and command_id=p_command_id;
  if found then
    if v_receipt.work_id<>v_parent.id or v_receipt.actor_user_id<>v_actor
      or v_receipt.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_receipt.result; end if;
  select * into v_raw from d5o_hosted.prototype_states
    where workspace_id=v_workspace.id and state_key='work' for share;
  select * into v_operate from d5o_hosted.connected_operate_states
    where workspace_id=v_workspace.id and work_id=v_parent.id for update;
  if v_raw.revision is distinct from p_expected_work_revision
    or v_operate.decision_revision is distinct from p_expected_operate_revision then
    raise exception 'stale_service_pricing_basis' using errcode='23505'; end if;
  select item into v_request from pg_catalog.jsonb_array_elements(v_operate.state->'requests') item
    where item->>'id'=p_request_id;
  if v_request is null or v_request->>'status' not in ('Triaged','In progress')
    or v_request->>'coverage' not in ('Partially covered','Chargeable')
    or v_request->>'agreementId' is null then
    raise exception 'current_partial_request_required' using errcode='23514'; end if;
  v_cycle:=coalesce(v_request->>'reopenedAt',v_request->>'reportedAt');
  v_estimate:=v_request->'serviceEstimate';
  if p_action='save-service-estimate' then
    if v_member.role<>'project_manager' then
      raise exception 'service_estimator_required' using errcode='42501'; end if;
    v_input:=p_input->'pricingInput';
    if pg_catalog.jsonb_typeof(v_input->'lines')<>'array'
      or pg_catalog.jsonb_array_length(v_input->'lines')<>1
      or length(trim(coalesce(v_input->>'riskBasis','')))<10 then
      raise exception 'sourced_single_line_required' using errcode='23514'; end if;
    v_line:=v_input->'lines'->0;
    if v_line->>'category'<>'labor' or length(trim(coalesce(v_line->>'description','')))<8
      or length(trim(coalesce(v_line->>'source','')))<8
      or length(trim(coalesce(v_line->>'assumption','')))<8
      or v_line->>'rateId' is null or v_line->>'manualRate' is not null
      or v_line->>'scopeRef'<>p_request_id or v_line->>'unit'<>'hour'
      or v_line->'procurement' is not null then
      raise exception 'published_labor_rate_required' using errcode='23514'; end if;
    select p.payload into v_policy from d5o_hosted.connected_pricing_policies p
      join d5o_hosted.connected_pricing_active a on a.workspace_id=p.workspace_id
        and a.policy_id=p.policy_id and a.version=p.version
      where p.workspace_id=v_workspace.id and p.status='published';
    if v_policy is null or v_policy->>'method'<>'target-margin'
      or v_policy->>'currency' is distinct from v_input->>'currency'
      or (v_policy->>'effectiveFrom')::date>current_date then
      raise exception 'active_published_service_policy_required' using errcode='23514'; end if;
    select item into v_rate from pg_catalog.jsonb_array_elements(v_policy->'rates') item
      where item->>'id'=v_line->>'rateId' and item->>'category'='labor'
        and item->>'unit'='hour' and item#>>'{scope,kind}'='default'
        and (item->>'effectiveFrom')::date<=current_date
        and (item->>'effectiveTo' is null or (item->>'effectiveTo')::date>=current_date);
    if v_rate is null then raise exception 'effective_labor_rate_missing' using errcode='23514'; end if;
    begin
      v_qty:=(v_line->>'quantity')::numeric;
      v_cost:=(v_rate->>'amount')::numeric;
      v_target:=(v_policy->>'targetMarginPercent')::numeric;
      v_floor:=(v_policy->>'floorMarginPercent')::numeric;
      v_discount_pct:=(v_input->>'discountPercent')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'invalid_service_money_input' using errcode='22023'; end;
    if v_qty<=0 or v_qty>10000 or v_cost<=0 or v_cost>100000
      or v_target<0 or v_target>=100 or v_floor<0 or v_floor>=100
      or v_discount_pct<0 or v_discount_pct>(v_policy->>'maxDiscountPercent')::numeric then
      raise exception 'service_pricing_policy_limit' using errcode='23514'; end if;
    v_direct:=pg_catalog.round(v_qty*v_cost*100*
      (100+coalesce((v_rate->>'burdenPercent')::numeric,0))/100)::bigint;
    v_overhead:=pg_catalog.round(v_direct*(v_policy->>'overheadPercent')::numeric/100)::bigint;
    v_contingency:=pg_catalog.round(v_direct*(v_policy->>'contingencyPercent')::numeric/100)::bigint;
    v_included:=v_direct+v_overhead+v_contingency;
    v_base:=pg_catalog.ceil(v_included*100/(100-v_target))::bigint;
    v_discount:=pg_catalog.round(v_base*v_discount_pct/100)::bigint;
    v_price:=v_base-v_discount;
    v_margin:=(v_price-v_included)*100.0/v_price;
    if v_margin<v_floor then raise exception 'service_margin_below_floor' using errcode='23514'; end if;
    v_revision:=coalesce((v_estimate->>'revision')::integer,0)+1;
    v_input:=v_input||pg_catalog.jsonb_build_object('workType','Lifecycle service',
      'pricedAt',current_date,'definitionRevision',0,'solutionRevision',0);
    v_eval:=pg_catalog.jsonb_build_object('policyId',v_policy->>'id',
      'policyVersion',(v_policy->>'version')::integer,'currency',v_policy->>'currency',
      'input',v_input,'lines',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'id',v_line->>'id','category','labor','amountMinor',v_direct,
        'rateId',v_rate->>'id','rateSource',v_rate->>'source')),
      'directCostMinor',v_direct,'overheadMinor',v_overhead,
      'contingencyMinor',v_contingency,'includedCostMinor',v_included,
      'proposedPriceMinor',v_price,'discountMinor',v_discount,
      'grossProfitMinor',v_price-v_included,'marginPercent',v_margin,
      'annualRecurringMinor',0,'totalRecurringMinor',0,
      'minimumFloorPriceMinor',pg_catalog.ceil(v_included*100/(100-v_floor)),
      'minimumTargetPriceMinor',v_base,
      'absorbableCostMinor',v_price-pg_catalog.ceil(v_price*v_floor/100)-v_included,
      'issues','[]'::jsonb,'recommendation','Ready for pricing review',
      'calculatedAt',v_now);
    v_estimate:=pg_catalog.jsonb_build_object('revision',v_revision,
      'requestCycleAt',v_cycle,'status','Draft','input',v_input,
      'evaluation',v_eval,'policySnapshot',v_policy,'savedAt',v_now,
      'savedByActorId',v_actor,'history',coalesce(v_estimate->'history','[]'::jsonb)
        ||case when v_estimate is null then '[]'::jsonb else
          pg_catalog.jsonb_build_array(v_estimate) end);
    v_request:=v_request||pg_catalog.jsonb_build_object('serviceEstimate',v_estimate);
  elsif p_action='submit-service-pricing' then
    if v_member.role<>'project_manager' then
      raise exception 'service_estimator_required' using errcode='42501'; end if;
    if v_estimate->>'status'<>'Draft' or v_estimate->>'requestCycleAt'<>v_cycle
      or (v_estimate->>'revision')::integer is distinct from (p_input->>'estimateRevision')::integer then
      raise exception 'stale_service_estimate' using errcode='23505'; end if;
    v_estimate:=v_estimate||pg_catalog.jsonb_build_object('status','Pricing review',
      'submittedByActorId',v_actor,'submittedAt',v_now);
    v_request:=v_request||pg_catalog.jsonb_build_object('serviceEstimate',v_estimate);
  elsif p_action in ('approve-service-pricing','return-service-pricing') then
    if v_estimate->>'status'<>'Pricing review' or v_estimate->>'requestCycleAt'<>v_cycle
      or (v_estimate->>'revision')::integer is distinct from (p_input->>'estimateRevision')::integer then
      raise exception 'stale_service_pricing_review' using errcode='23505'; end if;
    if v_member.role<>v_estimate#>>'{policySnapshot,pricingApproverRole}'
      or v_actor::text=v_estimate->>'submittedByActorId' or length(v_reason)<10 then
      raise exception 'independent_pricing_review_required' using errcode='42501'; end if;
    v_estimate:=v_estimate||pg_catalog.jsonb_build_object('status',
      case when p_action='approve-service-pricing' then 'Approved' else 'Returned' end,
      'reviewedByActorId',v_actor,'reviewedAt',v_now,'reviewNote',v_reason);
    v_request:=v_request||pg_catalog.jsonb_build_object('serviceEstimate',v_estimate);
  else
    if v_member.role<>'operations_leader' or v_estimate->>'status'<>'Approved'
      or v_estimate->>'requestCycleAt'<>v_cycle
      or (v_estimate->>'revision')::integer is distinct from (p_input->>'estimateRevision')::integer
      or v_request#>>'{serviceAuthorization,estimateRevision}'=v_estimate->>'revision'
      or p_input->>'evidenceId' is null
      or length(trim(coalesce(p_input->>'customerParty','')))<3
      or length(trim(coalesce(p_input->>'customerOrganization','')))<3
      or length(trim(coalesce(p_input->>'customerRole','')))<3
      or length(trim(coalesce(p_input->>'authorityBasis','')))<10
      or p_input->>'outcome'<>'Authorized' or length(v_reason)<10 then
      raise exception 'exact_customer_service_authorization_required' using errcode='23514'; end if;
    v_evidence:=d5o_hosted.require_customer_decision_evidence_v1(
      v_workspace.id,v_parent.id,p_input->>'evidenceId',
      'service-authorization',p_request_id,(v_estimate->>'revision')::integer,
      pg_catalog.jsonb_build_object(
        'estimateRevision',(v_estimate->>'revision')::integer,
        'amountMinor',v_estimate#>'{evaluation,proposedPriceMinor}',
        'currency',v_estimate#>>'{evaluation,currency}',
        'requestCycleAt',v_cycle));
    v_auth:=pg_catalog.jsonb_build_object('estimateRevision',(v_estimate->>'revision')::integer,
      'amountMinor',v_estimate#>'{evaluation,proposedPriceMinor}',
      'currency',v_estimate#>>'{evaluation,currency}',
      'source','evidence:'||(v_evidence->>'id'),'customerEvidence',v_evidence,
      'customerParty',p_input->>'customerParty',
      'customerOrganization',p_input->>'customerOrganization',
      'customerRole',p_input->>'customerRole',
      'authorityBasis',p_input->>'authorityBasis',
      'outcome',p_input->>'outcome',
      'conditions',trim(coalesce(p_input->>'conditions','')),
      'exclusions',trim(coalesce(p_input->>'exclusions','')),
      'recordedByActorId',v_actor,'recordedAt',v_now);
    v_request:=v_request||pg_catalog.jsonb_build_object('serviceAuthorization',v_auth,
      'serviceAuthorizationHistory',coalesce(v_request->'serviceAuthorizationHistory','[]'::jsonb));
  end if;
  v_request:=pg_catalog.jsonb_set(v_request,'{history}',
    coalesce(v_request->'history','[]'::jsonb)||pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('at',v_now,'action',p_action,
        'actorId',v_actor,'note',v_reason)));
  v_state:=pg_catalog.jsonb_set(v_operate.state,'{requests}',
    (select pg_catalog.jsonb_agg(case when item->>'id'=p_request_id then v_request
      else item end order by ordinal) from pg_catalog.jsonb_array_elements(v_operate.state->'requests')
      with ordinality as entries(item,ordinal)));
  v_state:=v_state||pg_catalog.jsonb_build_object('authorityRevision',
    v_operate.decision_revision+1,'events',coalesce(v_operate.state->'events','[]'::jsonb)
      ||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',gen_random_uuid(),
        'commandId',p_command_id,'fingerprint',v_fingerprint,'at',v_now,
        'actorId',v_actor,'membershipId',v_member.id,'action',p_action,
        'detail',p_request_id)));
  update d5o_hosted.connected_operate_states set decision_revision=decision_revision+1,
    state=v_state,updated_at=v_now where workspace_id=v_workspace.id and work_id=v_parent.id;
  insert into d5o_hosted.connected_operate_events(workspace_id,work_id,decision_revision,
    command_id,action,actor_user_id,membership_id,deploy_revision,snapshot)
  values(v_workspace.id,v_parent.id,v_operate.decision_revision+1,p_command_id,p_action,
    v_actor,v_member.id,coalesce((select decision_revision from d5o_hosted.connected_deploy_states
      where workspace_id=v_workspace.id and work_id=v_parent.id),0),v_state);
  v_result:=pg_catalog.jsonb_build_object('state',
    d5o_hosted.connected_operate_projection_v1(v_workspace.id,v_raw.state_json),
    'revision',v_raw.revision,'operateRevision',v_operate.decision_revision+1);
  insert into d5o_hosted.connected_operate_receipts(workspace_id,command_id,work_id,
    actor_user_id,fingerprint,result)
  values(v_workspace.id,p_command_id,v_parent.id,v_actor,v_fingerprint,v_result);
  return v_result;
end; $$;
revoke all on function public.d5o_hosted_service_pricing_command_v1(
  text,text,text,text,jsonb,text,bigint,integer) from public,anon,service_role;
grant execute on function public.d5o_hosted_service_pricing_command_v1(
  text,text,text,text,jsonb,text,bigint,integer) to authenticated;
