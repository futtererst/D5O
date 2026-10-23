-- A pilot Work Record has one canonical hosted UUID. The tenant-prefixed ID is
-- a durable presentation alias, not a second business identity. Creation of
-- the canonical row, alias, draft projection, catalog row and receipt is atomic.
create table d5o_hosted.work_identity_links (
  workspace_id uuid not null references d5o_hosted.workspaces(id),
  work_id uuid not null,
  presentation_id text not null,
  parent_work_id uuid,
  relation_kind text check (relation_kind in ('service_visit', 'maintenance_visit', 'lifecycle_opportunity')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, work_id),
  unique (workspace_id, presentation_id),
  foreign key (work_id, workspace_id) references d5o_hosted.work_records(id, workspace_id),
  foreign key (parent_work_id, workspace_id) references d5o_hosted.work_records(id, workspace_id),
  check ((parent_work_id is null) = (relation_kind is null))
);
create table d5o_hosted.connected_create_receipts (
  workspace_id uuid not null references d5o_hosted.workspaces(id),
  command_id text not null check (length(command_id) between 8 and 120),
  actor_user_id uuid not null references auth.users(id),
  request_fingerprint text not null,
  work_id uuid not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, command_id),
  foreign key (work_id, workspace_id) references d5o_hosted.work_records(id, workspace_id)
);
alter table d5o_hosted.work_identity_links enable row level security;
alter table d5o_hosted.connected_create_receipts enable row level security;
revoke all on d5o_hosted.work_identity_links, d5o_hosted.connected_create_receipts from public, anon, authenticated;

