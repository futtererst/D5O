-- Connected Define decisions are owned by this table, never by a replacement
-- prototype snapshot. The existing snapshot remains a draft/source projection.
create table d5o_hosted.connected_define_states (
  workspace_id uuid not null,
  work_id uuid not null,
  source_revision bigint not null,
  source_digest text not null,
  definition_revision integer not null check (definition_revision > 0),
  decision_revision integer not null check (decision_revision > 0),
  status text not null check (status in ('Draft','In review','Changes requested','Approved')),
  submitted_by uuid not null references auth.users(id),
  commercial_reviewer uuid references auth.users(id),
  delivery_reviewer uuid references auth.users(id),
  handoff_sender uuid references auth.users(id),
  handoff_receiver uuid references auth.users(id),
  projection jsonb not null check (pg_catalog.jsonb_typeof(projection)='object'),
  next_action text not null,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, work_id),
  foreign key (work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id)
);
create table d5o_hosted.connected_define_events (
  workspace_id uuid not null,
  work_id uuid not null,
  decision_revision integer not null,
  command_id text not null,
  action text not null,
  definition_revision integer not null,
  actor_user_id uuid not null references auth.users(id),
  membership_id uuid not null references d5o_hosted.memberships(id),
  authority_role text not null,
  configuration_version_id uuid not null references d5o_hosted.configuration_versions(id),
  source_digest text not null,
  reason text not null,
  occurred_at timestamptz not null default now(),
  primary key (workspace_id,work_id,decision_revision),
  unique (workspace_id,command_id),
  foreign key (work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id)
);
create table d5o_hosted.connected_define_receipts (
  workspace_id uuid not null,
  command_id text not null,
  work_id uuid not null,
  actor_user_id uuid not null references auth.users(id),
  fingerprint text not null,
  result jsonb not null,
  primary key (workspace_id,command_id),
  foreign key (work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id)
);
alter table d5o_hosted.connected_define_states enable row level security;
alter table d5o_hosted.connected_define_events enable row level security;
alter table d5o_hosted.connected_define_receipts enable row level security;
revoke all on d5o_hosted.connected_define_states,d5o_hosted.connected_define_events,
  d5o_hosted.connected_define_receipts from public,anon,authenticated;

-- This helper has no Data API grant. It is used by the member-scoped read RPC.
create function d5o_hosted.connected_define_projection_v1(p_workspace uuid,p_state jsonb)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when p_state is null then null else
    pg_catalog.jsonb_set(p_state,'{records}',coalesce((
      select pg_catalog.jsonb_agg(case when d.work_id is null then item
        else item || pg_catalog.jsonb_build_object('definition',d.projection,
          'nextAction',d.next_action) end order by ordinal)
      from pg_catalog.jsonb_array_elements(coalesce(p_state->'records','[]'::jsonb))
        with ordinality as records(item,ordinal)
      left join d5o_hosted.work_identity_links l on l.workspace_id=p_workspace
        and l.presentation_id=item->>'id'
      left join d5o_hosted.connected_define_states d on d.workspace_id=p_workspace
        and d.work_id=l.work_id
    ),'[]'::jsonb)) end;
$$;
revoke all on function d5o_hosted.connected_define_projection_v1(uuid,jsonb)
  from public,anon,authenticated,service_role;

