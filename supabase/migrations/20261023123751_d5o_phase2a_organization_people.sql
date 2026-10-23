-- Phase 2A extends the authoritative hosted workspace, membership, workforce,
-- and identity-intent models. No parallel customer or login directory is made.
alter table d5o_hosted.workspaces
  add column legal_name text,
  add column primary_contact_email text,
  add column time_zone text not null default 'America/New_York',
  add column default_currency text not null default 'USD',
  add column branding jsonb not null default '{}'::jsonb,
  add column profile_revision integer not null default 1,
  add column updated_at timestamptz not null default now(),
  add constraint hosted_workspace_currency_check check(default_currency ~ '^[A-Z]{3}$'),
  add constraint hosted_workspace_branding_check check(jsonb_typeof(branding)='object');

create table d5o_hosted.org_units (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references d5o_hosted.workspaces(id),
  code text not null check(code ~ '^[A-Z0-9][A-Z0-9_-]{1,31}$'),
  name text not null check(length(trim(name)) between 2 and 120),
  description text not null default '',status text not null default 'active' check(status in ('active','retired')),
  parent_id uuid,manager_user_id uuid,revision integer not null default 1,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(workspace_id,id),unique(workspace_id,code),
  foreign key(workspace_id,parent_id) references d5o_hosted.org_units(workspace_id,id),
  foreign key(workspace_id,manager_user_id) references d5o_hosted.memberships(workspace_id,actor_user_id)
);
create table d5o_hosted.org_locations (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references d5o_hosted.workspaces(id),
  code text not null check(code ~ '^[A-Z0-9][A-Z0-9_-]{1,31}$'),
  name text not null check(length(trim(name)) between 2 and 120),
  address jsonb not null default '{}'::jsonb check(jsonb_typeof(address)='object'),
  country text not null check(country ~ '^[A-Z]{2}$'),time_zone text not null,
  unit_id uuid,status text not null default 'active' check(status in ('active','retired')),
  revision integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(workspace_id,id),unique(workspace_id,code),
  foreign key(workspace_id,unit_id) references d5o_hosted.org_units(workspace_id,id)
);
create table d5o_hosted.org_teams (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references d5o_hosted.workspaces(id),
  code text not null check(code ~ '^[A-Z0-9][A-Z0-9_-]{1,31}$'),
  name text not null check(length(trim(name)) between 2 and 120),description text not null default '',
  manager_user_id uuid,unit_id uuid,primary_location_id uuid,
  status text not null default 'active' check(status in ('active','retired')),
  revision integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(workspace_id,id),unique(workspace_id,code),
  foreign key(workspace_id,manager_user_id) references d5o_hosted.memberships(workspace_id,actor_user_id),
  foreign key(workspace_id,unit_id) references d5o_hosted.org_units(workspace_id,id),
  foreign key(workspace_id,primary_location_id) references d5o_hosted.org_locations(workspace_id,id)
);
create table d5o_hosted.org_team_members (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references d5o_hosted.workspaces(id),
  team_id uuid not null,member_user_id uuid,person_id uuid,
  status text not null default 'active' check(status in ('active','ended')),
  effective_from date not null default current_date,effective_to date,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  revision integer not null default 1,
  check(member_user_id is not null or person_id is not null),
  check(effective_to is null or effective_to>=effective_from),
  foreign key(workspace_id,team_id) references d5o_hosted.org_teams(workspace_id,id),
  foreign key(workspace_id,member_user_id) references d5o_hosted.memberships(workspace_id,actor_user_id),
  foreign key(workspace_id,person_id) references d5o_hosted.connected_crew_profiles(workspace_id,id)
);
create unique index org_team_active_user_v1 on d5o_hosted.org_team_members(workspace_id,team_id,member_user_id)
  where status='active' and member_user_id is not null;
create unique index org_team_active_person_v1 on d5o_hosted.org_team_members(workspace_id,team_id,person_id)
  where status='active' and person_id is not null;

-- Optional, stable organizational references on existing workforce identities.
-- Historical profiles remain valid with NULL links; no scheduling key changes.
alter table d5o_hosted.connected_crew_profiles
  add column primary_unit_id uuid,
  add column primary_location_id uuid,
  add constraint crew_primary_unit_tenant_fkey foreign key(workspace_id,primary_unit_id)
    references d5o_hosted.org_units(workspace_id,id),
  add constraint crew_primary_location_tenant_fkey foreign key(workspace_id,primary_location_id)
    references d5o_hosted.org_locations(workspace_id,id);

create table d5o_hosted.org_admin_events (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references d5o_hosted.workspaces(id),
  command_id text not null,actor_user_id uuid not null references auth.users(id),
  action text not null,subject_id uuid,reason text not null,
  before_state jsonb,after_state jsonb,occurred_at timestamptz not null default now(),
  unique(workspace_id,command_id)
);
create table d5o_hosted.org_admin_receipts (
  workspace_id uuid not null references d5o_hosted.workspaces(id),command_id text not null,
  actor_user_id uuid not null references auth.users(id),fingerprint text not null,
  result jsonb not null,primary key(workspace_id,command_id)
);

-- A tenant membership has one live role, but an invitation is an offer; Auth
-- confirmation, email equality, expiry and recipient acceptance grant access.
alter table d5o_hosted.admin_identity_requests
  add column expires_at timestamptz not null default (now()+interval '14 days'),
  add column accepted_at timestamptz,
  add column revoked_at timestamptz;
