-- Phase 2B extends the hosted workspace/configuration/identity authorities.
-- Existing pilot workspaces are not enrolled in this lifecycle.
create table d5o_hosted.configuration_templates (
  id uuid primary key default gen_random_uuid(), template_key text not null unique
    check(template_key ~ '^[a-z][a-z0-9_-]{2,63}$'),
  name text not null check(length(trim(name)) between 3 and 120),
  description text not null default '', status text not null default 'active'
    check(status in ('active','retired')),
  created_at timestamptz not null default now()
);
create table d5o_hosted.configuration_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references d5o_hosted.configuration_templates(id),
  version_number integer not null check(version_number>0),
  status text not null check(status in ('draft','validated','published')),
  schema_version integer not null default 1 check(schema_version=1),
  manifest_json jsonb not null check(jsonb_typeof(manifest_json)='object'),
  work_types_json jsonb not null check(jsonb_typeof(work_types_json)='array'),
  create_roles_json jsonb not null check(jsonb_typeof(create_roles_json)='array'),
  routes_json jsonb not null check(jsonb_typeof(routes_json)='object'),
  source_sha256 text not null check(source_sha256 ~ '^[0-9a-f]{64}$'),
  validated_at timestamptz,published_at timestamptz,published_by uuid references auth.users(id),
  created_at timestamptz not null default now(),unique(template_id,version_number)
);
create table d5o_hosted.platform_command_receipts (
  command_id text primary key,actor_user_id uuid not null references auth.users(id),
  fingerprint text not null,result jsonb not null,created_at timestamptz not null default now()
);
create table d5o_hosted.platform_events (
  id uuid primary key default gen_random_uuid(),command_id text not null,
  actor_user_id uuid not null references auth.users(id),workspace_id uuid references d5o_hosted.workspaces(id),
  template_version_id uuid references d5o_hosted.configuration_template_versions(id),
  action text not null,reason text not null,before_state jsonb,after_state jsonb,
  occurred_at timestamptz not null default now()
);
create table d5o_hosted.tenant_provisioning (
  workspace_id uuid primary key references d5o_hosted.workspaces(id),
  request_id text not null unique check(length(request_id) between 8 and 120),
  request_fingerprint text not null,
  template_version_id uuid not null references d5o_hosted.configuration_template_versions(id),
  configuration_version_id uuid not null references d5o_hosted.configuration_versions(id),
  country text not null check(country ~ '^[A-Z]{2}$'),
  initial_admin_email text not null,initial_invitation_id text not null,
  lifecycle text not null check(lifecycle in
    ('awaiting_admin','setup_required','ready','active','suspended','failed')),
  created_by uuid not null references auth.users(id),revision integer not null default 1,
  failure_code text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  activated_at timestamptz,unique(workspace_id,initial_invitation_id)
);
alter table d5o_hosted.configuration_versions
  add column source_template_version_id uuid references d5o_hosted.configuration_template_versions(id);
alter table d5o_hosted.admin_identity_requests
  add column provisioning_workspace_id uuid references d5o_hosted.tenant_provisioning(workspace_id);
-- Invitation row and provisioning row are created in one transaction; FK is deferred.
alter table d5o_hosted.admin_identity_requests drop constraint admin_identity_requests_provisioning_workspace_id_fkey;
alter table d5o_hosted.admin_identity_requests add constraint admin_identity_requests_provisioning_workspace_id_fkey
  foreign key(provisioning_workspace_id) references d5o_hosted.tenant_provisioning(workspace_id)
  deferrable initially deferred;
alter table d5o_hosted.admin_identity_requests drop constraint admin_identity_requests_role_check;
alter table d5o_hosted.admin_identity_requests add constraint admin_identity_requests_role_check
  check ((action='invite' and (requested_role is null or requested_role in
    ('executive','operations_leader','business_development_lead','project_manager',
     'billing_commercial_lead','field_supervisor','closeout_lead','read_only_auditor') or
     (requested_role='admin' and provisioning_workspace_id=workspace_id)))
    or (action='recovery' and requested_role is null));
create unique index hosted_initial_admin_offer_v1 on d5o_hosted.admin_identity_requests(provisioning_workspace_id)
  where provisioning_workspace_id is not null and status not in ('revoked','provider_rejected');

alter table d5o_hosted.configuration_templates enable row level security;
alter table d5o_hosted.configuration_template_versions enable row level security;
alter table d5o_hosted.platform_command_receipts enable row level security;
alter table d5o_hosted.platform_events enable row level security;
alter table d5o_hosted.tenant_provisioning enable row level security;
revoke all on d5o_hosted.configuration_templates,d5o_hosted.configuration_template_versions,
  d5o_hosted.platform_command_receipts,d5o_hosted.platform_events,d5o_hosted.tenant_provisioning
  from public,anon,authenticated,service_role;