create function public.d5o_hosted_create_connected_work_v1(
  p_workspace_key text, p_command_id text, p_expected_work_revision bigint,
  p_expected_catalog_revision bigint, p_configuration_version_id uuid,
  p_work_type_key text, p_title text, p_customer text, p_site text,
  p_owner text, p_actor_user_id uuid, p_membership_id uuid,
  p_initial_discovery jsonb
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_workspace d5o_hosted.workspaces%rowtype;
  v_membership d5o_hosted.memberships%rowtype;
  v_tenant d5o_hosted.configuration_tenants%rowtype;
  v_version d5o_hosted.configuration_versions%rowtype;
  v_type d5o_hosted.configuration_work_types%rowtype;
  v_work_state d5o_hosted.prototype_states%rowtype;
  v_catalog_state d5o_hosted.prototype_states%rowtype;
  v_receipt d5o_hosted.connected_create_receipts%rowtype;
  v_work_id uuid := gen_random_uuid();
  v_alias text;
  v_fingerprint text;
  v_now timestamptz := now();
  v_record jsonb;
  v_catalog_record jsonb;
  v_next_work jsonb;
  v_next_catalog jsonb;
  v_result jsonb;
begin
  if current_setting('role', true) is distinct from 'service_role'
    or p_actor_user_id is null or p_membership_id is null then
    raise exception 'server_command_required' using errcode='42501';
  end if;
  if p_command_id is null or length(p_command_id) not between 8 and 120
    or p_expected_work_revision is null or p_expected_work_revision < 0
    or p_expected_catalog_revision is null or p_expected_catalog_revision < 0
    or p_configuration_version_id is null or p_work_type_key is null
    or p_title is null or length(trim(p_title)) not between 1 and 240
    or p_customer is null or length(trim(p_customer)) not between 1 and 200
    or p_site is null or length(trim(p_site)) not between 1 and 200
    or p_owner is null or length(trim(p_owner)) not between 1 and 120 then
    raise exception 'invalid_connected_work' using errcode='22023';
  end if;
  if p_initial_discovery is not null and (
    pg_catalog.jsonb_typeof(p_initial_discovery) <> 'object'
    or p_initial_discovery - 'source' - 'need' - 'procurement' - 'closeDate' <> '{}'::jsonb
    or length(coalesce(p_initial_discovery->>'source','')) not between 1 and 120
    or length(coalesce(p_initial_discovery->>'need','')) not between 1 and 3000
    or length(coalesce(p_initial_discovery->>'procurement','')) not between 1 and 120
    or length(coalesce(p_initial_discovery->>'closeDate','')) > 10) then
    raise exception 'invalid_discover_draft' using errcode='22023';
  end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('d5o-connected:' || v_workspace.id::text, 0));
  select * into v_membership from d5o_hosted.memberships
    where id=p_membership_id and workspace_id=v_workspace.id
      and actor_user_id=p_actor_user_id and status='active' for share;
  if not found or v_membership.role not in
    ('admin','project_manager','business_development_lead','operations_leader') then
    raise exception 'create_authority_denied' using errcode='42501';
  end if;
  v_fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_array(
    p_workspace_key,p_configuration_version_id,p_work_type_key,
    trim(p_title),trim(p_customer),trim(p_site),trim(p_owner),p_initial_discovery)::text);
  select * into v_receipt from d5o_hosted.connected_create_receipts
    where workspace_id=v_workspace.id and command_id=p_command_id;
  if found then
    if v_receipt.actor_user_id is distinct from p_actor_user_id
      or v_receipt.request_fingerprint is distinct from v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505';
    end if;
    return v_receipt.result;
  end if;
  select * into v_tenant from d5o_hosted.configuration_tenants
    where workspace_id=v_workspace.id and status='active';
  if not found or (select count(*) from d5o_hosted.configuration_tenants
      where workspace_id=v_workspace.id and status='active') <> 1 then
    raise exception 'configuration_mapping_unavailable' using errcode='22023';
  end if;
  select * into v_version from d5o_hosted.configuration_versions
    where id=p_configuration_version_id and tenant_id=v_tenant.id
      and status='published' and effective_from<=v_now
      and (effective_to is null or effective_to>v_now);
  if not found then raise exception 'configuration_or_right_unavailable' using errcode='42501'; end if;
  select * into v_type from d5o_hosted.configuration_work_types
    where configuration_version_id=v_version.id
      and work_type_key=p_work_type_key and status='active';
  if not found or not exists (
    select 1 from d5o_hosted.configuration_create_rights
      where configuration_version_id=v_version.id
        and work_type_key=p_work_type_key
        and workspace_role=v_membership.role) then
    raise exception 'configuration_or_right_unavailable' using errcode='42501';
  end if;
  select * into v_work_state from d5o_hosted.prototype_states
    where workspace_id=v_workspace.id and state_key='work' for update;
  select * into v_catalog_state from d5o_hosted.prototype_states
    where workspace_id=v_workspace.id and state_key='catalog' for update;
  if coalesce(v_work_state.revision,0) <> p_expected_work_revision
    or coalesce(v_catalog_state.revision,0) <> p_expected_catalog_revision then
    raise exception 'stale_state' using errcode='23505';
  end if;
  if (v_work_state.revision is not null and
      pg_catalog.jsonb_typeof(v_work_state.state_json->'records') <> 'array')
    or (v_catalog_state.revision is not null and
      pg_catalog.jsonb_typeof(v_catalog_state.state_json->'records') <> 'array') then
    raise exception 'invalid_state' using errcode='22023';
  end if;
  v_alias := p_workspace_key || '-' || pg_catalog.replace(v_work_id::text,'-','');
  insert into d5o_hosted.work_records(id,workspace_id,configuration_tenant_id,
    configuration_version_id,configuration_digest,work_type_key,title,created_by)
  values(v_work_id,v_workspace.id,v_tenant.id,v_version.id,v_version.source_sha256,
    p_work_type_key,trim(p_title),p_actor_user_id);
  insert into d5o_hosted.work_events(workspace_id,work_id,event_type,record_version,
    actor_user_id,membership_id,authority_role,configuration_version_id,
    configuration_digest,payload)
  values(v_workspace.id,v_work_id,'work_created',1,p_actor_user_id,p_membership_id,
    v_membership.role,v_version.id,v_version.source_sha256,
    pg_catalog.jsonb_build_object('title',trim(p_title),'customer',trim(p_customer),
      'site',trim(p_site),'workTypeKey',p_work_type_key,'presentationId',v_alias));
  insert into d5o_hosted.work_identity_links(workspace_id,work_id,presentation_id)
    values(v_workspace.id,v_work_id,v_alias);
  v_catalog_record := pg_catalog.jsonb_build_object(
    'id',v_alias,'canonicalWorkId',v_work_id,'workspace',p_workspace_key,
    'title',trim(p_title),'type',v_type.display_name,'customer',trim(p_customer),
    'site',trim(p_site),'stage','Plan','owner',trim(p_owner),
    'nextAction','Complete Discover intake','progress',8,'value','Unpriced',
    'status','moving','proof','[]'::jsonb,'blockers','[]'::jsonb,
    'history',pg_catalog.jsonb_build_array('Work Record started'),
    'phaseConfigurationVersionId',v_version.id,'createdAt',v_now,'createdBy',p_actor_user_id);
  if p_initial_discovery is not null then
    v_catalog_record := pg_catalog.jsonb_set(v_catalog_record,'{nextAction}',
      pg_catalog.to_jsonb('Qualify customer need'::text));
  end if;
  v_record := v_catalog_record - 'createdAt' - 'createdBy';
  if p_initial_discovery is not null then
    v_record := v_record || pg_catalog.jsonb_build_object(
      'nextAction','Qualify customer need','discovery',pg_catalog.jsonb_build_object(
        'source',p_initial_discovery->>'source','need',p_initial_discovery->>'need',
        'procurement',p_initial_discovery->>'procurement','closeDate',p_initial_discovery->>'closeDate',
        'phase','Qualification','fit','Unassessed',
        'estimate',pg_catalog.jsonb_build_object('revision',0,'labor',0,'materials',0,
          'subcontract',0,'travel',0,'contingency',0,'targetMargin',25,
          'sellPrice',0,'status','Not started','assumption',''),
        'proposal',pg_catalog.jsonb_build_object('status','Not started','dueDate','',
          'method','Customer portal','recipient','','response',''),
        'pursuitControl',pg_catalog.jsonb_build_object('revision',0,'status','draft',
          'requester','','intendedOutcome','','roughValue','','currency','USD',
          'requiredDate','','knownRisk','','spend',pg_catalog.jsonb_build_object(
            'status','not_requested','cap',0,'purpose',''),'handoff',pg_catalog.jsonb_build_object(
            'status','not_started','receiver','','brief','','revision',0),
          'history','[]'::jsonb)));
  end if;
  v_next_work := coalesce(v_work_state.state_json,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'workspace',p_workspace_key,'records','[]'::jsonb));
  v_next_catalog := coalesce(v_catalog_state.state_json,pg_catalog.jsonb_build_object(
    'schemaVersion',1,'workspace',p_workspace_key,'records','[]'::jsonb,'packages','[]'::jsonb));
  v_next_work := pg_catalog.jsonb_set(v_next_work,'{records}',
    coalesce(v_next_work->'records','[]'::jsonb) || pg_catalog.jsonb_build_array(v_record));
  v_next_catalog := pg_catalog.jsonb_set(v_next_catalog,'{records}',
    coalesce(v_next_catalog->'records','[]'::jsonb) || pg_catalog.jsonb_build_array(v_catalog_record));
  v_next_work := pg_catalog.jsonb_set(v_next_work,'{revision}',
    pg_catalog.to_jsonb(coalesce(v_work_state.revision,0)+1));
  v_next_catalog := pg_catalog.jsonb_set(v_next_catalog,'{revision}',
    pg_catalog.to_jsonb(coalesce(v_catalog_state.revision,0)+1));
  insert into d5o_hosted.prototype_states(workspace_id,state_key,revision,state_json,updated_by)
    values(v_workspace.id,'work',1,v_next_work,p_actor_user_id)
    on conflict(workspace_id,state_key) do update set
      revision=d5o_hosted.prototype_states.revision+1,state_json=excluded.state_json,
      updated_by=p_actor_user_id,updated_at=v_now;
  insert into d5o_hosted.prototype_states(workspace_id,state_key,revision,state_json,updated_by)
    values(v_workspace.id,'catalog',1,v_next_catalog,p_actor_user_id)
    on conflict(workspace_id,state_key) do update set
      revision=d5o_hosted.prototype_states.revision+1,state_json=excluded.state_json,
      updated_by=p_actor_user_id,updated_at=v_now;
  insert into d5o_hosted.prototype_state_revisions(
    workspace_id,state_key,revision,state_json,actor_user_id,membership_id)
  values(v_workspace.id,'work',coalesce(v_work_state.revision,0)+1,v_next_work,p_actor_user_id,p_membership_id),
    (v_workspace.id,'catalog',coalesce(v_catalog_state.revision,0)+1,v_next_catalog,p_actor_user_id,p_membership_id);
  v_result := pg_catalog.jsonb_build_object(
    'workId',v_work_id,'presentationId',v_alias,'workRevision',coalesce(v_work_state.revision,0)+1,
    'catalogRevision',coalesce(v_catalog_state.revision,0)+1,
    'configurationVersionId',v_version.id,'recordVersion',1);
  insert into d5o_hosted.connected_create_receipts(
    workspace_id,command_id,actor_user_id,request_fingerprint,work_id,result)
  values(v_workspace.id,p_command_id,p_actor_user_id,v_fingerprint,v_work_id,v_result);
  return v_result;