alter table d5o_hosted.admin_identity_requests drop constraint admin_identity_requests_status_check;
alter table d5o_hosted.admin_identity_requests add constraint admin_identity_requests_status_check
  check(status in ('pending','provider_accepted','provider_rejected','uncertain',
    'existing_confirmed','setup_completed','accepted','revoked','expired'));
alter table d5o_hosted.memberships drop constraint memberships_status_check;
alter table d5o_hosted.memberships add constraint memberships_status_check
  check(status in ('active','suspended','removed'));
alter table d5o_hosted.memberships add column revision integer not null default 1;

alter table d5o_hosted.org_units enable row level security;
alter table d5o_hosted.org_locations enable row level security;
alter table d5o_hosted.org_teams enable row level security;
alter table d5o_hosted.org_team_members enable row level security;
alter table d5o_hosted.org_admin_events enable row level security;
alter table d5o_hosted.org_admin_receipts enable row level security;
revoke all on d5o_hosted.org_units,d5o_hosted.org_locations,d5o_hosted.org_teams,
  d5o_hosted.org_team_members,d5o_hosted.org_admin_events,d5o_hosted.org_admin_receipts
  from public,anon,authenticated,service_role;

create function public.d5o_hosted_org_admin_read_v1(
  p_workspace_key text,p_kind text,p_search text default '',p_offset integer default 0,p_limit integer default 25
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_workspace d5o_hosted.workspaces%rowtype;v_actor uuid:=auth.uid();v_items jsonb;v_total bigint;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null or
    p_kind not in ('overview','units','locations','teams','people','invitations','activity') or
    p_offset not between 0 and 10000 or p_limit not between 1 and 50 or
    length(coalesce(p_search,''))>120 then
    raise exception 'org_read_denied' using errcode='42501'; end if;
  select w.* into v_workspace from d5o_hosted.workspaces w join d5o_hosted.memberships m
    on m.workspace_id=w.id where w.workspace_key=p_workspace_key and w.status='active'
    and m.actor_user_id=v_actor and m.status='active' and m.role='admin';
  if not found then raise exception 'admin_membership_required' using errcode='42501'; end if;
  if p_kind='overview' then
    return pg_catalog.jsonb_build_object('organization',pg_catalog.jsonb_build_object(
      'id',v_workspace.id,'name',v_workspace.legal_name,'displayName',v_workspace.display_name,
      'status',v_workspace.status,'contactEmail',v_workspace.primary_contact_email,
      'timeZone',v_workspace.time_zone,'currency',v_workspace.default_currency,
      'branding',v_workspace.branding,'revision',v_workspace.profile_revision,
      'createdAt',v_workspace.created_at,'updatedAt',v_workspace.updated_at),
      'units',(select count(*) from d5o_hosted.org_units where workspace_id=v_workspace.id and status='active'),
      'locations',(select count(*) from d5o_hosted.org_locations where workspace_id=v_workspace.id and status='active'),
      'teams',(select count(*) from d5o_hosted.org_teams where workspace_id=v_workspace.id and status='active'),
      'members',(select count(*) from d5o_hosted.memberships where workspace_id=v_workspace.id and status='active'));
  elsif p_kind='units' then
    select count(*),coalesce(pg_catalog.jsonb_agg(to_jsonb(t) order by t.name),'[]'::jsonb) into v_total,v_items
      from (select * from d5o_hosted.org_units where workspace_id=v_workspace.id and
        (coalesce(p_search,'')='' or name ilike '%'||p_search||'%' or code ilike '%'||p_search||'%')
        order by name offset p_offset limit p_limit) t;
    select count(*) into v_total from d5o_hosted.org_units where workspace_id=v_workspace.id and
      (coalesce(p_search,'')='' or name ilike '%'||p_search||'%' or code ilike '%'||p_search||'%');
  elsif p_kind='locations' then
    select coalesce(pg_catalog.jsonb_agg(to_jsonb(t) order by t.name),'[]'::jsonb) into v_items from
      (select * from d5o_hosted.org_locations where workspace_id=v_workspace.id and
      (coalesce(p_search,'')='' or name ilike '%'||p_search||'%' or code ilike '%'||p_search||'%')
      order by name offset p_offset limit p_limit) t;
    select count(*) into v_total from d5o_hosted.org_locations where workspace_id=v_workspace.id and
      (coalesce(p_search,'')='' or name ilike '%'||p_search||'%' or code ilike '%'||p_search||'%');
  elsif p_kind='teams' then
    select coalesce(pg_catalog.jsonb_agg(to_jsonb(t) order by t.name),'[]'::jsonb) into v_items from
      (select x.*,
        coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'id',tm.id,'memberUserId',tm.member_user_id,'personId',tm.person_id,
          'name',coalesce(u.email,p.display_name),'revision',tm.revision))
          from d5o_hosted.org_team_members tm
          left join auth.users u on u.id=tm.member_user_id
          left join d5o_hosted.connected_crew_profiles p on p.workspace_id=tm.workspace_id and p.id=tm.person_id
          where tm.workspace_id=v_workspace.id and tm.team_id=x.id and tm.status='active'),'[]'::jsonb) members
       from d5o_hosted.org_teams x where x.workspace_id=v_workspace.id and
      (coalesce(p_search,'')='' or x.name ilike '%'||p_search||'%' or x.code ilike '%'||p_search||'%')
      order by name offset p_offset limit p_limit) t;
    select count(*) into v_total from d5o_hosted.org_teams where workspace_id=v_workspace.id and
      (coalesce(p_search,'')='' or name ilike '%'||p_search||'%' or code ilike '%'||p_search||'%');
  elsif p_kind='people' then
    select coalesce(pg_catalog.jsonb_agg(to_jsonb(t) order by t.email),'[]'::jsonb) into v_items from
      (select m.id,m.actor_user_id,u.email,m.role,m.status,m.revision,
        p.id person_id,p.display_name person_name,p.revision person_revision,
        p.primary_unit_id,p.primary_location_id,
        coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',tm.id,'teamId',tm.team_id,'teamName',x.name))
          from d5o_hosted.org_team_members tm join d5o_hosted.org_teams x on x.id=tm.team_id
          where tm.workspace_id=v_workspace.id and tm.member_user_id=m.actor_user_id and tm.status='active'),'[]'::jsonb) teams
       from d5o_hosted.memberships m join auth.users u on u.id=m.actor_user_id
       left join d5o_hosted.connected_crew_profiles p on p.workspace_id=m.workspace_id and p.actor_user_id=m.actor_user_id
       where m.workspace_id=v_workspace.id and (coalesce(p_search,'')='' or u.email ilike '%'||p_search||'%'
         or p.display_name ilike '%'||p_search||'%') order by u.email offset p_offset limit p_limit) t;
    select count(*) into v_total from d5o_hosted.memberships m join auth.users u on u.id=m.actor_user_id
      left join d5o_hosted.connected_crew_profiles p on p.workspace_id=m.workspace_id and p.actor_user_id=m.actor_user_id
      where m.workspace_id=v_workspace.id and (coalesce(p_search,'')='' or u.email ilike '%'||p_search||'%'
         or p.display_name ilike '%'||p_search||'%');
  elsif p_kind='invitations' then
    select coalesce(pg_catalog.jsonb_agg(to_jsonb(t) order by t.created_at desc),'[]'::jsonb) into v_items from
      (select command_id,target_email,requested_role,status,expires_at,created_at,accepted_at,revoked_at,
        case when status not in ('accepted','revoked') and expires_at<now() then 'expired' else status end effective_status
       from d5o_hosted.admin_identity_requests where workspace_id=v_workspace.id and action='invite'
       and (coalesce(p_search,'')='' or target_email ilike '%'||p_search||'%')
       order by created_at desc offset p_offset limit p_limit) t;
    select count(*) into v_total from d5o_hosted.admin_identity_requests where workspace_id=v_workspace.id
      and action='invite' and (coalesce(p_search,'')='' or target_email ilike '%'||p_search||'%');
  else
    with events as (
      select e.action,e.reason,e.occurred_at,e.subject_id,e.actor_user_id
        from d5o_hosted.org_admin_events e where e.workspace_id=v_workspace.id
      union all select 'membership.'||e.action,coalesce(r.reason,'Historical membership decision'),
        e.occurred_at,e.target_user_id,e.actor_user_id
        from d5o_hosted.membership_assignment_events e
        left join d5o_hosted.admin_membership_reasons r
          on r.workspace_id=e.workspace_id and r.command_id=e.command_id
        where e.workspace_id=v_workspace.id
      union all select 'identity.'||e.action,e.reason,e.created_at,null::uuid,e.actor_user_id
        from d5o_hosted.admin_identity_requests e where e.workspace_id=v_workspace.id
          and not exists(select 1 from d5o_hosted.org_admin_events x
            where x.workspace_id=e.workspace_id and x.command_id=e.command_id)
    ), filtered as (
      select e.*,u.email actor_email from events e join auth.users u on u.id=e.actor_user_id
        where coalesce(p_search,'')='' or e.action ilike '%'||p_search||'%'
    )
    select count(*),coalesce((select pg_catalog.jsonb_agg(to_jsonb(t) order by t.occurred_at desc)
      from (select * from filtered order by occurred_at desc offset p_offset limit p_limit) t),'[]'::jsonb)
      into v_total,v_items from filtered;
  end if;
  return pg_catalog.jsonb_build_object('items',coalesce(v_items,'[]'::jsonb),'total',coalesce(v_total,0),
    'offset',p_offset,'limit',p_limit);
