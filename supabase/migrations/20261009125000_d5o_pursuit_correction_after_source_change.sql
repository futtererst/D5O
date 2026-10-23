-- A changed Discover draft invalidates its old pursuit basis. The authorized owner may
-- save a new intake revision against the current source; submit and later decisions
-- still require the exact current digest. Old events and receipts are retained.
create or replace function public.d5o_hosted_pursuit_command_v1(
  p_workspace_key text,p_presentation_id text,p_action text,p_intent jsonb,
  p_command_id text,p_expected_source_revision bigint,p_expected_decision_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_workspace d5o_hosted.workspaces%rowtype;
  v_member d5o_hosted.memberships%rowtype; v_work d5o_hosted.work_records%rowtype;
  v_state d5o_hosted.prototype_states%rowtype; v_control d5o_hosted.connected_pursuit_states%rowtype;
  v_receipt d5o_hosted.connected_pursuit_receipts%rowtype; v_raw jsonb;
  v_projection jsonb; v_fingerprint text; v_source_digest text;
  v_next text; v_fit text; v_reason text; v_result jsonb; v_receiver uuid;
  v_now timestamptz:=now();
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or p_action not in ('save-intake','submit','decide','submit-handoff','respond-handoff')
    or p_intent is null or pg_catalog.jsonb_typeof(p_intent)<>'object'
    or p_command_id is null or length(p_command_id) not between 8 and 120
    or p_expected_source_revision is null or p_expected_source_revision<1
    or p_expected_decision_revision is null or p_expected_decision_revision<0 then
    raise exception 'invalid_pursuit_command' using errcode='22023'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor and status='active' for share;
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  select w.* into v_work from d5o_hosted.work_records w
    join d5o_hosted.work_identity_links l on l.workspace_id=w.workspace_id and l.work_id=w.id
    where w.workspace_id=v_workspace.id and l.presentation_id=p_presentation_id for update of w;
  if not found then raise exception 'connected_work_unavailable' using errcode='42501'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_workspace_key,p_presentation_id,
    p_action,p_intent,p_expected_source_revision,p_expected_decision_revision)::text);
  select * into v_receipt from d5o_hosted.connected_pursuit_receipts
    where workspace_id=v_workspace.id and command_id=p_command_id;
  if found then
    if v_receipt.work_id<>v_work.id or v_receipt.actor_user_id<>v_actor
      or v_receipt.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_receipt.result;
  end if;
  select * into v_state from d5o_hosted.prototype_states
    where workspace_id=v_workspace.id and state_key='work' for share;
  select * into v_control from d5o_hosted.connected_pursuit_states
    where workspace_id=v_workspace.id and work_id=v_work.id for update;
  if v_state.revision is distinct from p_expected_source_revision
    or coalesce(v_control.decision_revision,0)<>p_expected_decision_revision then
    raise exception 'stale_state' using errcode='23505'; end if;
  select item into v_raw from pg_catalog.jsonb_array_elements(v_state.state_json->'records') item
    where item->>'id'=p_presentation_id and item->>'canonicalWorkId'=v_work.id::text;
  if v_raw is null or v_raw->>'phaseConfigurationVersionId' is distinct from v_work.configuration_version_id::text
    then raise exception 'source_identity_changed' using errcode='42501'; end if;
  v_source_digest:=d5o_hosted.connected_pursuit_source_digest_v1(v_raw);
  if v_control.work_id is not null and v_control.source_digest<>v_source_digest
    and p_action<>'save-intake' then
    raise exception 'pursuit_source_changed' using errcode='23505'; end if;
  v_projection:=coalesce(v_control.projection,v_raw#>'{discovery,pursuitControl}');
  if v_projection is null then raise exception 'pursuit_draft_unavailable' using errcode='22023'; end if;
  v_reason:=trim(coalesce(p_intent->>'reason',''));
  if p_action='save-intake' then
    if v_member.role not in ('admin','project_manager','business_development_lead')
      or coalesce(v_control.status,'draft') not in ('draft','returned','held')
      or p_intent-'requester'-'intendedOutcome'-'roughValue'-'currency'-'requiredDate'-'knownRisk'
        -'customer'-'site'-'owner'-'need'<>'{}'::jsonb
      or p_intent->>'customer' is distinct from v_raw->>'customer'
      or p_intent->>'site' is distinct from v_raw->>'site'
      or p_intent->>'owner' is distinct from v_raw->>'owner'
      or p_intent->>'need' is distinct from v_raw#>>'{discovery,need}'
      or length(trim(coalesce(p_intent->>'requester','')))=0
      or length(trim(coalesce(p_intent->>'intendedOutcome','')))=0
      or (p_intent->>'roughValue') !~ '^[0-9]+(\.[0-9]{1,2})?$'
      or (p_intent->>'roughValue')::numeric<=0
      or (p_intent->>'currency') !~ '^[A-Z]{3}$'
      or (p_intent->>'requiredDate') !~ '^\d{4}-\d{2}-\d{2}$'
      or length(trim(coalesce(p_intent->>'knownRisk','')))=0 then
      raise exception 'invalid_pursuit_intake' using errcode='22023'; end if;
    v_projection:=v_projection||pg_catalog.jsonb_build_object('status','draft',
      'requester',trim(p_intent->>'requester'),
      'intendedOutcome',trim(p_intent->>'intendedOutcome'),
      'roughValue',p_intent->>'roughValue','currency',p_intent->>'currency',
      'requiredDate',p_intent->>'requiredDate','knownRisk',trim(p_intent->>'knownRisk'));
    v_next:='Submit intake for pursuit decision'; v_fit:='Unassessed';
  elsif p_action='submit' then
    if v_member.role not in ('admin','project_manager','business_development_lead')
      or coalesce(v_control.status,'draft')<>'draft'
      or length(trim(coalesce(v_projection->>'requester','')))=0
      or length(trim(coalesce(v_projection->>'intendedOutcome','')))=0
      or length(trim(coalesce(v_projection->>'roughValue','')))=0
      or length(trim(coalesce(v_projection->>'requiredDate','')))=0
      or length(trim(coalesce(v_projection->>'knownRisk','')))=0
      or length(trim(coalesce(v_raw->>'customer','')))=0
      or length(trim(coalesce(v_raw->>'site','')))=0
      or length(trim(coalesce(v_raw->>'owner','')))=0
      or length(trim(coalesce(v_raw#>>'{discovery,need}','')))=0 then
      raise exception 'pursuit_intake_incomplete' using errcode='23514'; end if;
    v_projection:=v_projection||pg_catalog.jsonb_build_object('status','submitted',
      'submission',pg_catalog.jsonb_build_object('revision',p_expected_decision_revision+1,
        'at',v_now,'actor',v_actor::text,'actorId',v_actor));
    v_control.status:='submitted'; v_control.submitter:=v_actor;
    v_next:='Qualification authority: decide pursuit';
    v_fit:='Unassessed';
  elsif p_action='decide' then
    if v_member.role not in ('admin','billing_commercial_lead','business_development_lead')
      or v_control.status<>'submitted' or v_actor=v_control.submitter
      or p_intent-'outcome'-'reason'<>'{}'::jsonb
      or p_intent->>'outcome' not in ('qualified','returned','held','declined')
      or length(v_reason)<10 then
      raise exception 'pursuit_decision_denied' using errcode='42501'; end if;
    if p_intent->>'outcome'='qualified' and v_raw#>'{discovery,crm}' is not null
      and (v_raw#>>'{discovery,crm,disqualifier}'<>'None'
        or (v_raw#>'{discovery,crm,assessmentHistory}'->-1)->>'recommendation'
          not in ('Pursue','Pursue with conditions')) then
      raise exception 'pursuit_assessment_unfavorable' using errcode='23514'; end if;
    v_control.status:=p_intent->>'outcome'; v_control.decider:=v_actor;
    v_projection:=v_projection||pg_catalog.jsonb_build_object('status',v_control.status,
      'decision',pg_catalog.jsonb_build_object('revision',v_projection#>'{submission,revision}',
        'outcome',v_control.status,'reason',v_reason,'at',v_now,'actor',v_actor::text,
        'actorId',v_actor,'policyVersion',v_work.configuration_version_id));
    v_fit:=case when v_control.status='qualified' then 'Qualified'
      when v_control.status='declined' then 'Disqualified' else 'Unassessed' end;
    v_next:=case when v_control.status='qualified' then
      'Request bounded pursuit spend or send Define handoff' else
      'Correct intake or retain the pursuit decision' end;
  elsif p_action='submit-handoff' then
    if v_member.role not in ('admin','project_manager','business_development_lead')
      or v_control.status<>'qualified' or v_projection#>>'{handoff,status}' in ('submitted','accepted')
      or p_intent-'receiver'-'brief'<>'{}'::jsonb
      or length(trim(coalesce(p_intent->>'receiver','')))=0
      or length(trim(coalesce(p_intent->>'brief','')))<20 then
      raise exception 'pursuit_handoff_denied' using errcode='42501'; end if;
    select m.actor_user_id into v_receiver from d5o_hosted.memberships m
      join auth.users u on u.id=m.actor_user_id
      where m.workspace_id=v_workspace.id and m.status='active'
        and m.role in ('admin','operations_leader','project_manager')
        and pg_catalog.lower(u.email)=pg_catalog.lower(trim(p_intent->>'receiver'));
    if v_receiver is null or v_receiver=v_actor then
      raise exception 'named_receiver_unavailable' using errcode='42501'; end if;
    v_projection:=pg_catalog.jsonb_set(v_projection,'{handoff}',
      pg_catalog.jsonb_build_object('status','submitted',
        'receiver',trim(p_intent->>'receiver'),'brief',trim(p_intent->>'brief'),
        'receiverActorId',v_receiver,
        'revision',coalesce((v_projection#>>'{handoff,revision}')::integer,0)+1,
        'actor',v_actor::text,'actorId',v_actor,'at',v_now));
    v_control.handoff_sender:=v_actor; v_next:='Define receiver: accept or return the pursuit brief';
    v_fit:='Qualified';
  elsif p_action='respond-handoff' then
    if v_member.role not in ('admin','operations_leader','project_manager')
      or v_control.status<>'qualified' or v_projection#>>'{handoff,status}'<>'submitted'
      or v_actor=v_control.handoff_sender
      or v_actor::text is distinct from v_projection#>>'{handoff,receiverActorId}'
      or p_intent-'outcome'-'reason'<>'{}'::jsonb
      or p_intent->>'outcome' not in ('accepted','returned')
      or length(v_reason)<10 then
      raise exception 'pursuit_receipt_denied' using errcode='42501'; end if;
    v_projection:=pg_catalog.jsonb_set(v_projection,'{handoff}',
      (v_projection->'handoff')||pg_catalog.jsonb_build_object(
        'status',p_intent->>'outcome','reason',v_reason,'actor',v_actor::text,
        'actorId',v_actor,'at',v_now));
    v_control.handoff_receiver:=v_actor;
    v_next:=case when p_intent->>'outcome'='accepted' then
      'Define owner: establish scope baseline' else
      'Pursuit owner: correct Define brief' end;
    v_fit:='Qualified';
  end if;
  v_projection:=v_projection||pg_catalog.jsonb_build_object(
    'revision',p_expected_decision_revision+1,
    'history',coalesce(v_projection->'history','[]'::jsonb)||
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'revision',p_expected_decision_revision+1,'action',p_action,
        'actor',v_actor::text,'at',v_now,'note',coalesce(nullif(v_reason,''),p_action))));
  if v_control.work_id is null then
    insert into d5o_hosted.connected_pursuit_states(workspace_id,work_id,source_digest,
      decision_revision,status,projection,fit,next_action)
    values(v_workspace.id,v_work.id,v_source_digest,1,'draft',v_projection,v_fit,v_next);
  else
    update d5o_hosted.connected_pursuit_states set source_digest=v_source_digest,
      decision_revision=decision_revision+1,
      status=v_projection->>'status',submitter=coalesce(v_control.submitter,submitter),
      decider=coalesce(v_control.decider,decider),
      handoff_sender=coalesce(v_control.handoff_sender,handoff_sender),
      handoff_receiver=coalesce(v_control.handoff_receiver,handoff_receiver),
      projection=v_projection,fit=v_fit,next_action=v_next,updated_at=v_now
    where workspace_id=v_workspace.id and work_id=v_work.id;
  end if;
  insert into d5o_hosted.connected_pursuit_events(workspace_id,work_id,decision_revision,
    command_id,action,actor_user_id,membership_id,authority_role,configuration_version_id,
    source_digest,reason)
  values(v_workspace.id,v_work.id,p_expected_decision_revision+1,p_command_id,p_action,
    v_actor,v_member.id,v_member.role,v_work.configuration_version_id,v_source_digest,v_reason);
  v_result:=public.d5o_hosted_prototype_read_v1(p_workspace_key,'work');
  insert into d5o_hosted.connected_pursuit_receipts(workspace_id,command_id,work_id,
    actor_user_id,fingerprint,result)
  values(v_workspace.id,p_command_id,v_work.id,v_actor,v_fingerprint,v_result);
  return v_result;
end; $$;