end; $$;
revoke all on function public.d5o_hosted_create_connected_work_v1(
  text,text,bigint,bigint,uuid,text,text,text,text,text,uuid,uuid,jsonb)
  from public,anon,authenticated;
grant execute on function public.d5o_hosted_create_connected_work_v1(
  text,text,bigint,bigint,uuid,text,text,text,text,text,uuid,uuid,jsonb)
  to service_role;

-- The isolated pilot reads its real published configuration. Existing hosted
-- synthetic previews keep their separate presentation inventory.
create function public.d5o_hosted_configuration_inventory_v1(p_workspace_key text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_actor jsonb; v_tenant uuid; v_count integer; v_active uuid;
  v_versions jsonb; v_active_count integer;
begin
  v_actor := public.d5o_hosted_actor_v1(p_workspace_key);
  select count(*), (array_agg(t.id))[1] into v_count,v_tenant
    from d5o_hosted.configuration_tenants t
    where t.workspace_id=(v_actor->>'workspaceId')::uuid and t.status='active';
  if v_count <> 1 then return pg_catalog.jsonb_build_object(
    'workspaceId',v_actor->>'workspaceId','status',
    case when v_count=0 then 'no_mapping' else 'ambiguous_mapping' end,
    'tenantId',null,'activeVersionId',null,'versions','[]'::jsonb,
    'canAdminister',(v_actor->>'role'='admin')); end if;
  select count(*), (array_agg(id))[1] into v_active_count,v_active
    from d5o_hosted.configuration_versions
    where tenant_id=v_tenant and status='published' and effective_from<=now()
      and (effective_to is null or effective_to>now());
  if v_active_count <> 1 then return pg_catalog.jsonb_build_object(
    'workspaceId',v_actor->>'workspaceId','status',
    case when v_active_count=0 then 'unavailable_version' else 'ambiguous_mapping' end,
    'tenantId',v_tenant,'activeVersionId',null,'versions','[]'::jsonb,
    'canAdminister',(v_actor->>'role'='admin')); end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',v.id,'tenant_configuration_id',v.tenant_id,
    'version',v.version_number,'status',v.status,
    'base_configuration_version_id',null,'published_at',v.created_at,
    'effective_from',v.effective_from,'effective_to',v.effective_to,
    'config_manifest_json',v.manifest_json) order by v.version_number desc),'[]'::jsonb)
  into v_versions from d5o_hosted.configuration_versions v
  where v.tenant_id=v_tenant and v.status in ('published','superseded');
  return pg_catalog.jsonb_build_object('workspaceId',v_actor->>'workspaceId',
    'status','ready','tenantId',v_tenant,'activeVersionId',v_active,
    'versions',v_versions,'canAdminister',(v_actor->>'role'='admin'));
