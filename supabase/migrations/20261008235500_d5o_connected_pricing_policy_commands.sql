-- The isolated pilot's Develop policy is administered by authenticated intent.
-- Draft, publication and activation live outside the generic Work snapshot.
create table d5o_hosted.connected_pricing_policies (
  workspace_id uuid not null references d5o_hosted.workspaces(id),
  policy_id text not null,version integer not null check (version>0),
  status text not null check (status in ('draft','published','superseded')),
  payload jsonb not null check (pg_catalog.jsonb_typeof(payload)='object'),
  updated_at timestamptz not null default now(),
  primary key (workspace_id,policy_id,version)
);
create table d5o_hosted.connected_pricing_active (
  workspace_id uuid primary key references d5o_hosted.workspaces(id),
  policy_id text not null,version integer not null,
  foreign key (workspace_id,policy_id,version)
    references d5o_hosted.connected_pricing_policies(workspace_id,policy_id,version)
);
create table d5o_hosted.connected_pricing_events (
  workspace_id uuid not null references d5o_hosted.workspaces(id),
  command_id text not null,action text not null,
  policy_id text not null,version integer not null,
  actor_user_id uuid not null references auth.users(id),
  membership_id uuid not null references d5o_hosted.memberships(id),
  occurred_at timestamptz not null default now(),
  primary key (workspace_id,command_id)
);
create table d5o_hosted.connected_pricing_receipts (
  workspace_id uuid not null references d5o_hosted.workspaces(id),
  command_id text not null,actor_user_id uuid not null references auth.users(id),
  fingerprint text not null,result jsonb not null,
  primary key (workspace_id,command_id)
);
alter table d5o_hosted.connected_pricing_policies enable row level security;
alter table d5o_hosted.connected_pricing_active enable row level security;
alter table d5o_hosted.connected_pricing_events enable row level security;
alter table d5o_hosted.connected_pricing_receipts enable row level security;
revoke all on d5o_hosted.connected_pricing_policies,d5o_hosted.connected_pricing_active,
  d5o_hosted.connected_pricing_events,d5o_hosted.connected_pricing_receipts
  from public,anon,authenticated;

-- Keep the accepted pursuit, Define and solution overlays from the prior
-- migration, then compose the separately governed pricing policy projection.
create function d5o_hosted.connected_solution_projection_v1(p_workspace uuid,p_state jsonb)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when p_state is null then null else
    pg_catalog.jsonb_set(p_state,'{records}',coalesce((
      select pg_catalog.jsonb_agg(
        case when s.work_id is null then defined else
          defined||pg_catalog.jsonb_build_object(
            'develop',coalesce(defined->'develop','{}'::jsonb)||
              pg_catalog.jsonb_build_object('review',s.review,
                'authorityRevision',s.decision_revision),
            'nextAction',case when s.source_digest is distinct from
              d5o_hosted.connected_solution_digest_v1(item->'develop') then
              'Solution changed: submit a new revision for review'
              else s.next_action end) end order by ordinal)
      from pg_catalog.jsonb_array_elements(coalesce(p_state->'records','[]'::jsonb))
        with ordinality as records(item,ordinal)
      left join d5o_hosted.work_identity_links l on l.workspace_id=p_workspace
        and l.presentation_id=item->>'id'
      left join d5o_hosted.connected_define_states d on d.workspace_id=p_workspace
        and d.work_id=l.work_id
      left join d5o_hosted.connected_solution_states s on s.workspace_id=p_workspace
        and s.work_id=l.work_id
      cross join lateral (select coalesce(d5o_hosted.connected_pursuit_record_v1(
        p_workspace,item),item) as base) pursuit
      cross join lateral (select case when d.work_id is null then base else
        base||pg_catalog.jsonb_build_object('definition',d.projection,
          'nextAction',d.next_action) end as defined) definition
    ),'[]'::jsonb)) end;
$$;
revoke all on function d5o_hosted.connected_solution_projection_v1(uuid,jsonb)
  from public,anon,authenticated,service_role;