-- Preserve the existing field-worker denial and workspace membership check.
create or replace function public.d5o_hosted_prototype_read_v1(p_workspace_key text,p_state_key text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_workspace uuid; v_state d5o_hosted.prototype_states%rowtype;
begin
  if auth.uid() is null or p_workspace_key is null
    or p_state_key not in ('work','catalog','schedule') then
    raise exception 'prototype_scope_forbidden' using errcode='42501'; end if;
  select w.id into v_workspace from d5o_hosted.workspaces w
    join d5o_hosted.memberships m on m.workspace_id=w.id
    where w.workspace_key=p_workspace_key and w.status='active'
      and m.actor_user_id=auth.uid() and m.status='active' and m.role<>'field_worker';
  if v_workspace is null then raise exception 'prototype_scope_forbidden' using errcode='42501'; end if;
  select * into v_state from d5o_hosted.prototype_states
    where workspace_id=v_workspace and state_key=p_state_key;
  if not found then return pg_catalog.jsonb_build_object('revision',0,'state',null); end if;
  return pg_catalog.jsonb_build_object('revision',v_state.revision,'state',
    case when p_state_key='work' then
      d5o_hosted.connected_define_projection_v1(v_workspace,v_state.state_json)
    else v_state.state_json end);
end; $$;
revoke all on function public.d5o_hosted_prototype_read_v1(text,text) from public,anon;
grant execute on function public.d5o_hosted_prototype_read_v1(text,text) to authenticated;

-- Evaluate the same pinned Define facts that the existing Define workspace
-- requires before a review. Unknown facts fail closed.
create function d5o_hosted.connected_define_ready_v1(p_work jsonb,p_contract jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare d jsonb := p_work->'definition'; c jsonb := d->'scopeControl';
  row jsonb; scope_row jsonb; requirement jsonb; criterion jsonb; rule jsonb;
  fact text[]; value jsonb; field text;
begin
  if d is null or d->>'status'<>'Draft' or coalesce((d->>'revision')::integer,0)<1
    or p_work#>>'{discovery,pursuitControl,handoff,status}'<>'accepted' then return false; end if;
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
  if not exists (select 1 from pg_catalog.jsonb_array_elements(coalesce(d->'findings','[]'::jsonb)) f
      where f->>'status'='Confirmed' and length(trim(coalesce(f->>'source','')))>0
        and length(trim(coalesce(f->>'detail','')))>0)
    or exists (select 1 from pg_catalog.jsonb_array_elements(coalesce(d->'clarifications','[]'::jsonb)) q
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
    fact := pg_catalog.string_to_array(rule->>'fact','.');
    if fact is null or fact[1] not in ('definition','discovery') then return false; end if;
    value := p_work #> fact;
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

create function public.d5o_hosted_define_command_v1(
  p_workspace_key text,p_presentation_id text,p_action text,p_review_role text,
  p_reason text,p_command_id text,p_expected_source_revision bigint,
  p_expected_decision_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid := auth.uid(); v_workspace d5o_hosted.workspaces%rowtype;
  v_member d5o_hosted.memberships%rowtype; v_work d5o_hosted.work_records%rowtype;
  v_state d5o_hosted.prototype_states%rowtype; v_control d5o_hosted.connected_define_states%rowtype;
  v_receipt d5o_hosted.connected_define_receipts%rowtype; v_config d5o_hosted.configuration_versions%rowtype;
  v_raw jsonb; v_definition jsonb; v_phase jsonb; v_fingerprint text; v_now timestamptz:=now();
  v_reviewer uuid; v_next text; v_result jsonb; v_decision jsonb; v_history jsonb;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or p_action not in ('submit','approve-review','return-review','submit-handoff','accept-handoff','return-handoff','new-revision')
    or p_command_id is null or length(p_command_id) not between 8 and 120
    or p_expected_source_revision is null or p_expected_source_revision<1
    or p_expected_decision_revision is null or p_expected_decision_revision<0
    or length(coalesce(p_reason,''))>2000 then
    raise exception 'invalid_define_command' using errcode='22023'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor and status='active' for share;
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  select w.* into v_work from d5o_hosted.work_records w
    join d5o_hosted.work_identity_links l on l.work_id=w.id and l.workspace_id=w.workspace_id
    where w.workspace_id=v_workspace.id and l.presentation_id=p_presentation_id for update of w;
  if not found then raise exception 'connected_work_unavailable' using errcode='42501'; end if;
  v_fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_array(p_workspace_key,p_presentation_id,
    p_action,p_review_role,trim(coalesce(p_reason,'')),p_expected_source_revision,
    p_expected_decision_revision)::text);
  select * into v_receipt from d5o_hosted.connected_define_receipts
    where workspace_id=v_workspace.id and command_id=p_command_id;
  if found then
    if v_receipt.work_id<>v_work.id or v_receipt.actor_user_id<>v_actor
      or v_receipt.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_receipt.result;
  end if;
  select * into v_state from d5o_hosted.prototype_states
    where workspace_id=v_workspace.id and state_key='work' for share;
  select * into v_control from d5o_hosted.connected_define_states
    where workspace_id=v_workspace.id and work_id=v_work.id for update;
  if v_state.revision is distinct from p_expected_source_revision
    or coalesce(v_control.decision_revision,0)<>p_expected_decision_revision then
    raise exception 'stale_state' using errcode='23505'; end if;
  select item into v_raw from pg_catalog.jsonb_array_elements(v_state.state_json->'records') item
    where item->>'id'=p_presentation_id and item->>'canonicalWorkId'=v_work.id::text;
  if v_raw is null or v_raw->>'phaseConfigurationVersionId' is distinct from v_work.configuration_version_id::text
    then raise exception 'source_identity_changed' using errcode='42501'; end if;
  v_definition := v_raw->'definition';
  if v_definition is null or pg_catalog.jsonb_typeof(v_definition)<>'object' then
    raise exception 'definition_unavailable' using errcode='22023'; end if;
  if v_control.work_id is not null and (v_control.status='Draft' or
    v_control.definition_revision > coalesce((v_definition->>'revision')::integer,0)) then
    v_definition:=v_control.projection;
  end if;
  if v_control.work_id is not null
    and v_control.definition_revision=coalesce((v_raw#>>'{definition,revision}')::integer,0)
    and v_control.source_digest<>pg_catalog.md5((v_raw->'definition')::text) then
    raise exception 'definition_source_changed' using errcode='23505'; end if;
  select * into v_config from d5o_hosted.configuration_versions
    where id=v_work.configuration_version_id and source_sha256=v_work.configuration_digest
      and status in ('published','superseded');
  select ph into v_phase from pg_catalog.jsonb_array_elements(
    coalesce(v_config.manifest_json#>'{d5oPresentation,phaseContract,workTypes}','[]'::jsonb)) wt,
    lateral pg_catalog.jsonb_array_elements(coalesce(wt->'phases','[]'::jsonb)) ph
    where wt->>'workTypeKey'=v_work.work_type_key and ph->>'key'='define';
  if v_phase is null then raise exception 'pinned_define_policy_unavailable' using errcode='42501'; end if;
  if p_action='submit' then
    if (v_control.work_id is not null and v_control.status<>'Draft')
      or v_member.role not in ('admin','project_manager','operations_leader')
      then raise exception 'define_submit_denied' using errcode='42501'; end if;
    if not d5o_hosted.connected_define_ready_v1(
      v_raw||pg_catalog.jsonb_build_object('definition',v_definition),v_phase) then
      raise exception 'definition_incomplete' using errcode='23514'; end if;
    v_next:='Commercial and Delivery: review the Define baseline';
    v_definition := v_definition || pg_catalog.jsonb_build_object('status','In review',
      'reviews',pg_catalog.jsonb_build_object('commercial','Pending','delivery','Pending',
        'revision',(v_definition->>'revision')::integer),
      'configurationVersion',v_config.id::text,
      'configurationWorkTypeKey',v_work.work_type_key);
    if v_control.work_id is null then
      insert into d5o_hosted.connected_define_states(workspace_id,work_id,source_revision,
        source_digest,definition_revision,decision_revision,status,submitted_by,projection,next_action)
      values(v_workspace.id,v_work.id,v_state.revision,pg_catalog.md5((v_raw->'definition')::text),
        (v_definition->>'revision')::integer,1,'In review',v_actor,v_definition,v_next);
    else
      update d5o_hosted.connected_define_states set decision_revision=decision_revision+1,
        status='In review',submitted_by=v_actor,source_revision=v_state.revision,
        source_digest=pg_catalog.md5(v_definition::text),updated_at=v_now
        where workspace_id=v_workspace.id and work_id=v_work.id;
    end if;
  else
    if v_control.work_id is null or v_control.definition_revision is distinct from
      (v_definition->>'revision')::integer then
      raise exception 'define_submission_required' using errcode='23514'; end if;
    v_definition:=v_control.projection;
    if p_action in ('approve-review','return-review') then
      if p_review_role not in ('commercial','delivery') or
        (p_review_role='commercial' and v_member.role not in ('admin','billing_commercial_lead')) or
        (p_review_role='delivery' and v_member.role not in ('admin','operations_leader','project_manager')) then
        raise exception 'define_review_role_denied' using errcode='42501'; end if;
      if v_control.status<>'In review' or v_definition#>>array['reviews',p_review_role]<>'Pending'
        or v_actor=v_control.submitted_by or
        (p_review_role='commercial' and v_actor=v_control.delivery_reviewer) or
        (p_review_role='delivery' and v_actor=v_control.commercial_reviewer) then
        raise exception 'define_independent_review_required' using errcode='42501'; end if;
      if length(trim(coalesce(p_reason,'')))<10 then
        raise exception 'decision_reason_required' using errcode='22023'; end if;
      if p_action='approve-review' and not d5o_hosted.connected_define_ready_v1(
        v_raw||pg_catalog.jsonb_build_object('definition',
          v_definition||pg_catalog.jsonb_build_object('status','Draft')),v_phase) then
        raise exception 'definition_incomplete' using errcode='23514'; end if;
      v_definition:=pg_catalog.jsonb_set(v_definition,array['reviews',p_review_role],
        pg_catalog.to_jsonb(case when p_action='approve-review' then 'Approved' else 'Changes requested' end));
      if p_action='return-review' then
        v_control.status:='Changes requested'; v_next:='Define owner: correct the returned revision';
      elsif v_definition#>>'{reviews,commercial}'='Approved'
        and v_definition#>>'{reviews,delivery}'='Approved' then
        v_control.status:='Approved'; v_next:='Define owner: submit the approved baseline to Develop';
        v_definition:=v_definition || pg_catalog.jsonb_build_object('approvedBaselines',
          coalesce(v_definition->'approvedBaselines','[]'::jsonb) ||
          pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'revision',v_control.definition_revision,'approvedAt',v_now,
            'configurationVersion',v_config.id::text,
            'outcome',v_definition->'outcome','excludedScope',v_definition->'excludedScope',
            'deliveryApproach',v_definition->'deliveryApproach','registers',v_definition->'registers',
            'project',v_definition->'project','findings',v_definition->'findings',
            'clarifications',v_definition->'clarifications','scopeControl',v_definition->'scopeControl')));
      else v_next:='Commercial and Delivery: finish the Define reviews'; end if;
      if p_review_role='commercial' then v_control.commercial_reviewer:=v_actor;
      else v_control.delivery_reviewer:=v_actor; end if;
    elsif p_action='new-revision' then
      if v_member.role not in ('admin','project_manager','operations_leader')
        or v_control.status not in ('Changes requested','Approved')
        or v_definition#>>'{developHandoff,status}'='accepted'
        or length(trim(coalesce(p_reason,'')))<10 then
        raise exception 'define_revision_denied' using errcode='42501'; end if;
      v_control.status:='Draft';
      v_control.definition_revision:=v_control.definition_revision+1;
      v_control.commercial_reviewer:=null; v_control.delivery_reviewer:=null;
      v_control.handoff_sender:=null; v_control.handoff_receiver:=null;
      v_definition:=v_definition-'reviews'-'developHandoff'-'configurationVersion'
        -'configurationWorkTypeKey'-'sourceEstimateRevision'-'sourceProposalRevision';
      v_definition:=v_definition||pg_catalog.jsonb_build_object(
        'revision',v_control.definition_revision,'status','Draft');
      v_next:='Define owner: correct and resubmit the new revision';
    elsif p_action='submit-handoff' then
      if v_member.role not in ('admin','project_manager','operations_leader')
        or v_control.status<>'Approved' or v_definition->'approvedBaselines' is null
        or v_definition#>>'{developHandoff,status}' in ('submitted','accepted') then
        raise exception 'define_handoff_denied' using errcode='42501'; end if;
      v_definition:=v_definition || pg_catalog.jsonb_build_object('developHandoff',
        pg_catalog.jsonb_build_object('revision',v_control.definition_revision,
          'status','submitted','receiver','Develop receiver queue',
          'note',coalesce(nullif(trim(p_reason),''),'Approved Define basis submitted'),
          'submittedAt',v_now,'actor',v_actor::text,'submittedByActorId',v_actor,
          'submittedByMembershipId',v_member.id));
      v_control.handoff_sender:=v_actor;
      v_next:='Develop receiver: accept or return the exact Define revision';
    elsif p_action in ('accept-handoff','return-handoff') then
      if v_member.role not in ('admin','project_manager','operations_leader')
        or v_control.status<>'Approved' or v_definition#>>'{developHandoff,status}'<>'submitted'
        or v_definition#>>'{developHandoff,revision}'<>v_control.definition_revision::text
        or v_actor=v_control.handoff_sender or length(trim(coalesce(p_reason,'')))<10 then
        raise exception 'define_receipt_denied' using errcode='42501'; end if;
      v_definition:=pg_catalog.jsonb_set(v_definition,'{developHandoff}',
        (v_definition->'developHandoff') || pg_catalog.jsonb_build_object(
          'status',case when p_action='accept-handoff' then 'accepted' else 'returned' end,
          'note',trim(p_reason),'respondedAt',v_now,'receivedByActorId',v_actor,
          'receivedByMembershipId',v_member.id));
      v_control.handoff_receiver:=v_actor;
      v_next:=case when p_action='accept-handoff' then
        'Develop owner: develop the solution and estimate' else
        'Define owner: revise the returned basis' end;
    end if;
    update d5o_hosted.connected_define_states set decision_revision=decision_revision+1,
      status=v_control.status,definition_revision=v_control.definition_revision,
      commercial_reviewer=v_control.commercial_reviewer,
      delivery_reviewer=v_control.delivery_reviewer,handoff_sender=v_control.handoff_sender,
      handoff_receiver=v_control.handoff_receiver,updated_at=v_now
      where workspace_id=v_workspace.id and work_id=v_work.id;
  end if;
  select * into v_control from d5o_hosted.connected_define_states
    where workspace_id=v_workspace.id and work_id=v_work.id;
  v_decision:=pg_catalog.jsonb_build_object('commandId',p_command_id,'action',p_action,
    'definitionRevision',v_control.definition_revision,'reviewRole',p_review_role,
    'actorId',v_actor,'membershipId',v_member.id,'policyVersion',v_config.version_number::text,
    'at',v_now,'reason',trim(coalesce(p_reason,'')));
  v_history:=pg_catalog.jsonb_build_object('at',v_now,'revision',v_control.definition_revision,
    'event',p_action,'note',v_member.role || ' (' || v_actor::text || ') · ' ||
      coalesce(nullif(trim(p_reason),''),'Decision recorded'));
  v_definition:=v_definition || pg_catalog.jsonb_build_object('status',v_control.status,
    'authorityRevision',v_control.decision_revision,
    'decisions',coalesce(v_definition->'decisions','[]'::jsonb)||pg_catalog.jsonb_build_array(v_decision),
    'history',coalesce(v_definition->'history','[]'::jsonb)||pg_catalog.jsonb_build_array(v_history));
  update d5o_hosted.connected_define_states set projection=v_definition,next_action=v_next,
    source_digest=case when v_control.status='Draft' then pg_catalog.md5(v_definition::text)
      else source_digest end
    where workspace_id=v_workspace.id and work_id=v_work.id;
  insert into d5o_hosted.connected_define_events(workspace_id,work_id,decision_revision,
    command_id,action,definition_revision,actor_user_id,membership_id,authority_role,
    configuration_version_id,source_digest,reason)
  values(v_workspace.id,v_work.id,v_control.decision_revision,p_command_id,p_action,
    v_control.definition_revision,v_actor,v_member.id,v_member.role,v_config.id,
    v_control.source_digest,trim(coalesce(p_reason,'')));
  v_result:=public.d5o_hosted_prototype_read_v1(p_workspace_key,'work');
  insert into d5o_hosted.connected_define_receipts(workspace_id,command_id,work_id,
    actor_user_id,fingerprint,result)
  values(v_workspace.id,p_command_id,v_work.id,v_actor,v_fingerprint,v_result);
  return v_result;
end; $$;
revoke all on function public.d5o_hosted_define_command_v1(
  text,text,text,text,text,text,bigint,integer) from public,anon,service_role;
grant execute on function public.d5o_hosted_define_command_v1(
  text,text,text,text,text,text,bigint,integer) to authenticated;