end $$;
revoke all on function public.d5o_hosted_org_admin_read_v1(text,text,text,integer,integer)
  from public,anon,service_role;
grant execute on function public.d5o_hosted_org_admin_read_v1(text,text,text,integer,integer) to authenticated;

create function public.d5o_hosted_org_admin_command_v1(
  p_workspace_key text,p_action text,p_subject_id uuid,p_input jsonb,
  p_expected_revision integer,p_reason text,p_command_id text
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace uuid;
  v_prior d5o_hosted.org_admin_receipts%rowtype;v_before jsonb;v_after jsonb;v_result jsonb;
  v_fingerprint text;v_id uuid;v_parent uuid;v_unit uuid;v_location uuid;v_manager uuid;
  v_target uuid;v_person uuid;v_role text;v_status text;v_code text;v_name text;
  v_ended integer:=0;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null or
    p_action not in ('organization.save','unit.create','unit.update','unit.retire',
      'location.create','location.update','location.retire','team.create','team.update','team.retire',
      'team-member.add','team-member.end','person.assign','member.role','member.suspend',
      'member.reactivate','member.remove') or
    p_input is null or pg_catalog.jsonb_typeof(p_input)<>'object' or
    p_expected_revision is null or p_expected_revision<0 or
    length(trim(coalesce(p_reason,''))) not between 8 and 500 or
    length(coalesce(p_command_id,'')) not between 8 and 120 then
    raise exception 'invalid_org_command' using errcode='22023'; end if;
  select w.id into v_workspace from d5o_hosted.workspaces w
    join d5o_hosted.memberships m on m.workspace_id=w.id
    where w.workspace_key=p_workspace_key and w.status='active'
      and m.actor_user_id=v_actor and m.role='admin' and m.status='active';
  if v_workspace is null then raise exception 'admin_membership_required' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('d5o-org:'||v_workspace::text,0));
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_workspace_key,p_action,p_subject_id,
    p_input,p_expected_revision,trim(p_reason))::text);
  select * into v_prior from d5o_hosted.org_admin_receipts
    where workspace_id=v_workspace and command_id=p_command_id;
  if found then
    if v_prior.actor_user_id<>v_actor or v_prior.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_prior.result;
  end if;
  v_id:=p_subject_id;
  v_code:=upper(trim(p_input->>'code'));
  v_name:=trim(p_input->>'name');
  if p_action like 'unit.%' or p_action like 'location.%' or p_action like 'team.%' then
    if p_action not like '%.retire' and (v_code !~ '^[A-Z0-9][A-Z0-9_-]{1,31}$'
      or length(v_name) not between 2 and 120) then
      raise exception 'invalid_org_record' using errcode='22023'; end if;
    v_unit:=nullif(p_input->>'unitId','')::uuid;
    v_location:=nullif(p_input->>'locationId','')::uuid;
    v_manager:=nullif(p_input->>'managerUserId','')::uuid;
    if v_manager is not null and not exists(select 1 from d5o_hosted.memberships
      where workspace_id=v_workspace and actor_user_id=v_manager and status='active') then
      raise exception 'cross_tenant_reference' using errcode='23503'; end if;
    if v_unit is not null and not exists(select 1 from d5o_hosted.org_units
      where workspace_id=v_workspace and id=v_unit and status='active') then
      raise exception 'cross_tenant_reference' using errcode='23503'; end if;
    if v_location is not null and not exists(select 1 from d5o_hosted.org_locations
      where workspace_id=v_workspace and id=v_location and status='active') then
      raise exception 'cross_tenant_reference' using errcode='23503'; end if;
  end if;
  if p_action='organization.save' then
    select to_jsonb(w) into v_before from d5o_hosted.workspaces w where id=v_workspace for update;
    if (v_before->>'profile_revision')::integer<>p_expected_revision or
      length(trim(coalesce(p_input->>'name',''))) not between 2 and 120 or
      length(trim(coalesce(p_input->>'displayName',''))) not between 2 and 120 or
      coalesce(p_input->>'currency','') !~ '^[A-Z]{3}$' or
      length(coalesce(p_input->>'timeZone','')) not between 3 and 80 or
      not exists(select 1 from pg_catalog.pg_timezone_names where name=p_input->>'timeZone') or
      pg_catalog.jsonb_typeof(coalesce(p_input->'branding','{}'::jsonb))<>'object' then
      raise exception 'stale_or_invalid_organization' using errcode='23505'; end if;
    update d5o_hosted.workspaces set legal_name=trim(p_input->>'name'),
      display_name=trim(p_input->>'displayName'),primary_contact_email=nullif(trim(p_input->>'contactEmail'),''),
      time_zone=p_input->>'timeZone',default_currency=p_input->>'currency',
      branding=coalesce(p_input->'branding','{}'::jsonb),profile_revision=profile_revision+1,updated_at=now()
      where id=v_workspace returning to_jsonb(workspaces.*) into v_after;
    v_id:=v_workspace;
  elsif p_action like 'unit.%' then
    v_parent:=nullif(p_input->>'parentId','')::uuid;
    if v_parent is not null and not exists(select 1 from d5o_hosted.org_units
      where workspace_id=v_workspace and id=v_parent and status='active') then
      raise exception 'cross_tenant_reference' using errcode='23503'; end if;
    if p_action='unit.create' then
      if p_expected_revision<>0 or p_subject_id is not null then
        raise exception 'stale_revision' using errcode='23505'; end if;
      insert into d5o_hosted.org_units(workspace_id,code,name,description,parent_id,manager_user_id)
        values(v_workspace,v_code,v_name,coalesce(p_input->>'description',''),v_parent,v_manager)
        returning id,to_jsonb(org_units.*) into v_id,v_after;
    else
      select to_jsonb(x) into v_before from d5o_hosted.org_units x
        where workspace_id=v_workspace and id=v_id for update;
      if v_before is null then raise exception 'cross_tenant_reference' using errcode='23503'; end if;
      if (v_before->>'revision')::integer<>p_expected_revision then
        raise exception 'stale_revision' using errcode='23505'; end if;
      if p_action='unit.retire' then
        if exists(select 1 from d5o_hosted.org_units where workspace_id=v_workspace and parent_id=v_id and status='active')
          or exists(select 1 from d5o_hosted.org_teams where workspace_id=v_workspace and unit_id=v_id and status='active')
          or exists(select 1 from d5o_hosted.org_locations where workspace_id=v_workspace and unit_id=v_id and status='active')
          or exists(select 1 from d5o_hosted.connected_crew_profiles where workspace_id=v_workspace and primary_unit_id=v_id and active) then
          raise exception 'organization_unit_in_use' using errcode='23514'; end if;
        update d5o_hosted.org_units set status='retired',revision=revision+1,updated_at=now()
          where id=v_id returning to_jsonb(org_units.*) into v_after;
      else
        if v_parent=v_id or exists(with recursive ancestors as (
          select id,parent_id from d5o_hosted.org_units where workspace_id=v_workspace and id=v_parent
          union all select p.id,p.parent_id from d5o_hosted.org_units p join ancestors a on p.id=a.parent_id
            where p.workspace_id=v_workspace) select 1 from ancestors where id=v_id) then
          raise exception 'organization_cycle' using errcode='23514'; end if;
        update d5o_hosted.org_units set code=v_code,name=v_name,
          description=coalesce(p_input->>'description',''),parent_id=v_parent,manager_user_id=v_manager,
          revision=revision+1,updated_at=now() where id=v_id
          returning to_jsonb(org_units.*) into v_after;
      end if;
    end if;
  elsif p_action like 'location.%' then
    if p_action<>'location.retire' and (coalesce(p_input->>'country','') !~ '^[A-Z]{2}$'
      or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_input->>'timeZone')
      or pg_catalog.jsonb_typeof(coalesce(p_input->'address','{}'::jsonb))<>'object') then
      raise exception 'invalid_org_record' using errcode='22023'; end if;
    if p_action='location.create' then
      if p_expected_revision<>0 or p_subject_id is not null then raise exception 'stale_revision' using errcode='23505'; end if;
      insert into d5o_hosted.org_locations(workspace_id,code,name,address,country,time_zone,unit_id)
        values(v_workspace,v_code,v_name,coalesce(p_input->'address','{}'::jsonb),
          p_input->>'country',p_input->>'timeZone',v_unit)
        returning id,to_jsonb(org_locations.*) into v_id,v_after;
    else
      select to_jsonb(x) into v_before from d5o_hosted.org_locations x
        where workspace_id=v_workspace and id=v_id for update;
      if v_before is null then raise exception 'cross_tenant_reference' using errcode='23503'; end if;
      if (v_before->>'revision')::integer<>p_expected_revision then raise exception 'stale_revision' using errcode='23505'; end if;
      if p_action='location.retire' then
        if exists(select 1 from d5o_hosted.org_teams where workspace_id=v_workspace and primary_location_id=v_id and status='active')
          or exists(select 1 from d5o_hosted.connected_crew_profiles where workspace_id=v_workspace and primary_location_id=v_id and active) then
          raise exception 'organization_unit_in_use' using errcode='23514'; end if;
        update d5o_hosted.org_locations set status='retired',revision=revision+1,updated_at=now()
          where id=v_id returning to_jsonb(org_locations.*) into v_after;
      else
        update d5o_hosted.org_locations set code=v_code,name=v_name,
          address=coalesce(p_input->'address','{}'::jsonb),country=p_input->>'country',
          time_zone=p_input->>'timeZone',unit_id=v_unit,revision=revision+1,updated_at=now()
          where id=v_id returning to_jsonb(org_locations.*) into v_after;
      end if;
    end if;
  elsif p_action like 'team.%' then
    if p_action='team.create' then
      if p_expected_revision<>0 or p_subject_id is not null then raise exception 'stale_revision' using errcode='23505'; end if;
      insert into d5o_hosted.org_teams(workspace_id,code,name,description,manager_user_id,unit_id,primary_location_id)
        values(v_workspace,v_code,v_name,coalesce(p_input->>'description',''),v_manager,v_unit,v_location)
        returning id,to_jsonb(org_teams.*) into v_id,v_after;
    else
      select to_jsonb(x) into v_before from d5o_hosted.org_teams x
        where workspace_id=v_workspace and id=v_id for update;
      if v_before is null then raise exception 'cross_tenant_reference' using errcode='23503'; end if;
      if (v_before->>'revision')::integer<>p_expected_revision then raise exception 'stale_revision' using errcode='23505'; end if;
      if p_action='team.retire' then
        if exists(select 1 from d5o_hosted.org_team_members where workspace_id=v_workspace and team_id=v_id and status='active') then
          raise exception 'organization_unit_in_use' using errcode='23514'; end if;
        update d5o_hosted.org_teams set status='retired',revision=revision+1,updated_at=now()
          where id=v_id returning to_jsonb(org_teams.*) into v_after;
      else
        update d5o_hosted.org_teams set code=v_code,name=v_name,
          description=coalesce(p_input->>'description',''),manager_user_id=v_manager,
          unit_id=v_unit,primary_location_id=v_location,revision=revision+1,updated_at=now()
          where id=v_id returning to_jsonb(org_teams.*) into v_after;
      end if;
    end if;
  elsif p_action='team-member.add' then
    v_target:=nullif(p_input->>'memberUserId','')::uuid;
    v_person:=nullif(p_input->>'personId','')::uuid;
    if p_expected_revision<>0 or p_subject_id is not null or
      (v_target is null and v_person is null) or
      not exists(select 1 from d5o_hosted.org_teams where workspace_id=v_workspace
        and id=(p_input->>'teamId')::uuid and status='active') or
      (v_target is not null and not exists(select 1 from d5o_hosted.memberships
        where workspace_id=v_workspace and actor_user_id=v_target and status='active')) or
      (v_person is not null and not exists(select 1 from d5o_hosted.connected_crew_profiles
        where workspace_id=v_workspace and id=v_person and active
          and (v_target is null or actor_user_id=v_target))) then
      raise exception 'cross_tenant_reference' using errcode='23503'; end if;
    insert into d5o_hosted.org_team_members(workspace_id,team_id,member_user_id,person_id,effective_from)
      values(v_workspace,(p_input->>'teamId')::uuid,v_target,v_person,
        coalesce((p_input->>'effectiveFrom')::date,current_date))
      returning id,to_jsonb(org_team_members.*) into v_id,v_after;
  elsif p_action='team-member.end' then
    select to_jsonb(x) into v_before from d5o_hosted.org_team_members x
      where workspace_id=v_workspace and id=v_id for update;
    if v_before is null then raise exception 'cross_tenant_reference' using errcode='23503'; end if;
    if (v_before->>'revision')::integer<>p_expected_revision then raise exception 'stale_revision' using errcode='23505'; end if;
    update d5o_hosted.org_team_members set status='ended',effective_to=current_date,
      revision=revision+1,updated_at=now() where id=v_id
      returning to_jsonb(org_team_members.*) into v_after;
  elsif p_action='person.assign' then
    v_unit:=nullif(p_input->>'unitId','')::uuid;
    v_location:=nullif(p_input->>'locationId','')::uuid;
    select to_jsonb(x) into v_before from d5o_hosted.connected_crew_profiles x
      where workspace_id=v_workspace and id=v_id for update;
    if v_before is null then raise exception 'cross_tenant_reference' using errcode='23503'; end if;
    if (v_before->>'revision')::integer<>p_expected_revision then raise exception 'stale_revision' using errcode='23505'; end if;
    if (v_unit is not null and not exists(select 1 from d5o_hosted.org_units
        where workspace_id=v_workspace and id=v_unit and status='active')) or
       (v_location is not null and not exists(select 1 from d5o_hosted.org_locations
        where workspace_id=v_workspace and id=v_location and status='active')) then
      raise exception 'cross_tenant_reference' using errcode='23503'; end if;
    update d5o_hosted.connected_crew_profiles set primary_unit_id=v_unit,
      primary_location_id=v_location,revision=revision+1 where workspace_id=v_workspace and id=v_id
      returning to_jsonb(connected_crew_profiles.*) into v_after;
  else
    select to_jsonb(m) into v_before from d5o_hosted.memberships m
      where workspace_id=v_workspace and id=v_id for update;
    if v_before is null then raise exception 'cross_tenant_reference' using errcode='23503'; end if;
    if (v_before->>'revision')::integer<>p_expected_revision then raise exception 'stale_revision' using errcode='23505'; end if;
    v_target:=(v_before->>'actor_user_id')::uuid;
    if v_target=v_actor or v_before->>'role' in ('admin','field_worker') then
      raise exception 'role_assignment_forbidden' using errcode='42501'; end if;
    if p_action='member.role' then
      v_role:=p_input->>'role';
      if v_role not in ('executive','operations_leader','business_development_lead',
        'project_manager','billing_commercial_lead','field_supervisor','closeout_lead','read_only_auditor')
        or v_before->>'status'<>'active' then
        raise exception 'role_assignment_forbidden' using errcode='42501'; end if;
      update d5o_hosted.memberships set role=v_role,revision=revision+1 where id=v_id
        returning to_jsonb(memberships.*) into v_after;
    else
      v_status:=case p_action when 'member.suspend' then 'suspended'
        when 'member.reactivate' then 'active' else 'removed' end;
      if (p_action='member.reactivate' and v_before->>'status'<>'suspended')
        or (p_action in ('member.suspend','member.remove') and v_before->>'status'='removed') then
        raise exception 'stale_membership' using errcode='23505'; end if;
      update d5o_hosted.memberships set status=v_status,revision=revision+1 where id=v_id
        returning to_jsonb(memberships.*) into v_after;
      if p_action='member.remove' then
        update d5o_hosted.org_team_members set status='ended',effective_to=current_date,
          revision=revision+1,updated_at=now()
          where workspace_id=v_workspace and member_user_id=v_target and status='active';
        get diagnostics v_ended = row_count;
      end if;
    end if;
  end if;
  v_result:=pg_catalog.jsonb_build_object('id',v_id,'action',p_action,'record',v_after,
    'endedTeamAssignments',v_ended);
  insert into d5o_hosted.org_admin_events(workspace_id,command_id,actor_user_id,
    action,subject_id,reason,before_state,after_state)
    values(v_workspace,p_command_id,v_actor,p_action,v_id,trim(p_reason),v_before,v_after);
  insert into d5o_hosted.org_admin_receipts(workspace_id,command_id,actor_user_id,fingerprint,result)
    values(v_workspace,p_command_id,v_actor,v_fingerprint,v_result);
  return v_result;
