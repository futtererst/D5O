-- Disposable local pilot only. The entire probe, including its test wrapper,
-- injected failure, and successful creation, is rolled back.
begin;
create table public.d5o_pilot_related_payload(
  id integer primary key, parent_id text not null, work_revision bigint not null,
  catalog_revision bigint not null, parent_after jsonb not null,
  child jsonb not null, actor_id uuid not null, membership_id uuid not null);
create function public.d5o_pilot_related_probe(p_title text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_workspace uuid; v_parent jsonb; v_parent_id text; v_actor uuid; v_member uuid;
  v_work d5o_hosted.prototype_states%rowtype;
  v_catalog d5o_hosted.prototype_states%rowtype;
  v_version text; v_customer text; v_site text; v_operate jsonb;
  v_command text := '11111111-2222-4333-8444-555555555555';
  v_alias text := 'rybex-11111111222243338444555555555555';
  v_next jsonb; v_child jsonb;
begin
  select parent_id,work_revision,catalog_revision,parent_after,child,actor_id,membership_id
    into v_parent_id,v_work.revision,v_catalog.revision,v_parent,v_child,v_actor,v_member
    from public.d5o_pilot_related_payload where id=1;
  if found then
    v_child := pg_catalog.jsonb_set(v_child,'{title}',pg_catalog.to_jsonb(p_title));
    return public.d5o_hosted_create_related_work_v1('rybex',v_command,
      'open-lifecycle',v_parent_id,v_work.revision,v_catalog.revision,
      v_parent,v_child,v_actor,v_member);
  end if;
  select id into v_workspace from d5o_hosted.workspaces
    where workspace_key='rybex' and display_name='Rybex Isolated Pilot';
  if v_workspace is null then raise exception 'wrong_database_target'; end if;
  select actor_user_id,id into v_actor,v_member from d5o_hosted.memberships
    where workspace_id=v_workspace and role='project_manager' and status='active' limit 1;
  select * into v_work from d5o_hosted.prototype_states
    where workspace_id=v_workspace and state_key='work';
  select * into v_catalog from d5o_hosted.prototype_states
    where workspace_id=v_workspace and state_key='catalog';
  select item into v_parent from pg_catalog.jsonb_array_elements(v_work.state_json->'records') item
    where item->>'canonicalWorkId' is not null limit 1;
  if v_parent is null then raise exception 'connected_parent_missing'; end if;
  v_parent_id := v_parent->>'id'; v_version := v_parent->>'phaseConfigurationVersionId';
  v_customer := v_parent->>'customer'; v_site := v_parent->>'site';
  v_operate := pg_catalog.jsonb_build_object('assets','[]'::jsonb,
    'agreements','[]'::jsonb,'requests','[]'::jsonb,'jobs','[]'::jsonb,
    'maintenance','[]'::jsonb,'customerReviews','[]'::jsonb,
    'lifecycleLinks','[]'::jsonb,'finance',pg_catalog.jsonb_build_object(
      'status','Pending','owner','Finance','note',''),
    'lessons','[]'::jsonb,'events','[]'::jsonb);
  -- A rollback-only fixture, not an approval or claim about real delivery.
  update d5o_hosted.prototype_states set state_json=pg_catalog.jsonb_set(
    state_json,'{records}',(select pg_catalog.jsonb_agg(
      case when item->>'id'=v_parent_id then pg_catalog.jsonb_set(item,'{operate}',v_operate)
      else item end) from pg_catalog.jsonb_array_elements(state_json->'records') item))
    where workspace_id=v_workspace and state_key='work';
  v_parent := pg_catalog.jsonb_set(v_parent,'{operate}',v_operate);
  v_next := pg_catalog.jsonb_set(v_operate,'{events}',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'id','22222222-2222-4222-8222-222222222222',
      'commandId',v_command,'actorId',v_actor,'membershipId',v_member,
      'action','Lifecycle opportunity opened','at','2026-10-08T12:00:00Z')));
  v_next := pg_catalog.jsonb_set(v_next,'{lifecycleLinks}',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'id','33333333-3333-4333-8333-333333333333',
      'opportunityWorkId',v_alias,'rationale','Pilot replacement review',
      'owner','Pilot Project Manager','at','2026-10-08T12:00:00Z')));
  v_parent := pg_catalog.jsonb_set(v_parent,'{operate}',v_next);
  v_parent := pg_catalog.jsonb_set(v_parent,'{history}',
    pg_catalog.jsonb_build_array('Pilot lifecycle command') ||
      coalesce(v_parent->'history','[]'::jsonb));
  v_child := pg_catalog.jsonb_build_object('id',v_alias,'workspace','rybex',
    'title',p_title,'type','Lifecycle service','customer',v_customer,
    'site',v_site,'stage','Qualification','owner','Pilot Project Manager',
    'nextAction','Qualify lifecycle need in Discover','progress',0,
    'value','Indicative value unknown','status','moving',
    'proof','[]'::jsonb,'blockers','[]'::jsonb,'history','[]'::jsonb,
    'phaseConfigurationVersionId',v_version,
    'discovery',pg_catalog.jsonb_build_object('source','Lifecycle referral',
      'need','Pilot replacement review'));
  insert into public.d5o_pilot_related_payload values
    (1,v_parent_id,v_work.revision,v_catalog.revision,v_parent,v_child,v_actor,v_member);
  return public.d5o_hosted_create_related_work_v1('rybex',v_command,
    'open-lifecycle',v_parent_id,v_work.revision,v_catalog.revision,
    v_parent,v_child,v_actor,v_member);
