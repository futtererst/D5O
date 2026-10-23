-- Keep the command-only catalog guard. Package identity lives in a protected
-- table and is projected into both existing views without snapshot writes.

create table d5o_hosted.connected_package_states (
  workspace_id uuid not null,work_id uuid not null,package_id text not null,
  snapshot jsonb not null,created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key(workspace_id,package_id),
  foreign key(work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id)
);
alter table d5o_hosted.connected_package_states enable row level security;
revoke all on d5o_hosted.connected_package_states from public,anon,authenticated,service_role;

create function d5o_hosted.connected_package_projection_v1(
  p_workspace uuid,p_state jsonb,p_key text
) returns jsonb language sql stable security definer set search_path='' as $$
  select case when p_state is null then null
    when p_key='catalog' then pg_catalog.jsonb_set(p_state,'{packages}',
      coalesce(p_state->'packages','[]'::jsonb)||coalesce((
        select pg_catalog.jsonb_agg(snapshot order by created_at,package_id)
        from d5o_hosted.connected_package_states where workspace_id=p_workspace
      ),'[]'::jsonb))
    when p_key='work' then pg_catalog.jsonb_set(p_state,'{records}',coalesce((
      select pg_catalog.jsonb_agg(case when l.work_id is null then item else
        pg_catalog.jsonb_set(item,'{packages}',
          coalesce(item->'packages','[]'::jsonb)||coalesce((
            select pg_catalog.jsonb_agg(p.snapshot order by p.created_at,p.package_id)
            from d5o_hosted.connected_package_states p
            where p.workspace_id=p_workspace and p.work_id=l.work_id
          ),'[]'::jsonb),true) end order by ordinal)
      from pg_catalog.jsonb_array_elements(coalesce(p_state->'records','[]'::jsonb))
        with ordinality as records(item,ordinal)
      left join d5o_hosted.work_identity_links l on l.workspace_id=p_workspace
        and l.presentation_id=item->>'id'
    ),'[]'::jsonb)) else p_state end;
$$;
revoke all on function d5o_hosted.connected_package_projection_v1(uuid,jsonb,text)
  from public,anon,authenticated,service_role;

