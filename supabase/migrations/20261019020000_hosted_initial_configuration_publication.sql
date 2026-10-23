-- First hosted configuration publication. No default tenant or creation right is fabricated.
-- The administrator reviews the complete source and eligible receiving roles before one
-- atomic typed command installs the first immutable, pinned version.
create table d5o_hosted.initial_configuration_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references d5o_hosted.workspaces(id),
  tenant_id uuid not null references d5o_hosted.configuration_tenants(id),
  version_id uuid not null references d5o_hosted.configuration_versions(id),
  actor_user_id uuid not null references auth.users(id),
  membership_id uuid not null references d5o_hosted.memberships(id),
  command_id text not null,
  reason text not null,
  manifest_sha256 text not null,
  published_at timestamptz not null default now(),
  unique (workspace_id, command_id)
);
create table d5o_hosted.initial_configuration_receipts (
  workspace_id uuid not null references d5o_hosted.workspaces(id),
  command_id text not null,
  actor_user_id uuid not null references auth.users(id),
  fingerprint text not null,
  result jsonb not null,
  primary key (workspace_id, command_id)
);
alter table d5o_hosted.initial_configuration_events enable row level security;
alter table d5o_hosted.initial_configuration_receipts enable row level security;
revoke all on d5o_hosted.initial_configuration_events,
  d5o_hosted.initial_configuration_receipts from public, anon, authenticated;

