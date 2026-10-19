-- Read retained administration facts only for an active administrator of the
-- exact workspace. This does not expose auth.users or private event tables.
create function public.d5o_hosted_admin_directory_v1(
  p_workspace_key text, p_admin_user_id uuid, p_admin_membership_id uuid,
  p_search text default '', p_offset integer default 0, p_limit integer default 25,
  p_user_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_workspace uuid;
begin
  if current_setting('role', true) is distinct from 'service_role'
    or p_limit not between 1 and 50 or p_offset not between 0 and 10000
    or length(coalesce(p_search,'')) > 120 then
    raise exception 'admin_directory_denied' using errcode = '42501';
  end if;
  select w.id into v_workspace from d5o_hosted.workspaces w
    join d5o_hosted.memberships m on m.workspace_id=w.id
    where w.workspace_key=p_workspace_key and w.status='active'
      and m.id=p_admin_membership_id and m.actor_user_id=p_admin_user_id
      and m.role='admin' and m.status='active';
  if v_workspace is null then raise exception 'admin_membership_required' using errcode='42501'; end if;
  return (with filtered as (
    select m.id,m.actor_user_id,m.role,m.status,u.email,u.email_confirmed_at,
      u.created_at,u.last_sign_in_at,p.id as person_id,p.person,p.display_name,
      p.active as person_active,p.qualifications,p.weekly_capacity_hours,
      (select count(*) from d5o_hosted.connected_schedule_states s,
        lateral pg_catalog.jsonb_array_elements(coalesce(s.state->'assignments','[]'::jsonb)) a
        where s.workspace_id=v_workspace and p.id is not null
          and a->'people' ? p.person and (a->>'date')::date >= current_date) as future_assignments
    from d5o_hosted.memberships m join auth.users u on u.id=m.actor_user_id
    left join d5o_hosted.connected_crew_profiles p on p.workspace_id=m.workspace_id
      and p.actor_user_id=m.actor_user_id
    where m.workspace_id=v_workspace and (p_user_id is null or m.actor_user_id=p_user_id)
      and (coalesce(p_search,'')=''
      or u.email ilike '%'||p_search||'%' or p.display_name ilike '%'||p_search||'%')
  ), page as (select * from filtered order by email,actor_user_id offset p_offset limit p_limit)
  select pg_catalog.jsonb_build_object('total',(select count(*) from filtered),
    'offset',p_offset,'items',coalesce((select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object('membershipId',id,'userId',actor_user_id,
        'email',email,'confirmed',email_confirmed_at is not null,
        'createdAt',created_at,'lastSignInAt',last_sign_in_at,'role',role,
        'status',status,'personId',person_id,'person',person,
        'displayName',display_name,'personActive',person_active,
        'qualifications',qualifications,'weeklyCapacityHours',weekly_capacity_hours,
        'futureAssignments',future_assignments) order by email) from page),'[]'::jsonb)));
end; $$;
revoke all on function public.d5o_hosted_admin_directory_v1(text,uuid,uuid,text,integer,integer,uuid)
  from public,anon,authenticated;
grant execute on function public.d5o_hosted_admin_directory_v1(text,uuid,uuid,text,integer,integer,uuid)
  to service_role;

