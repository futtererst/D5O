-- A connected pursuit is independently governed. The JSON opportunity remains
-- editable context; this table and its receipts own decisions and handoff.
create table d5o_hosted.connected_pursuit_states (
  workspace_id uuid not null,
  work_id uuid not null,
  source_digest text not null,
  decision_revision integer not null check (decision_revision>0),
  status text not null check (status in ('draft','submitted','returned','held','qualified','declined')),
  submitter uuid references auth.users(id),
  decider uuid references auth.users(id),
  handoff_sender uuid references auth.users(id),
  handoff_receiver uuid references auth.users(id),
  projection jsonb not null check (pg_catalog.jsonb_typeof(projection)='object'),
  fit text not null,
  next_action text not null,
  updated_at timestamptz not null default now(),
  primary key(workspace_id,work_id),
  foreign key(work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id)
);
create table d5o_hosted.connected_pursuit_events (
  workspace_id uuid not null,
  work_id uuid not null,
  decision_revision integer not null,
  command_id text not null,
  action text not null,
  actor_user_id uuid not null references auth.users(id),
  membership_id uuid not null references d5o_hosted.memberships(id),
  authority_role text not null,
  configuration_version_id uuid not null references d5o_hosted.configuration_versions(id),
  source_digest text not null,
  reason text not null,
  occurred_at timestamptz not null default now(),
  primary key(workspace_id,work_id,decision_revision),
  unique(workspace_id,command_id),
  foreign key(work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id)
);
create table d5o_hosted.connected_pursuit_receipts (
  workspace_id uuid not null,
  command_id text not null,
  work_id uuid not null,
  actor_user_id uuid not null references auth.users(id),
  fingerprint text not null,
  result jsonb not null,
  primary key(workspace_id,command_id),
  foreign key(work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id)
);
alter table d5o_hosted.connected_pursuit_states enable row level security;
alter table d5o_hosted.connected_pursuit_events enable row level security;
alter table d5o_hosted.connected_pursuit_receipts enable row level security;
revoke all on d5o_hosted.connected_pursuit_states,d5o_hosted.connected_pursuit_events,
  d5o_hosted.connected_pursuit_receipts from public,anon,authenticated;

