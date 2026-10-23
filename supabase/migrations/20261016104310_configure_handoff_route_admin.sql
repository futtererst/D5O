-- Administrator-owned, revisioned route settings for hosted handoff commands.
alter table d5o_hosted.configuration_handoff_roles
  add column revision integer not null default 1 check (revision > 0),
  add column configured_by uuid references auth.users(id),
  add column updated_at timestamptz not null default now();
create table d5o_hosted.handoff_route_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references d5o_hosted.workspaces(id),
  configuration_version_id uuid not null references d5o_hosted.configuration_versions(id),
  route_key text not null,
  revision integer not null,
  prior_role text,
  receiving_role text not null,
  actor_user_id uuid not null references auth.users(id),
  membership_id uuid not null references d5o_hosted.memberships(id),
  command_id text not null,
  occurred_at timestamptz not null default now(),
  unique(workspace_id,command_id),
  unique(configuration_version_id,route_key,revision)
);
create table d5o_hosted.handoff_route_receipts (
  workspace_id uuid not null references d5o_hosted.workspaces(id),
  command_id text not null,
  actor_user_id uuid not null references auth.users(id),
  fingerprint text not null,
  result jsonb not null,
  primary key(workspace_id,command_id)
);
alter table d5o_hosted.handoff_route_events enable row level security;
alter table d5o_hosted.handoff_route_receipts enable row level security;
revoke all on d5o_hosted.handoff_route_events,d5o_hosted.handoff_route_receipts from public,anon,authenticated;

create function public.d5o_hosted_handoff_routes_v1(p_workspace_key text,p_version uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_workspace d5o_hosted.workspaces%rowtype;v_actor uuid:=auth.uid();
  v_result jsonb;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null then
    raise exception 'handoff_route_admin_required' using errcode='42501'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  if not found or not exists(select 1 from d5o_hosted.memberships m
    where m.workspace_id=v_workspace.id and m.actor_user_id=v_actor
      and m.status='active' and m.role='admin') then
    raise exception 'handoff_route_admin_required' using errcode='42501'; end if;
  if not exists(select 1 from d5o_hosted.configuration_versions v
    join d5o_hosted.configuration_tenants t on t.id=v.tenant_id
    where v.id=p_version and t.workspace_id=v_workspace.id) then
    raise exception 'handoff_configuration_unavailable' using errcode='42501'; end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'key',r.route_key,'role',r.receiving_role,'revision',r.revision,
    'updatedAt',r.updated_at,'configuredBy',r.configured_by) order by r.route_key),'[]'::jsonb)
    into v_result from d5o_hosted.configuration_handoff_roles r
    where r.configuration_version_id=p_version;
  return v_result;
end $$;
revoke all on function public.d5o_hosted_handoff_routes_v1(text,uuid) from public,anon;
grant execute on function public.d5o_hosted_handoff_routes_v1(text,uuid) to authenticated;

create function public.d5o_hosted_configure_handoff_route_v1(
  p_workspace_key text,p_version uuid,p_route text,p_role text,
  p_expected_revision integer,p_command_id text
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_workspace d5o_hosted.workspaces%rowtype;v_member d5o_hosted.memberships%rowtype;
  v_route d5o_hosted.configuration_handoff_roles%rowtype;v_actor uuid:=auth.uid();
  v_receipt d5o_hosted.handoff_route_receipts%rowtype;v_fingerprint text;v_result jsonb;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or p_route not in ('discoverDefine','designDeploy','deployOperate')
    or p_role not in ('admin','operations_leader','project_manager')
    or (p_route='deployOperate' and p_role<>'operations_leader')
    or p_expected_revision is null or p_expected_revision<0
    or length(coalesce(p_command_id,'')) not between 8 and 120 then
    raise exception 'invalid_handoff_route' using errcode='22023'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active' for share;
  if not found then raise exception 'handoff_route_admin_required' using errcode='42501'; end if;
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor
      and status='active' and role='admin' for share;
  if not found then raise exception 'handoff_route_admin_required' using errcode='42501'; end if;
  if not exists(select 1 from d5o_hosted.configuration_versions v
    join d5o_hosted.configuration_tenants t on t.id=v.tenant_id
    where v.id=p_version and t.workspace_id=v_workspace.id
      and v.status in ('published','superseded')) then
    raise exception 'handoff_configuration_unavailable' using errcode='42501'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_workspace_key,p_version,p_route,p_role,p_expected_revision)::text);
  select * into v_receipt from d5o_hosted.handoff_route_receipts
    where workspace_id=v_workspace.id and command_id=p_command_id;
  if found then
    if v_receipt.actor_user_id<>v_actor or v_receipt.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_receipt.result;
  end if;
  select * into v_route from d5o_hosted.configuration_handoff_roles
    where configuration_version_id=p_version and route_key=p_route for update;
  if coalesce(v_route.revision,0)<>p_expected_revision then
    raise exception 'stale_handoff_route' using errcode='23505'; end if;
  if v_route.configuration_version_id is null then
    insert into d5o_hosted.configuration_handoff_roles
      (configuration_version_id,route_key,receiving_role,revision,configured_by)
      values(p_version,p_route,p_role,1,v_actor);
  else
    update d5o_hosted.configuration_handoff_roles set
      receiving_role=p_role,revision=revision+1,configured_by=v_actor,updated_at=now()
      where configuration_version_id=p_version and route_key=p_route;
  end if;
  insert into d5o_hosted.handoff_route_events(workspace_id,configuration_version_id,
    route_key,revision,prior_role,receiving_role,actor_user_id,membership_id,command_id)
    values(v_workspace.id,p_version,p_route,p_expected_revision+1,
      v_route.receiving_role,p_role,v_actor,v_member.id,p_command_id);
  v_result:=pg_catalog.jsonb_build_object('key',p_route,'role',p_role,
    'revision',p_expected_revision+1,'configurationVersionId',p_version);
  insert into d5o_hosted.handoff_route_receipts(workspace_id,command_id,actor_user_id,fingerprint,result)
    values(v_workspace.id,p_command_id,v_actor,v_fingerprint,v_result);
  return v_result;
end $$;
revoke all on function public.d5o_hosted_configure_handoff_route_v1(text,uuid,text,text,integer,text) from public,anon;
grant execute on function public.d5o_hosted_configure_handoff_route_v1(text,uuid,text,text,integer,text) to authenticated;