end; $$;
revoke all on function public.d5o_hosted_configuration_inventory_v1(text)
  from public,anon;
grant execute on function public.d5o_hosted_configuration_inventory_v1(text)
  to authenticated;

-- Once a canonical identity has been connected, neither the generic snapshot
-- writer nor another service-role caller may remove it or substitute an alias.
-- Legacy rows without a link remain readable and keep their prior references.
create function d5o_hosted.guard_connected_identity_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_link record; v_record jsonb; v_count integer;
begin
  if new.state_key not in ('work','catalog') or not exists (
    select 1 from d5o_hosted.work_identity_links l
      where l.workspace_id=new.workspace_id) then return new; end if;
  if pg_catalog.jsonb_typeof(new.state_json->'records') is distinct from 'array' then
    raise exception 'connected_records_missing' using errcode='42501'; end if;
  for v_link in select work_id,presentation_id from d5o_hosted.work_identity_links
      where workspace_id=new.workspace_id loop
    select count(*), (pg_catalog.jsonb_agg(item)->0) into v_count,v_record
      from pg_catalog.jsonb_array_elements(new.state_json->'records') item
      where item->>'id'=v_link.presentation_id;
    if v_count <> 1 or v_record->>'canonicalWorkId' is distinct from v_link.work_id::text
      or v_record->>'workspace' is distinct from (
        select workspace_key from d5o_hosted.workspaces where id=new.workspace_id) then
      raise exception 'connected_identity_changed' using errcode='42501'; end if;
  end loop;
  return new;
end; $$;
revoke all on function d5o_hosted.guard_connected_identity_v1()
  from public,anon,authenticated;
create trigger d5o_hosted_connected_identity_guard
  before insert or update of state_json on d5o_hosted.prototype_states
  for each row execute function d5o_hosted.guard_connected_identity_v1();