create function d5o_hosted.template_payload_valid_v1(
  p_manifest jsonb,p_types jsonb,p_roles jsonb,p_routes jsonb
) returns boolean language sql immutable set search_path='' as $$
  select pg_catalog.jsonb_typeof(p_manifest)='object'
    and p_manifest->'workTypes'=p_types
    and pg_catalog.jsonb_typeof(p_types)='array' and pg_catalog.jsonb_array_length(p_types) between 1 and 8
    and pg_catalog.jsonb_typeof(p_roles)='array' and pg_catalog.jsonb_array_length(p_roles)>0
    and p_roles ? 'admin'
    and pg_catalog.jsonb_typeof(p_routes)='object'
    and p_routes ? 'discoverDefine' and p_routes ? 'designDeploy' and p_routes ? 'deployOperate'
    and p_manifest#>'{d5oPresentation,handoffRoles}'=p_routes
    and p_manifest#>>'{d5oPresentation,phaseContract,schemaVersion}'='1'
    and pg_catalog.jsonb_typeof(p_manifest#>'{d5oPresentation,phaseContract,workTypes}')='array'
    and pg_catalog.jsonb_array_length(p_manifest#>'{d5oPresentation,phaseContract,workTypes}')=
      pg_catalog.jsonb_array_length(p_types)
    and not exists(select 1 from pg_catalog.jsonb_each_text(p_routes) r where r.value<>'admin')
    and not exists(select 1 from pg_catalog.jsonb_array_elements(p_types) t
      where t->>'key' !~ '^[a-z][a-z0-9_-]{1,63}$' or length(coalesce(t->>'label','')) not between 2 and 120)
    and not exists(select 1 from pg_catalog.jsonb_array_elements(p_manifest#>'{d5oPresentation,phaseContract,workTypes}') t
      where (select pg_catalog.jsonb_agg(p->>'key' order by n)
        from pg_catalog.jsonb_array_elements(t->'phases') with ordinality p(p,n))
          <> '["discover","define","develop","design","deploy","operate"]'::jsonb)
    and not (p_manifest ? 'serviceWorkApproval');
$$;
revoke all on function d5o_hosted.template_payload_valid_v1(jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;

create function d5o_hosted.template_immutability_v1() returns trigger language plpgsql set search_path='' as $$
begin
  if old.status='published' then raise exception 'published_template_immutable' using errcode='23514'; end if;
  return new;
end $$;

-- New tenants cannot create executable Work until the governed activation.
-- Pilot workspaces have no provisioning row and retain their existing behavior.
create function d5o_hosted.require_active_provisioning_v1() returns trigger
language plpgsql set search_path='' as $$
begin
  if exists(select 1 from d5o_hosted.tenant_provisioning p
    where p.workspace_id=new.workspace_id and p.lifecycle<>'active') then
    raise exception 'tenant_not_active' using errcode='42501'; end if;
  return new;
end $$;
create trigger work_requires_active_provisioning before insert on d5o_hosted.work_records
  for each row execute function d5o_hosted.require_active_provisioning_v1();

create function public.d5o_platform_templates_v1() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null or not exists
    (select 1 from d5o_hosted.platform_administrators where actor_user_id=v_actor and status='active') then
    raise exception 'platform_administrator_required' using errcode='42501'; end if;
  return coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',v.id,'templateKey',t.template_key,'name',t.name,'description',t.description,
    'templateStatus',t.status,'version',v.version_number,'status',v.status,
    'schemaVersion',v.schema_version,'publishedAt',v.published_at,
    'valid',d5o_hosted.template_payload_valid_v1(v.manifest_json,v.work_types_json,
      v.create_roles_json,v.routes_json),
    'usage',(select count(*) from d5o_hosted.tenant_provisioning p where p.template_version_id=v.id))
    order by t.name,v.version_number desc) from d5o_hosted.configuration_templates t
    join d5o_hosted.configuration_template_versions v on v.template_id=t.id),'[]'::jsonb);
end $$;
revoke all on function public.d5o_platform_templates_v1() from public,anon,service_role;
grant execute on function public.d5o_platform_templates_v1() to authenticated;

