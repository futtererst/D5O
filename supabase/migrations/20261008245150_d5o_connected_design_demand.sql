-- Dated package demand is a typed Design draft linked to exact package revision.
-- The shared schedule consumes its projection; it cannot manufacture release authority.
create function d5o_hosted.connected_design_demand_projection_v1(
  p_workspace uuid,p_state jsonb
) returns jsonb language sql stable security definer set search_path='' as $$
  select pg_catalog.jsonb_set(p_state,'{packageDemands}',
    coalesce(p_state->'packageDemands','[]'::jsonb)||coalesce((
      select pg_catalog.jsonb_agg(d.value order by l.presentation_id,d.ordinal)
      from d5o_hosted.connected_design_states s
      join d5o_hosted.work_identity_links l on l.workspace_id=s.workspace_id
        and l.work_id=s.work_id
      cross join lateral pg_catalog.jsonb_array_elements(
        coalesce(s.state->'demands','[]'::jsonb)) with ordinality d(value,ordinal)
      where s.workspace_id=p_workspace
    ),'[]'::jsonb));
$$;
revoke all on function d5o_hosted.connected_design_demand_projection_v1(uuid,jsonb)
  from public,anon,authenticated,service_role;

create or replace function public.d5o_hosted_prototype_read_v1(p_workspace_key text,p_state_key text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_workspace uuid;v_state d5o_hosted.prototype_states%rowtype;
  v_projected jsonb;
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
  if not found and p_state_key<>'schedule' then
    return pg_catalog.jsonb_build_object('revision',0,'state',null); end if;
  if p_state_key='schedule' then
    v_projected:=d5o_hosted.connected_design_demand_projection_v1(v_workspace,
      coalesce(v_state.state_json,pg_catalog.jsonb_build_object(
        'schemaVersion',1,'workspace',p_workspace_key,
        'anchorDate',to_char(date_trunc('week',now()),'YYYY-MM-DD'),
        'revision',0,'draftRevision',0,'assignments','[]'::jsonb,
        'availabilityBlocks','[]'::jsonb,'publications','[]'::jsonb,
        'receipts','[]'::jsonb,'packageDemands','[]'::jsonb)));
    return pg_catalog.jsonb_build_object('revision',coalesce(v_state.revision,0),
      'state',v_projected);
  end if;
  v_projected:=case when p_state_key='work' then
    d5o_hosted.connected_design_projection_v1(v_workspace,
      d5o_hosted.connected_define_projection_v1(v_workspace,v_state.state_json))
    else v_state.state_json end;
  return pg_catalog.jsonb_build_object('revision',v_state.revision,'state',
    d5o_hosted.connected_package_projection_v1(v_workspace,v_projected,p_state_key));
end; $$;
revoke all on function public.d5o_hosted_prototype_read_v1(text,text) from public,anon;
grant execute on function public.d5o_hosted_prototype_read_v1(text,text) to authenticated;

create function public.d5o_hosted_design_demand_command_v1(
  p_workspace_key text,p_presentation_id text,p_demand jsonb,
  p_command_id text,p_expected_source_revision bigint,
  p_expected_decision_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
  v_member d5o_hosted.memberships%rowtype;v_work d5o_hosted.work_records%rowtype;
  v_raw d5o_hosted.prototype_states%rowtype;
  v_handoff d5o_hosted.connected_design_handoffs%rowtype;
  v_design d5o_hosted.connected_design_states%rowtype;
  v_receipt d5o_hosted.connected_design_receipts%rowtype;
  v_target jsonb;v_slot jsonb;v_demands jsonb;v_state jsonb;
  v_fingerprint text;v_result jsonb;v_now timestamptz:=now();
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or pg_catalog.jsonb_typeof(p_demand)<>'object'
    or length(coalesce(p_command_id,'')) not between 8 and 120
    or p_expected_source_revision is null or p_expected_source_revision<1
    or p_expected_decision_revision is null or p_expected_decision_revision<1 then
    raise exception 'invalid_design_demand_command' using errcode='22023'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor and status='active' for share;
  if not found or v_member.role not in ('admin','project_manager','operations_leader') then
    raise exception 'design_demand_role_denied' using errcode='42501'; end if;
  select w.* into v_work from d5o_hosted.work_records w
    join d5o_hosted.work_identity_links l on l.work_id=w.id and l.workspace_id=w.workspace_id
    where w.workspace_id=v_workspace.id and l.presentation_id=p_presentation_id
    for update of w;
  if not found then raise exception 'connected_work_unavailable' using errcode='42501'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_workspace_key,
    p_presentation_id,p_demand,p_expected_source_revision,
    p_expected_decision_revision)::text);
  select * into v_receipt from d5o_hosted.connected_design_receipts
    where workspace_id=v_workspace.id and command_id=p_command_id;
  if found then
    if v_receipt.work_id<>v_work.id or v_receipt.actor_user_id<>v_actor
      or v_receipt.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_receipt.result;
  end if;
  select * into v_raw from d5o_hosted.prototype_states
    where workspace_id=v_workspace.id and state_key='work' for share;
  select * into v_handoff from d5o_hosted.connected_design_handoffs
    where workspace_id=v_workspace.id and work_id=v_work.id for share;
  select * into v_design from d5o_hosted.connected_design_states
    where workspace_id=v_workspace.id and work_id=v_work.id for update;
  if v_raw.revision is distinct from p_expected_source_revision
    or v_design.decision_revision is distinct from p_expected_decision_revision
    or v_handoff.status is distinct from 'accepted'
    or v_design.source_handoff_revision<>v_handoff.revision then
    raise exception 'stale_design_demand_basis' using errcode='23505'; end if;
  select p into v_target from pg_catalog.jsonb_array_elements(v_design.state->'packages') p
    where p->>'packageId'=p_demand->>'packageId';
  if v_target is null or p_demand->>'workId'<>p_presentation_id
    or p_demand->>'qualification' is null
    or coalesce((p_demand->>'minimumPeople')::integer,0)<1
    or coalesce((p_demand->>'estimatedPersonHours')::numeric,0)<=0
    or pg_catalog.jsonb_typeof(p_demand->'requiredSlots')<>'array'
    or pg_catalog.jsonb_array_length(p_demand->'requiredSlots')=0
    or p_demand->>'priority' not in ('Critical','High','Normal') then
    raise exception 'dated_design_demand_invalid' using errcode='23514'; end if;
  for v_slot in select value from pg_catalog.jsonb_array_elements(p_demand->'requiredSlots') loop
    if coalesce(v_slot->>'date','')<v_target->>'windowStart'
      or coalesce(v_slot->>'date','')>v_target->>'windowEnd'
      or coalesce(v_slot->>'shift','')='' then
      raise exception 'demand_outside_package_window' using errcode='23514'; end if;
  end loop;
  if exists(select 1 from pg_catalog.jsonb_array_elements(v_design.state->'releases') r
    where r->>'packageId'=p_demand->>'packageId'
      and r->>'status' in ('Awaiting receipt','Accepted')) then
    raise exception 'released_demand_locked' using errcode='23514'; end if;
  v_demands:=(select coalesce(pg_catalog.jsonb_agg(d order by ordinal),'[]'::jsonb)
    from pg_catalog.jsonb_array_elements(coalesce(v_design.state->'demands','[]'::jsonb))
      with ordinality as entries(d,ordinal)
    where d->>'packageId'<>p_demand->>'packageId');
  v_demands:=v_demands||pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('workId',p_presentation_id,
      'packageId',p_demand->>'packageId','qualification',p_demand->>'qualification',
      'minimumPeople',(p_demand->>'minimumPeople')::integer,
      'estimatedPersonHours',(p_demand->>'estimatedPersonHours')::numeric,
      'requiredSlots',p_demand->'requiredSlots','priority',p_demand->>'priority',
      'prerequisite',coalesce(p_demand->>'prerequisite',''),
      'crewSchedulable',coalesce((p_demand->>'crewSchedulable')::boolean,true),
      'designPackageRevision',(v_target->>'revision')::integer));
  v_state:=v_design.state||pg_catalog.jsonb_build_object(
    'demands',v_demands,'authorityRevision',v_design.decision_revision+1,
    'history',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'at',v_now,'actorId',v_actor,'membershipId',v_member.id,
      'action','save-demand · '||p_command_id,
      'note','Dated qualified package demand recorded',
      'packageId',p_demand->>'packageId',
      'revision',(v_target->>'revision')::integer))||
      coalesce(v_design.state->'history','[]'::jsonb));
  update d5o_hosted.connected_design_states set
    decision_revision=decision_revision+1,state=v_state,updated_at=v_now
    where workspace_id=v_workspace.id and work_id=v_work.id;
  insert into d5o_hosted.connected_design_events(workspace_id,work_id,
    decision_revision,command_id,action,actor_user_id,membership_id,
    source_handoff_revision,snapshot,reason)
  values(v_workspace.id,v_work.id,v_design.decision_revision+1,p_command_id,
    'save-demand',v_actor,v_member.id,v_handoff.revision,v_state,
    'Dated qualified package demand recorded');
  v_result:=public.d5o_hosted_prototype_read_v1(p_workspace_key,'work');
  insert into d5o_hosted.connected_design_receipts(workspace_id,command_id,
    work_id,actor_user_id,fingerprint,result)
  values(v_workspace.id,p_command_id,v_work.id,v_actor,v_fingerprint,v_result);
  return v_result;
end; $$;
revoke all on function public.d5o_hosted_design_demand_command_v1(
  text,text,jsonb,text,bigint,integer) from public,anon,service_role;
grant execute on function public.d5o_hosted_design_demand_command_v1(
  text,text,jsonb,text,bigint,integer) to authenticated;
