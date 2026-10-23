-- The hosted Work pin, rather than the unrelated M1 configuration lineage,
-- governs these handoffs. Existing published versions and decisions stay intact.
alter table d5o_hosted.configuration_versions
  drop constraint configuration_versions_status_check;
alter table d5o_hosted.configuration_versions
  add constraint configuration_versions_status_check
  check (status in ('draft','validated','published','superseded'));
alter table d5o_hosted.configuration_versions
  add column source_version_id uuid references d5o_hosted.configuration_versions(id);

create or replace function d5o_hosted.guard_configuration_version_v1()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='UPDATE' and old.status in ('validated','published','superseded') and (
    new.tenant_id is distinct from old.tenant_id
    or new.version_number is distinct from old.version_number
    or new.source_version_id is distinct from old.source_version_id
    or new.source_sha256 is distinct from old.source_sha256
    or new.manifest_json is distinct from old.manifest_json
    or (old.status='validated' and new.status not in ('validated','published'))
    or (old.status='published' and new.status not in ('published','superseded'))
    or (old.status='superseded' and new.status<>'superseded')
    or (old.status='published' and new.effective_from is distinct from old.effective_from)
    or (old.status='superseded' and new.effective_from is distinct from old.effective_from)
  ) then raise exception 'published_configuration_immutable' using errcode='23514'; end if;
  if new.status in ('validated','published','superseded') and (
    (new.status in ('published','superseded') and new.effective_from is null)
    or pg_catalog.jsonb_typeof(new.manifest_json)<>'object'
    or case when pg_catalog.jsonb_typeof(new.manifest_json->'workTypes')='array'
      then pg_catalog.jsonb_array_length(new.manifest_json->'workTypes')=0 else true end
  ) then raise exception 'invalid_configuration_manifest' using errcode='23514'; end if;
  return new;
end $$;
create or replace function d5o_hosted.guard_configuration_child_v1()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_old uuid;v_new uuid;
begin
  if tg_op<>'INSERT' then v_old:=old.configuration_version_id; end if;
  if tg_op<>'DELETE' then v_new:=new.configuration_version_id; end if;
  if exists(select 1 from d5o_hosted.configuration_versions v
    where v.id in (v_old,v_new) and v.status in ('validated','published','superseded')) then
    raise exception 'published_configuration_immutable' using errcode='23514'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger d5o_hosted_handoff_route_guard
before insert or update or delete on d5o_hosted.configuration_handoff_roles
for each row execute function d5o_hosted.guard_configuration_child_v1();

-- Retire the immediate editor. Its old receipts and events remain historical.
revoke all on function public.d5o_hosted_configure_handoff_route_v1(text,uuid,text,text,integer,text)
  from public,anon,authenticated;

create table d5o_hosted.handoff_configuration_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references d5o_hosted.workspaces(id),
  configuration_version_id uuid not null references d5o_hosted.configuration_versions(id),
  action text not null check(action in ('create-draft','save-route','publish','activate')),
  route_key text, prior_role text, receiving_role text,
  actor_user_id uuid not null references auth.users(id),
  membership_id uuid not null references d5o_hosted.memberships(id),
  command_id text not null,
  occurred_at timestamptz not null default now(),
  unique(workspace_id,command_id)
);
create table d5o_hosted.handoff_configuration_receipts (
  workspace_id uuid not null references d5o_hosted.workspaces(id),
  command_id text not null,
  actor_user_id uuid not null references auth.users(id),
  fingerprint text not null,
  result jsonb not null,
  primary key(workspace_id,command_id)
);
alter table d5o_hosted.handoff_configuration_events enable row level security;
alter table d5o_hosted.handoff_configuration_receipts enable row level security;
revoke all on d5o_hosted.handoff_configuration_events,d5o_hosted.handoff_configuration_receipts
  from public,anon,authenticated;