create function public.d5o_platform_provision_v1(
  p_request_id text,p_workspace_key text,p_legal_name text,p_display_name text,
  p_admin_email text,p_country text,p_time_zone text,p_currency text,
  p_template_version_id uuid,p_reason text
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_template d5o_hosted.configuration_template_versions%rowtype;
  v_workspace uuid:=gen_random_uuid();v_tenant uuid:=gen_random_uuid();v_version uuid:=gen_random_uuid();
  v_user uuid;v_invite text;v_offer_status text;v_fp text;v_prior d5o_hosted.platform_command_receipts%rowtype;
  v_result jsonb;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null or not exists
    (select 1 from d5o_hosted.platform_administrators where actor_user_id=v_actor and status='active') then
    raise exception 'platform_administrator_required' using errcode='42501'; end if;
  if length(coalesce(p_request_id,'')) not between 8 and 120 or
    p_workspace_key !~ '^[a-z][a-z0-9_-]{2,63}$' or
    length(trim(coalesce(p_legal_name,''))) not between 2 and 120 or
    length(trim(coalesce(p_display_name,''))) not between 2 and 120 or
    lower(trim(coalesce(p_admin_email,''))) !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' or
    p_country !~ '^[A-Z]{2}$' or length(coalesce(p_time_zone,'')) not between 3 and 64 or
    p_currency !~ '^[A-Z]{3}$' or length(trim(coalesce(p_reason,''))) not between 8 and 500 then
    raise exception 'invalid_provisioning_request' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('d5o-provision:'||p_request_id,0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('d5o-key:'||p_workspace_key,0));
  v_fp:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_workspace_key,trim(p_legal_name),
    trim(p_display_name),lower(trim(p_admin_email)),p_country,p_time_zone,p_currency,
    p_template_version_id,trim(p_reason))::text);
  select * into v_prior from d5o_hosted.platform_command_receipts where command_id=p_request_id;
  if found then
    if v_prior.actor_user_id<>v_actor or v_prior.fingerprint<>v_fp then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_prior.result;
  end if;
  if exists(select 1 from d5o_hosted.workspaces where workspace_key=p_workspace_key) then
    raise exception 'tenant_key_exists' using errcode='23505'; end if;
  select v.* into v_template from d5o_hosted.configuration_template_versions v
    join d5o_hosted.configuration_templates t on t.id=v.template_id
    where v.id=p_template_version_id and v.status='published' and t.status='active';
  if not found or not d5o_hosted.template_payload_valid_v1(v_template.manifest_json,
    v_template.work_types_json,v_template.create_roles_json,v_template.routes_json) then
    raise exception 'template_not_published' using errcode='23514'; end if;
  select id into v_user from auth.users where lower(email)=lower(trim(p_admin_email))
    and email_confirmed_at is not null limit 1;
  v_offer_status:=case when v_user is null then 'pending' else 'existing_confirmed' end;
  v_invite:='initial:'||p_request_id;
  insert into d5o_hosted.workspaces(id,workspace_key,display_name,legal_name,
    primary_contact_email,time_zone,default_currency,status)
    values(v_workspace,p_workspace_key,trim(p_display_name),trim(p_legal_name),
      lower(trim(p_admin_email)),p_time_zone,p_currency,'active');
  insert into d5o_hosted.configuration_tenants(id,workspace_id,status) values(v_tenant,v_workspace,'active');
  insert into d5o_hosted.configuration_versions(id,tenant_id,version_number,status,
    source_sha256,manifest_json,effective_from,source_template_version_id)
    values(v_version,v_tenant,1,'draft',v_template.source_sha256,
      v_template.manifest_json,null,v_template.id);
  insert into d5o_hosted.configuration_work_types(configuration_version_id,work_type_key,display_name,status)
    select v_version,t->>'key',t->>'label','active' from pg_catalog.jsonb_array_elements(v_template.work_types_json) t;
  insert into d5o_hosted.configuration_create_rights(configuration_version_id,work_type_key,workspace_role)
    select v_version,t->>'key',r #>> '{}' from pg_catalog.jsonb_array_elements(v_template.work_types_json) t
      cross join pg_catalog.jsonb_array_elements(v_template.create_roles_json) r;
  insert into d5o_hosted.configuration_handoff_roles(configuration_version_id,route_key,receiving_role,revision,configured_by)
    select v_version,key,value #>> '{}',1,v_actor from pg_catalog.jsonb_each(v_template.routes_json);
  update d5o_hosted.configuration_versions set status='published',effective_from=now()
    where id=v_version;
  insert into d5o_hosted.tenant_provisioning(workspace_id,request_id,request_fingerprint,
    template_version_id,configuration_version_id,country,initial_admin_email,initial_invitation_id,
    lifecycle,created_by)
    values(v_workspace,p_request_id,v_fp,v_template.id,v_version,p_country,lower(trim(p_admin_email)),
      v_invite,'awaiting_admin',v_actor);
  insert into d5o_hosted.admin_identity_requests(workspace_id,command_id,actor_user_id,
    action,target_email,reason,fingerprint,status,provider_user_id,requested_role,
    expires_at,provisioning_workspace_id)
    values(v_workspace,v_invite,v_actor,'invite',lower(trim(p_admin_email)),trim(p_reason),v_fp,
      v_offer_status,v_user,'admin',now()+interval '14 days',v_workspace);
  v_result:=pg_catalog.jsonb_build_object('workspaceId',v_workspace,'workspaceKey',p_workspace_key,
    'configurationVersionId',v_version,'templateVersionId',v_template.id,
    'invitationId',v_invite,'invitationStatus',v_offer_status,
    'adminEmail',lower(trim(p_admin_email)),'lifecycle','awaiting_admin');
  insert into d5o_hosted.platform_events(command_id,actor_user_id,workspace_id,template_version_id,
    action,reason,after_state) values(p_request_id,v_actor,v_workspace,v_template.id,
    'tenant.provision',trim(p_reason),v_result);
  insert into d5o_hosted.platform_command_receipts(command_id,actor_user_id,fingerprint,result)
    values(p_request_id,v_actor,v_fp,v_result);
  return v_result;