create function public.d5o_hosted_admin_audit_v1(
  p_workspace_key text, p_admin_user_id uuid, p_admin_membership_id uuid,
  p_actor text default '', p_action text default '', p_subject text default '',
  p_from date default null, p_to date default null,
  p_offset integer default 0, p_limit integer default 25
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_workspace uuid;
begin
  if current_setting('role', true) is distinct from 'service_role'
    or p_limit not between 1 and 50 or p_offset not between 0 and 10000
    or length(coalesce(p_actor,''))>120 or length(coalesce(p_action,''))>120
    or length(coalesce(p_subject,''))>120 then
    raise exception 'admin_audit_denied' using errcode='42501';
  end if;
  select w.id into v_workspace from d5o_hosted.workspaces w
    join d5o_hosted.memberships m on m.workspace_id=w.id
    where w.workspace_key=p_workspace_key and w.status='active'
      and m.id=p_admin_membership_id and m.actor_user_id=p_admin_user_id
      and m.role='admin' and m.status='active';
  if v_workspace is null then raise exception 'admin_membership_required' using errcode='42501'; end if;
  return (with events as (
    select e.occurred_at at_time,e.actor_user_id actor_id,e.action action_name,
      e.target_user_id::text subject_id,e.command_id reference,
      'Membership role '||coalesce(e.previous_role,'none')||' → '||e.assigned_role||
        coalesce(' · Reason: '||r.reason,' · Reason not retained') detail
      from d5o_hosted.membership_assignment_events e
      left join d5o_hosted.admin_membership_reasons r
        on r.workspace_id=e.workspace_id and r.command_id=e.command_id
      where e.workspace_id=v_workspace
    union all select e.occurred_at,e.actor_user_id,'admin.succession',
      e.target_user_id::text,e.command_id,e.reason
      from d5o_hosted.admin_succession_events e where e.workspace_id=v_workspace
    union all select e.created_at,e.actor_user_id,'identity.'||e.action,
      e.target_email,e.command_id,e.status||' · '||e.reason
      from d5o_hosted.admin_identity_requests e where e.workspace_id=v_workspace
    union all select e.occurred_at,e.actor_user_id,'workforce.'||e.action,
      coalesce(e.result->>'id',''),e.command_id,
      'Roster revision '||coalesce(e.result->>'revision','unknown')
      from d5o_hosted.connected_workforce_commands e where e.workspace_id=v_workspace
    union all select e.at,e.actor_user_id,'binding.'||e.action,
      e.worker_user_id::text,e.id::text,'Roster person '||e.person
      from d5o_hosted.crew_binding_events e where e.workspace_id=v_workspace
    union all select e.occurred_at,e.actor_user_id,'binding.corrected',
      e.person_id::text,e.command_id,e.reason||' · Original and replacement account identities retained'
      from d5o_hosted.admin_binding_corrections e where e.workspace_id=v_workspace
    union all select e.occurred_at,e.actor_user_id,'configuration.'||e.action,
      e.configuration_version_id::text,e.command_id,
      coalesce(e.route_key,'version')||' → '||coalesce(e.receiving_role,'recorded')
      from d5o_hosted.handoff_configuration_events e where e.workspace_id=v_workspace
    union all select e.published_at,e.actor_user_id,'configuration.first-published',
      e.version_id::text,e.command_id,e.reason
      from d5o_hosted.initial_configuration_events e where e.workspace_id=v_workspace
    union all select e.occurred_at,e.actor_user_id,'delegation.'||e.action,
      e.rule_id::text,e.command_id,coalesce(e.basis->>'reason','Reason not recorded')
      from d5o_hosted.spending_delegate_events e where e.workspace_id=v_workspace
    union all select e.occurred_at,e.actor_user_id,'rate.'||e.action,
      e.rate_id::text,e.command_id,coalesce(e.basis->>'reason','Reason not recorded')
      from d5o_hosted.design_internal_rate_events e where e.workspace_id=v_workspace
  ), filtered as (
    select e.*,u.email actor_email from events e join auth.users u on u.id=e.actor_id
    where (coalesce(p_actor,'')='' or u.email ilike '%'||p_actor||'%')
      and (coalesce(p_action,'')='' or e.action_name ilike '%'||p_action||'%')
      and (coalesce(p_subject,'')='' or e.subject_id ilike '%'||p_subject||'%'
        or e.detail ilike '%'||p_subject||'%')
      and (p_from is null or e.at_time::date>=p_from)
      and (p_to is null or e.at_time::date<=p_to)
  ), page as (select * from filtered order by at_time desc,reference desc
    offset p_offset limit p_limit)
  select pg_catalog.jsonb_build_object('total',(select count(*) from filtered),
    'offset',p_offset,'items',coalesce((select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object('at',at_time,'actor',actor_email,'action',action_name,
        'subject',subject_id,'reference',reference,'detail',detail)
      order by at_time desc,reference desc) from page),'[]'::jsonb)));
