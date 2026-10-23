-- Service visits stay in command-owned rows. Generic snapshots cannot add,
-- replace or delete them; Work and Catalog reads project the same identity.
create function d5o_hosted.connected_service_projection_v1(
  p_workspace uuid,p_state jsonb,p_state_key text
) returns jsonb language sql stable security definer set search_path='' as $$
  select pg_catalog.jsonb_set(p_state,'{records}',
    coalesce(p_state->'records','[]'::jsonb)||coalesce((
      select pg_catalog.jsonb_agg(case when p_state_key='work'
        then s.work_projection else s.catalog_projection end order by s.created_at,s.work_id)
      from d5o_hosted.connected_service_work s where s.workspace_id=p_workspace
    ),'[]'::jsonb));
$$;
revoke all on function d5o_hosted.connected_service_projection_v1(uuid,jsonb,text)
  from public,anon,authenticated,service_role;

create or replace function d5o_hosted.guard_connected_identity_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_link record;v_record jsonb;v_prior jsonb;v_count integer;v_projected boolean;
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
    select exists(select 1 from d5o_hosted.connected_service_work s
      where s.workspace_id=new.workspace_id and s.work_id=v_link.work_id
        and s.presentation_id=v_link.presentation_id) into v_projected;
    if v_projected then
      if v_count<>0 then raise exception 'service_work_snapshot_collision'
        using errcode='42501'; end if;
      continue;
    end if;
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
        v_workspace,p_workspace_key,v_state.state_json)); end if;
  select * into v_state from d5o_hosted.prototype_states
    where workspace_id=v_workspace and state_key=p_state_key;
  if not found then return pg_catalog.jsonb_build_object('revision',0,'state',null); end if;
  v_projected:=case when p_state_key='work' then
    d5o_hosted.connected_operate_projection_v1(v_workspace,
      d5o_hosted.connected_deploy_projection_v1(v_workspace,
        d5o_hosted.connected_design_projection_v1(v_workspace,
          d5o_hosted.connected_define_projection_v1(v_workspace,
            d5o_hosted.connected_service_projection_v1(
              v_workspace,v_state.state_json,p_state_key)))))
    else d5o_hosted.connected_service_projection_v1(
      v_workspace,v_state.state_json,p_state_key) end;
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
        v_workspace,p_workspace_key,v_state.state_json)); end if;
  v_projected:=d5o_hosted.connected_operate_projection_v1(v_workspace,
    d5o_hosted.connected_deploy_projection_v1(v_workspace,
      d5o_hosted.connected_design_projection_v1(v_workspace,
        d5o_hosted.connected_define_projection_v1(v_workspace,
          d5o_hosted.connected_service_projection_v1(
            v_workspace,v_state.state_json,'work')))));
  return pg_catalog.jsonb_build_object('revision',v_state.revision,'state',
    d5o_hosted.connected_package_projection_v1(v_workspace,v_projected,'work'));
end; $$;
revoke all on function public.d5o_hosted_server_connected_read_v1(text,text)
  from public,anon,authenticated;
grant execute on function public.d5o_hosted_server_connected_read_v1(text,text)
  to service_role;
