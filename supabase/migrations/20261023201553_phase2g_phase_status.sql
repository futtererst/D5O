-- A transactionally refreshed read projection of existing connected decisions.
-- It is never an independent workflow writer. Historical rows without enough
-- connected evidence stay unresolved rather than gaining invented completions.
create table d5o_hosted.connected_phase_status (
  workspace_id uuid not null,
  work_id uuid not null,
  configuration_version_id uuid not null references d5o_hosted.configuration_versions(id),
  projection jsonb not null check (pg_catalog.jsonb_typeof(projection)='object'),
  projection_revision bigint not null default 1 check (projection_revision>0),
  source_event text,
  last_transition_actor uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (workspace_id,work_id),
  foreign key (work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id)
);
alter table d5o_hosted.connected_phase_status enable row level security;
revoke all on d5o_hosted.connected_phase_status from public,anon,authenticated,service_role;

create function d5o_hosted.connected_phase_projection_v1(p_workspace uuid,p_work uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_work d5o_hosted.work_records%rowtype;
  v_pursuit d5o_hosted.connected_pursuit_states%rowtype;
  v_define d5o_hosted.connected_define_states%rowtype;
  v_solution d5o_hosted.connected_solution_states%rowtype;
  v_handoff d5o_hosted.connected_design_handoffs%rowtype;
  v_design d5o_hosted.connected_design_states%rowtype;
  v_deploy d5o_hosted.connected_deploy_states%rowtype;
  v_operate d5o_hosted.connected_operate_states%rowtype;
  v_discover_done boolean;v_define_done boolean;v_design_done boolean;
  v_develop_done boolean;v_deploy_done boolean;v_deploy_blocked boolean;
  v_support_active boolean;
  v_packages integer;v_accepted integer;v_current text;v_phases jsonb;
begin
  select * into v_work from d5o_hosted.work_records
    where workspace_id=p_workspace and id=p_work;
  if not found then return null; end if;
  select * into v_pursuit from d5o_hosted.connected_pursuit_states
    where workspace_id=p_workspace and work_id=p_work;
  select * into v_define from d5o_hosted.connected_define_states
    where workspace_id=p_workspace and work_id=p_work;
  select * into v_solution from d5o_hosted.connected_solution_states
    where workspace_id=p_workspace and work_id=p_work;
  select * into v_handoff from d5o_hosted.connected_design_handoffs
    where workspace_id=p_workspace and work_id=p_work;
  select * into v_design from d5o_hosted.connected_design_states
    where workspace_id=p_workspace and work_id=p_work;
  select * into v_deploy from d5o_hosted.connected_deploy_states
    where workspace_id=p_workspace and work_id=p_work;
  select * into v_operate from d5o_hosted.connected_operate_states
    where workspace_id=p_workspace and work_id=p_work;
  v_discover_done:=coalesce(v_pursuit.status='qualified'
    and v_pursuit.handoff_receiver is not null,false);
  v_define_done:=v_discover_done and coalesce(v_define.status='Approved'
    and v_define.handoff_receiver is not null,false);
  select count(*) into v_packages from d5o_hosted.connected_package_states
    where workspace_id=p_workspace and work_id=p_work;
  select count(distinct d->>'packageId') into v_accepted
    from pg_catalog.jsonb_array_elements(coalesce(v_design.state->'releases','[]'::jsonb)) d
    where d->>'status'='Accepted';
  v_design_done:=v_define_done and coalesce(v_handoff.status='accepted',false)
    and v_packages>0 and v_accepted>=v_packages;
  v_develop_done:=v_design_done and exists(
    select 1 from pg_catalog.jsonb_array_elements(
      coalesce(v_deploy.state->'permits','[]'::jsonb)) p
      where p->>'status' in ('Authorized','Held'));
  v_deploy_blocked:=exists(select 1 from pg_catalog.jsonb_array_elements(
    coalesce(v_deploy.state->'permits','[]'::jsonb)) p
    where p->>'status'='Held');
  v_deploy_done:=v_develop_done and
    coalesce(v_deploy.state#>>'{workAcceptance,receipt}'='Accepted',false);
  v_support_active:=v_deploy_done and
    coalesce(v_operate.state#>>'{activation,status}'='Active',false);
  v_current:=case when not v_discover_done then 'Discover'
    when not v_define_done then 'Define'
    when not v_design_done then 'Design'
    when not v_develop_done then 'Develop'
    when not v_deploy_done then 'Deploy' else 'Operate' end;
  v_phases:=pg_catalog.jsonb_build_object(
    'Discover',pg_catalog.jsonb_build_object(
      'status',case when v_discover_done then 'completed'
        when v_pursuit.status='held' then 'blocked' else 'active' end,
      'entryEvidence','work_created:'||v_work.id,
      'completionEvidence',case when v_discover_done then
        'pursuit_handoff:'||v_pursuit.decision_revision end),
    'Define',pg_catalog.jsonb_build_object(
      'status',case when v_define_done then 'completed'
        when not v_discover_done then 'not_started'
        when v_define.status='Changes requested' then 'blocked'
        when v_define.work_id is not null then 'active' else 'ready_to_enter' end,
      'entryEvidence',case when v_discover_done then
        'pursuit_handoff:'||v_pursuit.decision_revision end,
      'completionEvidence',case when v_define_done then
        'define_handoff:'||v_define.decision_revision end),
    'Design',pg_catalog.jsonb_build_object(
      'status',case when v_design_done then 'completed'
        when not v_define_done then 'not_started'
        when v_handoff.status='accepted' then 'active' else 'ready_to_enter' end,
      'entryEvidence',case when v_handoff.status='accepted' then
        'design_handoff:'||v_handoff.decision_revision end,
      'completionEvidence',case when v_design_done then
        'accepted_releases:'||v_design.decision_revision end),
    'Develop',pg_catalog.jsonb_build_object(
      'status',case when v_develop_done then 'completed'
        when not v_design_done and v_solution.status='Approved'
          then 'preparation_in_progress'
        when not v_design_done then 'not_started'
        else 'active' end,
      'preparationEvidence',case when v_solution.status='Approved' then
        'selected_solution:'||v_solution.decision_revision end,
      'entryEvidence',case when v_design_done then
        'accepted_releases:'||v_design.decision_revision end,
      'completionEvidence',case when v_develop_done then
        'field_start:'||v_deploy.decision_revision end),
    'Deploy',pg_catalog.jsonb_build_object(
      'status',case when v_deploy_done then 'completed'
        when not v_develop_done then 'not_started'
        when v_deploy_blocked then 'blocked' else 'active' end,
      'entryEvidence',case when v_develop_done then
        'field_start:'||v_deploy.decision_revision end,
      'completionEvidence',case when v_deploy_done then
        'work_acceptance:'||v_deploy.decision_revision end),
    'Operate',pg_catalog.jsonb_build_object(
      'status',case when not v_deploy_done then 'not_started' else 'active' end,
      'entryEvidence',case when v_deploy_done then
        'work_acceptance:'||v_deploy.decision_revision end,
      'supportStatus',case when v_support_active then 'Active' else
        coalesce(v_operate.state#>>'{activation,status}','Pending') end,
      'financialCloseout',coalesce(v_operate.state#>>'{finance,status}','Pending')));
  return pg_catalog.jsonb_build_object('currentPhase',v_current,
    'configurationVersionId',v_work.configuration_version_id,
    'phases',v_phases,'supportActive',v_support_active,
    'financialCloseout',coalesce(v_operate.state#>>'{finance,status}','Pending'));
end; $$;
revoke all on function d5o_hosted.connected_phase_projection_v1(uuid,uuid)
  from public,anon,authenticated,service_role;

create function d5o_hosted.refresh_connected_phase_status_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_projection jsonb;v_version uuid;v_actor uuid;v_ref text;
begin
  v_projection:=d5o_hosted.connected_phase_projection_v1(new.workspace_id,new.work_id);
  if v_projection is null then return new; end if;
  select configuration_version_id into v_version from d5o_hosted.work_records
    where workspace_id=new.workspace_id and id=new.work_id;
  v_actor:=(pg_catalog.to_jsonb(new)->>'actor_user_id')::uuid;
  v_ref:=tg_table_name||':'||coalesce(pg_catalog.to_jsonb(new)->>'decision_revision',
    pg_catalog.to_jsonb(new)->>'record_version','1');
  insert into d5o_hosted.connected_phase_status(workspace_id,work_id,
    configuration_version_id,projection,source_event,last_transition_actor)
  values(new.workspace_id,new.work_id,v_version,v_projection,v_ref,v_actor)
  on conflict(workspace_id,work_id) do update set
    projection=excluded.projection,
    projection_revision=d5o_hosted.connected_phase_status.projection_revision+1,
    source_event=excluded.source_event,
    last_transition_actor=excluded.last_transition_actor,
    updated_at=now()
  where d5o_hosted.connected_phase_status.projection is distinct from excluded.projection;
  return new;
end; $$;
revoke all on function d5o_hosted.refresh_connected_phase_status_v1()
  from public,anon,authenticated,service_role;

create trigger phase_status_work_created after insert on d5o_hosted.work_events
  for each row execute function d5o_hosted.refresh_connected_phase_status_v1();
create trigger phase_status_pursuit after insert on d5o_hosted.connected_pursuit_events
  for each row execute function d5o_hosted.refresh_connected_phase_status_v1();
create trigger phase_status_define after insert on d5o_hosted.connected_define_events
  for each row execute function d5o_hosted.refresh_connected_phase_status_v1();
create trigger phase_status_solution after insert on d5o_hosted.connected_solution_events
  for each row execute function d5o_hosted.refresh_connected_phase_status_v1();
create trigger phase_status_design_handoff after insert on d5o_hosted.connected_design_handoff_events
  for each row execute function d5o_hosted.refresh_connected_phase_status_v1();
create trigger phase_status_design after insert on d5o_hosted.connected_design_events
  for each row execute function d5o_hosted.refresh_connected_phase_status_v1();
create trigger phase_status_deploy after insert on d5o_hosted.connected_deploy_events
  for each row execute function d5o_hosted.refresh_connected_phase_status_v1();
create trigger phase_status_operate after insert on d5o_hosted.connected_operate_events
  for each row execute function d5o_hosted.refresh_connected_phase_status_v1();

-- Only historical Work with actual connected decisions is backfilled. A
-- historical Work without these decisions will read as unresolved.
insert into d5o_hosted.connected_phase_status(workspace_id,work_id,
  configuration_version_id,projection,source_event)
select w.workspace_id,w.id,w.configuration_version_id,
  d5o_hosted.connected_phase_projection_v1(w.workspace_id,w.id),null
from d5o_hosted.work_records w
where exists(select 1 from d5o_hosted.connected_pursuit_events e
  where e.workspace_id=w.workspace_id and e.work_id=w.id)
  or exists(select 1 from d5o_hosted.connected_define_events e
    where e.workspace_id=w.workspace_id and e.work_id=w.id)
  or exists(select 1 from d5o_hosted.connected_design_events e
    where e.workspace_id=w.workspace_id and e.work_id=w.id)
  or exists(select 1 from d5o_hosted.connected_deploy_events e
    where e.workspace_id=w.workspace_id and e.work_id=w.id)
  or exists(select 1 from d5o_hosted.connected_operate_events e
    where e.workspace_id=w.workspace_id and e.work_id=w.id)
on conflict (workspace_id,work_id) do nothing;

create function public.d5o_hosted_phase_status_read_v1(
  p_workspace_key text,p_presentation_id text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace uuid;v_work uuid;v_role text;
  v_status d5o_hosted.connected_phase_status%rowtype;v_replayed jsonb;
begin
  if pg_catalog.current_setting('role',true)<>'authenticated' or v_actor is null then
    raise exception 'phase_status_forbidden' using errcode='42501'; end if;
  select w.id,m.role into v_workspace,v_role from d5o_hosted.workspaces w
    join d5o_hosted.memberships m on m.workspace_id=w.id
    where w.workspace_key=p_workspace_key and w.status='active'
      and m.actor_user_id=v_actor and m.status='active';
  if v_workspace is null or v_role='field_worker' then
    raise exception 'phase_status_forbidden' using errcode='42501'; end if;
  if (public.d5o_hosted_capability_read_v1(p_workspace_key)->>'connectedWork')::boolean
    is distinct from true then
    raise exception 'connected_work_unavailable' using errcode='42501'; end if;
  select l.work_id into v_work from d5o_hosted.work_identity_links l
    where l.workspace_id=v_workspace and l.presentation_id=p_presentation_id;
  if v_work is null then
    raise exception 'phase_status_forbidden' using errcode='42501'; end if;
  select * into v_status from d5o_hosted.connected_phase_status
    where workspace_id=v_workspace and work_id=v_work;
  if not found then return pg_catalog.jsonb_build_object('status','unresolved',
    'workId',v_work,'reason','historical_connected_evidence_unavailable'); end if;
  v_replayed:=d5o_hosted.connected_phase_projection_v1(v_workspace,v_work);
  return pg_catalog.jsonb_build_object('status','resolved','workId',v_work,
    'configurationVersionId',v_status.configuration_version_id,
    'projection',v_status.projection,'projectionRevision',v_status.projection_revision,
    'sourceEvent',v_status.source_event,'lastTransitionActor',v_status.last_transition_actor,
    'updatedAt',v_status.updated_at,'replayMatches',v_status.projection=v_replayed);
end; $$;
revoke all on function public.d5o_hosted_phase_status_read_v1(text,text)
  from public,anon,service_role;
grant execute on function public.d5o_hosted_phase_status_read_v1(text,text)
  to authenticated;