create function public.d5o_hosted_publish_initial_configuration_v1(
  p_workspace_key text, p_command_id text, p_manifest jsonb,
  p_work_types jsonb, p_create_roles jsonb, p_routes jsonb, p_reason text
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_workspace d5o_hosted.workspaces%rowtype;
  v_member d5o_hosted.memberships%rowtype;
  v_receipt d5o_hosted.initial_configuration_receipts%rowtype;
  v_tenant uuid := gen_random_uuid();
  v_version uuid := gen_random_uuid();
  v_digest text;
  v_fingerprint text;
  v_result jsonb;
  v_type jsonb;
  v_contract_type jsonb;
  v_role text;
  v_route text;
  v_type_key text;
  v_type_label text;
  v_supported text[];
  v_phase_keys jsonb;
begin
  if current_setting('role', true) <> 'authenticated' or v_actor is null then
    raise exception 'configuration_admin_required' using errcode='42501';
  end if;
  if length(coalesce(p_command_id,'')) not between 8 and 120
    or length(trim(coalesce(p_reason,''))) not between 8 and 240
    or pg_catalog.jsonb_typeof(p_manifest) <> 'object'
    or pg_catalog.jsonb_typeof(p_work_types) <> 'array'
    or pg_catalog.jsonb_typeof(p_create_roles) <> 'array'
    or pg_catalog.jsonb_typeof(p_routes) <> 'object'
  then raise exception 'invalid_initial_configuration' using errcode='22023'; end if;

  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active' for update;
  if not found then raise exception 'configuration_admin_required' using errcode='42501'; end if;
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor
      and status='active' and role='admin' for share;
  if not found then raise exception 'configuration_admin_required' using errcode='42501'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(
    p_workspace_key,p_manifest,p_work_types,p_create_roles,p_routes,trim(p_reason))::text);
  select * into v_receipt from d5o_hosted.initial_configuration_receipts
    where workspace_id=v_workspace.id and command_id=p_command_id;
  if found then
    if v_receipt.actor_user_id<>v_actor or v_receipt.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_receipt.result;
  end if;

  if exists(select 1 from d5o_hosted.configuration_tenants
      where workspace_id=v_workspace.id)
    or exists(select 1 from d5o_hosted.work_records
      where workspace_id=v_workspace.id) then
    raise exception 'initial_configuration_already_exists' using errcode='23505';
  end if;
  v_supported:=case p_workspace_key
    when 'rybex' then array['technical-delivery','lifecycle-service']
    when 'rotork' then array['modernization-service','lifecycle-service']
    else null end;
  if v_supported is null or pg_catalog.jsonb_array_length(p_work_types)<>2
    or p_manifest->'workTypes'<>p_work_types
    or p_manifest#>>'{d5oPresentation,schemaVersion}'<>'1'
    or p_manifest#>>'{d5oPresentation,phaseContract,schemaVersion}'<>'1'
    or pg_catalog.jsonb_typeof(p_manifest#>'{d5oPresentation,phaseContract,workTypes}')<>'array'
    or pg_catalog.jsonb_array_length(p_manifest#>'{d5oPresentation,phaseContract,workTypes}')<>2
    or p_manifest#>'{d5oPresentation,handoffRoles}'<>p_routes
    or (select count(*) from pg_catalog.jsonb_object_keys(p_routes))<>3
    or pg_catalog.jsonb_array_length(p_create_roles)=0
  then raise exception 'invalid_initial_configuration' using errcode='22023'; end if;

  for v_type in select value from pg_catalog.jsonb_array_elements(p_work_types) loop
    v_type_key:=v_type->>'key'; v_type_label:=v_type->>'label';
    if v_type_key is null or v_type_key<>all(v_supported)
      or length(trim(coalesce(v_type_label,''))) not between 2 and 120 then
      raise exception 'unsupported_work_type' using errcode='22023'; end if;
    select value into v_contract_type from pg_catalog.jsonb_array_elements(
      p_manifest#>'{d5oPresentation,phaseContract,workTypes}')
      where value->>'workTypeKey'=v_type_key;
    if not found or v_contract_type->>'workTypeLabel'<>v_type_label
      or v_contract_type->>'version'<>'prototype-v2'
      or pg_catalog.jsonb_typeof(v_contract_type->'phases')<>'array' then
      raise exception 'invalid_phase_contract' using errcode='22023'; end if;
    select pg_catalog.jsonb_agg(phase->'key' order by ordinal)
      into v_phase_keys from pg_catalog.jsonb_array_elements(v_contract_type->'phases')
        with ordinality as stages(phase,ordinal);
    if v_phase_keys<>'["discover","define","develop","design","deploy","operate"]'::jsonb then
      raise exception 'invalid_phase_contract' using errcode='22023'; end if;
  end loop;
  if (select count(distinct value->>'key') from pg_catalog.jsonb_array_elements(p_work_types))<>2
    or (select count(distinct value->>'workTypeKey') from pg_catalog.jsonb_array_elements(
      p_manifest#>'{d5oPresentation,phaseContract,workTypes}'))<>2 then
    raise exception 'invalid_initial_configuration' using errcode='22023'; end if;

  for v_role in select value #>> '{}' from pg_catalog.jsonb_array_elements(p_create_roles) loop
    if v_role not in ('admin','project_manager','business_development_lead',
      'operations_leader','billing_commercial_lead','field_supervisor',
      'closeout_lead','executive') then
      raise exception 'invalid_create_role' using errcode='22023'; end if;
  end loop;
  if (select count(distinct value #>> '{}') from pg_catalog.jsonb_array_elements(p_create_roles))
     <>pg_catalog.jsonb_array_length(p_create_roles) then
    raise exception 'invalid_create_role' using errcode='22023'; end if;

  foreach v_route in array array['discoverDefine','designDeploy','deployOperate'] loop
    v_role:=p_routes->>v_route;
    if v_role not in ('admin','project_manager','operations_leader')
      or not exists(select 1 from d5o_hosted.memberships m
        where m.workspace_id=v_workspace.id and m.status='active' and m.role=v_role) then
      raise exception 'configured_receiver_unavailable' using errcode='23514'; end if;
  end loop;
  if exists(select 1 from pg_catalog.jsonb_object_keys(p_routes) as route(key)
    where route.key not in ('discoverDefine','designDeploy','deployOperate')) then
    raise exception 'invalid_initial_configuration' using errcode='22023'; end if;

  v_digest:=pg_catalog.encode(extensions.digest(p_manifest::text,'sha256'),'hex');
  insert into d5o_hosted.configuration_tenants(id,workspace_id,status)
    values(v_tenant,v_workspace.id,'active');
  insert into d5o_hosted.configuration_versions(
    id,tenant_id,version_number,status,source_sha256,manifest_json)
    values(v_version,v_tenant,1,'draft',v_digest,p_manifest);
  insert into d5o_hosted.configuration_work_types(
    configuration_version_id,work_type_key,display_name,status)
    select v_version,value->>'key',value->>'label','active'
      from pg_catalog.jsonb_array_elements(p_work_types);
  insert into d5o_hosted.configuration_create_rights(
    configuration_version_id,work_type_key,workspace_role)
    select v_version,t.value->>'key',r.value #>> '{}'
      from pg_catalog.jsonb_array_elements(p_work_types) t(value)
      cross join pg_catalog.jsonb_array_elements(p_create_roles) r(value);
  insert into d5o_hosted.configuration_handoff_roles(
    configuration_version_id,route_key,receiving_role,revision,configured_by)
    select v_version,key,value #>> '{}',1,v_actor
      from pg_catalog.jsonb_each(p_routes);
  update d5o_hosted.configuration_versions
    set status='published',effective_from=now() where id=v_version;
  v_result:=pg_catalog.jsonb_build_object('workspaceId',v_workspace.id,
    'tenantId',v_tenant,'versionId',v_version,'version',1,'status','published',
    'manifestSha256',v_digest);
  insert into d5o_hosted.initial_configuration_events(
    workspace_id,tenant_id,version_id,actor_user_id,membership_id,
    command_id,reason,manifest_sha256)
    values(v_workspace.id,v_tenant,v_version,v_actor,v_member.id,
      p_command_id,trim(p_reason),v_digest);
  insert into d5o_hosted.initial_configuration_receipts(
    workspace_id,command_id,actor_user_id,fingerprint,result)
    values(v_workspace.id,p_command_id,v_actor,v_fingerprint,v_result);
  return v_result;
end $$;
revoke all on function public.d5o_hosted_publish_initial_configuration_v1(
  text,text,jsonb,jsonb,jsonb,jsonb,text) from public,anon;
grant execute on function public.d5o_hosted_publish_initial_configuration_v1(
  text,text,jsonb,jsonb,jsonb,jsonb,text) to authenticated;