end; $$;
revoke all on function public.d5o_hosted_admin_audit_v1(text,uuid,uuid,text,text,text,date,date,integer,integer)
  from public,anon,authenticated;
grant execute on function public.d5o_hosted_admin_audit_v1(text,uuid,uuid,text,text,text,date,date,integer,integer)
  to service_role;

create function public.d5o_hosted_admin_receipt_v1(
  p_workspace_key text,p_admin_user_id uuid,p_admin_membership_id uuid,p_command_id text
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_workspace uuid; v_source text; v_result jsonb;
begin
  if current_setting('role',true) is distinct from 'service_role'
    or length(coalesce(p_command_id,'')) not between 8 and 120 then
    raise exception 'admin_receipt_denied' using errcode='42501'; end if;
  select w.id into v_workspace from d5o_hosted.workspaces w
    join d5o_hosted.memberships m on m.workspace_id=w.id
    where w.workspace_key=p_workspace_key and w.status='active'
      and m.id=p_admin_membership_id and m.actor_user_id=p_admin_user_id
      and m.role='admin' and m.status='active';
  if v_workspace is null then raise exception 'admin_membership_required' using errcode='42501'; end if;
  select 'membership',pg_catalog.jsonb_build_object('action',e.action,'subject',e.target_user_id)
    into v_source,v_result from d5o_hosted.membership_assignment_events e
    where e.workspace_id=v_workspace and e.command_id=p_command_id and e.actor_user_id=p_admin_user_id;
  if v_source is null then
    select 'workforce',c.result into v_source,v_result
      from d5o_hosted.connected_workforce_commands c
      where c.workspace_id=v_workspace and c.command_id=p_command_id and c.actor_user_id=p_admin_user_id;
  end if;
  if v_source is null then
    select 'handoff',r.result into v_source,v_result
      from d5o_hosted.handoff_configuration_receipts r
      where r.workspace_id=v_workspace and r.command_id=p_command_id and r.actor_user_id=p_admin_user_id;
  end if;
  if v_source is null then
    select 'delegation',r.result into v_source,v_result
      from d5o_hosted.spending_delegate_receipts r
      where r.workspace_id=v_workspace and r.command_id=p_command_id and r.actor_user_id=p_admin_user_id;
  end if;
  if v_source is null then
    select 'rate',r.result into v_source,v_result
      from d5o_hosted.design_internal_rate_receipts r
      where r.workspace_id=v_workspace and r.command_id=p_command_id and r.actor_user_id=p_admin_user_id;
  end if;
  if v_source is null then
    select 'admin_succession',pg_catalog.jsonb_build_object('subject',e.target_user_id)
      into v_source,v_result from d5o_hosted.admin_succession_events e
      where e.workspace_id=v_workspace and e.command_id=p_command_id
        and e.actor_user_id=p_admin_user_id;
  end if;
  if v_source is null then
    select 'binding_correction',pg_catalog.jsonb_build_object('personId',e.person_id,'revision',e.workforce_revision)
      into v_source,v_result from d5o_hosted.admin_binding_corrections e
      where e.workspace_id=v_workspace and e.command_id=p_command_id
        and e.actor_user_id=p_admin_user_id;
  end if;
  if v_source is null then
    select 'identity',pg_catalog.jsonb_build_object('status',e.status,'action',e.action)
      into v_source,v_result from d5o_hosted.admin_identity_requests e
      where e.workspace_id=v_workspace and e.command_id=p_command_id
        and e.actor_user_id=p_admin_user_id;
  end if;
  return pg_catalog.jsonb_build_object('found',v_source is not null,'source',v_source,'result',v_result);
end; $$;
revoke all on function public.d5o_hosted_admin_receipt_v1(text,uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.d5o_hosted_admin_receipt_v1(text,uuid,uuid,text) to service_role;

-- A reason is attached in the same transaction as the existing replay-protected
-- membership command. Earlier events without a reason remain truthful.
create table d5o_hosted.admin_membership_reasons (
  workspace_id uuid not null references d5o_hosted.workspaces(id),
  command_id text not null, actor_user_id uuid not null references auth.users(id),
  reason text not null check(length(trim(reason)) between 8 and 500),
  fingerprint text not null,
  primary key(workspace_id,command_id),
  foreign key(workspace_id,command_id)
    references d5o_hosted.membership_assignment_events(workspace_id,command_id)
);
alter table d5o_hosted.admin_membership_reasons enable row level security;
revoke all on d5o_hosted.admin_membership_reasons from public,anon,authenticated,service_role;

create function public.d5o_hosted_admin_membership_change_v1(
  p_workspace_key text,p_admin_user_id uuid,p_admin_membership_id uuid,
  p_member_email text,p_action text,p_role text,p_expected_role text,
  p_expected_status text,p_reason text,p_command_id text
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_workspace uuid;v_target uuid;v_current d5o_hosted.memberships%rowtype;
  v_prior d5o_hosted.membership_assignment_events%rowtype;v_annotation d5o_hosted.admin_membership_reasons%rowtype;
  v_fingerprint text;
  v_result jsonb;
begin
  if current_setting('role',true) is distinct from 'service_role'
    or p_action not in ('assign','suspend')
    or length(trim(coalesce(p_reason,''))) not between 8 and 500
    or (p_expected_status is not null and p_expected_status not in ('active','suspended')) then
    raise exception 'invalid_membership_change' using errcode='22023'; end if;
  select w.id into v_workspace from d5o_hosted.workspaces w
    join d5o_hosted.memberships m on m.workspace_id=w.id
    where w.workspace_key=p_workspace_key and w.status='active'
      and m.id=p_admin_membership_id and m.actor_user_id=p_admin_user_id
      and m.role='admin' and m.status='active';
  if v_workspace is null then raise exception 'admin_membership_required' using errcode='42501'; end if;
  select id into v_target from auth.users where lower(email)=lower(trim(p_member_email))
    and email_confirmed_at is not null;
  if v_target is null then raise exception 'confirmed_member_missing' using errcode='23503'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(
    p_workspace_key,p_admin_user_id,p_member_email,p_action,p_role,
    p_expected_role,p_expected_status,trim(p_reason))::text);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'd5o-member:'||v_workspace::text||':'||v_target::text,0));
  select * into v_prior from d5o_hosted.membership_assignment_events
    where workspace_id=v_workspace and command_id=p_command_id;
  if found then
    select * into v_annotation from d5o_hosted.admin_membership_reasons
      where workspace_id=v_workspace and command_id=p_command_id;
    if v_annotation.fingerprint is distinct from v_fingerprint then
      raise exception 'command_id_reused' using errcode='23505'; end if;
  else
    select * into v_current from d5o_hosted.memberships
      where workspace_id=v_workspace and actor_user_id=v_target for update;
    if (v_current.id is null and p_expected_status is not null)
      or (v_current.id is not null and v_current.status is distinct from p_expected_status) then
      raise exception 'stale_membership' using errcode='23505'; end if;
  end if;
  if p_action='suspend' then
    v_result:=public.d5o_hosted_suspend_member_v1(p_workspace_key,p_admin_user_id,
      p_admin_membership_id,p_member_email,p_expected_role,p_command_id);
  else
    v_result:=public.d5o_hosted_assign_member_v1(p_workspace_key,p_admin_user_id,
      p_admin_membership_id,p_member_email,p_role,p_expected_role,p_command_id);
  end if;
  if exists(select 1 from d5o_hosted.membership_assignment_events
      where workspace_id=v_workspace and command_id=p_command_id) then
    insert into d5o_hosted.admin_membership_reasons(workspace_id,command_id,actor_user_id,reason,fingerprint)
      values(v_workspace,p_command_id,p_admin_user_id,trim(p_reason),v_fingerprint) on conflict do nothing;
  end if;
  return v_result;