end $$;
revoke all on function public.d5o_platform_provision_v1(text,text,text,text,text,text,text,text,uuid,text)
  from public,anon,service_role;
grant execute on function public.d5o_platform_provision_v1(text,text,text,text,text,text,text,text,uuid,text)
  to authenticated;
create trigger template_version_immutable before update or delete on d5o_hosted.configuration_template_versions
  for each row execute function d5o_hosted.template_immutability_v1();

-- Seed two named, validated starting contracts. Neither contains a customer
-- approval threshold: each customer must publish its own value before activation.
do $$
declare v_types jsonb;v_phases jsonb;v_routes jsonb;v_manifest jsonb;v_service_types jsonb;
  v_template uuid;v_actor uuid;
begin
  v_types:='[{"key":"technical-delivery","label":"Technical Delivery","status":"active","templateKey":"technical-delivery"},{"key":"lifecycle-service","label":"Lifecycle Service","status":"active","templateKey":"lifecycle-service"}]'::jsonb;
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('key',p,'label',p,'purpose',p||' work') order by n)
    into v_phases from pg_catalog.unnest(array['discover','define','develop','design','deploy','operate']) with ordinality x(p,n);
  v_routes:='{"discoverDefine":"admin","designDeploy":"admin","deployOperate":"admin"}'::jsonb;
  select pg_catalog.jsonb_build_object('workTypes',v_types,'d5oPresentation',
    pg_catalog.jsonb_build_object('schemaVersion',1,'handoffRoles',v_routes,'phaseContract',
      pg_catalog.jsonb_build_object('schemaVersion',1,'workTypes',pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object('workTypeKey',t->>'key','workTypeLabel',t->>'label',
          'version','prototype-v2','phases',v_phases,
          'designControls',pg_catalog.jsonb_build_object('reviewLeadDays',2,'procurementBufferDays',2),
          'deployControls',pg_catalog.jsonb_build_object('fieldStartLeadMinutes',10,'maxActualHoursPerShift',12),
          'operateControls',pg_catalog.jsonb_build_object('timezone','America/New_York','defaultResponseHours',24)) order by n)))) into v_manifest
    from pg_catalog.jsonb_array_elements(v_types) with ordinality x(t,n);
  if not d5o_hosted.template_payload_valid_v1(v_manifest,v_types,'["admin"]'::jsonb,v_routes) then
    raise exception 'seed_template_invalid'; end if;
  insert into d5o_hosted.configuration_templates(template_key,name,description)
    values('standard-d5o','Standard D5O','Baseline six-phase work types and admin handoffs') returning id into v_template;
  insert into d5o_hosted.configuration_template_versions(template_id,version_number,status,manifest_json,
    work_types_json,create_roles_json,routes_json,source_sha256,validated_at,published_at)
    values(v_template,1,'published',v_manifest,v_types,'["admin"]'::jsonb,v_routes,
      pg_catalog.encode(extensions.digest(v_manifest::text,'sha256'),'hex'),now(),now());
  v_service_types:=pg_catalog.jsonb_build_array(v_types->1);
  v_manifest:=pg_catalog.jsonb_set(pg_catalog.jsonb_set(v_manifest,'{workTypes}',v_service_types),
    '{d5oPresentation,phaseContract,workTypes}',
    pg_catalog.jsonb_build_array(v_manifest#>'{d5oPresentation,phaseContract,workTypes,1}'));
  if not d5o_hosted.template_payload_valid_v1(v_manifest,v_service_types,'["admin"]'::jsonb,v_routes) then
    raise exception 'service_template_invalid'; end if;
  insert into d5o_hosted.configuration_templates(template_key,name,description)
    values('service-operations','Service Operations','Six-phase service work; tenant approval policy required before activation') returning id into v_template;
  insert into d5o_hosted.configuration_template_versions(template_id,version_number,status,manifest_json,
    work_types_json,create_roles_json,routes_json,source_sha256,validated_at,published_at)
    values(v_template,1,'published',v_manifest,v_service_types,'["admin"]'::jsonb,v_routes,
      pg_catalog.encode(extensions.digest(v_manifest::text,'sha256'),'hex'),now(),now());
end $$;
