-- Governed full-day unavailability on the same schedule revision and receipt ledger.
-- Preserve immutable publications and worker responses; conflicts require a later booking amendment.
create or replace function d5o_hosted.connected_schedule_projection_v1(
  p_workspace uuid,p_workspace_key text,p_raw jsonb
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_normal d5o_hosted.connected_schedule_states%rowtype; v_base jsonb;
begin
  select * into v_normal from d5o_hosted.connected_schedule_states where workspace_id=p_workspace;
  if not found then return d5o_hosted.connected_design_demand_projection_v1(
    p_workspace,coalesce(p_raw,pg_catalog.jsonb_build_object(
      'schemaVersion',1,'workspace',p_workspace_key,
      'anchorDate',to_char(date_trunc('week',now()),'YYYY-MM-DD'),
      'revision',0,'draftRevision',0,'assignments','[]'::jsonb,
      'availabilityBlocks','[]'::jsonb,'publications','[]'::jsonb,
      'receipts','[]'::jsonb,'packageDemands','[]'::jsonb))); end if;
  v_base:=pg_catalog.jsonb_build_object('schemaVersion',1,
    'workspace',p_workspace_key,'anchorDate',v_normal.state->>'anchorDate',
    'revision',v_normal.decision_revision,
    'draftRevision',v_normal.state->'draftRevision',
    'assignments',v_normal.state->'assignments',
    'availabilityBlocks',coalesce((select pg_catalog.jsonb_agg(
      case when exists(select 1 from d5o_hosted.memberships m
        where m.workspace_id=p_workspace and m.actor_user_id=auth.uid()
          and m.status='active' and m.role='admin')
      then (b-'note')||pg_catalog.jsonb_build_object(
        'reason',coalesce(nullif(b->>'note',''),nullif(b->>'reason',''),'Unavailable'))
      else (b-'note')||pg_catalog.jsonb_build_object('reason','Unavailable') end)
      from pg_catalog.jsonb_array_elements(
        coalesce(v_normal.state->'availabilityBlocks','[]'::jsonb)) b),'[]'::jsonb),
    'publications',v_normal.state->'publications',
    'receipts',v_normal.state->'receipts','packageDemands','[]'::jsonb);
  return d5o_hosted.connected_design_demand_projection_v1(p_workspace,v_base);
end; $$;
revoke all on function d5o_hosted.connected_schedule_projection_v1(uuid,text,jsonb) from public,anon,authenticated,service_role;

create function public.d5o_hosted_availability_command_v1(
  p_workspace_key text,p_action text,p_input jsonb,p_command_id text,p_expected_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace uuid;v_member d5o_hosted.memberships%rowtype;
  v_schedule d5o_hosted.connected_schedule_states%rowtype;
  v_prior d5o_hosted.connected_schedule_receipts%rowtype;
  v_fingerprint text;v_state jsonb;v_blocks jsonb;v_block jsonb;v_result jsonb;
  v_anchor date;v_week integer;v_day integer;v_date date;v_person text;v_note text;v_id text;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or p_action not in ('record-unavailability','clear-unavailability')
    or pg_catalog.jsonb_typeof(p_input)<>'object'
    or length(coalesce(p_command_id,'')) not between 8 and 120
    or p_expected_revision is null or p_expected_revision<0 then
    raise exception 'invalid_availability_command' using errcode='22023'; end if;
  select id into v_workspace from d5o_hosted.workspaces where workspace_key=p_workspace_key and status='active';
  select * into v_member from d5o_hosted.memberships where workspace_id=v_workspace
    and actor_user_id=v_actor and status='active' and role='admin' for share;
  if v_workspace is null or v_member.id is null then
    raise exception 'admin_availability_required' using errcode='42501'; end if;
  insert into d5o_hosted.connected_schedule_states(workspace_id,decision_revision,state)
    values(v_workspace,1,pg_catalog.jsonb_build_object(
      'anchorDate',to_char(date_trunc('week',now()),'YYYY-MM-DD'),
      'draftRevision',1,'assignments','[]'::jsonb,'availabilityBlocks','[]'::jsonb,
      'publications','[]'::jsonb,'receipts','[]'::jsonb)) on conflict do nothing;
  select * into v_schedule from d5o_hosted.connected_schedule_states
    where workspace_id=v_workspace for update;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(
    p_workspace_key,p_action,p_input,p_expected_revision)::text);
  select * into v_prior from d5o_hosted.connected_schedule_receipts
    where workspace_id=v_workspace and command_id=p_command_id;
  if found then
    if v_prior.actor_user_id<>v_actor or v_prior.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_prior.result;
  end if;
  if v_schedule.decision_revision<>p_expected_revision and not
    (v_schedule.decision_revision=1 and p_expected_revision=0 and
      v_schedule.state->'assignments'='[]'::jsonb and
      v_schedule.state->'publications'='[]'::jsonb) then
    raise exception 'stale_schedule' using errcode='23505'; end if;
  v_state:=v_schedule.state;
  v_blocks:=coalesce(v_state->'availabilityBlocks','[]'::jsonb);
  if p_action='record-unavailability' then
    v_person:=trim(coalesce(p_input->>'person',''));
    v_week:=(p_input->>'week')::integer;
    v_day:=(p_input->>'day')::integer;
    v_date:=(p_input->>'date')::date;
    v_anchor:=(v_state->>'anchorDate')::date;
    v_note:=trim(coalesce(p_input->>'note',''));
    if v_week is null or v_week not between -260 and 260
      or v_day is null or v_day not between 0 and 4
      or v_date is null or v_date<>v_anchor+v_week*7+v_day
      or length(v_note)>140 or v_person='' then
      raise exception 'invalid_unavailability_interval' using errcode='23514'; end if;
    if not exists(select 1 from d5o_hosted.connected_crew_profiles
      where workspace_id=v_workspace and person=v_person and active) then
      raise exception 'person_unavailable' using errcode='23514'; end if;
    if exists(select 1 from pg_catalog.jsonb_array_elements(v_blocks) b
      where b->>'person'=v_person and b->>'date'=v_date::text) then
      raise exception 'unavailability_already_recorded' using errcode='23505'; end if;
    v_id:=pg_catalog.gen_random_uuid()::text;
    v_block:=pg_catalog.jsonb_build_object('id',v_id,'person',v_person,
      'week',v_week,'day',v_day,'date',v_date,'reason','Unavailable','note',v_note,
      'timeZone','America/New_York',
      'recordedBy',v_actor,'recordedAt',now());
    v_blocks:=v_blocks||pg_catalog.jsonb_build_array(v_block);
  else
    v_id:=trim(coalesce(p_input->>'id',''));
    if v_id='' or not exists(select 1 from pg_catalog.jsonb_array_elements(v_blocks) b
      where b->>'id'=v_id) then
      raise exception 'unavailability_missing' using errcode='23514'; end if;
    select coalesce(pg_catalog.jsonb_agg(b),'[]'::jsonb) into v_blocks
      from pg_catalog.jsonb_array_elements(v_blocks) b where b->>'id'<>v_id;
  end if;
  v_state:=pg_catalog.jsonb_set(v_state,'{availabilityBlocks}',v_blocks,true);
  v_state:=pg_catalog.jsonb_set(v_state,'{draftRevision}',
    pg_catalog.to_jsonb(coalesce((v_state->>'draftRevision')::integer,0)+1),true);
  update d5o_hosted.connected_schedule_states set decision_revision=decision_revision+1,
    state=v_state,updated_at=now() where workspace_id=v_workspace;
  insert into d5o_hosted.connected_schedule_events(workspace_id,decision_revision,
    command_id,action,actor_user_id,membership_id,snapshot)
    values(v_workspace,v_schedule.decision_revision+1,p_command_id,p_action,
      v_actor,v_member.id,v_state);
  v_result:=public.d5o_hosted_prototype_read_v1(p_workspace_key,'schedule');
  insert into d5o_hosted.connected_schedule_receipts(workspace_id,command_id,
    actor_user_id,fingerprint,result)
    values(v_workspace,p_command_id,v_actor,v_fingerprint,v_result);
  return v_result;
end; $$;
revoke all on function public.d5o_hosted_availability_command_v1(text,text,jsonb,text,integer)
  from public,anon,service_role;
grant execute on function public.d5o_hosted_availability_command_v1(text,text,jsonb,text,integer)
  to authenticated;

-- Keep the earlier full crew transition contract and add one locked eligibility check.
alter function public.d5o_hosted_crew_command_v1(text,text,jsonb,text,integer)
  rename to d5o_hosted_crew_command_internal_v1;
revoke all on function public.d5o_hosted_crew_command_internal_v1(text,text,jsonb,text,integer)
  from public,anon,authenticated,service_role;

create function d5o_hosted.crew_booking_eligibility_v1(
  p_workspace uuid,p_state jsonb,p_assignment jsonb
) returns void language plpgsql volatile security definer set search_path='' as $$
declare v_item jsonb;v_profile d5o_hosted.connected_crew_profiles%rowtype;
  v_person text;v_hours numeric;v_used numeric;v_shift text;v_start integer;v_end integer;
  v_assignment jsonb;
begin
  v_shift:=p_assignment->>'shift';
  if coalesce(v_shift,'') !~ '^\d\d:\d\d[–-]\d\d:\d\d$' then
    raise exception 'invalid_booking_shift' using errcode='23514'; end if;
  v_start:=left(v_shift,2)::integer*60+substring(v_shift from 4 for 2)::integer;
  v_end:=substring(v_shift from 7 for 2)::integer*60+right(v_shift,2)::integer;
  if v_end<=v_start or v_end-v_start>960 then
    raise exception 'invalid_booking_shift' using errcode='23514'; end if;
  v_hours:=(v_end-v_start-case when v_end-v_start>=360 then 30 else 0 end)::numeric/60;
  for v_item in select value from pg_catalog.jsonb_array_elements(p_assignment->'people') loop
    v_person:=v_item#>>'{}';
    select * into v_profile from d5o_hosted.connected_crew_profiles
      where workspace_id=p_workspace and person=v_person and active;
    if not found or v_profile.actor_user_id is null
      or not exists(select 1 from d5o_hosted.crew_bindings b
        join d5o_hosted.memberships m on m.workspace_id=b.workspace_id
          and m.actor_user_id=b.actor_user_id and m.status='active' and m.role='field_worker'
        where b.workspace_id=p_workspace and b.actor_user_id=v_profile.actor_user_id
          and b.person=v_person and b.active) then
      raise exception 'qualified_bound_worker_required' using errcode='23514'; end if;
    if exists(select 1 from pg_catalog.jsonb_array_elements(
        coalesce(p_state->'availabilityBlocks','[]'::jsonb)) b
        where b->>'person'=v_person and b->>'date'=p_assignment->>'date') then
      raise exception 'worker_unavailable_for_shift' using errcode='23514'; end if;
    v_used:=0;
    for v_assignment in select a from pg_catalog.jsonb_array_elements(
      coalesce(p_state->'assignments','[]'::jsonb)) a
      where a->>'id'<>p_assignment->>'id'
        and (a->>'week')::integer=(p_assignment->>'week')::integer
        and a->'people' ? v_person loop
      v_shift:=v_assignment->>'shift';
      if coalesce(v_shift,'') !~ '^\d\d:\d\d[–-]\d\d:\d\d$' then
        raise exception 'invalid_existing_booking_shift' using errcode='23514'; end if;
      v_start:=left(v_shift,2)::integer*60+substring(v_shift from 4 for 2)::integer;
      v_end:=substring(v_shift from 7 for 2)::integer*60+right(v_shift,2)::integer;
      v_used:=v_used+(v_end-v_start-case when v_end-v_start>=360 then 30 else 0 end)::numeric/60;
    end loop;
    if v_used+v_hours>v_profile.weekly_capacity_hours then
      raise exception 'worker_weekly_capacity_exceeded' using errcode='23514'; end if;
  end loop;
end; $$;
revoke all on function d5o_hosted.crew_booking_eligibility_v1(uuid,jsonb,jsonb)
  from public,anon,authenticated,service_role;

create function public.d5o_hosted_crew_command_v1(
  p_workspace_key text,p_action text,p_input jsonb,p_command_id text,p_expected_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace uuid;v_role text;
  v_schedule d5o_hosted.connected_schedule_states%rowtype;v_assignment jsonb;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null then
    raise exception 'crew_membership_required' using errcode='42501'; end if;
  select w.id,m.role into v_workspace,v_role from d5o_hosted.workspaces w
    join d5o_hosted.memberships m on m.workspace_id=w.id
    where w.workspace_key=p_workspace_key and w.status='active'
      and m.actor_user_id=v_actor and m.status='active';
  if v_workspace is null then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  if p_action in ('save-booking','publish-week') then
    if v_role not in ('admin','project_manager','operations_leader') then
      raise exception 'scheduling_authority_required' using errcode='42501'; end if;
    -- Replay is resolved by the original command before current eligibility is re-evaluated.
    if exists(select 1 from d5o_hosted.connected_schedule_receipts
      where workspace_id=v_workspace and command_id=p_command_id) then
      return public.d5o_hosted_crew_command_internal_v1(
        p_workspace_key,p_action,p_input,p_command_id,p_expected_revision);
    end if;
    select * into v_schedule from d5o_hosted.connected_schedule_states
      where workspace_id=v_workspace for update;
    if found then
      if v_schedule.decision_revision<>p_expected_revision and not
        (v_schedule.decision_revision=1 and p_expected_revision=0 and
          v_schedule.state->'assignments'='[]'::jsonb and
          v_schedule.state->'publications'='[]'::jsonb) then
        raise exception 'stale_schedule' using errcode='23505'; end if;
      if p_action='save-booking' then
        v_assignment:=p_input->'assignment';
        if pg_catalog.jsonb_typeof(v_assignment)='object'
          and pg_catalog.jsonb_typeof(v_assignment->'people')='array' then
          perform d5o_hosted.crew_booking_eligibility_v1(v_workspace,v_schedule.state,v_assignment);
        end if;
      else
        for v_assignment in select a from pg_catalog.jsonb_array_elements(
          coalesce(v_schedule.state->'assignments','[]'::jsonb)) a
          where (a->>'week')::integer=(p_input->>'week')::integer loop
          perform d5o_hosted.crew_booking_eligibility_v1(v_workspace,v_schedule.state,v_assignment);
        end loop;
      end if;
    end if;
  end if;
  return public.d5o_hosted_crew_command_internal_v1(
    p_workspace_key,p_action,p_input,p_command_id,p_expected_revision);
end; $$;
revoke all on function public.d5o_hosted_crew_command_v1(text,text,jsonb,text,integer)
  from public,anon,service_role;
grant execute on function public.d5o_hosted_crew_command_v1(text,text,jsonb,text,integer)
  to authenticated;
