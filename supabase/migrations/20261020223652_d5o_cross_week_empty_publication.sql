-- Allow a governed empty publication only when it supersedes a nonempty
-- current source week. The existing public wrapper still owns Work locking,
-- labor reservation supersession, actor authorization and replay receipts.
-- Keep the worker's later empty/revised week marker so an old publication
-- cannot remain visible as the current assignment after a cross-week move.
create or replace function public.d5o_hosted_crew_command_internal_v1(
  p_workspace_key text,p_action text,p_input jsonb,p_command_id text,
  p_expected_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
  v_member d5o_hosted.memberships%rowtype;
  v_schedule d5o_hosted.connected_schedule_states%rowtype;
  v_receipt d5o_hosted.connected_schedule_receipts%rowtype;
  v_profile d5o_hosted.connected_crew_profiles%rowtype;
  v_binding d5o_hosted.crew_bindings%rowtype;
  v_work d5o_hosted.work_records%rowtype;
  v_design d5o_hosted.connected_design_states%rowtype;
  v_assignment jsonb;v_demand jsonb;v_package jsonb;v_state jsonb;
  v_publication jsonb;v_previous jsonb;v_prior_assignment jsonb;
  v_prior_receipt jsonb;v_prior_demand jsonb;v_current_demand jsonb;
  v_item jsonb;v_person text;v_id text;
  v_fingerprint text;v_result jsonb;v_now timestamptz:=now();
  v_week integer;v_day integer;v_date date;v_anchor date;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or p_action not in ('save-booking','publish-week','respond-booking')
    or pg_catalog.jsonb_typeof(p_input)<>'object'
    or length(coalesce(p_command_id,'')) not between 8 and 120
    or p_expected_revision is null or p_expected_revision<0 then
    raise exception 'invalid_crew_command' using errcode='22023'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor and status='active' for share;
  if not found then raise exception 'crew_membership_required' using errcode='42501'; end if;
  insert into d5o_hosted.connected_schedule_states(workspace_id,decision_revision,state)
    values(v_workspace.id,1,pg_catalog.jsonb_build_object(
      'anchorDate',to_char(date_trunc('week',v_now),'YYYY-MM-DD'),
      'draftRevision',1,'assignments','[]'::jsonb,
      'publications','[]'::jsonb,'receipts','[]'::jsonb))
    on conflict(workspace_id) do nothing;
  select * into v_schedule from d5o_hosted.connected_schedule_states
    where workspace_id=v_workspace.id for update;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(
    p_workspace_key,p_action,p_input,p_expected_revision)::text);
  select * into v_receipt from d5o_hosted.connected_schedule_receipts
    where workspace_id=v_workspace.id and command_id=p_command_id;
  if found then
    if v_receipt.actor_user_id<>v_actor or v_receipt.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_receipt.result; end if;
  if v_schedule.decision_revision<>p_expected_revision and not
    (v_schedule.decision_revision=1 and p_expected_revision=0 and
      v_schedule.state->'assignments'='[]'::jsonb and
      v_schedule.state->'publications'='[]'::jsonb) then
    raise exception 'stale_schedule' using errcode='23505'; end if;
  v_state:=v_schedule.state;v_anchor:=(v_state->>'anchorDate')::date;
  if p_action='save-booking' then
    if v_member.role not in ('admin','project_manager','operations_leader') then
      raise exception 'scheduling_authority_required' using errcode='42501'; end if;
    v_assignment:=p_input->'assignment';
    if pg_catalog.jsonb_typeof(v_assignment)<>'object'
      or length(coalesce(v_assignment->>'id','')) not between 5 and 100
      or pg_catalog.jsonb_typeof(v_assignment->'people')<>'array'
      or pg_catalog.jsonb_array_length(v_assignment->'people')=0
      or coalesce(v_assignment->>'crew','')=''
      or coalesce(v_assignment->>'shift','') !~ '^\d\d:\d\d[–-]\d\d:\d\d$'
      or coalesce(v_assignment->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'invalid_booking' using errcode='22023'; end if;
    v_week:=(v_assignment->>'week')::integer;
    v_day:=(v_assignment->>'day')::integer;
    v_date:=(v_assignment->>'date')::date;
    if v_week not between -260 and 260 or v_day not between 0 and 4
      or v_date<>v_anchor+v_week*7+v_day then
      raise exception 'booking_date_mismatch' using errcode='23514'; end if;
    select w.* into v_work from d5o_hosted.work_records w
      join d5o_hosted.work_identity_links l on l.workspace_id=w.workspace_id
        and l.work_id=w.id
      where w.workspace_id=v_workspace.id
        and l.presentation_id=v_assignment->>'workId' for share of w;
    if not found then raise exception 'booking_work_unavailable' using errcode='23514'; end if;
    select * into v_design from d5o_hosted.connected_design_states
      where workspace_id=v_workspace.id and work_id=v_work.id for share;
    select d into v_demand from pg_catalog.jsonb_array_elements(
      coalesce(v_design.state->'demands','[]'::jsonb)) d
      where d->>'packageId'=v_assignment->>'packageId'
        and d->>'workId'=v_assignment->>'workId';
    select p into v_package from pg_catalog.jsonb_array_elements(
      coalesce(v_design.state->'packages','[]'::jsonb)) p
      where p->>'packageId'=v_assignment->>'packageId';
    -- A draft may precede release, but must still match the current engineered demand.
    -- Publication below continues to require an accepted release of that same revision.
    if v_demand is null or v_package is null
      or v_demand->>'designPackageRevision'<>v_package->>'revision'
      or not exists(select 1 from pg_catalog.jsonb_array_elements(
        v_demand->'requiredSlots') s where s->>'date'=v_assignment->>'date'
        and s->>'shift'=v_assignment->>'shift')
      or pg_catalog.jsonb_array_length(v_assignment->'people')<
        (v_demand->>'minimumPeople')::integer then
      raise exception 'current_demand_coverage_required' using errcode='23514'; end if;
    if (select count(distinct p#>>'{}') from pg_catalog.jsonb_array_elements(
      v_assignment->'people') p)<>
      pg_catalog.jsonb_array_length(v_assignment->'people') then
      raise exception 'duplicate_crew_person' using errcode='23514'; end if;
    for v_item in select value from pg_catalog.jsonb_array_elements(v_assignment->'people') loop
      v_person:=v_item#>>'{}';
      select cp.* into v_profile from d5o_hosted.connected_crew_profiles cp
        join d5o_hosted.crew_bindings b on b.workspace_id=cp.workspace_id
          and b.actor_user_id=cp.actor_user_id and b.person=cp.person and b.active
        join d5o_hosted.memberships m on m.workspace_id=cp.workspace_id
          and m.actor_user_id=cp.actor_user_id and m.status='active'
        where cp.workspace_id=v_workspace.id and cp.person=v_person
          and cp.active and v_demand->>'qualification'=any(cp.qualifications);
      if not found then raise exception 'qualified_bound_worker_required' using errcode='23514'; end if;
      if exists(select 1 from pg_catalog.jsonb_array_elements(v_state->'assignments') a
        where a->>'id'<>v_assignment->>'id'
          and a->>'date'=v_assignment->>'date'
          and a->'people' ? v_person) then
        raise exception 'crew_overlap' using errcode='23514'; end if;
    end loop;
    if exists(select 1 from pg_catalog.jsonb_array_elements(v_state->'assignments') a
      where a->>'id'=v_assignment->>'id' and
        (a->>'workId'<>v_assignment->>'workId' or
          a->>'packageId'<>v_assignment->>'packageId')) then
      raise exception 'booking_scope_changed' using errcode='23514'; end if;
    v_assignment:=pg_catalog.jsonb_build_object(
      'id',v_assignment->>'id','crew',v_assignment->>'crew',
      'people',v_assignment->'people','workId',v_assignment->>'workId',
      'packageId',v_assignment->>'packageId','week',v_week,'day',v_day,
      'date',v_date,'shift',v_assignment->>'shift') ||
      case when v_assignment ? 'personHoursPerWorker'
        then pg_catalog.jsonb_build_object('personHoursPerWorker',v_assignment->'personHoursPerWorker')
        else '{}'::jsonb end;
    v_state:=pg_catalog.jsonb_set(v_state,'{assignments}',
      (select coalesce(pg_catalog.jsonb_agg(a order by ordinal),'[]'::jsonb)
        from pg_catalog.jsonb_array_elements(v_state->'assignments')
          with ordinality as entries(a,ordinal)
        where a->>'id'<>v_assignment->>'id')||
      pg_catalog.jsonb_build_array(v_assignment));
    v_state:=pg_catalog.jsonb_set(v_state,'{draftRevision}',
      pg_catalog.to_jsonb((v_state->>'draftRevision')::integer+1));
  elsif p_action='publish-week' then
    if v_member.role not in ('admin','project_manager','operations_leader') then
      raise exception 'publication_authority_required' using errcode='42501'; end if;
    v_week:=(p_input->>'week')::integer;
    if v_week is null or v_week not between -260 and 260 then
      raise exception 'invalid_publication_week' using errcode='22023'; end if;
    select pub into v_previous from pg_catalog.jsonb_array_elements(
      v_state->'publications') with ordinality entries(pub,ordinal)
      where (pub->>'week')::integer=v_week order by ordinal desc limit 1;
    -- An empty publication withdraws the last published booking from this week.
    -- It cannot invent an empty week or repeat an already withdrawn one.
    if not exists(select 1 from pg_catalog.jsonb_array_elements(v_state->'assignments') a
      where (a->>'week')::integer=v_week)
      and (v_previous is null or v_previous->'assignments'='[]'::jsonb) then
      raise exception 'empty_publication' using errcode='23514'; end if;
    for v_assignment in select a from pg_catalog.jsonb_array_elements(
      v_state->'assignments') a where (a->>'week')::integer=v_week loop
      select w.* into v_work from d5o_hosted.work_records w
        join d5o_hosted.work_identity_links l on l.workspace_id=w.workspace_id
          and l.work_id=w.id
        where w.workspace_id=v_workspace.id
          and l.presentation_id=v_assignment->>'workId' for share of w;
      select * into v_design from d5o_hosted.connected_design_states
        where workspace_id=v_workspace.id and work_id=v_work.id for share;
      select d into v_demand from pg_catalog.jsonb_array_elements(
        coalesce(v_design.state->'demands','[]'::jsonb)) d
        where d->>'packageId'=v_assignment->>'packageId';
      select p into v_package from pg_catalog.jsonb_array_elements(
        coalesce(v_design.state->'packages','[]'::jsonb)) p
        where p->>'packageId'=v_assignment->>'packageId';
      if v_work.id is null or v_demand is null or v_package is null
        or v_demand->>'designPackageRevision'<>v_package->>'revision'
        or not exists(select 1 from
        pg_catalog.jsonb_array_elements(v_design.state->'releases') r
        where r->>'packageId'=v_assignment->>'packageId'
          and r->>'status'='Accepted'
          and r->>'packageRevision'=v_demand->>'designPackageRevision') then
        raise exception 'release_changed_before_publication' using errcode='23514'; end if;
      for v_item in select p from pg_catalog.jsonb_array_elements(
        v_assignment->'people') p loop
        v_person:=v_item#>>'{}';
        if not exists(select 1 from d5o_hosted.connected_crew_profiles cp
          join d5o_hosted.crew_bindings b on b.workspace_id=cp.workspace_id
            and b.actor_user_id=cp.actor_user_id and b.active
          join d5o_hosted.memberships m on m.workspace_id=cp.workspace_id
            and m.actor_user_id=cp.actor_user_id and m.status='active'
          where cp.workspace_id=v_workspace.id and cp.person=v_person
            and cp.active and v_demand->>'qualification'=any(cp.qualifications)) then
          raise exception 'crew_qualification_changed_before_publication' using errcode='23514'; end if;
      end loop;
    end loop;
    v_id:=gen_random_uuid()::text;
    v_publication:=pg_catalog.jsonb_build_object('id',v_id,'week',v_week,
      'weekStart',v_anchor+v_week*7,
      'draftRevision',v_state->'draftRevision','publishedAt',v_now,
      'publishedBy',pg_catalog.jsonb_build_object('id',v_actor,
        'name',v_actor::text,'role',v_member.role),
      'assignments',(select coalesce(pg_catalog.jsonb_agg(a order by ordinal),'[]'::jsonb)
        from pg_catalog.jsonb_array_elements(v_state->'assignments')
          with ordinality as entries(a,ordinal)
        where (a->>'week')::integer=v_week),
      'packageDemands',coalesce((select pg_catalog.jsonb_agg(d.value)
        from d5o_hosted.connected_design_states ds
        cross join lateral pg_catalog.jsonb_array_elements(
          coalesce(ds.state->'demands','[]'::jsonb)) d
        where ds.workspace_id=v_workspace.id and exists(
          select 1 from pg_catalog.jsonb_array_elements(v_state->'assignments') a
          where (a->>'week')::integer=v_week
            and a->>'packageId'=d.value->>'packageId')),'[]'::jsonb));
    if v_previous is not null and v_previous->'assignments'=v_publication->'assignments' then
      raise exception 'week_already_published' using errcode='23514'; end if;
    if v_previous is not null then
      for v_assignment in select a from pg_catalog.jsonb_array_elements(
        v_publication->'assignments') a loop
        select a into v_prior_assignment from pg_catalog.jsonb_array_elements(
          v_previous->'assignments') a where a->>'id'=v_assignment->>'id';
        if v_prior_assignment is distinct from v_assignment then continue; end if;
        select d into v_prior_demand from pg_catalog.jsonb_array_elements(
          coalesce(v_previous->'packageDemands','[]'::jsonb)) d
          where d->>'packageId'=v_assignment->>'packageId';
        select d into v_current_demand from pg_catalog.jsonb_array_elements(
          coalesce(v_publication->'packageDemands','[]'::jsonb)) d
          where d->>'packageId'=v_assignment->>'packageId';
        if v_prior_demand is null or v_current_demand is null
          or v_prior_demand is distinct from v_current_demand then continue; end if;
        for v_item in select p from pg_catalog.jsonb_array_elements(
          v_assignment->'people') p loop
          v_person:=v_item#>>'{}';
          select r into v_prior_receipt from pg_catalog.jsonb_array_elements(
            v_state->'receipts') r where r->>'publicationId'=v_previous->>'id'
              and r->>'assignmentId'=v_assignment->>'id'
              and r->>'recipient'=v_person;
          if v_prior_receipt is null then continue; end if;
          v_state:=pg_catalog.jsonb_set(v_state,'{receipts}',
            v_state->'receipts'||pg_catalog.jsonb_build_array(
              v_prior_receipt||pg_catalog.jsonb_build_object(
                'id',gen_random_uuid(),'publicationId',v_id,
                'source','carried','carriedFromReceiptId',v_prior_receipt->>'id',
                'statement','The worker response remains valid because this booking did not change in the revised schedule.')));
        end loop;
      end loop;
    end if;
    v_state:=pg_catalog.jsonb_set(v_state,'{publications}',
      v_state->'publications'||pg_catalog.jsonb_build_array(v_publication));
  else
    select * into v_binding from d5o_hosted.crew_bindings
      where workspace_id=v_workspace.id and actor_user_id=v_actor and active;
    if not found or v_member.role not in ('field_worker','field_supervisor') then
      raise exception 'worker_binding_required' using errcode='42501'; end if;
    v_id:=p_input->>'publicationId';
    select pub into v_publication from pg_catalog.jsonb_array_elements(
      v_state->'publications') pub where pub->>'id'=v_id;
    select a into v_assignment from pg_catalog.jsonb_array_elements(
      coalesce(v_publication->'assignments','[]'::jsonb)) a
      where a->>'id'=p_input->>'assignmentId'
        and a->'people' ? v_binding.person;
    if v_assignment is null or p_input->>'response' not in
      ('acknowledged','cannot-attend') or exists(select 1 from
        pg_catalog.jsonb_array_elements(v_state->'receipts') r
        where r->>'publicationId'=v_id
          and r->>'assignmentId'=p_input->>'assignmentId'
          and r->>'recipient'=v_binding.person) then
      raise exception 'worker_response_invalid' using errcode='23514'; end if;
    if exists(select 1 from pg_catalog.jsonb_array_elements(v_state->'publications') pub
      where (pub->>'week')::integer=(v_publication->>'week')::integer
        and pub->>'publishedAt'>v_publication->>'publishedAt') then
      raise exception 'publication_superseded' using errcode='23514'; end if;
    v_state:=pg_catalog.jsonb_set(v_state,'{receipts}',
      v_state->'receipts'||pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('id',gen_random_uuid(),
          'publicationId',v_id,'assignmentId',p_input->>'assignmentId',
          'recipient',v_binding.person,'recordedAt',v_now,
          'recordedBy',pg_catalog.jsonb_build_object('id',v_actor,
            'name',v_binding.person,'role',v_member.role),
          'statement','Worker response to exact published booking',
          'source','self','response',p_input->>'response')));
  end if;
  update d5o_hosted.connected_schedule_states set
    decision_revision=decision_revision+1,state=v_state,updated_at=v_now
    where workspace_id=v_workspace.id;
  insert into d5o_hosted.connected_schedule_events(workspace_id,decision_revision,
    command_id,action,actor_user_id,membership_id,snapshot)
  values(v_workspace.id,v_schedule.decision_revision+1,p_command_id,
    p_action,v_actor,v_member.id,v_state);
  if p_action='respond-booking' then
    v_result:=pg_catalog.jsonb_build_object('person',v_binding.person,
      'revision',v_schedule.decision_revision+1,
      'state',pg_catalog.jsonb_build_object('workspace',p_workspace_key,
        'schemaVersion',1,'anchorDate',v_state->'anchorDate',
        'revision',v_schedule.decision_revision+1,
        'draftRevision',v_state->'draftRevision',
        'assignments',(select coalesce(pg_catalog.jsonb_agg(a),'[]'::jsonb)
          from pg_catalog.jsonb_array_elements(v_state->'assignments') a
          where a->'people' ? v_binding.person),
        'availabilityBlocks','[]'::jsonb,'packageDemands','[]'::jsonb,
        'publications',(select coalesce(pg_catalog.jsonb_agg(
          (pub-'packageDemands')||pg_catalog.jsonb_build_object('assignments',
            (select pg_catalog.jsonb_agg(a) from pg_catalog.jsonb_array_elements(
              pub->'assignments') a where a->'people' ? v_binding.person))),
          '[]'::jsonb)
          from pg_catalog.jsonb_array_elements(v_state->'publications') pub
          where exists(select 1 from pg_catalog.jsonb_array_elements(
            pub->'assignments') a where a->'people' ? v_binding.person)),
        'receipts',(select coalesce(pg_catalog.jsonb_agg(r),'[]'::jsonb)
          from pg_catalog.jsonb_array_elements(v_state->'receipts') r
          where r->>'recipient'=v_binding.person)));
  else v_result:=public.d5o_hosted_prototype_read_v1(p_workspace_key,'schedule'); end if;
  insert into d5o_hosted.connected_schedule_receipts(workspace_id,command_id,
    actor_user_id,fingerprint,result)
  values(v_workspace.id,p_command_id,v_actor,v_fingerprint,v_result);
  return v_result;
