-- Forward-only reassessment of changed field facts before turnover. The existing
-- authenticated, revisioned command and evidence-aware acceptance contracts are
-- restated with only the completion snapshot and turnover selection changed.
-- Measured execution and verification against an exact accepted release.
create or replace function public.d5o_hosted_field_fact_command_v1(
  p_workspace_key text,p_presentation_id text,p_package_id text,
  p_action text,p_input jsonb,p_command_id text,
  p_expected_source_revision bigint,p_expected_design_revision integer,
  p_expected_schedule_revision integer,p_expected_deploy_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
  v_member d5o_hosted.memberships%rowtype;v_work d5o_hosted.work_records%rowtype;
  v_raw d5o_hosted.prototype_states%rowtype;
  v_design d5o_hosted.connected_design_states%rowtype;
  v_schedule d5o_hosted.connected_schedule_states%rowtype;
  v_deploy d5o_hosted.connected_deploy_states%rowtype;
  v_receipt d5o_hosted.connected_deploy_receipts%rowtype;
  v_binding d5o_hosted.crew_bindings%rowtype;
  v_policy jsonb;v_state jsonb;v_release jsonb;v_publication jsonb;
  v_booking jsonb;v_permit jsonb;v_report jsonb;v_inspection jsonb;
  v_item jsonb;v_prior jsonb;v_id text;v_note text:=trim(coalesce(p_input->>'note',''));
  v_now timestamptz:=now();v_fingerprint text;v_result jsonb;
  v_quantity numeric;v_hours numeric;v_planned numeric;v_total numeric;
  v_requirement text;v_has_pass boolean;v_failed boolean;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or p_action not in ('save-report','submit-report','review-report',
      'record-inspection','review-inspection','review-completion')
    or pg_catalog.jsonb_typeof(p_input)<>'object'
    or length(coalesce(p_command_id,'')) not between 8 and 120
    or p_expected_source_revision is null or p_expected_source_revision<1
    or p_expected_design_revision is null or p_expected_design_revision<1
    or p_expected_schedule_revision is null or p_expected_schedule_revision<1
    or p_expected_deploy_revision is null or p_expected_deploy_revision<1 then
    raise exception 'invalid_field_fact_command' using errcode='22023'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor and status='active' for share;
  if not found then raise exception 'field_membership_required' using errcode='42501'; end if;
  select w.* into v_work from d5o_hosted.work_records w
    join d5o_hosted.work_identity_links l on l.work_id=w.id
      and l.workspace_id=w.workspace_id
    where w.workspace_id=v_workspace.id and l.presentation_id=p_presentation_id
      for update of w;
  if not found then raise exception 'connected_work_unavailable' using errcode='42501'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_workspace_key,
    p_presentation_id,p_package_id,p_action,p_input,p_expected_source_revision,
    p_expected_design_revision,p_expected_schedule_revision,
    p_expected_deploy_revision)::text);
  select * into v_receipt from d5o_hosted.connected_deploy_receipts
    where workspace_id=v_workspace.id and command_id=p_command_id;
  if found then
    if v_receipt.work_id<>v_work.id or v_receipt.actor_user_id<>v_actor
      or v_receipt.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    if v_member.role='field_worker' then
      return pg_catalog.jsonb_build_object('accepted',true,
        'packageId',p_package_id,'commandId',p_command_id,'replay',true);
    end if;
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
    or v_schedule.decision_revision is distinct from p_expected_schedule_revision
    or v_deploy.decision_revision is distinct from p_expected_deploy_revision then
    raise exception 'stale_field_fact_basis' using errcode='23505'; end if;
  select wt->'deployControls' into v_policy
    from d5o_hosted.configuration_versions c,
      lateral pg_catalog.jsonb_array_elements(
        c.manifest_json#>'{d5oPresentation,phaseContract,workTypes}') wt
    where c.id=v_work.configuration_version_id
      and wt->>'workTypeKey'=v_work.work_type_key;
  if v_policy is null or v_policy->>'schemaVersion'<>'1' then
    raise exception 'pinned_deploy_policy_unavailable' using errcode='23514'; end if;
  v_state:=v_deploy.state;
  select r into v_release from pg_catalog.jsonb_array_elements(v_design.state->'releases') r
    where r->>'packageId'=p_package_id order by r->>'issuedAt' desc limit 1;
  if v_release is null or v_release->>'status'<>'Accepted'
    or (v_release->>'packageRevision')::integer<>
      (select (p->>'revision')::integer from pg_catalog.jsonb_array_elements(
        v_design.state->'packages') p where p->>'packageId'=p_package_id) then
    raise exception 'current_release_required' using errcode='23514'; end if;
  select pub into v_publication from pg_catalog.jsonb_array_elements(
    v_schedule.state->'publications') pub
    where exists(select 1 from pg_catalog.jsonb_array_elements(pub->'assignments') a
      where a->>'workId'=p_presentation_id and a->>'packageId'=p_package_id)
    order by pub->>'publishedAt' desc limit 1;
  select a into v_booking from pg_catalog.jsonb_array_elements(
    coalesce(v_publication->'assignments','[]'::jsonb)) a
    where a->>'id'=p_input->>'bookingId' and a->>'workId'=p_presentation_id
      and a->>'packageId'=p_package_id;
  if p_action in ('save-report','submit-report','record-inspection') then
    select * into v_binding from d5o_hosted.crew_bindings
      where workspace_id=v_workspace.id and actor_user_id=v_actor
        and active for share;
    if v_member.role<>'field_worker' or v_binding.person is null
      or v_booking is null or not (v_booking->'people' ? v_binding.person) then
      raise exception 'assigned_worker_required' using errcode='42501'; end if;
  end if;
  select p into v_permit from pg_catalog.jsonb_array_elements(v_state->'permits') p
    where p->>'packageId'=p_package_id order by p->>'at' desc limit 1;
  if p_action='save-report' then
    v_quantity:=(p_input->>'quantity')::numeric;
    v_hours:=(p_input->>'laborHours')::numeric;
    if v_quantity<0 or v_hours<0 or v_hours>
      (v_policy->>'maxActualHoursPerShift')::numeric
      or p_input->>'unit' is distinct from
        v_release#>>'{snapshot,completionBasis,unit}'
      or length(trim(coalesce(p_input->>'summary','')))<10 then
      raise exception 'measured_report_invalid' using errcode='22023'; end if;
    v_id:=coalesce(nullif(p_input->>'reportId',''),gen_random_uuid()::text);
    select r into v_prior from pg_catalog.jsonb_array_elements(v_state->'reports') r
      where r->>'id'=v_id;
    if v_prior is not null and (v_prior->>'authorId'<>v_actor::text
      or v_prior->>'status' not in ('Draft','Returned')
      or v_prior->>'bookingId'<>v_booking->>'id') then
      raise exception 'report_correction_denied' using errcode='42501'; end if;
    v_report:=pg_catalog.jsonb_build_object('id',v_id,
      'revision',coalesce((v_prior->>'revision')::integer,0)+1,
      'packageId',p_package_id,'releaseId',v_release->>'id',
      'bookingId',v_booking->>'id','date',v_booking->>'date',
      'quantity',v_quantity,'unit',p_input->>'unit',
      'laborHours',v_hours,'material',coalesce(p_input->>'material',''),
      'summary',trim(p_input->>'summary'),
      'evidenceIds','[]'::jsonb,'capturedAt',coalesce(p_input->>'capturedAt',v_now::text),
      'receivedAt',v_now,'authorId',v_actor,'status','Draft',
      'history',coalesce(v_prior->'history','[]'::jsonb)||
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'revision',coalesce((v_prior->>'revision')::integer,0)+1,
          'at',v_now,'reason',coalesce(nullif(v_note,''),'Field draft saved'))));
    v_state:=pg_catalog.jsonb_set(v_state,'{reports}',
      (select coalesce(pg_catalog.jsonb_agg(r order by ordinal),'[]'::jsonb)
        from pg_catalog.jsonb_array_elements(v_state->'reports')
          with ordinality as entries(r,ordinal) where r->>'id'<>v_id)
        ||pg_catalog.jsonb_build_array(v_report));
  elsif p_action='submit-report' then
    select r into v_report from pg_catalog.jsonb_array_elements(v_state->'reports') r
      where r->>'id'=p_input->>'reportId' and r->>'packageId'=p_package_id;
    if v_report is null or v_report->>'status'<>'Draft'
      or v_report->>'authorId'<>v_actor::text
      or v_permit->>'status'<>'Authorized'
      or v_permit->>'releaseId'<>v_release->>'id'
      or v_permit->>'publicationId'<>v_publication->>'id'
      or (v_permit->>'scheduleRevision')::integer<>
        v_schedule.decision_revision then
      raise exception 'current_start_and_author_required' using errcode='23514'; end if;
    v_report:=v_report||pg_catalog.jsonb_build_object('status','Submitted');
    v_state:=pg_catalog.jsonb_set(v_state,'{reports}',
      (select pg_catalog.jsonb_agg(case when r->>'id'=v_report->>'id'
        then v_report else r end order by ordinal)
        from pg_catalog.jsonb_array_elements(v_state->'reports')
          with ordinality as entries(r,ordinal)));
  elsif p_action='review-report' then
    if v_member.role not in ('field_supervisor','operations_leader')
      or p_input->>'decision' not in ('Reviewed','Returned')
      or length(v_note)<15 then
      raise exception 'report_review_authority_required' using errcode='42501'; end if;
    select r into v_report from pg_catalog.jsonb_array_elements(v_state->'reports') r
      where r->>'id'=p_input->>'reportId' and r->>'packageId'=p_package_id;
    if v_report is null or v_report->>'status'<>'Submitted'
      or v_report->>'authorId'=v_actor::text then
      raise exception 'independent_submitted_report_required' using errcode='42501'; end if;
    v_report:=v_report||pg_catalog.jsonb_build_object(
      'status',p_input->>'decision','reviewerId',v_actor,
      'reviewNote',v_note,'reviewedAt',v_now);
    v_state:=pg_catalog.jsonb_set(v_state,'{reports}',
      (select pg_catalog.jsonb_agg(case when r->>'id'=v_report->>'id'
        then v_report else r end order by ordinal)
        from pg_catalog.jsonb_array_elements(v_state->'reports')
          with ordinality as entries(r,ordinal)));
  elsif p_action='record-inspection' then
    select r into v_report from pg_catalog.jsonb_array_elements(v_state->'reports') r
      where r->>'id'=p_input->>'reportId' and r->>'packageId'=p_package_id
        and r->>'status'='Reviewed';
    v_requirement:=p_input->>'requirementId';
    if v_report is null or not (v_release#>'{snapshot,requirementIds}' ? v_requirement)
      or p_input->>'result' not in ('Pass','Fail')
      or length(trim(coalesce(p_input->>'method','')))<5 then
      raise exception 'inspection_basis_invalid' using errcode='23514'; end if;
    if p_input->>'supersedesId' is not null and not exists(select 1 from
      pg_catalog.jsonb_array_elements(v_state->'inspections') i
      where i->>'id'=p_input->>'supersedesId'
        and i->>'packageId'=p_package_id
        and i->>'requirementId'=v_requirement
        and i->>'result'='Fail' and i->>'status'='Verified') then
      raise exception 'failed_inspection_reference_required' using errcode='23514'; end if;
    v_inspection:=pg_catalog.jsonb_build_object('id',gen_random_uuid(),
      'packageId',p_package_id,'releaseId',v_release->>'id',
      'reportId',v_report->>'id','requirementId',v_requirement,
      'requirement',coalesce(p_input->>'requirement',v_requirement),
      'method',trim(p_input->>'method'),'result',p_input->>'result',
      'note',v_note,'evidenceIds','[]'::jsonb,'at',v_now,
      'actorId',v_actor,'status','Submitted',
      'supersedesId',p_input->>'supersedesId');
    v_state:=pg_catalog.jsonb_set(v_state,'{inspections}',
      v_state->'inspections'||pg_catalog.jsonb_build_array(v_inspection));
  elsif p_action='review-inspection' then
    if v_member.role<>'operations_leader' or
      p_input->>'decision' not in ('Verified','Returned')
      or length(v_note)<15 then
      raise exception 'quality_review_authority_required' using errcode='42501'; end if;
    select i into v_inspection from pg_catalog.jsonb_array_elements(
      v_state->'inspections') i where i->>'id'=p_input->>'inspectionId'
        and i->>'packageId'=p_package_id;
    if v_inspection is null or v_inspection->>'status'<>'Submitted'
      or v_inspection->>'actorId'=v_actor::text then
      raise exception 'independent_inspection_required' using errcode='42501'; end if;
    v_inspection:=v_inspection||pg_catalog.jsonb_build_object(
      'status',p_input->>'decision','reviewerId',v_actor,
      'reviewNote',v_note,'reviewedAt',v_now);
    v_state:=pg_catalog.jsonb_set(v_state,'{inspections}',
      (select pg_catalog.jsonb_agg(case when i->>'id'=v_inspection->>'id'
        then v_inspection else i end order by ordinal)
        from pg_catalog.jsonb_array_elements(v_state->'inspections')
          with ordinality as entries(i,ordinal)));
  else
    if v_member.role<>'operations_leader' or length(v_note)<15 then
      raise exception 'quality_completion_authority_required' using errcode='42501'; end if;
    v_planned:=(v_release#>>'{snapshot,completionBasis,plannedQuantity}')::numeric;
    if v_release#>>'{snapshot,completionBasis,kind}'<>'Measured'
      or v_planned<=0 then
      raise exception 'unsupported_completion_basis' using errcode='23514'; end if;
    select coalesce(sum((r->>'quantity')::numeric),0) into v_total
      from pg_catalog.jsonb_array_elements(v_state->'reports') r
      where r->>'packageId'=p_package_id and r->>'releaseId'=v_release->>'id'
        and r->>'status'='Reviewed' and r->>'unit'=
          v_release#>>'{snapshot,completionBasis,unit}';
    if v_total<>v_planned then
      raise exception 'measured_scope_incomplete_or_exceeded' using errcode='23514'; end if;
    if exists(select 1 from pg_catalog.jsonb_array_elements(v_state->'reports') r
      where r->>'packageId'=p_package_id and r->>'releaseId'=v_release->>'id'
        and r->>'status'='Reviewed' and r->>'authorId'=v_actor::text) then
      raise exception 'completion_reviewer_independence_required' using errcode='42501'; end if;
    if exists(select 1 from pg_catalog.jsonb_array_elements(v_state->'issues') i
      where i->>'packageId'=p_package_id and i->>'status'='Open') then
      raise exception 'open_issue_blocks_completion' using errcode='23514'; end if;
    for v_item in select value from pg_catalog.jsonb_array_elements(
      v_release#>'{snapshot,requirementIds}') loop
      v_requirement:=v_item#>>'{}';
      select exists(select 1 from pg_catalog.jsonb_array_elements(
        v_state->'inspections') i
        where i->>'packageId'=p_package_id and i->>'releaseId'=v_release->>'id'
          and i->>'requirementId'=v_requirement and i->>'result'='Pass'
          and i->>'status'='Verified') into v_has_pass;
      select exists(select 1 from pg_catalog.jsonb_array_elements(
        v_state->'inspections') i
        where i->>'packageId'=p_package_id and i->>'releaseId'=v_release->>'id'
          and i->>'requirementId'=v_requirement and i->>'result'='Fail'
          and i->>'status'='Verified' and not exists(select 1 from
            pg_catalog.jsonb_array_elements(v_state->'inspections') retest
            where retest->>'supersedesId'=i->>'id'
              and retest->>'result'='Pass' and retest->>'status'='Verified'))
        into v_failed;
      if not v_has_pass or v_failed then
        raise exception 'verified_requirement_or_retest_missing' using errcode='23514'; end if;
    end loop;
    if v_policy->>'requireReviewedEvidence'='true' and not exists(select 1 from
      pg_catalog.jsonb_array_elements(v_state->'evidence') e
      where e->>'packageId'=p_package_id and e->>'releaseId'=v_release->>'id'
        and e->>'state'='Reviewed') then
      raise exception 'reviewed_evidence_required' using errcode='23514'; end if;
    -- Prior reviewed decisions remain in history. A new fact set needs its
    -- own independent review, but issued turnover freezes this package basis.
    if v_state->'workAcceptance' is not null or exists(select 1 from
      pg_catalog.jsonb_array_elements(coalesce(v_state->'turnovers','[]'::jsonb)) t
      where t->'releaseIds' ? (v_release->>'id')) then
      raise exception 'completion_scope_frozen' using errcode='23514'; end if;
    if exists(select 1 from pg_catalog.jsonb_array_elements(
      coalesce(v_state->'completions','[]'::jsonb)) c
      where c->>'packageId'=p_package_id and c->>'releaseId'=v_release->>'id'
        and c->>'status'='Reviewed' and (c->>'reviewedQuantity')::numeric is not distinct from v_total
        and c->'reportIds'=(select coalesce(pg_catalog.jsonb_agg(r->>'id'),'[]'::jsonb)
          from pg_catalog.jsonb_array_elements(v_state->'reports') r
          where r->>'packageId'=p_package_id and r->>'releaseId'=v_release->>'id'
            and r->>'status'='Reviewed')
        and c->'inspectionIds'=(select coalesce(pg_catalog.jsonb_agg(i->>'id'),'[]'::jsonb)
          from pg_catalog.jsonb_array_elements(v_state->'inspections') i
          where i->>'packageId'=p_package_id and i->>'releaseId'=v_release->>'id'
            and i->>'status'='Verified' and i->>'result'='Pass')) then
      raise exception 'completion_already_reviewed' using errcode='23514'; end if;
    v_state:=pg_catalog.jsonb_set(v_state,'{completions}',
      coalesce(v_state->'completions','[]'::jsonb)||
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'id',gen_random_uuid(),
          'revision',1+(select count(*) from pg_catalog.jsonb_array_elements(
            coalesce(v_state->'completions','[]'::jsonb)) c
            where c->>'packageId'=p_package_id and c->>'releaseId'=v_release->>'id'),
          'supersedesId',(select c->>'id' from pg_catalog.jsonb_array_elements(
            coalesce(v_state->'completions','[]'::jsonb)) c
            where c->>'packageId'=p_package_id and c->>'releaseId'=v_release->>'id'
            order by (c->>'reviewedAt')::timestamptz desc limit 1),
          'packageId',p_package_id,
          'releaseId',v_release->>'id',
          'packageRevision',(v_release->>'packageRevision')::integer,
          'basis',v_release#>'{snapshot,completionBasis}',
          'reviewedQuantity',v_total,
          'unit',v_release#>>'{snapshot,completionBasis,unit}',
          'reportIds',(select pg_catalog.jsonb_agg(r->>'id') from
            pg_catalog.jsonb_array_elements(v_state->'reports') r
            where r->>'packageId'=p_package_id and r->>'releaseId'=v_release->>'id'
              and r->>'status'='Reviewed'),
          'inspectionIds',(select pg_catalog.jsonb_agg(i->>'id') from
            pg_catalog.jsonb_array_elements(v_state->'inspections') i
            where i->>'packageId'=p_package_id and i->>'releaseId'=v_release->>'id'
              and i->>'status'='Verified' and i->>'result'='Pass'),
          'reviewedAt',v_now,'reviewerId',v_actor,
          'membershipId',v_member.id,'reason',v_note,'status','Reviewed')));
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
  v_result:=case when v_member.role='field_worker' then
    pg_catalog.jsonb_build_object('accepted',true,
      'decisionRevision',v_deploy.decision_revision+1,
      'packageId',p_package_id,'commandId',p_command_id)
    else public.d5o_hosted_prototype_read_v1(p_workspace_key,'work') end;
  insert into d5o_hosted.connected_deploy_receipts(workspace_id,command_id,
    work_id,actor_user_id,fingerprint,result)
  values(v_workspace.id,p_command_id,v_work.id,v_actor,v_fingerprint,v_result);
  return v_result;
end; $$;
revoke all on function public.d5o_hosted_field_fact_command_v1(
  text,text,text,text,jsonb,text,bigint,integer,integer,integer)
  from public,anon,service_role;
grant execute on function public.d5o_hosted_field_fact_command_v1(
  text,text,text,text,jsonb,text,bigint,integer,integer,integer)
  to authenticated;

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
          and c->>'status'='Reviewed'
        order by (c->>'reviewedAt')::timestamptz desc limit 1),
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