end $$;
revoke all on function public.d5o_hosted_org_admin_command_v1(text,text,uuid,jsonb,integer,text,text)
  from public,anon,service_role;
grant execute on function public.d5o_hosted_org_admin_command_v1(text,text,uuid,jsonb,integer,text,text)
  to authenticated;

create function public.d5o_hosted_org_invitation_request_v1(
  p_workspace_key text,p_email text,p_role text,p_reason text,p_command_id text,
  p_expires_at timestamptz
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace uuid;v_existing uuid;v_status text;
  v_prior d5o_hosted.admin_identity_requests%rowtype;v_fingerprint text;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null or
    lower(trim(coalesce(p_email,''))) !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' or
    p_role not in ('executive','operations_leader','business_development_lead',
      'project_manager','billing_commercial_lead','field_supervisor','closeout_lead','read_only_auditor') or
    length(trim(coalesce(p_reason,''))) not between 8 and 500 or
    length(coalesce(p_command_id,'')) not between 8 and 120 or
    p_expires_at not between now()+interval '1 hour' and now()+interval '30 days' then
    raise exception 'invalid_invitation' using errcode='22023'; end if;
  select w.id into v_workspace from d5o_hosted.workspaces w join d5o_hosted.memberships m
    on m.workspace_id=w.id where w.workspace_key=p_workspace_key and w.status='active'
      and m.actor_user_id=v_actor and m.role='admin' and m.status='active';
  if v_workspace is null then raise exception 'admin_membership_required' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'd5o-invite:'||v_workspace::text||':'||lower(trim(p_email)),0));
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_workspace_key,lower(trim(p_email)),
    p_role,trim(p_reason),p_expires_at)::text);
  select * into v_prior from d5o_hosted.admin_identity_requests
    where workspace_id=v_workspace and command_id=p_command_id;
  if found then
    if v_prior.actor_user_id<>v_actor or v_prior.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return pg_catalog.jsonb_build_object('commandId',p_command_id,'status',v_prior.status,
      'providerRequired',v_prior.status='pending','replay',true);
  end if;
  if exists(select 1 from d5o_hosted.admin_identity_requests
    where workspace_id=v_workspace and action='invite' and target_email=lower(trim(p_email))
      and status in ('pending','provider_accepted','existing_confirmed','setup_completed')
      and expires_at>now()) then
    raise exception 'invitation_already_pending' using errcode='23505'; end if;
  select id into v_existing from auth.users where lower(email)=lower(trim(p_email))
    and email_confirmed_at is not null;
  if v_existing is not null and exists(select 1 from d5o_hosted.memberships
    where workspace_id=v_workspace and actor_user_id=v_existing and status='active') then
    raise exception 'membership_already_active' using errcode='23505'; end if;
  v_status:=case when v_existing is not null then 'existing_confirmed' else 'pending' end;
  insert into d5o_hosted.admin_identity_requests(workspace_id,command_id,actor_user_id,
    action,target_email,requested_role,reason,fingerprint,status,provider_user_id,
    resolved_at,expires_at)
    values(v_workspace,p_command_id,v_actor,'invite',lower(trim(p_email)),p_role,
      trim(p_reason),v_fingerprint,v_status,v_existing,
      case when v_existing is not null then now() else null end,p_expires_at);
  insert into d5o_hosted.org_admin_events(workspace_id,command_id,actor_user_id,
    action,reason,after_state)
    values(v_workspace,p_command_id,v_actor,'invitation.request',trim(p_reason),
      pg_catalog.jsonb_build_object('email',lower(trim(p_email)),'role',p_role,
        'status',v_status,'expiresAt',p_expires_at));
  return pg_catalog.jsonb_build_object('commandId',p_command_id,'status',v_status,
    'providerRequired',v_status='pending','replay',false);
