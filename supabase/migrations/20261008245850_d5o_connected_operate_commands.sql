-- Authenticated, typed pilot decisions for accepted support, asset identity,
-- structured coverage, service intake, and independent Finance closeout.
create or replace function public.d5o_hosted_operate_command_v1(
  p_workspace_key text,p_presentation_id text,p_action text,p_input jsonb,
  p_command_id text,p_expected_source_revision bigint,
  p_expected_deploy_revision integer,p_expected_operate_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
  v_member d5o_hosted.memberships%rowtype;v_work d5o_hosted.work_records%rowtype;
  v_raw d5o_hosted.prototype_states%rowtype;
  v_deploy d5o_hosted.connected_deploy_states%rowtype;
  v_operate d5o_hosted.connected_operate_states%rowtype;
  v_receipt d5o_hosted.connected_operate_receipts%rowtype;
  v_policy jsonb;v_state jsonb;v_source jsonb;v_asset jsonb;
  v_agreement jsonb;v_request jsonb;v_now timestamptz:=now();
  v_fingerprint text;v_result jsonb;v_note text:=trim(coalesce(p_input->>'note',''));
  v_id uuid;v_count integer;v_hours integer;v_due timestamptz;
  v_cursor timestamptz;v_added integer;v_local timestamp;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or p_action not in ('receive-handoff','add-asset','accept-support','activate',
      'add-agreement','approve-agreement','open-request','triage-request','update-finance')
    or pg_catalog.jsonb_typeof(p_input)<>'object'
    or length(coalesce(p_command_id,'')) not between 8 and 120
    or p_expected_source_revision is null or p_expected_source_revision<1
    or p_expected_deploy_revision is null or p_expected_deploy_revision<1
    or p_expected_operate_revision is null or p_expected_operate_revision<0 then
    raise exception 'invalid_operate_command' using errcode='22023'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor and status='active' for share;
  if not found then raise exception 'operate_membership_required' using errcode='42501'; end if;
  select w.* into v_work from d5o_hosted.work_records w
    join d5o_hosted.work_identity_links l on l.work_id=w.id
      and l.workspace_id=w.workspace_id
    where w.workspace_id=v_workspace.id and l.presentation_id=p_presentation_id
      for update of w;
  if not found then raise exception 'connected_work_unavailable' using errcode='42501'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(
    p_workspace_key,p_presentation_id,p_action,p_input,p_expected_source_revision,
    p_expected_deploy_revision,p_expected_operate_revision)::text);
  select * into v_receipt from d5o_hosted.connected_operate_receipts
    where workspace_id=v_workspace.id and command_id=p_command_id;
  if found then
    if v_receipt.work_id<>v_work.id or v_receipt.actor_user_id<>v_actor
      or v_receipt.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_receipt.result; end if;
  select * into v_raw from d5o_hosted.prototype_states
    where workspace_id=v_workspace.id and state_key='work' for share;
  select * into v_deploy from d5o_hosted.connected_deploy_states
    where workspace_id=v_workspace.id and work_id=v_work.id for share;
  select * into v_operate from d5o_hosted.connected_operate_states
    where workspace_id=v_workspace.id and work_id=v_work.id for update;
  if v_raw.revision is distinct from p_expected_source_revision
    or v_deploy.decision_revision is distinct from p_expected_deploy_revision
    or coalesce(v_operate.decision_revision,0) is distinct from p_expected_operate_revision then
    raise exception 'stale_operate_basis' using errcode='23505'; end if;
  select wt->'operateControls' into v_policy
    from d5o_hosted.configuration_versions c,
      lateral pg_catalog.jsonb_array_elements(
        c.manifest_json#>'{d5oPresentation,phaseContract,workTypes}') wt
    where c.id=v_work.configuration_version_id
      and wt->>'workTypeKey'=v_work.work_type_key;
  if v_policy is null or (v_policy->>'version')::integer<>1 then
    raise exception 'pinned_operate_policy_unavailable' using errcode='23514'; end if;
  v_state:=coalesce(v_operate.state,pg_catalog.jsonb_build_object(
    'assets','[]'::jsonb,'agreements','[]'::jsonb,'requests','[]'::jsonb,
    'jobs','[]'::jsonb,'maintenance','[]'::jsonb,
    'customerReviews','[]'::jsonb,'lifecycleLinks','[]'::jsonb,
    'finance',pg_catalog.jsonb_build_object('status','Pending','owner','Finance','note',''),
    'lessons','[]'::jsonb,'events','[]'::jsonb));
  if p_action='receive-handoff' then
    if v_member.role<>'operations_leader' or length(v_note)<15
      or v_state->'source' is not null then
      raise exception 'operations_receipt_required' using errcode='42501'; end if;
    v_source:=v_deploy.state->'workAcceptance';
    if v_source is null or v_source->>'receipt'<>'Accepted'
      or v_source->>'receivedByActorId'<>v_actor::text
      or v_source->>'id'<>p_input->>'workAcceptanceId'
      or (v_source->>'revision')::integer is distinct from
        (p_input->>'workAcceptanceRevision')::integer then
      raise exception 'exact_received_turnover_required' using errcode='23514'; end if;
    v_state:=pg_catalog.jsonb_set(v_state,'{source}',
      pg_catalog.jsonb_build_object('kind','Accepted Deploy',
        'workAcceptanceId',v_source->>'id','revision',(v_source->>'revision')::integer,
        'turnoverIds',v_source->'turnoverIds','acceptedAt',v_now,
        'acceptedByActorId',v_actor,'note',v_note));
  elsif p_action='add-asset' then
    if v_member.role not in ('project_manager','operations_leader')
      or v_state->'source' is null
      or length(trim(coalesce(p_input->>'name','')))<3
      or length(trim(coalesce(p_input->>'kind','')))<3
      or length(trim(coalesce(p_input->>'location','')))<3 then
      raise exception 'asset_record_incomplete' using errcode='42501'; end if;
    if exists(select 1 from pg_catalog.jsonb_array_elements(v_state->'assets') a
      where (a->>'name'=p_input->>'name' and a->>'location'=p_input->>'location')
        or (nullif(p_input->>'externalId','') is not null
          and a->>'externalId'=p_input->>'externalId')) then
      raise exception 'asset_identity_conflict' using errcode='23505'; end if;
    select gen_random_uuid() into v_id;
    v_asset:=pg_catalog.jsonb_build_object('id',v_id,'name',trim(p_input->>'name'),
      'kind',trim(p_input->>'kind'),'customer',
        (select r->>'customer' from pg_catalog.jsonb_array_elements(v_raw.state_json->'records') r
          where r->>'id'=p_presentation_id),
      'site',(select r->>'site' from pg_catalog.jsonb_array_elements(v_raw.state_json->'records') r
          where r->>'id'=p_presentation_id),
      'location',trim(p_input->>'location'),
      'externalId',nullif(trim(coalesce(p_input->>'externalId','')),''),
      'sourceWorkIds',pg_catalog.jsonb_build_array(p_presentation_id),
      'sourceTurnoverId',v_state#>>'{source,workAcceptanceId}',
      'status','Pending','owner',coalesce(nullif(trim(p_input->>'owner'),''),v_member.role),
      'documentation',trim(coalesce(p_input->>'documentation','')),
      'history',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'at',v_now,'action','Asset identified','source','Accepted Deploy','actorId',v_actor)));
    v_state:=pg_catalog.jsonb_set(v_state,'{assets}',
      v_state->'assets'||pg_catalog.jsonb_build_array(v_asset));
  elsif p_action='accept-support' then
    if v_member.role<>'operations_leader' or v_state->'source' is null
      or pg_catalog.jsonb_array_length(v_state->'assets')=0
      or length(trim(coalesce(p_input->>'escalation','')))<5
      or length(trim(coalesce(p_input->>'intakeRoute','')))<5
      or (v_policy->>'requireCustomerContact')::boolean
        and length(trim(coalesce(p_input->>'customerContact','')))<3
      or (v_policy->>'requireDocumentationReview')::boolean
        and length(trim(coalesce(p_input->>'documentation','')))<5
      or (v_policy->>'requireExplicitCoverageDisposition')::boolean
        and (length(trim(coalesce(p_input->>'warrantyDisposition','')))<3
          or length(trim(coalesce(p_input->>'serviceDisposition','')))<3)
      or (exists(select 1 from pg_catalog.jsonb_array_elements(v_deploy.state->'turnovers') t
        where trim(coalesce(t->>'obligations',''))<>'')
        and length(trim(coalesce(p_input->>'residualOwner','')))<3) then
      raise exception 'support_profile_incomplete' using errcode='23514'; end if;
    v_state:=pg_catalog.jsonb_set(v_state,'{support}',
      pg_catalog.jsonb_build_object('owner',v_member.role,'ownerActorId',v_actor,
        'acceptedAt',v_now,'customerContact',trim(coalesce(p_input->>'customerContact','')),
        'escalation',trim(p_input->>'escalation'),'intakeRoute',trim(p_input->>'intakeRoute'),
        'warrantyDisposition',trim(coalesce(p_input->>'warrantyDisposition','')),
        'serviceDisposition',trim(coalesce(p_input->>'serviceDisposition','')),
        'documentationReviewed',trim(coalesce(p_input->>'documentation','')),
        'residualOwner',trim(coalesce(p_input->>'residualOwner',''))));
  elsif p_action='activate' then
    if v_member.role<>'operations_leader' or v_state->'source' is null
      or v_state->'support' is null or v_state->'activation' is not null
      or pg_catalog.jsonb_array_length(v_state->'assets')=0
      or v_state#>>'{source,workAcceptanceId}'<>
        v_deploy.state#>>'{workAcceptance,id}'
      or v_deploy.state#>>'{workAcceptance,receipt}'<>'Accepted' then
      raise exception 'operational_readiness_incomplete' using errcode='23514'; end if;
    v_state:=pg_catalog.jsonb_set(v_state,'{activation}',
      pg_catalog.jsonb_build_object('status','Active','at',v_now,'actorId',v_actor,
        'basis',coalesce(nullif(v_note,''),'Recorded support readiness'),
        'sourceRevision',v_state#>'{source,revision}',
        'history',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'at',v_now,'action','Activated','actorId',v_actor,'reason',v_note))));
    v_state:=pg_catalog.jsonb_set(v_state,'{assets}',
      (select pg_catalog.jsonb_agg(a||pg_catalog.jsonb_build_object('status','Supported'))
        from pg_catalog.jsonb_array_elements(v_state->'assets') a));
  elsif p_action='add-agreement' then
    if v_member.role not in ('project_manager','operations_leader')
      or not exists(select 1 from pg_catalog.jsonb_array_elements(v_state->'assets') a
        where a->>'id'=p_input->>'assetId')
      or p_input->>'kind' not in ('Warranty','Service agreement','No coverage')
      or length(trim(coalesce(p_input->>'name','')))<3
      or (p_input->>'effectiveFrom')::date>(p_input->>'effectiveTo')::date
      or pg_catalog.jsonb_typeof(p_input->'serviceCategories')<>'array'
      or pg_catalog.jsonb_array_length(p_input->'serviceCategories')=0
      or pg_catalog.jsonb_typeof(p_input->'laborCovered')<>'boolean'
      or pg_catalog.jsonb_typeof(p_input->'partsCovered')<>'boolean'
      or pg_catalog.jsonb_typeof(p_input->'travelCovered')<>'boolean'
      or length(trim(coalesce(p_input->>'source','')))<10 then
      raise exception 'structured_agreement_required' using errcode='23514'; end if;
    if p_input->>'kind'='No coverage' and not (v_policy->>'allowNoCoverage')::boolean then
      raise exception 'no_coverage_disallowed' using errcode='23514'; end if;
    v_agreement:=pg_catalog.jsonb_build_object('id',gen_random_uuid(),
      'name',trim(p_input->>'name'),'kind',p_input->>'kind','status','Draft',
      'assetIds',pg_catalog.jsonb_build_array(p_input->>'assetId'),
      'effectiveFrom',p_input->>'effectiveFrom','effectiveTo',p_input->>'effectiveTo',
      'serviceCategories',p_input->'serviceCategories',
      'laborCovered',p_input->'laborCovered','partsCovered',p_input->'partsCovered',
      'travelCovered',p_input->'travelCovered',
      'includes',trim(coalesce(p_input->>'includes','')),
      'excludes',trim(coalesce(p_input->>'excludes','')),
      'responseHours',coalesce((p_input->>'responseHours')::integer,
        (v_policy->>'defaultResponseHours')::integer),
      'calendar',coalesce(p_input->>'calendar',v_policy->>'responseCalendar'),
      'timezone',v_policy->>'timezone','source',trim(p_input->>'source'),
      'revision',1,'createdByActorId',v_actor);
    v_state:=pg_catalog.jsonb_set(v_state,'{agreements}',
      v_state->'agreements'||pg_catalog.jsonb_build_array(v_agreement));
  elsif p_action='approve-agreement' then
    if v_member.role<>'operations_leader' or length(v_note)<15 then
      raise exception 'agreement_approval_authority_required' using errcode='42501'; end if;
    select a into v_agreement from pg_catalog.jsonb_array_elements(v_state->'agreements') a
      where a->>'id'=p_input->>'agreementId' and a->>'status'='Draft';
    if v_agreement is null or v_agreement->>'createdByActorId'=v_actor::text then
      raise exception 'independent_agreement_review_required' using errcode='42501'; end if;
    v_agreement:=v_agreement||pg_catalog.jsonb_build_object('status','Active',
      'approvedAt',v_now,'approvedBy',v_actor);
    v_state:=pg_catalog.jsonb_set(v_state,'{agreements}',
      (select pg_catalog.jsonb_agg(case when a->>'id'=v_agreement->>'id'
        then v_agreement else a end order by ordinal)
        from pg_catalog.jsonb_array_elements(v_state->'agreements')
          with ordinality as entries(a,ordinal)));
  elsif p_action='open-request' then
    if v_member.role not in ('project_manager','operations_leader')
      or v_state#>>'{activation,status}'<>'Active'
      or not exists(select 1 from pg_catalog.jsonb_array_elements(v_state->'assets') a
        where a->>'id'=p_input->>'assetId')
      or length(trim(coalesce(p_input->>'title','')))<5
      or length(trim(coalesce(p_input->>'description','')))<10
      or length(trim(coalesce(p_input->>'contact','')))<3
      or p_input->>'impact' not in ('Standard','High','Critical') then
      raise exception 'request_intake_incomplete' using errcode='23514'; end if;
    v_request:=pg_catalog.jsonb_build_object('id',gen_random_uuid(),
      'assetId',p_input->>'assetId','title',trim(p_input->>'title'),
      'description',trim(p_input->>'description'),'impact',p_input->>'impact',
      'contact',trim(p_input->>'contact'),'reportedAt',v_now,
      'owner',coalesce(nullif(trim(p_input->>'owner'),''),v_member.role),
      'status','New','coverage','Awaiting','jobIds','[]'::jsonb,
      'currentCycleJobIds','[]'::jsonb,
      'history',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'at',v_now,'action','Opened','actorId',v_actor,'note',v_note)));
    v_state:=pg_catalog.jsonb_set(v_state,'{requests}',
      v_state->'requests'||pg_catalog.jsonb_build_array(v_request));
  elsif p_action='triage-request' then
    if v_member.role<>'operations_leader' then
      raise exception 'request_triage_authority_required' using errcode='42501'; end if;
    select r into v_request from pg_catalog.jsonb_array_elements(v_state->'requests') r
      where r->>'id'=p_input->>'requestId' and r->>'status' in ('New','Reopened');
    if v_request is null or length(trim(coalesce(p_input->>'serviceCategory','')))<3 then
      raise exception 'current_request_required' using errcode='23514'; end if;
    select count(*) into v_count
      from pg_catalog.jsonb_array_elements(v_state->'agreements') a
      where a->>'status'='Active' and a->'assetIds' ? (v_request->>'assetId')
        and (a->>'effectiveFrom')::date<=v_now::date
        and (a->>'effectiveTo')::date>=v_now::date;
    if v_count>1 then raise exception 'coverage_conflict_requires_decision' using errcode='23514'; end if;
    select a into v_agreement from pg_catalog.jsonb_array_elements(v_state->'agreements') a
      where a->>'status'='Active' and a->'assetIds' ? (v_request->>'assetId')
        and (a->>'effectiveFrom')::date<=v_now::date
        and (a->>'effectiveTo')::date>=v_now::date limit 1;
    if v_agreement is null then
      v_request:=v_request||pg_catalog.jsonb_build_object('coverage','Chargeable',
        'coverageBasis','No active agreement; customer pricing and authorization required');
    elsif v_agreement->>'kind'='No coverage'
      or not (v_agreement->'serviceCategories' ? (p_input->>'serviceCategory')) then
      v_request:=v_request||pg_catalog.jsonb_build_object('coverage','Chargeable',
        'coverageBasis','Recorded terms do not cover this service category',
        'agreementId',v_agreement->>'id');
    else
      v_request:=v_request||pg_catalog.jsonb_build_object(
        'coverage',case when (v_agreement->>'laborCovered')::boolean
          and (v_agreement->>'partsCovered')::boolean
          and (v_agreement->>'travelCovered')::boolean then 'Covered'
          else 'Partially covered' end,
        'coverageBasis','Structured agreement scope and labor/parts/travel terms reviewed',
        'agreementId',v_agreement->>'id');
    end if;
    v_hours:=coalesce((v_agreement->>'responseHours')::integer,
      (v_policy->>'defaultResponseHours')::integer);
    if v_hours is not null and v_hours between 1 and 720 then
      if coalesce(v_agreement->>'calendar',v_policy->>'responseCalendar')='Continuous' then
        v_due:=v_now+pg_catalog.make_interval(hours=>v_hours);
      else
        v_cursor:=v_now;v_added:=0;
        while v_added<v_hours loop
          v_cursor:=v_cursor+interval '1 hour';
          v_local:=v_cursor at time zone (v_policy->>'timezone');
          if extract(isodow from v_local)<6
            and extract(hour from v_local)>=(coalesce((v_policy->>'businessStartHour')::integer,9))
            and extract(hour from v_local)<(coalesce((v_policy->>'businessEndHour')::integer,17))
            and not (v_policy->'holidayDates' ? v_local::date::text) then
            v_added:=v_added+1; end if;
          if v_cursor>v_now+interval '120 days' then
            raise exception 'sla_calendar_unresolvable' using errcode='23514'; end if;
        end loop;
        v_due:=v_cursor;
      end if;
    end if;
    v_request:=v_request||pg_catalog.jsonb_build_object('status','Triaged',
      'serviceCategory',p_input->>'serviceCategory',
      'responseDueAt',v_due,'owner',coalesce(nullif(trim(p_input->>'owner'),''),v_member.role),
      'slaBasis',pg_catalog.jsonb_build_object('configurationVersionId',
        v_work.configuration_version_id,'agreementId',v_agreement->>'id',
        'agreementRevision',(v_agreement->>'revision')::integer,
        'calendar',coalesce(v_agreement->>'calendar',v_policy->>'responseCalendar'),
        'timezone',v_policy->>'timezone','responseHours',v_hours));
    v_state:=pg_catalog.jsonb_set(v_state,'{requests}',
      (select pg_catalog.jsonb_agg(case when r->>'id'=v_request->>'id'
        then v_request else r end order by ordinal)
        from pg_catalog.jsonb_array_elements(v_state->'requests')
          with ordinality as entries(r,ordinal)));
  else
    if v_member.role<>'billing_commercial_lead'
      or p_input->>'status' not in ('Pending','In review','Closed')
      or length(v_note)<10
      or v_deploy.state#>>'{workAcceptance,receipt}'<>'Accepted' then
      raise exception 'finance_closeout_authority_required' using errcode='42501'; end if;
    v_state:=pg_catalog.jsonb_set(v_state,'{finance}',
      pg_catalog.jsonb_build_object('status',p_input->>'status',
        'owner',v_member.role,'ownerActorId',v_actor,'note',v_note,'at',v_now));
  end if;
  v_state:=v_state||pg_catalog.jsonb_build_object('authorityRevision',
    coalesce(v_operate.decision_revision,0)+1,
    'events',v_state->'events'||pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('id',gen_random_uuid(),
        'commandId',p_command_id,'fingerprint',v_fingerprint,
        'at',v_now,'actorId',v_actor,'membershipId',v_member.id,
        'action',p_action,'detail',v_note)));
  if v_operate.work_id is null then
    insert into d5o_hosted.connected_operate_states(workspace_id,work_id,
      decision_revision,state) values(v_workspace.id,v_work.id,1,v_state);
  else
    update d5o_hosted.connected_operate_states set
      decision_revision=decision_revision+1,state=v_state,updated_at=v_now
      where workspace_id=v_workspace.id and work_id=v_work.id;
  end if;
  insert into d5o_hosted.connected_operate_events(workspace_id,work_id,
    decision_revision,command_id,action,actor_user_id,membership_id,
    deploy_revision,snapshot)
  values(v_workspace.id,v_work.id,coalesce(v_operate.decision_revision,0)+1,
    p_command_id,p_action,v_actor,v_member.id,v_deploy.decision_revision,v_state);
  v_result:=public.d5o_hosted_prototype_read_v1(p_workspace_key,'work');
  insert into d5o_hosted.connected_operate_receipts(workspace_id,command_id,
    work_id,actor_user_id,fingerprint,result)
  values(v_workspace.id,p_command_id,v_work.id,v_actor,v_fingerprint,v_result);
  return v_result;
end; $$;
revoke all on function public.d5o_hosted_operate_command_v1(
  text,text,text,jsonb,text,bigint,integer,integer)
  from public,anon,service_role;
grant execute on function public.d5o_hosted_operate_command_v1(
  text,text,text,jsonb,text,bigint,integer,integer)
  to authenticated;