-- The two Operate actions that create related Work use this one transaction.
-- They may not register a presentation-only child after changing the parent.
create or replace function public.d5o_hosted_create_related_work_v1(
  p_workspace_key text, p_command_id text, p_action text,
  p_parent_presentation_id text, p_expected_work_revision bigint,
  p_expected_catalog_revision bigint, p_parent_after jsonb,
  p_child jsonb, p_actor_user_id uuid, p_membership_id uuid
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_workspace d5o_hosted.workspaces%rowtype;
  v_membership d5o_hosted.memberships%rowtype;
  v_parent_link d5o_hosted.work_identity_links%rowtype;
  v_parent d5o_hosted.work_records%rowtype;
  v_work d5o_hosted.prototype_states%rowtype;
  v_catalog d5o_hosted.prototype_states%rowtype;
  v_receipt d5o_hosted.connected_create_receipts%rowtype;
  v_before jsonb; v_child jsonb; v_catalog_child jsonb;
  v_after_work jsonb; v_after_catalog jsonb;
  v_child_id uuid; v_alias text; v_kind text; v_fingerprint text;
  v_event jsonb; v_job jsonb; v_result jsonb; v_work_type_key text;
  v_old_operate jsonb; v_new_operate jsonb; v_action_label text;
  v_item jsonb; v_match jsonb; v_target jsonb;
begin
  if current_setting('role',true) is distinct from 'service_role' then
    raise exception 'server_command_required' using errcode='42501'; end if;
  if p_action not in ('create-job','generate-maintenance','open-lifecycle')
    or p_command_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or pg_catalog.jsonb_typeof(p_parent_after) is distinct from 'object'
    or pg_catalog.jsonb_typeof(p_child) is distinct from 'object'
    or p_expected_work_revision < 1 or p_expected_catalog_revision < 1 then
    raise exception 'invalid_related_command' using errcode='22023'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('d5o-connected:'||v_workspace.id::text,0));
  select * into v_membership from d5o_hosted.memberships
    where id=p_membership_id and workspace_id=v_workspace.id
      and actor_user_id=p_actor_user_id and status='active' for share;
  if not found or v_membership.role not in ('admin','operations_leader','project_manager') then
    raise exception 'related_work_authority_denied' using errcode='42501'; end if;
  select * into v_parent_link from d5o_hosted.work_identity_links
    where workspace_id=v_workspace.id and presentation_id=p_parent_presentation_id;
  if not found then raise exception 'canonical_parent_required' using errcode='23503'; end if;
  select * into v_parent from d5o_hosted.work_records
    where id=v_parent_link.work_id and workspace_id=v_workspace.id for share;
  if not found then raise exception 'canonical_parent_required' using errcode='23503'; end if;
  v_alias := p_workspace_key||'-'||pg_catalog.replace(p_command_id,'-','');
  v_child_id := p_command_id::uuid;
  if p_child->>'id' is distinct from v_alias
    or p_child->>'workspace' is distinct from p_workspace_key
    or p_child->>'phaseConfigurationVersionId' is distinct from v_parent.configuration_version_id::text
    or p_child->>'customer' is distinct from (select item->>'customer'
      from d5o_hosted.prototype_states s,
        lateral pg_catalog.jsonb_array_elements(s.state_json->'records') item
      where s.workspace_id=v_workspace.id and s.state_key='work'
        and item->>'id'=p_parent_presentation_id limit 1)
    or p_child->'design' is not null or p_child->'deploy' is not null
    or p_child->'operate' is not null or p_child->>'status'='complete' then
    raise exception 'related_work_identity_invalid' using errcode='22023'; end if;
  v_kind := case when p_action='open-lifecycle' then 'lifecycle_opportunity'
    else 'service_visit' end;
  v_fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_array(
    p_action,p_parent_presentation_id,p_parent_after,p_child)::text);
  select * into v_receipt from d5o_hosted.connected_create_receipts
    where workspace_id=v_workspace.id and command_id=p_command_id;
  if found then
    if v_receipt.actor_user_id is distinct from p_actor_user_id
      or v_receipt.request_fingerprint is distinct from v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_receipt.result;
  end if;
  select * into v_work from d5o_hosted.prototype_states
    where workspace_id=v_workspace.id and state_key='work' for update;
  select * into v_catalog from d5o_hosted.prototype_states
    where workspace_id=v_workspace.id and state_key='catalog' for update;
  if v_work.revision is distinct from p_expected_work_revision
    or v_catalog.revision is distinct from p_expected_catalog_revision then
    raise exception 'stale_state' using errcode='23505'; end if;
  select item into v_before from pg_catalog.jsonb_array_elements(v_work.state_json->'records') item
    where item->>'id'=p_parent_presentation_id;
  if v_before is null or v_before->>'canonicalWorkId' is distinct from v_parent.id::text
    or p_parent_after->>'id' is distinct from p_parent_presentation_id
    or p_parent_after->>'canonicalWorkId' is distinct from v_parent.id::text
    or p_parent_after - 'operate' - 'history' is distinct from v_before - 'operate' - 'history'
    or pg_catalog.jsonb_typeof(p_parent_after->'history') is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_parent_after->'history')
       <> pg_catalog.jsonb_array_length(coalesce(v_before->'history','[]'::jsonb))+1
    or (p_parent_after->'history') - 0 is distinct from coalesce(v_before->'history','[]'::jsonb)
    or pg_catalog.jsonb_typeof(p_parent_after->'operate') is distinct from 'object' then
    raise exception 'related_parent_changed' using errcode='42501'; end if;
  v_old_operate := v_before->'operate'; v_new_operate := p_parent_after->'operate';
  v_event := v_new_operate#>'{events,0}';
  v_action_label := case p_action when 'create-job' then 'Service job generated'
    when 'generate-maintenance' then 'Maintenance job generated'
    else 'Lifecycle opportunity opened' end;
  if v_event->>'commandId' is distinct from p_command_id
    or v_event->>'actorId' is distinct from p_actor_user_id::text
    or v_event->>'membershipId' is distinct from p_membership_id::text
    or v_event->>'action' is distinct from v_action_label
    or pg_catalog.jsonb_array_length(coalesce(v_new_operate->'events','[]'::jsonb))
       <> pg_catalog.jsonb_array_length(coalesce(v_old_operate->'events','[]'::jsonb))+1
    or (v_new_operate->'events') - 0 is distinct from coalesce(v_old_operate->'events','[]'::jsonb) then
    raise exception 'related_command_event_invalid' using errcode='42501'; end if;
  if p_action='open-lifecycle' then
    v_match := v_new_operate#>'{lifecycleLinks,-1}';
    if v_new_operate - 'events' - 'lifecycleLinks'
       is distinct from v_old_operate - 'events' - 'lifecycleLinks'
      or pg_catalog.jsonb_array_length(v_new_operate->'lifecycleLinks')
       <> pg_catalog.jsonb_array_length(coalesce(v_old_operate->'lifecycleLinks','[]'::jsonb))+1
      or (v_new_operate->'lifecycleLinks') -
        (pg_catalog.jsonb_array_length(v_new_operate->'lifecycleLinks')-1)
        is distinct from coalesce(v_old_operate->'lifecycleLinks','[]'::jsonb)
      or v_new_operate#>>'{lifecycleLinks,-1,opportunityWorkId}' is distinct from v_alias
      or p_child#>>'{discovery,source}' is distinct from 'Lifecycle referral'
      or nullif(pg_catalog.btrim(v_match->>'rationale'),'') is null
      or p_child#>>'{discovery,need}' is distinct from v_match->>'rationale'
      or p_child->>'owner' is distinct from v_match->>'owner'
      or p_child->>'stage' is distinct from 'Qualification'
      or p_child->'serviceSource' is not null then
      raise exception 'related_lifecycle_invalid' using errcode='42501'; end if;
    if (v_match->>'assetId' is not null and not exists (
        select 1 from pg_catalog.jsonb_array_elements(v_old_operate->'assets') item
          where item->>'id'=v_match->>'assetId'))
      or (v_match->>'requestId' is not null and not exists (
        select 1 from pg_catalog.jsonb_array_elements(v_old_operate->'requests') item
          where item->>'id'=v_match->>'requestId'
            and (v_match->>'assetId' is null or item->>'assetId'=v_match->>'assetId'))) then
      raise exception 'related_lifecycle_source_invalid' using errcode='42501'; end if;
  else
    v_job := v_new_operate#>'{jobs,-1}';
    if v_old_operate#>>'{activation,status}' is distinct from 'Active'
      or v_new_operate - 'events' - 'jobs' - 'requests' - 'maintenance'
        is distinct from v_old_operate - 'events' - 'jobs' - 'requests' - 'maintenance'
      or pg_catalog.jsonb_array_length(v_new_operate->'jobs')
        <> pg_catalog.jsonb_array_length(coalesce(v_old_operate->'jobs','[]'::jsonb))+1
      or (v_new_operate->'jobs') -
        (pg_catalog.jsonb_array_length(v_new_operate->'jobs')-1)
        is distinct from coalesce(v_old_operate->'jobs','[]'::jsonb)
      or v_job->>'workId' is distinct from v_alias
      or v_job->>'status' is distinct from 'Generated'
      or p_child->>'stage' is distinct from 'Design'
      or p_child#>>'{serviceSource,parentWorkId}' is distinct from p_parent_presentation_id
      or p_child#>'{serviceSource,assetIds}' is distinct from v_job->'assetIds'
      or p_child#>>'{serviceSource,requestId}' is distinct from v_job->>'requestId'
      or p_child#>>'{serviceSource,maintenancePlanId}' is distinct from v_job->>'planId' then
      raise exception 'related_service_invalid' using errcode='42501'; end if;
    if p_action='create-job' then
      if v_job->>'requestId' is null or v_job->>'planId' is not null
        or v_new_operate->'maintenance' is distinct from v_old_operate->'maintenance'
        or pg_catalog.jsonb_array_length(v_new_operate->'requests')
          <> pg_catalog.jsonb_array_length(v_old_operate->'requests') then
        raise exception 'related_request_invalid' using errcode='42501'; end if;
      select item into v_target from pg_catalog.jsonb_array_elements(v_old_operate->'requests') item
        where item->>'id'=v_job->>'requestId';
      if v_target is null or v_target->>'status' not in ('Triaged','In progress')
        or v_target->>'coverage' not in ('Covered','Partially covered','Chargeable')
        or v_job->'assetIds' is distinct from pg_catalog.jsonb_build_array(v_target->>'assetId') then
        raise exception 'related_request_not_authorized' using errcode='42501'; end if;
      for v_item in select value from pg_catalog.jsonb_array_elements(v_old_operate->'requests') loop
        select item into v_match from pg_catalog.jsonb_array_elements(v_new_operate->'requests') item
          where item->>'id'=v_item->>'id';
        if v_match is null then raise exception 'related_request_changed' using errcode='42501'; end if;
        if v_item->>'id'=v_job->>'requestId' then
          if v_match - 'status' - 'jobIds' - 'currentCycleJobIds'
              is distinct from v_item - 'status' - 'jobIds' - 'currentCycleJobIds'
            or v_match->>'status' is distinct from 'In progress'
            or v_match->'jobIds' is distinct from
              coalesce(v_item->'jobIds','[]'::jsonb)||pg_catalog.jsonb_build_array(v_job->'id')
            or v_match->'currentCycleJobIds' is distinct from
              coalesce(v_item->'currentCycleJobIds',coalesce(v_item->'jobIds','[]'::jsonb))
                ||pg_catalog.jsonb_build_array(v_job->'id') then
            raise exception 'related_request_changed' using errcode='42501'; end if;
        elsif v_match is distinct from v_item then
          raise exception 'unrelated_request_changed' using errcode='42501'; end if;
      end loop;
    else
      if v_job->>'planId' is null or v_job->>'requestId' is not null
        or v_new_operate->'requests' is distinct from v_old_operate->'requests'
        or pg_catalog.jsonb_array_length(v_new_operate->'maintenance')
          <> pg_catalog.jsonb_array_length(v_old_operate->'maintenance') then
        raise exception 'related_plan_invalid' using errcode='42501'; end if;
      select item into v_target from pg_catalog.jsonb_array_elements(v_old_operate->'maintenance') item
        where item->>'id'=v_job->>'planId';
      if v_target is null or v_target->>'status' is distinct from 'Active'
        or v_job->>'dueDate' is distinct from v_target->>'nextDue'
        or v_job->'assetIds' is distinct from pg_catalog.jsonb_build_array(v_target->>'assetId')
        or (v_target->>'nextDue')::date > current_date then
        raise exception 'related_plan_not_due' using errcode='42501'; end if;
      for v_item in select value from pg_catalog.jsonb_array_elements(v_old_operate->'maintenance') loop
        select item into v_match from pg_catalog.jsonb_array_elements(v_new_operate->'maintenance') item
          where item->>'id'=v_item->>'id';
        if v_match is null then raise exception 'related_plan_changed' using errcode='42501'; end if;
        if v_item->>'id'=v_job->>'planId' then
          if v_match - 'generatedDates' - 'nextDue'
              is distinct from v_item - 'generatedDates' - 'nextDue'
            or v_match->'generatedDates' is distinct from
              coalesce(v_item->'generatedDates','[]'::jsonb)
                ||pg_catalog.jsonb_build_array(v_job->'dueDate') then
            raise exception 'related_plan_changed' using errcode='42501'; end if;
        elsif v_match is distinct from v_item then
          raise exception 'unrelated_plan_changed' using errcode='42501'; end if;
      end loop;
    end if;
  end if;
  if exists(select 1 from pg_catalog.jsonb_array_elements(v_work.state_json->'records') item
      where item->>'id'=v_alias)
    or exists(select 1 from pg_catalog.jsonb_array_elements(v_catalog.state_json->'records') item
      where item->>'id'=v_alias) then
    raise exception 'related_work_conflict' using errcode='23505'; end if;
  select work_type_key into v_work_type_key from d5o_hosted.configuration_work_types
    where configuration_version_id=v_parent.configuration_version_id
      and display_name=p_child->>'type' and status='active' limit 1;
  if v_work_type_key is null then raise exception 'related_work_type_unavailable' using errcode='22023'; end if;
  insert into d5o_hosted.work_records(id,workspace_id,configuration_tenant_id,
    configuration_version_id,configuration_digest,work_type_key,title,created_by)
  values(v_child_id,v_workspace.id,v_parent.configuration_tenant_id,
    v_parent.configuration_version_id,v_parent.configuration_digest,v_work_type_key,
    p_child->>'title',p_actor_user_id);
  insert into d5o_hosted.work_identity_links(workspace_id,work_id,presentation_id,
    parent_work_id,relation_kind)
  values(v_workspace.id,v_child_id,v_alias,v_parent.id,v_kind);
  v_child := pg_catalog.jsonb_set(p_child,'{canonicalWorkId}',pg_catalog.to_jsonb(v_child_id::text));
  v_catalog_child := pg_catalog.jsonb_build_object('id',v_alias,
    'canonicalWorkId',v_child_id,'workspace',p_workspace_key,
    'title',v_child->>'title','type',v_child->>'type',
    'customer',v_child->>'customer','site',v_child->>'site',
    'stage',v_child->>'stage','owner',v_child->>'owner',
    'nextAction',v_child->>'nextAction','progress',v_child->'progress',
    'value',v_child->>'value','status',v_child->>'status',
    'proof',coalesce(v_child->'proof','[]'::jsonb),
    'blockers',coalesce(v_child->'blockers','[]'::jsonb),
    'history',coalesce(v_child->'history','[]'::jsonb),
    'phaseConfigurationVersionId',v_parent.configuration_version_id,
    'createdAt',now(),'createdBy',p_actor_user_id);
  v_after_work := pg_catalog.jsonb_set(v_work.state_json,'{records}',
    (select pg_catalog.jsonb_agg(case when item->>'id'=p_parent_presentation_id
      then p_parent_after else item end)
      from pg_catalog.jsonb_array_elements(v_work.state_json->'records') item)
      || pg_catalog.jsonb_build_array(v_child));
  v_after_work := pg_catalog.jsonb_set(v_after_work,'{revision}',
    pg_catalog.to_jsonb(v_work.revision+1));
  v_after_catalog := pg_catalog.jsonb_set(v_catalog.state_json,'{records}',
    v_catalog.state_json->'records'||pg_catalog.jsonb_build_array(v_catalog_child));
  v_after_catalog := pg_catalog.jsonb_set(v_after_catalog,'{revision}',
    pg_catalog.to_jsonb(v_catalog.revision+1));
  update d5o_hosted.prototype_states set revision=revision+1,
    state_json=v_after_work,updated_by=p_actor_user_id,updated_at=now()
    where workspace_id=v_workspace.id and state_key='work';
  update d5o_hosted.prototype_states set revision=revision+1,
    state_json=v_after_catalog,updated_by=p_actor_user_id,updated_at=now()
    where workspace_id=v_workspace.id and state_key='catalog';
  insert into d5o_hosted.prototype_state_revisions(workspace_id,state_key,
    revision,state_json,actor_user_id,membership_id)
  values(v_workspace.id,'work',v_work.revision+1,v_after_work,p_actor_user_id,p_membership_id),
    (v_workspace.id,'catalog',v_catalog.revision+1,v_after_catalog,p_actor_user_id,p_membership_id);
  insert into d5o_hosted.work_events(workspace_id,work_id,event_type,
    record_version,actor_user_id,membership_id,authority_role,
    configuration_version_id,configuration_digest,payload)
  values(v_workspace.id,v_child_id,'work_created',1,p_actor_user_id,
    p_membership_id,v_membership.role,v_parent.configuration_version_id,
    v_parent.configuration_digest,pg_catalog.jsonb_build_object(
      'parentWorkId',v_parent.id,'relationKind',v_kind,
      'presentationId',v_alias,'commandId',p_command_id));
  v_result := pg_catalog.jsonb_build_object('workId',v_child_id,
    'presentationId',v_alias,'workRevision',v_work.revision+1,
    'catalogRevision',v_catalog.revision+1,'parentWorkId',v_parent.id,
    'relationKind',v_kind);
  insert into d5o_hosted.connected_create_receipts(workspace_id,command_id,
    actor_user_id,request_fingerprint,work_id,result)
  values(v_workspace.id,p_command_id,p_actor_user_id,v_fingerprint,v_child_id,v_result);
  return v_result;