end; $$;
revoke all on function public.d5o_pilot_related_probe(text) from public,anon,authenticated;
grant execute on function public.d5o_pilot_related_probe(text) to service_role;
create function public.d5o_pilot_injected_failure() returns trigger
language plpgsql as $$ begin raise exception 'pilot_injected_failure'; end $$;
create trigger d5o_pilot_fail_receipt before insert on d5o_hosted.connected_create_receipts
  for each row execute function public.d5o_pilot_injected_failure();
set local role service_role;
do $$
begin
  begin
    perform public.d5o_pilot_related_probe('Pilot lifecycle follow-on');
    raise exception 'injected_failure_was_not_observed';
  exception when others then
    if sqlerrm <> 'pilot_injected_failure' then raise; end if;
  end;
end $$;
reset role;
create function public.d5o_pilot_service_probe()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_workspace uuid; v_parent jsonb; v_parent_id text; v_actor uuid; v_member uuid;
  v_work d5o_hosted.prototype_states%rowtype;
  v_catalog d5o_hosted.prototype_states%rowtype;
  v_operate jsonb; v_next jsonb; v_child jsonb;
  v_command text := '44444444-4444-4444-8444-444444444444';
  v_alias text := 'rybex-44444444444444448444444444444444';
begin
  select id into v_workspace from d5o_hosted.workspaces
    where workspace_key='rybex' and display_name='Rybex Isolated Pilot';
  select actor_user_id,id into v_actor,v_member from d5o_hosted.memberships
    where workspace_id=v_workspace and role='project_manager' and status='active' limit 1;
  select * into v_work from d5o_hosted.prototype_states
    where workspace_id=v_workspace and state_key='work';
  select * into v_catalog from d5o_hosted.prototype_states
    where workspace_id=v_workspace and state_key='catalog';
  select item into v_parent from pg_catalog.jsonb_array_elements(v_work.state_json->'records') item
    where item->>'canonicalWorkId' is not null
      and pg_catalog.jsonb_typeof(item->'operate')='object'
      and item#>>'{operate,lifecycleLinks,0,opportunityWorkId}'
        ='rybex-11111111222243338444555555555555'
      and item->'serviceSource' is null limit 1;
  v_parent_id := v_parent->>'id';
  v_operate := v_parent->'operate';
  v_operate := pg_catalog.jsonb_set(v_operate,'{activation}',
    pg_catalog.jsonb_build_object('status','Active'));
  v_operate := pg_catalog.jsonb_set(v_operate,'{assets}',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id','pilot-asset-1')));
  v_operate := pg_catalog.jsonb_set(v_operate,'{requests}',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id','pilot-request-1',
      'assetId','pilot-asset-1','status','Triaged','coverage','Covered',
      'reportedAt','2026-10-08T10:00:00Z',
      'jobIds','[]'::jsonb,'currentCycleJobIds','[]'::jsonb)));
  update d5o_hosted.prototype_states set state_json=pg_catalog.jsonb_set(
    state_json,'{records}',(select pg_catalog.jsonb_agg(
      case when item->>'id'=v_parent_id then pg_catalog.jsonb_set(item,'{operate}',v_operate)
      else item end) from pg_catalog.jsonb_array_elements(state_json->'records') item))
    where workspace_id=v_workspace and state_key='work';
  v_parent := pg_catalog.jsonb_set(v_parent,'{operate}',v_operate);
  v_next := pg_catalog.jsonb_set(v_operate,'{events}',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'id','55555555-5555-4555-8555-555555555555','commandId',v_command,
      'actorId',v_actor,'membershipId',v_member,'action','Service job generated',
      'at','2026-10-08T12:00:00Z')) || (v_operate->'events'));
  v_next := pg_catalog.jsonb_set(v_next,'{jobs}',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'id','pilot-job-1','workId',v_alias,'status','Generated',
      'assetIds',pg_catalog.jsonb_build_array('pilot-asset-1'),
      'requestId','pilot-request-1','dueDate','2026-10-09')));
  v_next := pg_catalog.jsonb_set(v_next,'{requests}',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'id','pilot-request-1','assetId','pilot-asset-1','status','In progress','coverage','Covered',
      'reportedAt','2026-10-08T10:00:00Z',
      'jobIds',pg_catalog.jsonb_build_array('pilot-job-1'),
      'currentCycleJobIds',pg_catalog.jsonb_build_array('pilot-job-1'))));
  v_parent := pg_catalog.jsonb_set(v_parent,'{operate}',v_next);
  v_parent := pg_catalog.jsonb_set(v_parent,'{history}',
    pg_catalog.jsonb_build_array('Pilot service command') ||
      coalesce(v_parent->'history','[]'::jsonb));
  v_child := pg_catalog.jsonb_build_object('id',v_alias,'workspace','rybex',
    'title','Pilot service visit','type','Lifecycle service',
    'customer',v_parent->>'customer','site',v_parent->>'site',
    'stage','Design','owner','Pilot Project Manager',
    'nextAction','Prepare service release','progress',0,'value','Unpriced',
    'status','attention','proof','[]'::jsonb,'blockers','[]'::jsonb,
    'history','[]'::jsonb,
    'phaseConfigurationVersionId',v_parent->>'phaseConfigurationVersionId',
    'serviceSource',pg_catalog.jsonb_build_object('parentWorkId',v_parent_id,
      'assetIds',pg_catalog.jsonb_build_array('pilot-asset-1'),
      'requestId','pilot-request-1','coverage','Covered'));
  return public.d5o_hosted_create_related_work_v1('rybex',v_command,
    'create-job',v_parent_id,v_work.revision,v_catalog.revision,
    v_parent,v_child,v_actor,v_member);