end; $$;

revoke all on function public.d5o_hosted_crew_command_internal_v1(text,text,jsonb,text,integer)
  from public,anon,authenticated,service_role;

create or replace function public.d5o_hosted_worker_schedule_read_v1(p_workspace_key text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_binding d5o_hosted.crew_bindings%rowtype;
  v_state d5o_hosted.connected_schedule_states%rowtype;v_scoped jsonb;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null then
    raise exception 'worker_auth_required' using errcode='42501'; end if;
  select b.* into v_binding from d5o_hosted.crew_bindings b
    join d5o_hosted.workspaces w on w.id=b.workspace_id
    join d5o_hosted.memberships m on m.workspace_id=w.id
      and m.actor_user_id=v_actor and m.status='active' and m.role='field_worker'
    where w.workspace_key=p_workspace_key and w.status='active'
      and b.actor_user_id=v_actor and b.active;
  if not found then raise exception 'worker_binding_required' using errcode='42501'; end if;
  select * into v_state from d5o_hosted.connected_schedule_states
    where workspace_id=v_binding.workspace_id;
  if not found then return pg_catalog.jsonb_build_object('revision',0,'state',null); end if;
  v_scoped:=pg_catalog.jsonb_build_object('workspace',p_workspace_key,
    'schemaVersion',1,'anchorDate',v_state.state->'anchorDate',
    'revision',v_state.decision_revision,
    'draftRevision',v_state.state->'draftRevision',
    'assignments',(select coalesce(pg_catalog.jsonb_agg(a),'[]'::jsonb)
      from pg_catalog.jsonb_array_elements(v_state.state->'assignments') a
      where a->'people' ? v_binding.person
        and a->>'date' ~ '^\d{4}-\d{2}-\d{2}$'
        and a->>'date'>=to_char(v_binding.created_at,'YYYY-MM-DD')),
    'availabilityBlocks','[]'::jsonb,'packageDemands','[]'::jsonb,
    'publications',(select coalesce(pg_catalog.jsonb_agg(
      (pub-'packageDemands')||pg_catalog.jsonb_build_object('assignments',
        (select pg_catalog.jsonb_agg(a) from pg_catalog.jsonb_array_elements(
          pub->'assignments') a where a->'people' ? v_binding.person))),
      '[]'::jsonb)
      from pg_catalog.jsonb_array_elements(v_state.state->'publications') pub
      where (pub->>'publishedAt')::timestamptz>=v_binding.created_at
        -- Retain the current week marker even when this person was removed
        -- from the new publication; otherwise their old booking stays current.
        and exists(select 1 from pg_catalog.jsonb_array_elements(
          v_state.state->'publications') earlier
          where (earlier->>'week')::integer=(pub->>'week')::integer
            and (earlier->>'publishedAt')::timestamptz>=v_binding.created_at
            and (earlier->>'publishedAt')::timestamptz<=(pub->>'publishedAt')::timestamptz
            and exists(select 1 from pg_catalog.jsonb_array_elements(
              earlier->'assignments') a where a->'people' ? v_binding.person))),
    'receipts',(select coalesce(pg_catalog.jsonb_agg(r),'[]'::jsonb)
      from pg_catalog.jsonb_array_elements(v_state.state->'receipts') r
      where r->>'recipient'=v_binding.person
        and r#>>'{recordedBy,id}'=v_actor::text));
  return pg_catalog.jsonb_build_object('person',v_binding.person,
    'revision',v_state.decision_revision,'state',v_scoped);
end; $$;

revoke all on function public.d5o_hosted_worker_schedule_read_v1(text)
  from public,anon,service_role;
grant execute on function public.d5o_hosted_worker_schedule_read_v1(text)
  to authenticated;