end; $$;
revoke all on function public.d5o_hosted_admin_membership_change_v1(text,uuid,uuid,text,text,text,text,text,text,text)
  from public,anon,authenticated;
grant execute on function public.d5o_hosted_admin_membership_change_v1(text,uuid,uuid,text,text,text,text,text,text,text)
  to service_role;

-- Succession adds a second confirmed administrator without allowing self
-- promotion, changing worker bindings, or removing the last usable admin.
create table d5o_hosted.admin_succession_events (
  workspace_id uuid not null references d5o_hosted.workspaces(id),
  command_id text not null,actor_user_id uuid not null references auth.users(id),
  target_user_id uuid not null references auth.users(id),previous_role text,
  reason text not null,occurred_at timestamptz not null default now(),
  primary key(workspace_id,command_id)
);
alter table d5o_hosted.admin_succession_events enable row level security;
revoke all on d5o_hosted.admin_succession_events from public,anon,authenticated,service_role;
create function public.d5o_hosted_admin_succession_v1(
  p_workspace_key text,p_admin_user_id uuid,p_admin_membership_id uuid,
  p_target_email text,p_reason text,p_command_id text
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_workspace uuid;v_target uuid;v_member d5o_hosted.memberships%rowtype;
  v_prior d5o_hosted.admin_succession_events%rowtype;
begin
  if current_setting('role',true) is distinct from 'service_role'
    or length(trim(coalesce(p_reason,''))) not between 12 and 500
    or length(coalesce(p_command_id,'')) not between 8 and 120 then
    raise exception 'invalid_admin_succession' using errcode='22023'; end if;
  select w.id into v_workspace from d5o_hosted.workspaces w
    join d5o_hosted.memberships m on m.workspace_id=w.id
    where w.workspace_key=p_workspace_key and w.status='active'
      and m.id=p_admin_membership_id and m.actor_user_id=p_admin_user_id
      and m.role='admin' and m.status='active';
  if v_workspace is null then raise exception 'admin_membership_required' using errcode='42501'; end if;
  select id into v_target from auth.users where lower(email)=lower(trim(p_target_email))
    and email_confirmed_at is not null;
  if v_target is null or v_target=p_admin_user_id then
    raise exception 'confirmed_independent_account_required' using errcode='23503'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'd5o-member:'||v_workspace::text||':'||v_target::text,0));
  select * into v_prior from d5o_hosted.admin_succession_events
    where workspace_id=v_workspace and command_id=p_command_id;
  if found then
    if v_prior.actor_user_id<>p_admin_user_id or v_prior.target_user_id<>v_target
      or v_prior.reason<>trim(p_reason) then
      raise exception 'command_id_reused' using errcode='23505'; end if;
    return pg_catalog.jsonb_build_object('userId',v_target,'action','admin_succession','replay',true);
  end if;
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace and actor_user_id=v_target for update;
  if v_member.role='field_worker' or v_member.role='admin' then
    raise exception 'protected_membership' using errcode='42501'; end if;
  if exists(select 1 from d5o_hosted.crew_bindings
      where workspace_id=v_workspace and actor_user_id=v_target and active) then
    raise exception 'worker_binding_conflict' using errcode='23505'; end if;
  if v_member.id is null then
    insert into d5o_hosted.memberships(workspace_id,actor_user_id,role,status)
      values(v_workspace,v_target,'admin','active');
  else
    update d5o_hosted.memberships set role='admin',status='active' where id=v_member.id;
  end if;
  insert into d5o_hosted.admin_succession_events
    (workspace_id,command_id,actor_user_id,target_user_id,previous_role,reason)
    values(v_workspace,p_command_id,p_admin_user_id,v_target,v_member.role,trim(p_reason));
  return pg_catalog.jsonb_build_object('userId',v_target,'action','admin_succession');