end; $$;
revoke all on function public.d5o_pilot_service_probe() from public,anon,authenticated;
grant execute on function public.d5o_pilot_service_probe() to service_role;
do $$
begin
  if exists(select 1 from d5o_hosted.work_identity_links
      where presentation_id='rybex-11111111222243338444555555555555')
    or exists(select 1 from d5o_hosted.connected_create_receipts
      where command_id='11111111-2222-4333-8444-555555555555') then
    raise exception 'injected_failure_left_related_work'; end if;
end $$;
drop trigger d5o_pilot_fail_receipt on d5o_hosted.connected_create_receipts;
set local role service_role;
select public.d5o_pilot_related_probe('Pilot lifecycle follow-on');
select public.d5o_pilot_service_probe();
select public.d5o_pilot_related_probe('Pilot lifecycle follow-on');
do $$
begin
  begin
    perform public.d5o_pilot_related_probe('Conflicting lifecycle follow-on');
    raise exception 'conflicting_replay_was_allowed';
  exception when unique_violation then null;
  end;
end $$;
reset role;
do $$
begin
  if (select count(*) from d5o_hosted.work_identity_links
      where presentation_id='rybex-11111111222243338444555555555555') <> 1
    or (select count(*) from d5o_hosted.connected_create_receipts
      where command_id='11111111-2222-4333-8444-555555555555') <> 1 then
    raise exception 'related_work_duplicate_or_missing'; end if;
  if (select count(*) from d5o_hosted.work_identity_links
      where presentation_id='rybex-44444444444444448444444444444444'
        and relation_kind='service_visit') <> 1 then
    raise exception 'service_visit_identity_missing'; end if;
  raise notice 'PASS: failure atomicity, exact replay, conflict rejection, lifecycle and service identities';
end $$;
rollback;