create or replace function public.d5o_hosted_prototype_read_v1(p_workspace_key text,p_state_key text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_workspace uuid;v_state d5o_hosted.prototype_states%rowtype;
  v_projected jsonb;
begin
  if auth.uid() is null or p_workspace_key is null
    or p_state_key not in ('work','catalog','schedule') then
    raise exception 'prototype_scope_forbidden' using errcode='42501'; end if;
  select w.id into v_workspace from d5o_hosted.workspaces w
    join d5o_hosted.memberships m on m.workspace_id=w.id
    where w.workspace_key=p_workspace_key and w.status='active'
      and m.actor_user_id=auth.uid() and m.status='active' and m.role<>'field_worker';
  if v_workspace is null then raise exception 'prototype_scope_forbidden' using errcode='42501'; end if;
  select * into v_state from d5o_hosted.prototype_states
    where workspace_id=v_workspace and state_key=p_state_key;
  if not found then return pg_catalog.jsonb_build_object('revision',0,'state',null); end if;
  v_projected:=case when p_state_key='work' then
    d5o_hosted.connected_define_projection_v1(v_workspace,v_state.state_json)
    else v_state.state_json end;
  return pg_catalog.jsonb_build_object('revision',v_state.revision,'state',
    d5o_hosted.connected_package_projection_v1(v_workspace,v_projected,p_state_key));
end; $$;
revoke all on function public.d5o_hosted_prototype_read_v1(text,text) from public,anon;
grant execute on function public.d5o_hosted_prototype_read_v1(text,text) to authenticated;

create function public.d5o_hosted_create_connected_package_v2(
  p_workspace_key text,p_presentation_id text,p_name text,p_owner text,
  p_command_id text,p_expected_work_revision bigint,
  p_expected_catalog_revision bigint,p_expected_handoff_revision integer,
  p_expected_package_count integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
  v_member d5o_hosted.memberships%rowtype;v_work d5o_hosted.work_records%rowtype;
  v_work_state d5o_hosted.prototype_states%rowtype;
  v_catalog d5o_hosted.prototype_states%rowtype;
  v_handoff d5o_hosted.connected_design_handoffs%rowtype;
  v_receipt d5o_hosted.connected_package_receipts%rowtype;
  v_fingerprint text;v_id text;v_package jsonb;v_result jsonb;
  v_record jsonb;v_count integer;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or length(coalesce(p_command_id,'')) not between 8 and 120
    or length(trim(coalesce(p_name,''))) not between 3 and 120
    or length(trim(coalesce(p_owner,''))) not between 2 and 120
    or p_expected_work_revision is null or p_expected_work_revision<1
    or p_expected_catalog_revision is null or p_expected_catalog_revision<1
    or p_expected_handoff_revision is null or p_expected_handoff_revision<1
    or p_expected_package_count is null or p_expected_package_count<0 then
    raise exception 'invalid_package_command' using errcode='22023'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor and status='active' for share;
  if not found or v_member.role not in ('admin','project_manager','operations_leader') then
    raise exception 'package_editor_denied' using errcode='42501'; end if;
  select w.* into v_work from d5o_hosted.work_records w
    join d5o_hosted.work_identity_links l on l.work_id=w.id and l.workspace_id=w.workspace_id
    where w.workspace_id=v_workspace.id and l.presentation_id=p_presentation_id
    for update of w;
  if not found then raise exception 'connected_work_unavailable' using errcode='42501'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_workspace_key,
    p_presentation_id,trim(p_name),trim(p_owner),p_expected_work_revision,
    p_expected_catalog_revision,p_expected_handoff_revision,p_expected_package_count)::text);
  select * into v_receipt from d5o_hosted.connected_package_receipts
    where workspace_id=v_workspace.id and command_id=p_command_id;
  if found then
    if v_receipt.work_id<>v_work.id or v_receipt.actor_user_id<>v_actor
      or v_receipt.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_receipt.result;
  end if;
  select * into v_work_state from d5o_hosted.prototype_states
    where workspace_id=v_workspace.id and state_key='work' for share;
  select * into v_catalog from d5o_hosted.prototype_states
    where workspace_id=v_workspace.id and state_key='catalog' for share;
  select * into v_handoff from d5o_hosted.connected_design_handoffs
    where workspace_id=v_workspace.id and work_id=v_work.id for share;
  select count(*) into v_count from d5o_hosted.connected_package_states
    where workspace_id=v_workspace.id and work_id=v_work.id;
  v_count:=v_count+(select count(*) from pg_catalog.jsonb_array_elements(
    coalesce(v_catalog.state_json->'packages','[]'::jsonb)) item
    where item->>'workId'=p_presentation_id);
  if v_work_state.revision is distinct from p_expected_work_revision
    or v_catalog.revision is distinct from p_expected_catalog_revision
    or v_count<>p_expected_package_count
    or v_count>=500 or v_handoff.status is distinct from 'accepted'
    or v_handoff.revision<>p_expected_handoff_revision then
    raise exception 'stale_package_basis' using errcode='23505'; end if;
  select item into v_record from pg_catalog.jsonb_array_elements(
    v_work_state.state_json->'records') item
    where item->>'id'=p_presentation_id and item->>'canonicalWorkId'=v_work.id::text;
  if v_record is null or v_record->>'phaseConfigurationVersionId' is distinct from
      v_work.configuration_version_id::text
    or v_handoff.handoff#>>'{brief,configurationVersionId}' is distinct from
      v_work.configuration_version_id::text
    or not exists(select 1 from pg_catalog.jsonb_array_elements(
      v_catalog.state_json->'records') item where item->>'id'=p_presentation_id
        and item->>'canonicalWorkId'=v_work.id::text) then
    raise exception 'package_source_unavailable' using errcode='23514'; end if;
  v_id:='wp-'||pg_catalog.replace(gen_random_uuid()::text,'-','');
  v_package:=pg_catalog.jsonb_build_object('id',v_id,'workId',p_presentation_id,
    'name',trim(p_name),'owner',trim(p_owner),'installed',0,'tested',0,
    'accepted',0,'status','planned','createdAt',now(),
    'createdBy',v_actor,'sourceHandoffRevision',v_handoff.revision);
  insert into d5o_hosted.connected_package_states(workspace_id,work_id,
    package_id,snapshot,created_by)
  values(v_workspace.id,v_work.id,v_id,v_package,v_actor);
  v_result:=pg_catalog.jsonb_build_object('created',v_package,
    'workRevision',v_work_state.revision,
    'catalogRevision',v_catalog.revision,
    'packageCount',v_count+1,'canonicalWorkId',v_work.id);
  insert into d5o_hosted.connected_package_receipts(workspace_id,command_id,
    work_id,actor_user_id,fingerprint,result)
  values(v_workspace.id,p_command_id,v_work.id,v_actor,v_fingerprint,v_result);
  return v_result;