create function d5o_hosted.connected_pursuit_source_digest_v1(p_record jsonb)
returns text language sql immutable set search_path='' as $$
  select pg_catalog.md5(pg_catalog.jsonb_build_array(p_record->'customer',p_record->'site',
    p_record->'owner',p_record#>'{discovery,need}',
    p_record#>'{discovery,crm,assessmentHistory}')::text);
$$;
revoke all on function d5o_hosted.connected_pursuit_source_digest_v1(jsonb)
  from public,anon,authenticated,service_role;

create function d5o_hosted.connected_pursuit_record_v1(p_workspace uuid,p_record jsonb)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when p.work_id is null then p_record else
    p_record || pg_catalog.jsonb_build_object(
      'discovery',coalesce(p_record->'discovery','{}'::jsonb)||
        pg_catalog.jsonb_build_object('pursuitControl',p.projection,'fit',p.fit),
      'nextAction',case when p.source_digest is distinct from
        d5o_hosted.connected_pursuit_source_digest_v1(p_record) then
        'Pursuit source changed: reassess before another decision' else p.next_action end)
    end
  from d5o_hosted.work_identity_links l
  left join d5o_hosted.connected_pursuit_states p on p.workspace_id=l.workspace_id
    and p.work_id=l.work_id
  where l.workspace_id=p_workspace and l.presentation_id=p_record->>'id';
$$;
revoke all on function d5o_hosted.connected_pursuit_record_v1(uuid,jsonb)
  from public,anon,authenticated,service_role;

-- Compose Discover and Define authoritative projections for every member read.
create or replace function d5o_hosted.connected_define_projection_v1(p_workspace uuid,p_state jsonb)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when p_state is null then null else
    pg_catalog.jsonb_set(p_state,'{records}',coalesce((
      select pg_catalog.jsonb_agg(case when d.work_id is null then base
        else base || pg_catalog.jsonb_build_object('definition',d.projection,
          'nextAction',d.next_action) end order by ordinal)
      from pg_catalog.jsonb_array_elements(coalesce(p_state->'records','[]'::jsonb))
        with ordinality as records(item,ordinal)
      left join d5o_hosted.work_identity_links l on l.workspace_id=p_workspace
        and l.presentation_id=item->>'id'
      left join d5o_hosted.connected_define_states d on d.workspace_id=p_workspace
        and d.work_id=l.work_id
      cross join lateral (select coalesce(d5o_hosted.connected_pursuit_record_v1(
        p_workspace,item),item) as base) projected
    ),'[]'::jsonb)) end;
$$;
revoke all on function d5o_hosted.connected_define_projection_v1(uuid,jsonb)
  from public,anon,authenticated,service_role;

create function public.d5o_hosted_pursuit_command_v1(
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
  if v_control.work_id is not null and v_control.source_digest<>v_source_digest then
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
    update d5o_hosted.connected_pursuit_states set decision_revision=decision_revision+1,
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
revoke all on function public.d5o_hosted_pursuit_command_v1(
  text,text,text,jsonb,text,bigint,integer) from public,anon,service_role;
grant execute on function public.d5o_hosted_pursuit_command_v1(
  text,text,text,jsonb,text,bigint,integer) to authenticated;

-- Define evaluates the accepted authenticated pursuit, never a legacy text fit.
create or replace function d5o_hosted.connected_define_ready_v1(p_work jsonb,p_contract jsonb)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare d jsonb:=p_work->'definition'; c jsonb:=d->'scopeControl';
  row jsonb; scope_row jsonb; requirement jsonb; criterion jsonb; rule jsonb;
  fact text[]; value jsonb; field text;
begin
  if d is null or d->>'status'<>'Draft' or coalesce((d->>'revision')::integer,0)<1
    or not exists(select 1 from d5o_hosted.connected_pursuit_states p
      join d5o_hosted.work_identity_links l on l.work_id=p.work_id
        and l.workspace_id=p.workspace_id
      join d5o_hosted.workspaces w on w.id=p.workspace_id
      where l.presentation_id=p_work->>'id' and w.workspace_key=p_work->>'workspace'
        and p.status='qualified' and p.projection#>>'{handoff,status}'='accepted'
        and p.source_digest=d5o_hosted.connected_pursuit_source_digest_v1(p_work))
    then return false; end if;
  if length(trim(coalesce(d#>>'{project,customerContact}','')))=0
    or length(trim(coalesce(d#>>'{project,siteArea}','')))=0
    or length(trim(coalesce(d#>>'{project,affectedSystems}','')))=0
    or length(trim(coalesce(d#>>'{project,accessConstraints}','')))=0
    or length(trim(coalesce(d->>'outcome','')))=0
    or length(trim(coalesce(d->>'excludedScope','')))=0
    or length(trim(coalesce(d->>'deliveryApproach','')))=0
    or length(trim(coalesce(c#>>'{customerAgreement,representative}','')))=0
    or length(trim(coalesce(c#>>'{customerAgreement,agreedAt}','')))=0
    or length(trim(coalesce(c#>>'{customerAgreement,basis}','')))=0 then return false; end if;
  if not exists(select 1 from pg_catalog.jsonb_array_elements(coalesce(d->'findings','[]'::jsonb)) f
      where f->>'status'='Confirmed' and length(trim(coalesce(f->>'source','')))>0
        and length(trim(coalesce(f->>'detail','')))>0)
    or exists(select 1 from pg_catalog.jsonb_array_elements(coalesce(d->'clarifications','[]'::jsonb)) q
      where q->>'status'='Open') then return false; end if;
  if pg_catalog.jsonb_array_length(coalesce(c->'requirements','[]'::jsonb))=0
    or pg_catalog.jsonb_array_length(coalesce(d#>'{registers,scope_items}','[]'::jsonb))=0
    or pg_catalog.jsonb_array_length(coalesce(c->'interfaces','[]'::jsonb))=0 then return false; end if;
  for requirement in select x from pg_catalog.jsonb_array_elements(c->'requirements') x loop
    if requirement->>'state'<>'Confirmed' or length(trim(coalesce(requirement->>'id','')))=0
      or length(trim(coalesce(requirement->>'need','')))=0
      or length(trim(coalesce(requirement->>'source','')))=0
      or length(trim(coalesce(requirement->>'owner','')))=0 then return false; end if;
  end loop;
  for scope_row in select x from pg_catalog.jsonb_array_elements(d#>'{registers,scope_items}') x loop
    if length(trim(coalesce(scope_row->>'id','')))=0
      or length(trim(coalesce(scope_row->>'deliverable','')))=0
      or length(trim(coalesce(scope_row->>'boundary','')))=0
      or length(trim(coalesce(scope_row->>'owner','')))=0
      or not exists(select 1 from pg_catalog.jsonb_array_elements(c->'requirements') r
        where r->>'id'=scope_row->>'requirementId' and r->>'state'='Confirmed')
      or not exists(select 1 from pg_catalog.jsonb_array_elements(coalesce(d#>'{registers,acceptance_criteria}','[]'::jsonb)) a
        where a->>'scopeId'=scope_row->>'id'
          and length(trim(coalesce(a->>'result','')))>0
          and length(trim(coalesce(a->>'method','')))>0
          and length(trim(coalesce(a->>'proof','')))>0
          and length(trim(coalesce(a->>'authority','')))>0) then return false; end if;
  end loop;
  for criterion in select x from pg_catalog.jsonb_array_elements(coalesce(d#>'{registers,acceptance_criteria}','[]'::jsonb)) x loop
    if not exists(select 1 from pg_catalog.jsonb_array_elements(d#>'{registers,scope_items}') s
      where s->>'id'=criterion->>'scopeId') then return false; end if;
  end loop;
  for row in select x from pg_catalog.jsonb_array_elements(c->'interfaces') x loop
    if length(trim(coalesce(row->>'boundary','')))=0 or length(trim(coalesce(row->>'owner','')))=0
      or length(trim(coalesce(row->>'counterparty','')))=0
      or length(trim(coalesce(row->>'agreement','')))=0 then return false; end if;
  end loop;
  for row in select x from pg_catalog.jsonb_array_elements(coalesce(c->'assumptions','[]'::jsonb)) x loop
    if row->>'state'='Open' or length(trim(coalesce(row->>'statement','')))=0
      or length(trim(coalesce(row->>'owner','')))=0
      or length(trim(coalesce(row->>'source','')))=0 then return false; end if;
  end loop;
  if p_contract is null or pg_catalog.jsonb_typeof(p_contract->'components')<>'array' then return false; end if;
  for rule in select r from pg_catalog.jsonb_array_elements(p_contract->'components') co,
      lateral pg_catalog.jsonb_array_elements(coalesce(co->'rules','[]'::jsonb)) r
      where r->>'requiredAt'='review' loop
    fact:=pg_catalog.string_to_array(rule->>'fact','.');
    if fact is null or fact[1] not in ('definition','discovery') then return false; end if;
    value:=p_work #> fact;
    if rule->>'operator'='present' then
      if value is null or value='null'::jsonb
        or (pg_catalog.jsonb_typeof(value)='string' and length(trim(value #>> '{}'))=0)
        or (pg_catalog.jsonb_typeof(value)='array' and pg_catalog.jsonb_array_length(value)=0)
        then return false; end if;
    elsif rule->>'operator'='equals' then
      if value #>> '{}' is distinct from rule->>'value' then return false; end if;
    elsif rule->>'operator'='rows_complete' then
      if pg_catalog.jsonb_typeof(value)<>'array' or pg_catalog.jsonb_array_length(value)=0 then return false; end if;
      for row in select x from pg_catalog.jsonb_array_elements(value) x loop
        for field in select x from pg_catalog.jsonb_array_elements_text(coalesce(rule->'fields','[]'::jsonb)) x loop
          if length(trim(coalesce(row->>field,'')))=0 then return false; end if;
        end loop;
      end loop;
    else return false; end if;
  end loop;
  return true;
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end; $$;
revoke all on function d5o_hosted.connected_define_ready_v1(jsonb,jsonb)
  from public,anon,authenticated,service_role;