end; $$;
revoke all on function public.d5o_hosted_admin_succession_v1(text,uuid,uuid,text,text,text)
  from public,anon,authenticated;
grant execute on function public.d5o_hosted_admin_succession_v1(text,uuid,uuid,text,text,text)
  to service_role;

-- Current binding may be corrected only when no forthcoming assignment still
-- names this roster person. Historical worker events/reports remain attributed
-- to their original account; no evidence is transferred to the replacement.
create table d5o_hosted.admin_binding_corrections (
  workspace_id uuid not null references d5o_hosted.workspaces(id),
  command_id text not null,person_id uuid not null,
  old_user_id uuid not null references auth.users(id),
  new_user_id uuid not null references auth.users(id),
  actor_user_id uuid not null references auth.users(id),
  reason text not null check(length(trim(reason)) between 12 and 500),
  fingerprint text not null,workforce_revision integer not null,
  occurred_at timestamptz not null default now(),
  primary key(workspace_id,command_id)
);
alter table d5o_hosted.admin_binding_corrections enable row level security;
revoke all on d5o_hosted.admin_binding_corrections from public,anon,authenticated,service_role;

create function public.d5o_hosted_correct_worker_binding_v1(
  p_workspace_key text,p_person_id uuid,p_new_email text,p_reason text,
  p_expected_revision integer,p_command_id text
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace uuid;
  v_profile d5o_hosted.connected_crew_profiles%rowtype;
  v_state d5o_hosted.connected_workforce_states%rowtype;
  v_new_user uuid;v_prior d5o_hosted.admin_binding_corrections%rowtype;
  v_fingerprint text;v_result jsonb;
begin
  if current_setting('role',true) is distinct from 'authenticated' or v_actor is null
    or length(trim(coalesce(p_reason,''))) not between 12 and 500
    or length(coalesce(p_command_id,'')) not between 8 and 120
    or p_expected_revision is null or p_expected_revision<0 then
    raise exception 'invalid_binding_correction' using errcode='22023'; end if;
  select w.id into v_workspace from d5o_hosted.workspaces w
    join d5o_hosted.memberships m on m.workspace_id=w.id
    where w.workspace_key=p_workspace_key and w.status='active'
      and m.actor_user_id=v_actor and m.status='active' and m.role='admin';
  if v_workspace is null then raise exception 'admin_membership_required' using errcode='42501'; end if;
  select * into v_state from d5o_hosted.connected_workforce_states
    where workspace_id=v_workspace for update;
  if not found then raise exception 'workforce_missing' using errcode='23503'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(
    p_workspace_key,p_person_id,lower(trim(p_new_email)),trim(p_reason),p_expected_revision)::text);
  select * into v_prior from d5o_hosted.admin_binding_corrections
    where workspace_id=v_workspace and command_id=p_command_id;
  if found then
    if v_prior.actor_user_id<>v_actor or v_prior.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return pg_catalog.jsonb_build_object('personId',p_person_id,
      'newUserId',v_prior.new_user_id,'revision',v_prior.workforce_revision,'replay',true);
  end if;
  if v_state.revision<>p_expected_revision then
    raise exception 'stale_workforce' using errcode='23505'; end if;
  select * into v_profile from d5o_hosted.connected_crew_profiles
    where workspace_id=v_workspace and id=p_person_id for update;
  if not found or v_profile.actor_user_id is null then
    raise exception 'current_binding_required' using errcode='23514'; end if;
  select id into v_new_user from auth.users
    where lower(email)=lower(trim(p_new_email)) and email_confirmed_at is not null;
  if v_new_user is null or v_new_user=v_actor or v_new_user=v_profile.actor_user_id then
    raise exception 'different_confirmed_account_required' using errcode='23503'; end if;
  if exists(select 1 from d5o_hosted.memberships m
      where m.workspace_id=v_workspace and m.actor_user_id=v_new_user
        and m.role<>'field_worker')
    or exists(select 1 from d5o_hosted.connected_crew_profiles p
      where p.workspace_id=v_workspace and p.actor_user_id=v_new_user)
    or exists(select 1 from d5o_hosted.crew_bindings b
      where b.workspace_id=v_workspace and b.actor_user_id=v_new_user) then
    raise exception 'replacement_account_already_bound' using errcode='23505'; end if;
  if exists(select 1 from d5o_hosted.connected_schedule_states s,
      lateral pg_catalog.jsonb_array_elements(coalesce(s.state->'assignments','[]'::jsonb)) a
      where s.workspace_id=v_workspace and a->'people' ? v_profile.person
        and (a->>'date')::date>=current_date)
    or exists(select 1 from d5o_hosted.connected_schedule_states s,
      lateral pg_catalog.jsonb_array_elements(coalesce(s.state->'publications','[]'::jsonb)) pub,
      lateral pg_catalog.jsonb_array_elements(coalesce(pub->'assignments','[]'::jsonb)) a
      where s.workspace_id=v_workspace and a->'people' ? v_profile.person
        and (a->>'date')::date>=current_date) then
    raise exception 'future_booking_requires_schedule_correction' using errcode='23514'; end if;
  update d5o_hosted.memberships set status='suspended'
    where workspace_id=v_workspace and actor_user_id=v_profile.actor_user_id
      and role='field_worker';
  delete from d5o_hosted.crew_bindings where workspace_id=v_workspace
    and actor_user_id=v_profile.actor_user_id and person=v_profile.person;
  insert into d5o_hosted.memberships(workspace_id,actor_user_id,role,status)
    values(v_workspace,v_new_user,'field_worker','active')
    on conflict(workspace_id,actor_user_id) do update set status='active'
      where d5o_hosted.memberships.role='field_worker';
  insert into d5o_hosted.crew_bindings(workspace_id,actor_user_id,person,active)
    values(v_workspace,v_new_user,v_profile.person,v_profile.active);
  update d5o_hosted.connected_crew_profiles set actor_user_id=v_new_user,revision=revision+1
    where workspace_id=v_workspace and id=p_person_id;
  update d5o_hosted.connected_workforce_states set revision=revision+1
    where workspace_id=v_workspace;
  insert into d5o_hosted.admin_binding_corrections
    (workspace_id,command_id,person_id,old_user_id,new_user_id,actor_user_id,
      reason,fingerprint,workforce_revision)
    values(v_workspace,p_command_id,p_person_id,v_profile.actor_user_id,v_new_user,
      v_actor,trim(p_reason),v_fingerprint,v_state.revision+1);
  v_result:=pg_catalog.jsonb_build_object('personId',p_person_id,
    'newUserId',v_new_user,'revision',v_state.revision+1);
  return v_result;
