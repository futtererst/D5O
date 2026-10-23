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
  v_state jsonb;v_release jsonb;v_turnover jsonb;v_acceptance jsonb;
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
      or length(trim(coalesce(p_input->>'source','')))<10 then
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
    v_turnover:=v_turnover||pg_catalog.jsonb_build_object(
      'status',case when trim(coalesce(p_input->>'conditions',''))=''
        then 'Client accepted' else 'Conditionally accepted' end,
      'acceptedAt',v_now,'recordedByActorId',v_actor,'signerName',trim(p_input->>'signerName'),
      'signerOrganization',trim(p_input->>'signerOrganization'),
      'authorityBasis',trim(p_input->>'authorityBasis'),
      'source',trim(p_input->>'source'),
      'conditions',trim(coalesce(p_input->>'conditions','')));
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
        'method','External source recorded','authorityBasis',v_turnover->>'authorityBasis',
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
      or length(trim(coalesce(p_input->>'source','')))<10
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
    v_acceptance:=pg_catalog.jsonb_build_object('id',gen_random_uuid(),
      'revision',1,'turnoverIds',v_all_turnovers,'releaseIds',v_release_ids,
      'acceptedAt',v_now,'recordedByActorId',v_actor,
      'signerName',trim(p_input->>'signerName'),
      'signerOrganization',trim(p_input->>'signerOrganization'),
      'signerRole',trim(p_input->>'signerRole'),
      'authorityBasis',trim(p_input->>'authorityBasis'),
      'source',trim(p_input->>'source'),'conditions','','receipt','Awaiting');
    v_state:=pg_catalog.jsonb_set(v_state,'{workAcceptance}',v_acceptance);
    v_state:=pg_catalog.jsonb_set(v_state,'{signoffs}',v_state->'signoffs'||
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',gen_random_uuid(),
        'kind','Final client acceptance','recordId',v_acceptance->>'id',
        'recordRevision',1,'releaseIds',v_release_ids,'scope',p_presentation_id,
        'statement','Customer accepts the exact listed package turnovers; Operations receipt is separate.',
        'signerName',v_acceptance->>'signerName',
        'signerOrganization',v_acceptance->>'signerOrganization',
        'method','External source recorded','authorityBasis',v_acceptance->>'authorityBasis',
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