create function public.d5o_hosted_handoff_configuration_v1(p_workspace_key text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
  v_tenant d5o_hosted.configuration_tenants%rowtype;v_result jsonb;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null then
    raise exception 'handoff_route_admin_required' using errcode='42501'; end if;
  select * into v_workspace from d5o_hosted.workspaces where workspace_key=p_workspace_key and status='active';
  if not found or not exists(select 1 from d5o_hosted.memberships m
    where m.workspace_id=v_workspace.id and m.actor_user_id=v_actor and m.status='active' and m.role='admin') then
    raise exception 'handoff_route_admin_required' using errcode='42501'; end if;
  select * into v_tenant from d5o_hosted.configuration_tenants
    where workspace_id=v_workspace.id and status='active';
  if not found then raise exception 'handoff_configuration_unavailable' using errcode='23514'; end if;
  select pg_catalog.jsonb_build_object(
    'versions',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',v.id,'version',v.version_number,'status',v.status,'sourceVersionId',v.source_version_id,
      'routes',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'key',r.route_key,'role',r.receiving_role,'revision',r.revision,
        'eligibleCount',(select count(*) from d5o_hosted.memberships m
          where m.workspace_id=v_workspace.id and m.status='active' and m.role=r.receiving_role))
        order by r.route_key) from d5o_hosted.configuration_handoff_roles r
        where r.configuration_version_id=v.id),'[]'::jsonb)) order by v.version_number desc)
      from d5o_hosted.configuration_versions v where v.tenant_id=v_tenant.id
        and v.status in ('draft','validated','published')),'[]'::jsonb),
    'workTypes',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'key',t.work_type_key,'name',t.display_name) order by t.display_name)
      from d5o_hosted.configuration_work_types t join d5o_hosted.configuration_versions v
        on v.id=t.configuration_version_id
      where v.tenant_id=v_tenant.id and v.status='published' and t.status='active'),'[]'::jsonb))
    into v_result;
  return v_result;
end $$;
revoke all on function public.d5o_hosted_handoff_configuration_v1(text) from public,anon;
grant execute on function public.d5o_hosted_handoff_configuration_v1(text) to authenticated;