end; $$;
revoke all on function public.d5o_hosted_correct_worker_binding_v1(text,uuid,text,text,integer,text)
  from public,anon,service_role;
grant execute on function public.d5o_hosted_correct_worker_binding_v1(text,uuid,text,text,integer,text)
  to authenticated;

-- External Auth email calls cannot be part of a database transaction. Reserve
-- one exact intent before calling the provider; an uncertain attempt is never
-- automatically repeated with a fresh command identity.
create table d5o_hosted.admin_identity_requests (
  workspace_id uuid not null references d5o_hosted.workspaces(id),
  command_id text not null,actor_user_id uuid not null references auth.users(id),
  action text not null check(action in ('invite','recovery')),
  target_email text not null,reason text not null,
  fingerprint text not null,
  status text not null check(status in ('pending','provider_accepted','provider_rejected','uncertain')),
  provider_user_id uuid,provider_message text,
  created_at timestamptz not null default now(),resolved_at timestamptz,
  primary key(workspace_id,command_id)
);
alter table d5o_hosted.admin_identity_requests enable row level security;
revoke all on d5o_hosted.admin_identity_requests from public,anon,authenticated,service_role;
create function public.d5o_hosted_admin_identity_intent_v1(
  p_workspace_key text,p_admin_user_id uuid,p_admin_membership_id uuid,
  p_action text,p_target_email text,p_reason text,p_command_id text
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_workspace uuid;v_prior d5o_hosted.admin_identity_requests%rowtype;v_fingerprint text;
begin
  if current_setting('role',true) is distinct from 'service_role'
    or p_action not in ('invite','recovery')
    or lower(trim(coalesce(p_target_email,''))) !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
    or length(trim(coalesce(p_reason,''))) not between 8 and 500
    or length(coalesce(p_command_id,'')) not between 8 and 120 then
    raise exception 'invalid_identity_request' using errcode='22023'; end if;
  select w.id into v_workspace from d5o_hosted.workspaces w
    join d5o_hosted.memberships m on m.workspace_id=w.id
    where w.workspace_key=p_workspace_key and w.status='active'
      and m.id=p_admin_membership_id and m.actor_user_id=p_admin_user_id
      and m.role='admin' and m.status='active';
  if v_workspace is null then raise exception 'admin_membership_required' using errcode='42501'; end if;
  if p_action='recovery' and not exists(select 1 from d5o_hosted.memberships m
      join auth.users u on u.id=m.actor_user_id
      where m.workspace_id=v_workspace and lower(u.email)=lower(trim(p_target_email))) then
    raise exception 'workspace_account_required' using errcode='23503'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(
    p_workspace_key,p_admin_user_id,p_action,lower(trim(p_target_email)),trim(p_reason))::text);
  select * into v_prior from d5o_hosted.admin_identity_requests
    where workspace_id=v_workspace and command_id=p_command_id for update;
  if found then
    if v_prior.fingerprint<>v_fingerprint then
      raise exception 'command_id_reused' using errcode='23505'; end if;
    return pg_catalog.jsonb_build_object('fresh',false,'status',v_prior.status);
  end if;
  insert into d5o_hosted.admin_identity_requests
    (workspace_id,command_id,actor_user_id,action,target_email,reason,fingerprint,status)
    values(v_workspace,p_command_id,p_admin_user_id,p_action,
      lower(trim(p_target_email)),trim(p_reason),v_fingerprint,'pending');
  return pg_catalog.jsonb_build_object('fresh',true,'status','pending');