end $$;
revoke all on function public.d5o_hosted_org_invitation_request_v1(text,text,text,text,text,timestamptz)
  from public,anon,service_role;
grant execute on function public.d5o_hosted_org_invitation_request_v1(text,text,text,text,text,timestamptz)
  to authenticated;

-- Only the server's Auth-admin client can record the external provider result;
-- it cannot create tenant access or change the invitation's proposed role.
create function public.d5o_hosted_org_invitation_finish_v1(
  p_workspace_key text,p_command_id text,p_admin_user_id uuid,p_admin_membership_id uuid,
  p_status text,p_provider_user_id uuid
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_workspace uuid;v_request d5o_hosted.admin_identity_requests%rowtype;
begin
  if current_setting('role',true)<>'service_role' or
    p_status not in ('provider_accepted','provider_rejected','uncertain') then
    raise exception 'invitation_finish_denied' using errcode='42501'; end if;
  select w.id into v_workspace from d5o_hosted.workspaces w join d5o_hosted.memberships m
    on m.workspace_id=w.id where w.workspace_key=p_workspace_key and w.status='active'
    and m.id=p_admin_membership_id and m.actor_user_id=p_admin_user_id
    and m.role='admin' and m.status='active';
  if v_workspace is null then raise exception 'admin_membership_required' using errcode='42501'; end if;
  select * into v_request from d5o_hosted.admin_identity_requests
    where workspace_id=v_workspace and command_id=p_command_id
      and actor_user_id=p_admin_user_id and action='invite' for update;
  if not found then raise exception 'invitation_missing' using errcode='23503'; end if;
  if v_request.status<>'pending' or v_request.expires_at<=now() then
    raise exception 'invitation_not_pending' using errcode='23505'; end if;
  update d5o_hosted.admin_identity_requests set status=p_status,
    provider_user_id=p_provider_user_id,resolved_at=now(),
    provider_message=case when p_status='provider_accepted' then 'Provider accepted; delivery unverified'
      else 'Provider did not confirm delivery' end
    where workspace_id=v_workspace and command_id=p_command_id;
  insert into d5o_hosted.org_admin_events(workspace_id,command_id,actor_user_id,
    action,reason,after_state)
    values(v_workspace,'delivery:'||p_command_id,p_admin_user_id,'invitation.delivery',
      v_request.reason,pg_catalog.jsonb_build_object('status',p_status));
  return pg_catalog.jsonb_build_object('status',p_status);
end $$;
revoke all on function public.d5o_hosted_org_invitation_finish_v1(text,text,uuid,uuid,text,uuid)
  from public,anon,authenticated;
grant execute on function public.d5o_hosted_org_invitation_finish_v1(text,text,uuid,uuid,text,uuid)
  to service_role;

create function public.d5o_hosted_org_invitation_revoke_v1(
  p_workspace_key text,p_command_id text,p_reason text
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace uuid;v_request d5o_hosted.admin_identity_requests%rowtype;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null or
    length(trim(coalesce(p_reason,''))) not between 8 and 500 then
    raise exception 'invitation_revoke_denied' using errcode='42501'; end if;
  select w.id into v_workspace from d5o_hosted.workspaces w join d5o_hosted.memberships m
    on m.workspace_id=w.id where w.workspace_key=p_workspace_key and w.status='active'
      and m.actor_user_id=v_actor and m.role='admin' and m.status='active';
  if v_workspace is null then raise exception 'admin_membership_required' using errcode='42501'; end if;
  select * into v_request from d5o_hosted.admin_identity_requests
    where workspace_id=v_workspace and command_id=p_command_id and action='invite' for update;
  if not found then raise exception 'invitation_missing' using errcode='23503'; end if;
  if v_request.status='revoked' then return pg_catalog.jsonb_build_object('status','revoked','replay',true); end if;
  if v_request.status='accepted' then raise exception 'invitation_already_accepted' using errcode='23505'; end if;
  update d5o_hosted.admin_identity_requests set status='revoked',revoked_at=now()
    where workspace_id=v_workspace and command_id=p_command_id;
  insert into d5o_hosted.org_admin_events(workspace_id,command_id,actor_user_id,
    action,reason,before_state,after_state)
    values(v_workspace,'revoke:'||p_command_id,v_actor,'invitation.revoke',trim(p_reason),
      pg_catalog.to_jsonb(v_request),pg_catalog.jsonb_build_object('status','revoked'));
  return pg_catalog.jsonb_build_object('status','revoked','replay',false);
end $$;
revoke all on function public.d5o_hosted_org_invitation_revoke_v1(text,text,text)
  from public,anon,service_role;
grant execute on function public.d5o_hosted_org_invitation_revoke_v1(text,text,text) to authenticated;

create function public.d5o_hosted_org_invitation_accept_v1(
  p_workspace_key text,p_command_id text
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace uuid;v_request d5o_hosted.admin_identity_requests%rowtype;
  v_email text;v_confirmed timestamptz;v_member d5o_hosted.memberships%rowtype;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null then
    raise exception 'invitation_accept_denied' using errcode='42501'; end if;
  select id into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  select * into v_request from d5o_hosted.admin_identity_requests
    where workspace_id=v_workspace and command_id=p_command_id and action='invite' for update;
  select lower(email),email_confirmed_at into v_email,v_confirmed from auth.users where id=v_actor;
  if v_request.command_id is null or v_email is distinct from v_request.target_email
    or v_confirmed is null or v_request.provider_user_id is distinct from v_actor then
    raise exception 'invitation_accept_denied' using errcode='42501'; end if;
  if v_request.status='accepted' then
    return pg_catalog.jsonb_build_object('status','accepted','replay',true); end if;
  if v_request.status='revoked' or v_request.expires_at<=now() then
    raise exception 'invitation_expired' using errcode='23514'; end if;
  if v_request.status not in ('provider_accepted','existing_confirmed','setup_completed') or
    v_request.requested_role not in ('executive','operations_leader','business_development_lead',
      'project_manager','billing_commercial_lead','field_supervisor','closeout_lead','read_only_auditor') then
    raise exception 'invitation_not_ready' using errcode='23514'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'd5o-member:'||v_workspace::text||':'||v_actor::text,0));
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace and actor_user_id=v_actor for update;
  if found then
    if v_member.status='active' and v_member.role=v_request.requested_role then null;
    elsif v_member.status='removed' then
      update d5o_hosted.memberships set status='active',role=v_request.requested_role,
        revision=revision+1 where id=v_member.id;
    else raise exception 'membership_conflict' using errcode='23505'; end if;
  else
    insert into d5o_hosted.memberships(workspace_id,actor_user_id,role,status)
      values(v_workspace,v_actor,v_request.requested_role,'active');
  end if;
  update d5o_hosted.admin_identity_requests set status='accepted',accepted_at=now()
    where workspace_id=v_workspace and command_id=p_command_id;
  insert into d5o_hosted.org_admin_events(workspace_id,command_id,actor_user_id,
    action,reason,after_state)
    values(v_workspace,'accept:'||p_command_id,v_actor,'invitation.accept',v_request.reason,
      pg_catalog.jsonb_build_object('email',v_email,'role',v_request.requested_role));
  return pg_catalog.jsonb_build_object('status','accepted','role',v_request.requested_role,'replay',false);
end $$;
revoke all on function public.d5o_hosted_org_invitation_accept_v1(text,text)
  from public,anon,service_role;
grant execute on function public.d5o_hosted_org_invitation_accept_v1(text,text) to authenticated;