create function public.d5o_hosted_handoff_configuration_command_v1(
  p_workspace_key text,p_action text,p_version uuid,p_route text,p_role text,
  p_expected_revision integer,p_command_id text
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
  v_member d5o_hosted.memberships%rowtype;v_tenant d5o_hosted.configuration_tenants%rowtype;
  v_active d5o_hosted.configuration_versions%rowtype;v_version d5o_hosted.configuration_versions%rowtype;
  v_receipt d5o_hosted.handoff_configuration_receipts%rowtype;
  v_prior_role text;v_current_revision integer;v_result jsonb;v_routes jsonb;
  v_fingerprint text;v_new_id uuid;v_route record;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or p_action not in ('create-draft','save-route','publish','activate')
    or p_version is null or p_expected_revision is null or p_expected_revision<0
    or length(coalesce(p_command_id,'')) not between 8 and 120
    or (p_action='save-route' and (p_route not in ('discoverDefine','designDeploy','deployOperate')
      or p_role not in ('admin','operations_leader','project_manager')
      or (p_route='deployOperate' and p_role<>'operations_leader')))
    or (p_action<>'save-route' and (p_route is not null or p_role is not null or p_expected_revision<>0))
  then raise exception 'invalid_handoff_configuration_command' using errcode='22023'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active' for share;
  if not found then raise exception 'handoff_route_admin_required' using errcode='42501'; end if;
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor and status='active' and role='admin' for share;
  if not found then raise exception 'handoff_route_admin_required' using errcode='42501'; end if;
  select * into v_tenant from d5o_hosted.configuration_tenants
    where workspace_id=v_workspace.id and status='active' for update;
  if not found then raise exception 'handoff_configuration_unavailable' using errcode='23514'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_workspace_key,p_action,p_version,
    p_route,p_role,p_expected_revision)::text);
  select * into v_receipt from d5o_hosted.handoff_configuration_receipts
    where workspace_id=v_workspace.id and command_id=p_command_id;
  if found then
    if v_receipt.actor_user_id<>v_actor or v_receipt.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_receipt.result;
  end if;
  select * into v_active from d5o_hosted.configuration_versions
    where tenant_id=v_tenant.id and status='published'
      and effective_from<=now() and (effective_to is null or effective_to>now()) for update;
  if not found then raise exception 'handoff_configuration_unavailable' using errcode='23514'; end if;
  if p_action='create-draft' then
    if p_version<>v_active.id or exists(select 1 from d5o_hosted.configuration_versions
      where tenant_id=v_tenant.id and status in ('draft','validated')) then
      raise exception 'stale_handoff_configuration' using errcode='23505'; end if;
    insert into d5o_hosted.configuration_versions(tenant_id,version_number,status,source_sha256,
      manifest_json,source_version_id)
      values(v_tenant.id,(select max(version_number)+1 from d5o_hosted.configuration_versions
        where tenant_id=v_tenant.id),'draft',v_active.source_sha256,v_active.manifest_json,v_active.id)
      returning id into v_new_id;
    insert into d5o_hosted.configuration_work_types(configuration_version_id,work_type_key,display_name,status)
      select v_new_id,work_type_key,display_name,status from d5o_hosted.configuration_work_types
      where configuration_version_id=v_active.id;
    insert into d5o_hosted.configuration_create_rights(configuration_version_id,work_type_key,workspace_role)
      select v_new_id,work_type_key,workspace_role from d5o_hosted.configuration_create_rights
      where configuration_version_id=v_active.id;
    insert into d5o_hosted.configuration_handoff_roles(configuration_version_id,route_key,receiving_role,revision,configured_by)
      select v_new_id,route_key,receiving_role,1,v_actor from d5o_hosted.configuration_handoff_roles
      where configuration_version_id=v_active.id;
    v_result:=pg_catalog.jsonb_build_object('versionId',v_new_id,'status','draft');
  else
    select * into v_version from d5o_hosted.configuration_versions
      where id=p_version and tenant_id=v_tenant.id and source_version_id=v_active.id for update;
    if not found then raise exception 'stale_handoff_configuration' using errcode='23505'; end if;
    if p_action='save-route' then
      if v_version.status<>'draft' then raise exception 'handoff_draft_required' using errcode='23514'; end if;
      select receiving_role,revision into v_prior_role,v_current_revision
        from d5o_hosted.configuration_handoff_roles
        where configuration_version_id=v_version.id and route_key=p_route for update;
      if coalesce(v_current_revision,0)<>p_expected_revision then
        raise exception 'stale_handoff_route' using errcode='23505'; end if;
      if v_current_revision is null then
        insert into d5o_hosted.configuration_handoff_roles(configuration_version_id,route_key,receiving_role,revision,configured_by)
          values(v_version.id,p_route,p_role,1,v_actor);
      else
        update d5o_hosted.configuration_handoff_roles set receiving_role=p_role,
          revision=revision+1,configured_by=v_actor,updated_at=now()
          where configuration_version_id=v_version.id and route_key=p_route;
      end if;
      v_result:=pg_catalog.jsonb_build_object('versionId',v_version.id,'status','draft',
        'route',p_route,'role',p_role,'revision',p_expected_revision+1);
    elsif p_action='publish' then
      if v_version.status<>'draft' or (select count(*) from d5o_hosted.configuration_handoff_roles
        where configuration_version_id=v_version.id)<>3 then
        raise exception 'incomplete_handoff_routes' using errcode='23514'; end if;
      for v_route in select route_key,receiving_role from d5o_hosted.configuration_handoff_roles
        where configuration_version_id=v_version.id loop
        if not exists(select 1 from d5o_hosted.memberships m where m.workspace_id=v_workspace.id
          and m.status='active' and m.role=v_route.receiving_role) then
          raise exception 'configured_receiver_unavailable' using errcode='23514'; end if;
      end loop;
      select pg_catalog.jsonb_object_agg(route_key,receiving_role) into v_routes
        from d5o_hosted.configuration_handoff_roles where configuration_version_id=v_version.id;
      update d5o_hosted.configuration_versions set status='validated',
        source_sha256=pg_catalog.encode(extensions.digest(v_active.source_sha256||v_routes::text,'sha256'),'hex'),
        manifest_json=v_version.manifest_json||pg_catalog.jsonb_build_object('d5oPresentation',
          coalesce(v_version.manifest_json->'d5oPresentation','{}'::jsonb)||
          pg_catalog.jsonb_build_object('handoffRoles',v_routes))
        where id=v_version.id;
      v_result:=pg_catalog.jsonb_build_object('versionId',v_version.id,'status','validated');
    elsif p_action='activate' then
      if v_version.status<>'validated' then
        raise exception 'validated_handoff_configuration_required' using errcode='23514'; end if;
      update d5o_hosted.configuration_versions set status='superseded',effective_to=now()
        where id=v_active.id;
      update d5o_hosted.configuration_versions set status='published',effective_from=now()
        where id=v_version.id;
      v_result:=pg_catalog.jsonb_build_object('versionId',v_version.id,'status','published',
        'supersededVersionId',v_active.id);
    end if;
  end if;
  insert into d5o_hosted.handoff_configuration_events(workspace_id,configuration_version_id,
    action,route_key,prior_role,receiving_role,actor_user_id,membership_id,command_id)
    values(v_workspace.id,coalesce(v_new_id,v_version.id),p_action,p_route,v_prior_role,p_role,
      v_actor,v_member.id,p_command_id);
  insert into d5o_hosted.handoff_configuration_receipts(workspace_id,command_id,actor_user_id,fingerprint,result)
    values(v_workspace.id,p_command_id,v_actor,v_fingerprint,v_result);
  return v_result;
end $$;
revoke all on function public.d5o_hosted_handoff_configuration_command_v1(text,text,uuid,text,text,integer,text)
  from public,anon;
grant execute on function public.d5o_hosted_handoff_configuration_command_v1(text,text,uuid,text,text,integer,text)
  to authenticated;