end; $$;
revoke all on function public.d5o_hosted_admin_identity_intent_v1(text,uuid,uuid,text,text,text,text)
  from public,anon,authenticated;
grant execute on function public.d5o_hosted_admin_identity_intent_v1(text,uuid,uuid,text,text,text,text)
  to service_role;

create function public.d5o_hosted_admin_identity_finish_v1(
  p_workspace_key text,p_admin_user_id uuid,p_admin_membership_id uuid,
  p_command_id text,p_status text,p_provider_user_id uuid,p_provider_message text
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_workspace uuid;v_request d5o_hosted.admin_identity_requests%rowtype;
begin
  if current_setting('role',true) is distinct from 'service_role'
    or p_status not in ('provider_accepted','provider_rejected','uncertain')
    or length(coalesce(p_provider_message,''))>240 then
    raise exception 'invalid_identity_result' using errcode='22023'; end if;
  select w.id into v_workspace from d5o_hosted.workspaces w
    join d5o_hosted.memberships m on m.workspace_id=w.id
    where w.workspace_key=p_workspace_key and w.status='active'
      and m.id=p_admin_membership_id and m.actor_user_id=p_admin_user_id
      and m.role='admin' and m.status='active';
  if v_workspace is null then raise exception 'admin_membership_required' using errcode='42501'; end if;
  select * into v_request from d5o_hosted.admin_identity_requests
    where workspace_id=v_workspace and command_id=p_command_id
      and actor_user_id=p_admin_user_id for update;
  if not found then raise exception 'identity_intent_missing' using errcode='23503'; end if;
  if v_request.status<>'pending' then
    if v_request.status<>p_status or v_request.provider_user_id is distinct from p_provider_user_id then
      raise exception 'identity_result_conflict' using errcode='23505'; end if;
    return pg_catalog.jsonb_build_object('status',v_request.status,'replay',true);
  end if;
  update d5o_hosted.admin_identity_requests set status=p_status,
    provider_user_id=p_provider_user_id,provider_message=p_provider_message,
    resolved_at=now() where workspace_id=v_workspace and command_id=p_command_id;
  return pg_catalog.jsonb_build_object('status',p_status);
end; $$;
revoke all on function public.d5o_hosted_admin_identity_finish_v1(text,uuid,uuid,text,text,uuid,text)
  from public,anon,authenticated;
grant execute on function public.d5o_hosted_admin_identity_finish_v1(text,uuid,uuid,text,text,uuid,text)
  to service_role;