create function d5o_hosted.connected_pricing_projection_v1(p_workspace uuid,p_state jsonb)
returns jsonb language sql stable security definer set search_path='' as $$
  select d5o_hosted.connected_solution_projection_v1(p_workspace,p_state)||
    pg_catalog.jsonb_build_object(
      'pricingPolicies',case when exists(select 1 from d5o_hosted.connected_pricing_policies
        where workspace_id=p_workspace) then coalesce((select pg_catalog.jsonb_agg(
        payload order by policy_id,version) from d5o_hosted.connected_pricing_policies
        where workspace_id=p_workspace),'[]'::jsonb)
        else coalesce(p_state->'pricingPolicies','[]'::jsonb) end,
      'activePricingPolicy',case when exists(select 1 from d5o_hosted.connected_pricing_policies
        where workspace_id=p_workspace) then
        (select pg_catalog.jsonb_build_object('id',policy_id,'version',version)
          from d5o_hosted.connected_pricing_active where workspace_id=p_workspace)
        else p_state->'activePricingPolicy' end,
      'pricingPolicyHistory',case when exists(select 1 from d5o_hosted.connected_pricing_policies
        where workspace_id=p_workspace) then coalesce((select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object('at',occurred_at,'action',action,
          'policyId',policy_id,'version',version,'actorId',actor_user_id)
        order by occurred_at,command_id)
        from d5o_hosted.connected_pricing_events where workspace_id=p_workspace),'[]'::jsonb)
        else coalesce(p_state->'pricingPolicyHistory','[]'::jsonb) end);
$$;
revoke all on function d5o_hosted.connected_pricing_projection_v1(uuid,jsonb)
  from public,anon,authenticated,service_role;

create or replace function d5o_hosted.connected_define_projection_v1(p_workspace uuid,p_state jsonb)
returns jsonb language sql stable security definer set search_path='' as $$
  select d5o_hosted.connected_pricing_projection_v1(p_workspace,p_state);
$$;
revoke all on function d5o_hosted.connected_define_projection_v1(uuid,jsonb)
  from public,anon,authenticated,service_role;

