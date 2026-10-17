-- Remove a PL/pgSQL variable that shadows protected table status columns.
create or replace function public.d5o_hosted_design_cost_command_pre_forecast_v1(
 p_workspace_key text,p_presentation_id text,p_action text,p_input jsonb,p_command_id text,
 p_expected_revision integer,p_expected_source_digest text) returns jsonb
 language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); ws uuid; member d5o_hosted.memberships%rowtype;
 w d5o_hosted.work_records%rowtype; pos d5o_hosted.design_cost_positions%rowtype;
 receipt d5o_hosted.design_cost_receipts%rowtype; commitment d5o_hosted.design_spend_commitments%rowtype;
 link d5o_hosted.design_cost_links%rowtype; claim d5o_hosted.design_cost_claims%rowtype;
 prior d5o_hosted.design_cost_claims%rowtype; assessment d5o_hosted.outlook_assessments%rowtype;
 src jsonb; fingerprint text; result jsonb; subject uuid; amount bigint; category text; item jsonb; category_status text;
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
   item:=p_input->'categories'->category; category_status:=item->>'status';
   if category_status is null or category_status not in ('Resolved','Unknown','Not applicable') or length(trim(coalesce(item->>'reason','')))<8
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
