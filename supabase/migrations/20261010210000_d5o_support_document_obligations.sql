-- Exact support-document evidence and independently reviewed obligation completion.
-- Historical turnover, customer acceptance and activation remain unchanged.
alter table d5o_hosted.customer_decision_evidence
  drop constraint customer_decision_evidence_purpose_check;
alter table d5o_hosted.customer_decision_evidence
  add constraint customer_decision_evidence_purpose_check
  check (purpose in ('package-acceptance','work-acceptance','service-authorization',
    'field-change-authorization','service-billing-terms',
    'support-as-built','support-inspection'));

-- The original Operate command conflated role denial and profile validation.
-- Keep its implementation private; the public wrapper rejects an unauthorized
-- support-acceptance intent before invoking the original typed transition.
alter function public.d5o_hosted_operate_command_v1(
  text,text,text,jsonb,text,bigint,integer,integer)
  rename to d5o_hosted_operate_command_internal_v1;
revoke all on function public.d5o_hosted_operate_command_internal_v1(
  text,text,text,jsonb,text,bigint,integer,integer)
  from public,anon,authenticated,service_role;
create function public.d5o_hosted_operate_command_v1(
  p_workspace_key text,p_presentation_id text,p_action text,p_input jsonb,
  p_command_id text,p_expected_source_revision bigint,
  p_expected_deploy_revision integer,p_expected_operate_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_role text;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null then
    raise exception 'operate_membership_required' using errcode='42501'; end if;
  if p_action='accept-support' then
    select m.role into v_role from d5o_hosted.workspaces w
      join d5o_hosted.memberships m on m.workspace_id=w.id
      join d5o_hosted.work_identity_links l on l.workspace_id=w.id
      where w.workspace_key=p_workspace_key and w.status='active'
        and l.presentation_id=p_presentation_id
        and m.actor_user_id=v_actor and m.status='active';
    if v_role is null then
      raise exception 'workspace_forbidden' using errcode='42501'; end if;
    if v_role<>'operations_leader' then
      raise exception 'support_acceptance_authority_required' using errcode='42501'; end if;
  end if;
  return public.d5o_hosted_operate_command_internal_v1(
    p_workspace_key,p_presentation_id,p_action,p_input,p_command_id,
    p_expected_source_revision,p_expected_deploy_revision,p_expected_operate_revision);
end; $$;
revoke all on function public.d5o_hosted_operate_command_v1(
  text,text,text,jsonb,text,bigint,integer,integer) from public,anon,service_role;
grant execute on function public.d5o_hosted_operate_command_v1(
  text,text,text,jsonb,text,bigint,integer,integer) to authenticated;

create function d5o_hosted.support_document_basis_v1(
  p_workspace_id uuid,p_work_id uuid,p_turnover_id text,p_kind text
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_deploy jsonb;v_design jsonb;v_operate jsonb;
  v_turnover jsonb;v_release jsonb;v_acceptance jsonb;v_obligation text;
begin
  if p_kind not in ('as-built','inspection') then return null; end if;
  select state into v_deploy from d5o_hosted.connected_deploy_states
    where workspace_id=p_workspace_id and work_id=p_work_id;
  select state into v_design from d5o_hosted.connected_design_states
    where workspace_id=p_workspace_id and work_id=p_work_id;
  select state into v_operate from d5o_hosted.connected_operate_states
    where workspace_id=p_workspace_id and work_id=p_work_id;
  v_acceptance:=v_deploy->'workAcceptance';
  select t into v_turnover from pg_catalog.jsonb_array_elements(
    coalesce(v_deploy->'turnovers','[]'::jsonb)) t
    where t->>'id'=p_turnover_id;
  v_obligation:=pg_catalog.lower(coalesce(v_turnover->>'obligations',''));
  if v_turnover is null or v_turnover->>'status'<>'Client accepted'
    or v_turnover->>'receipt'<>'Accepted'
    or v_acceptance->>'receipt'<>'Accepted'
    or not (v_acceptance->'turnoverIds' ? p_turnover_id)
    or v_operate#>>'{source,workAcceptanceId}' is distinct from v_acceptance->>'id'
    or v_operate#>>'{source,revision}' is distinct from v_acceptance->>'revision'
    or (p_kind='as-built' and v_obligation not like '%as-built%')
    or (p_kind='inspection' and v_obligation not like '%inspection%')
    or pg_catalog.jsonb_array_length(coalesce(v_turnover->'releaseIds','[]'::jsonb))<>1
  then return null; end if;
  select r into v_release from pg_catalog.jsonb_array_elements(
    coalesce(v_design->'releases','[]'::jsonb)) r
    where r->>'id'=v_turnover->'releaseIds'->>0 and r->>'status'='Accepted';
  if v_release is null then return null; end if;
  return pg_catalog.jsonb_build_object(
    'turnoverId',p_turnover_id,'turnoverRevision',(v_turnover->>'revision')::integer,
    'packageId',v_release->>'packageId','releaseId',v_release->>'id',
    'releaseRevision',(v_release->>'packageRevision')::integer,
    'workAcceptanceId',v_acceptance->>'id',
    'workAcceptanceRevision',(v_acceptance->>'revision')::integer,
    'kind',p_kind);
end; $$;
revoke all on function d5o_hosted.support_document_basis_v1(uuid,uuid,text,text)
  from public,anon,authenticated,service_role;

create function public.d5o_hosted_register_support_document_v1(
  p_workspace_key text,p_presentation_id text,p_evidence_id uuid,
  p_turnover_id text,p_kind text,p_basis jsonb,p_checksum_sha256 text,
  p_filename text,p_uploader_id uuid
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_workspace d5o_hosted.workspaces%rowtype;
  v_work d5o_hosted.work_records%rowtype;v_member d5o_hosted.memberships%rowtype;
  v_object storage.objects%rowtype;v_path text;v_exact jsonb;
begin
  if current_setting('role',true)<>'service_role' or p_evidence_id is null
    or p_kind not in ('as-built','inspection') or p_uploader_id is null
    or p_checksum_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_support_document' using errcode='42501'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  select w.* into v_work from d5o_hosted.work_records w
    join d5o_hosted.work_identity_links l on l.workspace_id=w.workspace_id
      and l.work_id=w.id
    where w.workspace_id=v_workspace.id and l.presentation_id=p_presentation_id;
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=p_uploader_id
      and status='active';
  if v_work.id is null or v_member.role not in ('project_manager','field_supervisor') then
    raise exception 'support_document_supplier_required' using errcode='42501'; end if;
  v_exact:=d5o_hosted.support_document_basis_v1(
    v_workspace.id,v_work.id,p_turnover_id,p_kind);
  if v_exact is null or p_basis is distinct from v_exact then
    raise exception 'stale_support_document_basis' using errcode='23505'; end if;
  v_path:=p_workspace_key||'/'||pg_catalog.encode(
    extensions.digest(p_presentation_id,'sha256'),'hex')
    ||'/customer-decisions/'||p_evidence_id::text;
  select * into v_object from storage.objects
    where bucket_id='d5o-deploy-evidence' and name=v_path;
  if v_object.id is null or v_object.metadata->>'mimetype'<>'application/pdf'
    or (v_object.metadata->>'size')::bigint not between 1 and 10485760 then
    raise exception 'support_document_object_missing' using errcode='23514'; end if;
  insert into d5o_hosted.customer_decision_evidence(
    id,workspace_id,work_id,presentation_id,purpose,scope_id,scope_revision,
    basis,object_path,storage_object_id,storage_updated_at,checksum_sha256,
    size_bytes,mime_type,filename,uploaded_by)
  values(p_evidence_id,v_workspace.id,v_work.id,p_presentation_id,
    'support-'||p_kind,p_turnover_id,(v_exact->>'turnoverRevision')::integer,
    v_exact,v_path,v_object.id,v_object.updated_at,p_checksum_sha256,
    (v_object.metadata->>'size')::bigint,'application/pdf',
    left(p_filename,200),p_uploader_id);
  return pg_catalog.jsonb_build_object('evidenceId',p_evidence_id,
    'checksumSha256',p_checksum_sha256,'basis',v_exact);
end; $$;
revoke all on function public.d5o_hosted_register_support_document_v1(
  text,text,uuid,text,text,jsonb,text,text,uuid)
  from public,anon,authenticated;
grant execute on function public.d5o_hosted_register_support_document_v1(
  text,text,uuid,text,text,jsonb,text,text,uuid) to service_role;
create function public.d5o_hosted_support_document_command_v1(
  p_workspace_key text,p_presentation_id text,p_action text,
  p_turnover_id text,p_kind text,p_evidence_id uuid,p_decision text,
  p_note text,p_command_id text,p_expected_source_revision bigint,
  p_expected_deploy_revision integer,p_expected_operate_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
  v_member d5o_hosted.memberships%rowtype;v_work d5o_hosted.work_records%rowtype;
  v_raw d5o_hosted.prototype_states%rowtype;
  v_deploy d5o_hosted.connected_deploy_states%rowtype;
  v_operate d5o_hosted.connected_operate_states%rowtype;
  v_receipt d5o_hosted.connected_operate_receipts%rowtype;
  v_doc d5o_hosted.customer_decision_evidence%rowtype;
  v_basis jsonb;v_docs jsonb;v_item jsonb;v_state jsonb;v_result jsonb;
  v_fingerprint text;v_now timestamptz:=now();v_supersedes text;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or p_action not in ('submit','review') or p_kind not in ('as-built','inspection')
    or p_evidence_id is null or length(coalesce(p_command_id,'')) not between 8 and 120
    or p_expected_source_revision is null or p_expected_deploy_revision is null
    or p_expected_operate_revision is null then
    raise exception 'invalid_support_document_command' using errcode='22023'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor and status='active'
    for share;
  if not found then raise exception 'support_document_membership_required' using errcode='42501'; end if;
  if (p_action='submit' and v_member.role not in ('project_manager','field_supervisor'))
    or (p_action='review' and v_member.role<>'operations_leader') then
    raise exception 'support_document_authority_required' using errcode='42501'; end if;
  select w.* into v_work from d5o_hosted.work_records w
    join d5o_hosted.work_identity_links l on l.workspace_id=w.workspace_id
      and l.work_id=w.id
    where w.workspace_id=v_workspace.id and l.presentation_id=p_presentation_id
    for update of w;
  if not found then raise exception 'connected_work_unavailable' using errcode='42501'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(
    p_workspace_key,p_presentation_id,p_action,p_turnover_id,p_kind,
    p_evidence_id,p_decision,trim(coalesce(p_note,'')),p_expected_source_revision,
    p_expected_deploy_revision,p_expected_operate_revision)::text);
  select * into v_receipt from d5o_hosted.connected_operate_receipts
    where workspace_id=v_workspace.id and command_id=p_command_id;
  if found then
    if v_receipt.work_id<>v_work.id or v_receipt.actor_user_id<>v_actor
      or v_receipt.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_receipt.result;
  end if;
  select * into v_raw from d5o_hosted.prototype_states
    where workspace_id=v_workspace.id and state_key='work' for share;
  select * into v_deploy from d5o_hosted.connected_deploy_states
    where workspace_id=v_workspace.id and work_id=v_work.id for share;
  select * into v_operate from d5o_hosted.connected_operate_states
    where workspace_id=v_workspace.id and work_id=v_work.id for update;
  if v_raw.revision is distinct from p_expected_source_revision
    or v_deploy.decision_revision is distinct from p_expected_deploy_revision
    or v_operate.decision_revision is distinct from p_expected_operate_revision then
    raise exception 'stale_support_document_basis' using errcode='23505'; end if;
  v_basis:=d5o_hosted.support_document_basis_v1(
    v_workspace.id,v_work.id,p_turnover_id,p_kind);
  if v_basis is null then
    raise exception 'accepted_support_obligation_required' using errcode='23514'; end if;
  select * into v_doc from d5o_hosted.customer_decision_evidence
    where id=p_evidence_id and workspace_id=v_workspace.id and work_id=v_work.id
      and purpose='support-'||p_kind and scope_id=p_turnover_id
      and scope_revision=(v_basis->>'turnoverRevision')::integer and basis=v_basis;
  if not found then raise exception 'exact_support_document_required' using errcode='23514'; end if;
  perform d5o_hosted.require_customer_decision_evidence_v1(
    v_workspace.id,v_work.id,p_evidence_id::text,'support-'||p_kind,
    p_turnover_id,(v_basis->>'turnoverRevision')::integer,v_basis);
  v_docs:=coalesce(v_operate.state->'documentationObligations','[]'::jsonb);
  if p_action='submit' then
    if exists(select 1 from pg_catalog.jsonb_array_elements(v_docs) d
      where d->>'id'=p_evidence_id::text) then
      raise exception 'support_document_already_submitted' using errcode='23505'; end if;
    if exists(select 1 from pg_catalog.jsonb_array_elements(v_docs) d
      where d->>'turnoverId'=p_turnover_id and d->>'kind'=p_kind
        and d->>'status'='Submitted') then
      raise exception 'support_document_review_pending' using errcode='23514'; end if;
    select d->>'id' into v_supersedes from pg_catalog.jsonb_array_elements(v_docs) d
      where d->>'turnoverId'=p_turnover_id and d->>'kind'=p_kind
      order by d->>'submittedAt' desc limit 1;
    v_item:=pg_catalog.jsonb_build_object('id',p_evidence_id,
      'turnoverId',p_turnover_id,'kind',p_kind,'basis',v_basis,
      'status','Submitted','filename',v_doc.filename,
      'checksumSha256',v_doc.checksum_sha256,
      'uploadedAt',v_doc.uploaded_at,'uploadedByActorId',v_doc.uploaded_by,
      'submittedAt',v_now,'submittedByActorId',v_actor,
      'submittedByMembershipId',v_member.id,
      'supersedesId',v_supersedes,'note',trim(coalesce(p_note,'')));
    v_docs:=v_docs||pg_catalog.jsonb_build_array(v_item);
  else
    if p_decision not in ('Reviewed','Returned')
      or length(trim(coalesce(p_note,'')))<10 then
      raise exception 'support_document_review_reason_required' using errcode='23514'; end if;
    select d into v_item from pg_catalog.jsonb_array_elements(v_docs) d
      where d->>'id'=p_evidence_id::text and d->>'turnoverId'=p_turnover_id
        and d->>'kind'=p_kind and d->>'status'='Submitted';
    if v_item is null then
      raise exception 'current_support_document_review_required' using errcode='23514'; end if;
    if v_item->>'submittedByActorId'=v_actor::text
      or v_doc.uploaded_by=v_actor then
      raise exception 'independent_support_document_review_required'
        using errcode='42501'; end if;
    v_item:=v_item||pg_catalog.jsonb_build_object('status',p_decision,
      'reviewedAt',v_now,'reviewedByActorId',v_actor,
      'reviewedByMembershipId',v_member.id,'reviewReason',trim(p_note));
    v_docs:=(select pg_catalog.jsonb_agg(
      case when d->>'id'=p_evidence_id::text then v_item else d end order by ordinal)
      from pg_catalog.jsonb_array_elements(v_docs)
        with ordinality as entries(d,ordinal));
  end if;
  v_state:=v_operate.state||pg_catalog.jsonb_build_object(
    'documentationObligations',v_docs,
    'authorityRevision',v_operate.decision_revision+1,
    'events',coalesce(v_operate.state->'events','[]'::jsonb)
      ||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'id',gen_random_uuid(),'commandId',p_command_id,
        'fingerprint',v_fingerprint,'at',v_now,'actorId',v_actor,
        'membershipId',v_member.id,'action','support-document-'||p_action,
        'detail',p_turnover_id||' · '||p_kind||' · '||p_evidence_id::text)));
  update d5o_hosted.connected_operate_states set
    decision_revision=decision_revision+1,state=v_state,updated_at=v_now
    where workspace_id=v_workspace.id and work_id=v_work.id;
  insert into d5o_hosted.connected_operate_events(
    workspace_id,work_id,decision_revision,command_id,action,actor_user_id,
    membership_id,deploy_revision,snapshot)
  values(v_workspace.id,v_work.id,v_operate.decision_revision+1,p_command_id,
    'support-document-'||p_action,v_actor,v_member.id,
    v_deploy.decision_revision,v_state);
  v_result:=public.d5o_hosted_prototype_read_v1(p_workspace_key,'work');
  insert into d5o_hosted.connected_operate_receipts(
    workspace_id,command_id,work_id,actor_user_id,fingerprint,result)
  values(v_workspace.id,p_command_id,v_work.id,v_actor,v_fingerprint,v_result);
  return v_result;
end; $$;
revoke all on function public.d5o_hosted_support_document_command_v1(
  text,text,text,text,text,uuid,text,text,text,bigint,integer,integer)
  from public,anon,service_role;
grant execute on function public.d5o_hosted_support_document_command_v1(
  text,text,text,text,text,uuid,text,text,text,bigint,integer,integer)
  to authenticated;
