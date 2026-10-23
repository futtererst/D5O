-- Connected Operate decisions have their own append-only event/receipt trail.
create table d5o_hosted.connected_operate_states (
  workspace_id uuid not null references d5o_hosted.workspaces(id),
  work_id uuid not null,decision_revision integer not null default 1,
  state jsonb not null,updated_at timestamptz not null default now(),
  primary key(workspace_id,work_id),
  foreign key(work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id)
);
create table d5o_hosted.connected_operate_events (
  workspace_id uuid not null,work_id uuid not null,decision_revision integer not null,
  command_id text not null,action text not null,actor_user_id uuid not null,
  membership_id uuid not null,deploy_revision integer not null,
  snapshot jsonb not null,at timestamptz not null default now(),
  primary key(workspace_id,work_id,decision_revision),
  unique(workspace_id,command_id),
  foreign key(work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id)
);
create table d5o_hosted.connected_operate_receipts (
  workspace_id uuid not null,command_id text not null,work_id uuid not null,
  actor_user_id uuid not null,fingerprint text not null,result jsonb not null,
  created_at timestamptz not null default now(),primary key(workspace_id,command_id),
  foreign key(work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id)
);
alter table d5o_hosted.connected_operate_states enable row level security;
alter table d5o_hosted.connected_operate_events enable row level security;
alter table d5o_hosted.connected_operate_receipts enable row level security;
revoke all on d5o_hosted.connected_operate_states,
  d5o_hosted.connected_operate_events,d5o_hosted.connected_operate_receipts
  from public,anon,authenticated,service_role;

create function d5o_hosted.connected_operate_projection_v1(
  p_workspace uuid,p_state jsonb
) returns jsonb language sql stable security definer set search_path='' as $$
  select pg_catalog.jsonb_set(p_state,'{records}',coalesce((
    select pg_catalog.jsonb_agg(case when o.work_id is null then item else
      item||pg_catalog.jsonb_build_object('operate',o.state) end order by ordinal)
    from pg_catalog.jsonb_array_elements(coalesce(p_state->'records','[]'::jsonb))
      with ordinality as records(item,ordinal)
    left join d5o_hosted.work_identity_links l on l.workspace_id=p_workspace
      and l.presentation_id=item->>'id'
    left join d5o_hosted.connected_operate_states o on o.workspace_id=p_workspace
      and o.work_id=l.work_id
  ),'[]'::jsonb));
$$;
revoke all on function d5o_hosted.connected_operate_projection_v1(uuid,jsonb)
  from public,anon,authenticated,service_role;

create or replace function public.d5o_hosted_prototype_read_v1(
  p_workspace_key text,p_state_key text
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_workspace uuid;v_state d5o_hosted.prototype_states%rowtype;
  v_schedule d5o_hosted.connected_schedule_states%rowtype;v_projected jsonb;
begin
  if auth.uid() is null or p_workspace_key is null
    or p_state_key not in ('work','catalog','schedule') then
    raise exception 'prototype_scope_forbidden' using errcode='42501'; end if;
  select w.id into v_workspace from d5o_hosted.workspaces w
    join d5o_hosted.memberships m on m.workspace_id=w.id
    where w.workspace_key=p_workspace_key and w.status='active'
      and m.actor_user_id=auth.uid() and m.status='active' and m.role<>'field_worker';
  if v_workspace is null then raise exception 'prototype_scope_forbidden' using errcode='42501'; end if;
  if p_state_key='schedule' then
    select * into v_state from d5o_hosted.prototype_states
      where workspace_id=v_workspace and state_key='schedule';
    select * into v_schedule from d5o_hosted.connected_schedule_states
      where workspace_id=v_workspace;
    return pg_catalog.jsonb_build_object(
      'revision',coalesce(v_schedule.decision_revision,v_state.revision,0),
      'state',d5o_hosted.connected_schedule_projection_v1(
        v_workspace,p_workspace_key,v_state.state_json));
  end if;
  select * into v_state from d5o_hosted.prototype_states
    where workspace_id=v_workspace and state_key=p_state_key;
  if not found then return pg_catalog.jsonb_build_object('revision',0,'state',null); end if;
  v_projected:=case when p_state_key='work' then
    d5o_hosted.connected_operate_projection_v1(v_workspace,
      d5o_hosted.connected_deploy_projection_v1(v_workspace,
        d5o_hosted.connected_design_projection_v1(v_workspace,
          d5o_hosted.connected_define_projection_v1(v_workspace,v_state.state_json))))
    else v_state.state_json end;
  return pg_catalog.jsonb_build_object('revision',v_state.revision,'state',
    d5o_hosted.connected_package_projection_v1(v_workspace,v_projected,p_state_key));
end; $$;
revoke all on function public.d5o_hosted_prototype_read_v1(text,text) from public,anon;
grant execute on function public.d5o_hosted_prototype_read_v1(text,text) to authenticated;

create or replace function public.d5o_hosted_server_connected_read_v1(
  p_workspace_key text,p_state_key text
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_workspace uuid;v_state d5o_hosted.prototype_states%rowtype;
  v_schedule d5o_hosted.connected_schedule_states%rowtype;v_projected jsonb;
begin
  if current_setting('role',true)<>'service_role'
    or p_state_key not in ('work','schedule') then
    raise exception 'server_connected_read_forbidden' using errcode='42501'; end if;
  select id into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  if v_workspace is null then raise exception 'workspace_unavailable' using errcode='42501'; end if;
  select * into v_state from d5o_hosted.prototype_states
    where workspace_id=v_workspace and state_key=p_state_key;
  if not found then return pg_catalog.jsonb_build_object('revision',0,'state',null); end if;
  if p_state_key='schedule' then
    select * into v_schedule from d5o_hosted.connected_schedule_states
      where workspace_id=v_workspace;
    return pg_catalog.jsonb_build_object('revision',
      coalesce(v_schedule.decision_revision,v_state.revision,0),
      'state',d5o_hosted.connected_schedule_projection_v1(
        v_workspace,p_workspace_key,v_state.state_json));
  end if;
  v_projected:=d5o_hosted.connected_operate_projection_v1(v_workspace,
    d5o_hosted.connected_deploy_projection_v1(v_workspace,
      d5o_hosted.connected_design_projection_v1(v_workspace,
        d5o_hosted.connected_define_projection_v1(v_workspace,v_state.state_json))));
  return pg_catalog.jsonb_build_object('revision',v_state.revision,'state',
    d5o_hosted.connected_package_projection_v1(v_workspace,v_projected,'work'));
end; $$;
revoke all on function public.d5o_hosted_server_connected_read_v1(text,text)
  from public,anon,authenticated;
grant execute on function public.d5o_hosted_server_connected_read_v1(text,text)
  to service_role;
