-- A Work cap may govern Design and field labor without delegating purchasing or subcontracting.
CREATE OR REPLACE FUNCTION public.d5o_purchase_authority_command_v1(p_workspace_key text, p_presentation_id text, p_action text, p_input jsonb, p_command_id text, p_expected_revision integer, p_expected_source_digest text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); ws d5o_hosted.workspaces%rowtype; member d5o_hosted.memberships%rowtype;
 work d5o_hosted.work_records%rowtype; pos d5o_hosted.purchase_authority_positions%rowtype;
 authority d5o_hosted.purchase_authorities%rowtype; prior d5o_hosted.purchase_authorities%rowtype;
 receipt d5o_hosted.purchase_authority_receipts%rowtype; source jsonb; fp text; result jsonb;
 next_rev integer; subject uuid; design_used bigint; purchase_used bigint; current_bom jsonb;
begin
 if current_setting('role',true)<>'authenticated' or actor is null
  or p_action not in ('prepare','approve','return','revoke')
  or pg_catalog.jsonb_typeof(p_input)<>'object' or length(coalesce(p_command_id,'')) not between 8 and 120
  or p_expected_revision is null or p_expected_revision<0 then
  raise exception 'invalid_purchase_authority_command' using errcode='22023'; end if;
 select * into ws from d5o_hosted.workspaces where workspace_key=p_workspace_key and status='active';
 select * into member from d5o_hosted.memberships where workspace_id=ws.id and actor_user_id=actor and status='active' for share;
 select w.* into work from d5o_hosted.work_records w join d5o_hosted.work_identity_links l
  on l.workspace_id=w.workspace_id and l.work_id=w.id
  where w.workspace_id=ws.id and l.presentation_id=p_presentation_id for update of w;
 if member.id is null or work.id is null then raise exception 'workspace_forbidden' using errcode='42501'; end if;
 fp:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_workspace_key,p_presentation_id,p_action,p_input,p_expected_revision,p_expected_source_digest)::text);
 select * into receipt from d5o_hosted.purchase_authority_receipts where workspace_id=ws.id and command_id=p_command_id;
 if found then
  if receipt.work_id<>work.id or receipt.actor_user_id<>actor or receipt.fingerprint<>fp then
   raise exception 'command_reuse_conflict' using errcode='23505'; end if;
  return receipt.result; end if;
 insert into d5o_hosted.purchase_authority_positions(workspace_id,work_id) values(ws.id,work.id) on conflict do nothing;
 select * into pos from d5o_hosted.purchase_authority_positions where workspace_id=ws.id and work_id=work.id for update;
 if pos.revision<>p_expected_revision then raise exception 'stale_purchase_authority_revision' using errcode='23505'; end if;
 source:=d5o_hosted.purchase_basis_v1(ws.id,work.id);
 if p_action<>'revoke' and (source is null or source->>'digest' is distinct from p_expected_source_digest) then
  raise exception 'purchase_authority_source_changed' using errcode='23514'; end if;
 if p_action='prepare' then
  if member.role<>'project_manager' or work.created_by<>actor then
   raise exception 'purchase_authority_preparer_required' using errcode='42501'; end if;
  if coalesce(p_input->>'parentCapMinor','') !~ '^[1-9][0-9]*$'
   or coalesce(p_input->>'purchaseCapMinor','') !~ '^(0|[1-9][0-9]*)$'
   or coalesce(p_input->>'validFrom','') !~ '^\d{4}-\d{2}-\d{2}$'
   or coalesce(p_input->>'validUntil','') !~ '^\d{4}-\d{2}-\d{2}$'
   or length(trim(coalesce(p_input->>'purchasingEntity',''))) not between 4 and 200
   or length(trim(coalesce(p_input->>'graybarAccountReference',''))) not between 3 and 200
   or length(trim(coalesce(p_input->>'scope',''))) not between 10 and 2000
   or length(trim(coalesce(p_input->>'fundingSource',''))) not between 8 and 1000
   or length(trim(coalesce(p_input->>'sourceReference',''))) not between 5 and 500
   or length(trim(coalesce(p_input->>'conditions',''))) < 10 then
   raise exception 'purchase_authority_basis_invalid' using errcode='22023'; end if;
  if (p_input->>'purchaseCapMinor')::bigint>(p_input->>'parentCapMinor')::bigint
   or (p_input->>'validFrom')::date>(p_input->>'validUntil')::date
   or (p_input->>'validUntil')::date<current_date then
   raise exception 'purchase_authority_cap_or_dates_invalid' using errcode='23514'; end if;
  select state->'bom' into current_bom from d5o_hosted.graybar_states
   where workspace_id=ws.id and work_id=work.id for share;
  if (p_input->>'purchaseCapMinor')::bigint>0 and current_bom->>'status' is distinct from 'Approved' then raise exception 'approved_design_bom_required' using errcode='23514'; end if;
  if exists(select 1 from d5o_hosted.graybar_states g
   cross join lateral pg_catalog.jsonb_array_elements(coalesce(g.state->'orders','[]'::jsonb)) historical
   where g.workspace_id=ws.id and g.work_id=work.id
    and historical->>'status' in ('Approved','Test submitted','Acknowledged')
    and not exists(select 1 from d5o_hosted.purchase_reservations r
     where r.workspace_id=ws.id and r.work_id=work.id and r.order_id=historical->>'id')) then
   raise exception 'legacy_purchase_transition_required' using errcode='23514'; end if;
  if exists(select 1 from d5o_hosted.purchase_authorities where workspace_id=ws.id and work_id=work.id
   and status='Approved' and source_digest=source->>'digest' and valid_until>=current_date) then
   raise exception 'active_purchase_authority_exists' using errcode='23514'; end if;
  if p_input ? 'supersedesId' then
   select * into prior from d5o_hosted.purchase_authorities where id=(p_input->>'supersedesId')::uuid
    and workspace_id=ws.id and work_id=work.id;
   if prior.id is null or not (prior.status in ('Returned','Revoked')
    or prior.status='Approved' and prior.valid_until<current_date) then
    raise exception 'returned_revoked_or_expired_authority_required' using errcode='23514'; end if;
  end if;
  insert into d5o_hosted.purchase_authorities(workspace_id,work_id,status,parent_cap_minor,purchasing_cap_minor,subcontract_enabled,
   currency,purchasing_entity,graybar_account_reference,bom_id,scope,conditions,funding_source,source_reference,valid_from,valid_until,source_digest,source_snapshot,
   prepared_by,supersedes_id)
   values(ws.id,work.id,'Prepared',(p_input->>'parentCapMinor')::bigint,(p_input->>'purchaseCapMinor')::bigint,coalesce((p_input->>'subcontractEnabled')::boolean,false),
    'USD',trim(p_input->>'purchasingEntity'),trim(p_input->>'graybarAccountReference'),
    current_bom->>'id',trim(p_input->>'scope'),trim(p_input->>'conditions'),trim(p_input->>'fundingSource'),
    trim(p_input->>'sourceReference'),(p_input->>'validFrom')::date,(p_input->>'validUntil')::date,
    source->>'digest',source,actor,prior.id) returning * into authority;
 else
  if member.role<>'admin' then raise exception 'independent_purchasing_authority_required' using errcode='42501'; end if;
  select * into authority from d5o_hosted.purchase_authorities
   where id=(p_input->>'authorityId')::uuid and workspace_id=ws.id and work_id=work.id for update;
  if authority.id is null or length(trim(coalesce(p_input->>'reason',''))) < 10 then
   raise exception 'purchase_authority_and_reason_required' using errcode='23514'; end if;
  if p_action='revoke' then
   if authority.status<>'Approved' then raise exception 'approved_purchase_authority_required' using errcode='23514'; end if;
  elsif authority.status<>'Prepared' or authority.prepared_by=actor then
   raise exception 'independent_purchasing_authority_required' using errcode='42501';
  end if;
  if p_action='approve' then
   select state->'bom' into current_bom from d5o_hosted.graybar_states
    where workspace_id=ws.id and work_id=work.id for share;
   if authority.purchasing_cap_minor>0 and (authority.bom_id is distinct from current_bom->>'id' or current_bom->>'status' is distinct from 'Approved') then
    raise exception 'purchase_authority_bom_changed' using errcode='23514'; end if;
   if authority.source_digest<>source->>'digest' or authority.valid_until<current_date
    or exists(select 1 from d5o_hosted.purchase_authorities where workspace_id=ws.id and work_id=work.id
     and status='Approved' and source_digest=source->>'digest' and valid_until>=current_date) then
    raise exception 'purchase_authority_stale_or_duplicate' using errcode='23514'; end if;
   select coalesce(sum(amount_minor),0) into design_used from d5o_hosted.design_spend_commitments
    where workspace_id=ws.id and work_id=work.id and status='Approved';
   select coalesce(sum(amount_minor),0) into purchase_used from d5o_hosted.purchase_reservations
    where workspace_id=ws.id and work_id=work.id and status='Reserved';
   if design_used+purchase_used>authority.parent_cap_minor or purchase_used>authority.purchasing_cap_minor then
    raise exception 'purchase_authority_below_existing_commitments' using errcode='23514'; end if;
  end if;
  update d5o_hosted.purchase_authorities set status=case p_action when 'approve' then 'Approved'
   when 'return' then 'Returned' else 'Revoked' end,
   reviewed_by=actor,review_note=trim(p_input->>'reason'),decided_at=now() where id=authority.id;
 end if;
 subject:=authority.id; next_rev:=pos.revision+1;
 update d5o_hosted.purchase_authority_positions set revision=next_rev,updated_at=now()
  where workspace_id=ws.id and work_id=work.id;
 insert into d5o_hosted.purchase_authority_events(workspace_id,work_id,revision,action,command_id,actor_user_id,
  membership_id,subject_id,basis) values(ws.id,work.id,next_rev,p_action,p_command_id,actor,member.id,subject,
   pg_catalog.jsonb_build_object('input',p_input,'source',source));
 result:=pg_catalog.jsonb_build_object('revision',next_rev,'action',p_action,'subjectId',subject,
  'status',case p_action when 'prepare' then 'Prepared' when 'approve' then 'Approved'
   when 'return' then 'Returned' else 'Revoked' end);
 insert into d5o_hosted.purchase_authority_receipts(workspace_id,command_id,work_id,actor_user_id,fingerprint,result)
  values(ws.id,p_command_id,work.id,actor,fp,result);
 return result;
end; $function$
;