end; $$;
revoke all on function public.d5o_hosted_create_connected_package_v2(
  text,text,text,text,text,bigint,bigint,integer,integer)
  from public,anon,service_role;
grant execute on function public.d5o_hosted_create_connected_package_v2(
  text,text,text,text,text,bigint,bigint,integer,integer) to authenticated;

create function d5o_hosted.connected_package_draft_rebase_v1(
  p_workspace uuid,p_raw jsonb,p_submitted jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_new jsonb;v_old jsonb;v_expected jsonb;v_records jsonb:='[]'::jsonb;
begin
  for v_new in select value from pg_catalog.jsonb_array_elements(p_submitted->'records') loop
    select value into v_old from pg_catalog.jsonb_array_elements(p_raw->'records')
      where value->>'id'=v_new->>'id';
    if exists(select 1 from d5o_hosted.work_identity_links l
      join d5o_hosted.connected_package_states p on p.workspace_id=l.workspace_id
        and p.work_id=l.work_id
      where l.workspace_id=p_workspace and l.presentation_id=v_new->>'id') then
      select value into v_expected from pg_catalog.jsonb_array_elements(
        d5o_hosted.connected_package_projection_v1(p_workspace,
          d5o_hosted.connected_define_projection_v1(p_workspace,p_raw),'work')->'records')
        where value->>'id'=v_new->>'id';
      if v_new->'packages' is distinct from v_expected->'packages' then
        raise exception 'typed_package_command_required' using errcode='42501'; end if;
      if v_old->'packages' is null then v_new:=v_new-'packages';
      else v_new:=pg_catalog.jsonb_set(v_new,'{packages}',v_old->'packages',true); end if;
    end if;
    v_records:=v_records||pg_catalog.jsonb_build_array(v_new);
  end loop;
  return pg_catalog.jsonb_set(p_submitted,'{records}',v_records);
end; $$;
revoke all on function d5o_hosted.connected_package_draft_rebase_v1(uuid,jsonb,jsonb)
  from public,anon,authenticated,service_role;

-- All callers, including the older service-role writer, encounter this trigger.
-- For connected Work, raw package arrays remain unchanged; the typed table is
-- the only source of new package identities and later governed package facts.
create or replace function d5o_hosted.guard_connected_identity_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_link record;v_record jsonb;v_prior jsonb;v_count integer;
begin
  if new.state_key not in ('work','catalog') or not exists (
    select 1 from d5o_hosted.work_identity_links l
      where l.workspace_id=new.workspace_id) then return new; end if;
  if pg_catalog.jsonb_typeof(new.state_json->'records') is distinct from 'array' then
    raise exception 'connected_records_missing' using errcode='42501'; end if;
  for v_link in select work_id,presentation_id from d5o_hosted.work_identity_links
      where workspace_id=new.workspace_id loop
    select count(*),(pg_catalog.jsonb_agg(item)->0) into v_count,v_record
      from pg_catalog.jsonb_array_elements(new.state_json->'records') item
      where item->>'id'=v_link.presentation_id;
    if v_count<>1 or v_record->>'canonicalWorkId' is distinct from v_link.work_id::text
      or v_record->>'workspace' is distinct from (
        select workspace_key from d5o_hosted.workspaces where id=new.workspace_id) then
      raise exception 'connected_identity_changed' using errcode='42501'; end if;
    if tg_op='UPDATE' then
      select item into v_prior from pg_catalog.jsonb_array_elements(
        old.state_json->'records') item where item->>'id'=v_link.presentation_id;
      if v_prior->'packages' is distinct from v_record->'packages' then
        raise exception 'typed_package_command_required' using errcode='42501'; end if;
      if new.state_key='work' and exists(
        select 1 from d5o_hosted.connected_offer_states o
          where o.workspace_id=new.workspace_id and o.work_id=v_link.work_id)
        and v_prior#>'{discovery,proposal}' is distinct from
          v_record#>'{discovery,proposal}' then
        raise exception 'typed_offer_command_required' using errcode='42501'; end if;
    end if;
  end loop;
  if tg_op='UPDATE' and new.state_key='catalog' and
    (select coalesce(pg_catalog.jsonb_agg(item order by ordinal),'[]'::jsonb)
      from pg_catalog.jsonb_array_elements(coalesce(new.state_json->'packages','[]'::jsonb))
        with ordinality as entries(item,ordinal)
      where item->>'workId' in (select presentation_id from
        d5o_hosted.work_identity_links where workspace_id=new.workspace_id))
    is distinct from
    (select coalesce(pg_catalog.jsonb_agg(item order by ordinal),'[]'::jsonb)
      from pg_catalog.jsonb_array_elements(coalesce(old.state_json->'packages','[]'::jsonb))
        with ordinality as entries(item,ordinal)
      where item->>'workId' in (select presentation_id from
        d5o_hosted.work_identity_links where workspace_id=new.workspace_id)) then
    raise exception 'typed_package_command_required' using errcode='42501'; end if;
  return new;
end; $$;
revoke all on function d5o_hosted.guard_connected_identity_v1()
  from public,anon,authenticated,service_role;

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
  v_projection:=d5o_hosted.connected_package_projection_v1(v_workspace,
    d5o_hosted.connected_define_projection_v1(v_workspace,v_prior.state_json),'work');
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
    d5o_hosted.connected_solution_draft_rebase_v1(v_workspace,v_prior.state_json,
      d5o_hosted.connected_estimate_draft_rebase_v1(v_workspace,v_prior.state_json,
        d5o_hosted.connected_offer_draft_rebase_v1(v_workspace,v_prior.state_json,
          d5o_hosted.connected_handoff_draft_rebase_v1(v_workspace,v_prior.state_json,
            d5o_hosted.connected_package_draft_rebase_v1(
              v_workspace,v_prior.state_json,v_input))))),v_prior.revision+1);
  update d5o_hosted.prototype_states set revision=revision+1,state_json=v_state,
    updated_by=auth.uid(),updated_at=now()
    where workspace_id=v_workspace and state_key='work' returning revision into v_revision;
  insert into d5o_hosted.prototype_state_revisions(
    workspace_id,state_key,revision,state_json,actor_user_id,membership_id)
  values(v_workspace,'work',v_revision,v_state,auth.uid(),v_membership.id);
  return pg_catalog.jsonb_build_object('revision',v_revision,'state',
    d5o_hosted.connected_package_projection_v1(v_workspace,
      d5o_hosted.connected_define_projection_v1(v_workspace,v_state),'work'));
end; $$;
revoke all on function public.d5o_hosted_prototype_save_v1(text,text,bigint,jsonb)
  from public,anon;
grant execute on function public.d5o_hosted_prototype_save_v1(text,text,bigint,jsonb)
  to authenticated,service_role;
