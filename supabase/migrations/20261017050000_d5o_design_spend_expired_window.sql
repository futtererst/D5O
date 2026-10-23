-- Allow a new reviewed Design spending window after the previous one expires.
-- Existing approved commitments and the expired authority remain immutable history.
create or replace function public.d5o_hosted_design_spend_command_v1(
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
    where workspace_id=ws.id and work_id=work.id and status='Approved' and source_digest=src->>'digest' and valid_until>=current_date) then
   raise exception 'active_design_spend_authority_exists' using errcode='23514'; end if;
  if p_input ? 'supersedesId' then
   select * into prior_authz from d5o_hosted.design_spend_authorities
    where id=(p_input->>'supersedesId')::uuid and workspace_id=ws.id and work_id=work.id;
   if prior_authz.id is null or not (prior_authz.status in ('Returned','Revoked') or (prior_authz.status='Approved' and prior_authz.valid_until<current_date)) then
    raise exception 'returned_revoked_or_expired_authority_required' using errcode='23514'; end if;
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
      where workspace_id=ws.id and work_id=work.id and status='Approved' and source_digest=src->>'digest' and valid_until>=current_date) then
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