create function public.d5o_hosted_pricing_policy_command_v1(
  p_workspace_key text,p_action text,p_policy jsonb,p_policy_id text,
  p_policy_version integer,p_command_id text,p_expected_work_revision bigint
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
  v_member d5o_hosted.memberships%rowtype;v_work d5o_hosted.prototype_states%rowtype;
  v_prior d5o_hosted.connected_pricing_policies%rowtype;
  v_receipt d5o_hosted.connected_pricing_receipts%rowtype;
  v_policy jsonb;v_rate jsonb;v_fingerprint text;v_result jsonb;v_now timestamptz:=now();
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or p_action not in ('save-draft','publish','activate')
    or p_command_id is null or length(p_command_id) not between 8 and 120
    or p_expected_work_revision is null or p_expected_work_revision<1
    or p_policy_id is null or length(trim(p_policy_id)) not between 1 and 120
    or p_policy_version is null or p_policy_version<1 then
    raise exception 'invalid_pricing_command' using errcode='22023'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor and status='active' for share;
  if not found or v_member.role<>'admin' then
    raise exception 'pricing_config_forbidden' using errcode='42501'; end if;
  select * into v_work from d5o_hosted.prototype_states
    where workspace_id=v_workspace.id and state_key='work' for share;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_workspace_key,p_action,
    p_policy,p_policy_id,p_policy_version,p_expected_work_revision)::text);
  select * into v_receipt from d5o_hosted.connected_pricing_receipts
    where workspace_id=v_workspace.id and command_id=p_command_id;
  if found then
    if v_receipt.actor_user_id<>v_actor or v_receipt.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_receipt.result;
  end if;
  if v_work.revision is distinct from p_expected_work_revision then
    raise exception 'stale_state' using errcode='23505'; end if;
  select * into v_prior from d5o_hosted.connected_pricing_policies
    where workspace_id=v_workspace.id and policy_id=p_policy_id
      and version=p_policy_version for update;
  if p_action='save-draft' then
    if p_policy is null or pg_catalog.jsonb_typeof(p_policy)<>'object'
      or p_policy->>'id' is distinct from p_policy_id
      or p_policy->>'version' is distinct from p_policy_version::text
      or p_policy->>'workspace' is distinct from p_workspace_key
      or p_policy->>'status'<>'draft' or v_prior.status in ('published','superseded')
      or length(trim(coalesce(p_policy->>'name','')))=0
      or p_policy->>'currency' !~ '^[A-Z]{3}$'
      or p_policy->>'effectiveFrom' !~ '^\d{4}-\d{2}-\d{2}$'
      or coalesce(p_policy->>'method','') not in ('target-margin','markup','fixed-price')
      or coalesce(p_policy->>'solutionApproverRole','operations_leader')
        not in ('admin','operations_leader')
      or coalesce(p_policy->>'pricingApproverRole','') not in ('admin','operations_leader')
      or coalesce(p_policy->>'proposalApproverRole','') not in ('admin','operations_leader')
      or pg_catalog.jsonb_typeof(p_policy->'rates')<>'array' then
      raise exception 'invalid_pricing_draft' using errcode='22023'; end if;
    insert into d5o_hosted.connected_pricing_policies(
      workspace_id,policy_id,version,status,payload)
    values(v_workspace.id,p_policy_id,p_policy_version,'draft',p_policy)
    on conflict(workspace_id,policy_id,version) do update set
      payload=excluded.payload,updated_at=v_now;
  elsif p_action='publish' then
    if v_prior.status<>'draft' or p_policy is not null
      or pg_catalog.jsonb_array_length(coalesce(v_prior.payload->'rates','[]'::jsonb))=0
      or (v_prior.payload->>'targetMarginPercent') is null
      or (v_prior.payload->>'floorMarginPercent') is null
      or (v_prior.payload->>'targetMarginPercent')::numeric not between 0 and 95
      or (v_prior.payload->>'floorMarginPercent')::numeric not between 0 and
        (v_prior.payload->>'targetMarginPercent')::numeric then
      raise exception 'invalid_pricing_publication' using errcode='23514'; end if;
    for v_rate in select value from pg_catalog.jsonb_array_elements(v_prior.payload->'rates') loop
      if length(trim(coalesce(v_rate->>'id','')))=0
        or length(trim(coalesce(v_rate->>'unit','')))=0
        or length(trim(coalesce(v_rate->>'source','')))=0
        or coalesce(v_rate->>'category','') not in
          ('labor','material','equipment','subcontract','travel','mobilization',
            'setup','recurring','other')
        or coalesce(v_rate->>'amount','') !~ (case
          when v_prior.payload->>'currency'='JPY' then '^([0-9]+)$'
          else '^([0-9]+)(\.[0-9]{1,2})?$' end)
        or (v_rate->>'amount')::numeric<0 then
        raise exception 'invalid_pricing_rate' using errcode='23514'; end if;
    end loop;
    v_policy:=v_prior.payload||pg_catalog.jsonb_build_object('status','published',
      'publishedAt',v_now,'publishedBy',v_actor);
    update d5o_hosted.connected_pricing_policies set status='published',payload=v_policy,
      updated_at=v_now where workspace_id=v_workspace.id
        and policy_id=p_policy_id and version=p_policy_version;
  else
    if v_prior.status<>'published' or p_policy is not null
      or (v_prior.payload->>'effectiveFrom')::date>v_now::date
      or (v_prior.payload->>'effectiveTo' is not null and
        (v_prior.payload->>'effectiveTo')::date<v_now::date) then
      raise exception 'pricing_activation_denied' using errcode='23514'; end if;
    insert into d5o_hosted.connected_pricing_active(workspace_id,policy_id,version)
      values(v_workspace.id,p_policy_id,p_policy_version)
      on conflict(workspace_id) do update set policy_id=excluded.policy_id,
        version=excluded.version;
  end if;
  insert into d5o_hosted.connected_pricing_events(workspace_id,command_id,action,
    policy_id,version,actor_user_id,membership_id)
  values(v_workspace.id,p_command_id,p_action,p_policy_id,p_policy_version,v_actor,v_member.id);
  v_result:=public.d5o_hosted_prototype_read_v1(p_workspace_key,'work');
  insert into d5o_hosted.connected_pricing_receipts(workspace_id,command_id,
    actor_user_id,fingerprint,result)
  values(v_workspace.id,p_command_id,v_actor,v_fingerprint,v_result);
  return v_result;