end; $$;
revoke all on function public.d5o_hosted_create_related_work_v1(
  text,text,text,text,bigint,bigint,jsonb,jsonb,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.d5o_hosted_create_related_work_v1(
  text,text,text,text,bigint,bigint,jsonb,jsonb,uuid,uuid)
  to service_role;

-- A service-role key is not business authority. For connected Work Records the
-- legacy replacement writer may retain drafts, but cannot make any protected
-- phase decision. Dedicated typed commands must replace it phase by phase.
create or replace function public.d5o_hosted_command_save_v1(
  p_workspace_key text, p_state_key text, p_expected_revision bigint, p_state jsonb,
  p_actor_user_id uuid, p_membership_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_workspace uuid; v_revision bigint; v_current jsonb; v_link record;
  v_old jsonb; v_new jsonb;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception 'server_command_required' using errcode='42501'; end if;
  if p_state_key not in ('work','catalog','schedule') or p_expected_revision < 0
    or p_state is null or pg_catalog.jsonb_typeof(p_state) <> 'object'
    or p_state->>'workspace' is distinct from p_workspace_key
    or p_state->>'schemaVersion' is distinct from '1'
    or pg_catalog.octet_length(p_state::text) > 2000000 then
    raise exception 'invalid_state' using errcode='22023'; end if;
  select w.id into v_workspace from d5o_hosted.workspaces w
    join d5o_hosted.memberships m on m.workspace_id=w.id
    where w.workspace_key=p_workspace_key and w.status='active'
      and m.id=p_membership_id and m.actor_user_id=p_actor_user_id
      and m.status='active';
  if v_workspace is null then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  if p_state_key='work' and exists(select 1 from d5o_hosted.work_identity_links
      where workspace_id=v_workspace) then
    select state_json into v_current from d5o_hosted.prototype_states
      where workspace_id=v_workspace and state_key='work' for update;
    if pg_catalog.jsonb_typeof(p_state->'records') is distinct from 'array' then
      raise exception 'connected_records_missing' using errcode='42501'; end if;
    for v_link in select presentation_id from d5o_hosted.work_identity_links
        where workspace_id=v_workspace loop
      select item into v_old from pg_catalog.jsonb_array_elements(
        coalesce(v_current->'records','[]'::jsonb)) item
        where item->>'id'=v_link.presentation_id;
      select item into v_new from pg_catalog.jsonb_array_elements(p_state->'records') item
        where item->>'id'=v_link.presentation_id;
      if v_old is null or v_new is null
        or d5o_hosted.protected_work_record_v1(v_old)
          is distinct from d5o_hosted.protected_work_record_v1(v_new) then
        raise exception 'typed_command_required' using errcode='42501'; end if;
    end loop;
  end if;
  if p_expected_revision=0 then
    insert into d5o_hosted.prototype_states(workspace_id,state_key,revision,state_json,updated_by)
      values(v_workspace,p_state_key,1,p_state,p_actor_user_id)
      on conflict(workspace_id,state_key) do nothing returning revision into v_revision;
  else
    update d5o_hosted.prototype_states set revision=revision+1,state_json=p_state,
      updated_by=p_actor_user_id,updated_at=now()
      where workspace_id=v_workspace and state_key=p_state_key
        and revision=p_expected_revision returning revision into v_revision;
  end if;
  if v_revision is null then raise exception 'stale_state' using errcode='23505'; end if;
  insert into d5o_hosted.prototype_state_revisions(workspace_id,state_key,
    revision,state_json,actor_user_id,membership_id)
    values(v_workspace,p_state_key,v_revision,p_state,p_actor_user_id,p_membership_id);
  return pg_catalog.jsonb_build_object('revision',v_revision,'state',p_state);
end; $$;
revoke all on function public.d5o_hosted_command_save_v1(
  text,text,bigint,jsonb,uuid,uuid) from public,anon,authenticated;
grant execute on function public.d5o_hosted_command_save_v1(
  text,text,bigint,jsonb,uuid,uuid) to service_role;