end; $$;
revoke all on function public.d5o_hosted_pricing_policy_command_v1(
  text,text,jsonb,text,integer,text,bigint) from public,anon,service_role;
grant execute on function public.d5o_hosted_pricing_policy_command_v1(
  text,text,jsonb,text,integer,text,bigint) to authenticated;

-- The work-read projection includes normalized pricing policy data. Accept
-- that exact projection on a draft save, but retain the raw snapshot's old
-- policy fields so the existing protected-policy trigger remains effective.
create or replace function public.d5o_hosted_prototype_save_v1(
  p_workspace_key text,p_state_key text,p_expected_revision bigint,p_state jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_workspace uuid;v_membership d5o_hosted.memberships%rowtype;
  v_prior d5o_hosted.prototype_states%rowtype;v_state jsonb;v_input jsonb;
  v_projection jsonb;v_revision bigint;v_field text;
begin
  if auth.uid() is null or p_state_key is distinct from 'work'
    or p_expected_revision is null or p_expected_revision<1 or p_state is null
    or pg_catalog.jsonb_typeof(p_state)<>'object'
    or p_state->>'workspace' is distinct from p_workspace_key
    or p_state->>'schemaVersion' is distinct from '1'
    or pg_catalog.octet_length(p_state::text)>2000000 then
    raise exception 'invalid_prototype_state' using errcode='22023'; end if;
  select m.* into v_membership from d5o_hosted.workspaces w
    join d5o_hosted.memberships m on m.workspace_id=w.id
    where w.workspace_key=p_workspace_key and w.status='active'
      and m.actor_user_id=auth.uid() and m.status='active';
  v_workspace:=v_membership.workspace_id;
  if v_workspace is null or v_membership.role not in
    ('admin','operations_leader','project_manager','field_supervisor') then
    raise exception 'prototype_write_forbidden' using errcode='42501'; end if;
  select * into v_prior from d5o_hosted.prototype_states
    where workspace_id=v_workspace and state_key='work' for update;
  if not found or v_prior.revision<>p_expected_revision then
    raise exception 'stale_prototype_state' using errcode='23505'; end if;
  v_projection:=d5o_hosted.connected_define_projection_v1(v_workspace,v_prior.state_json);
  v_input:=p_state;
  foreach v_field in array array['pricingPolicies','activePricingPolicy','pricingPolicyHistory'] loop
    if p_state->v_field is distinct from v_projection->v_field then
      raise exception 'typed_policy_command_required' using errcode='42501'; end if;
    v_input:=v_input-v_field;
    if v_prior.state_json ? v_field then
      v_input:=v_input||pg_catalog.jsonb_build_object(v_field,v_prior.state_json->v_field);
    end if;
  end loop;
  v_state:=d5o_hosted.connected_draft_snapshot_v1(v_workspace,v_prior.state_json,
    d5o_hosted.connected_solution_draft_rebase_v1(
      v_workspace,v_prior.state_json,v_input),v_prior.revision+1);
  update d5o_hosted.prototype_states set revision=revision+1,state_json=v_state,
    updated_by=auth.uid(),updated_at=now()
    where workspace_id=v_workspace and state_key='work'
    returning revision into v_revision;
  insert into d5o_hosted.prototype_state_revisions(
    workspace_id,state_key,revision,state_json,actor_user_id,membership_id)
  values(v_workspace,'work',v_revision,v_state,auth.uid(),v_membership.id);
  return pg_catalog.jsonb_build_object('revision',v_revision,'state',
    d5o_hosted.connected_define_projection_v1(v_workspace,v_state));
end; $$;
revoke all on function public.d5o_hosted_prototype_save_v1(text,text,bigint,jsonb)
  from public,anon;
grant execute on function public.d5o_hosted_prototype_save_v1(text,text,bigint,jsonb)
  to authenticated;
