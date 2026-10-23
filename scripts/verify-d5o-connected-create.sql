-- Run only against the disposable D5O pilot database. The transaction rolls back.
begin;
create function pg_temp.d5o_injected_identity_failure()
returns trigger language plpgsql as $$
begin
  if (select title from d5o_hosted.work_records where id = new.work_id) = 'D5O injected failure'
    then raise exception 'injected_failure'; end if;
  return new;
end; $$;
create trigger d5o_pilot_injected_failure before insert on d5o_hosted.work_identity_links
  for each row execute function pg_temp.d5o_injected_identity_failure();
insert into d5o_hosted.workspaces(workspace_key,display_name) values('rotork','Isolation check')
  on conflict(workspace_key) do nothing;
create function pg_temp.d5o_connected_create_checks() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_workspace uuid;
  v_actor uuid; v_membership uuid; v_worker uuid; v_worker_membership uuid;
  v_version uuid; v_work_revision bigint; v_catalog_revision bigint;
  v_before_work bigint; v_before_links bigint; v_before_catalog integer;
  v_result jsonb; v_replay jsonb;
begin
  select id into strict v_workspace from d5o_hosted.workspaces where workspace_key='rybex';
  select actor_user_id,id into strict v_actor,v_membership from d5o_hosted.memberships
    where workspace_id=v_workspace and role='project_manager' and status='active';
  select actor_user_id,id into strict v_worker,v_worker_membership from d5o_hosted.memberships
    where workspace_id=v_workspace and role='field_worker' and status='active';
  select id into strict v_version from d5o_hosted.configuration_versions
    where tenant_id=(select id from d5o_hosted.configuration_tenants where workspace_id=v_workspace and status='active')
      and status='published';
  select revision into strict v_work_revision from d5o_hosted.prototype_states
    where workspace_id=v_workspace and state_key='work';
  select revision,pg_catalog.jsonb_array_length(state_json->'records')
    into strict v_catalog_revision,v_before_catalog from d5o_hosted.prototype_states
    where workspace_id=v_workspace and state_key='catalog';
  select count(*) into v_before_work from d5o_hosted.work_records where workspace_id=v_workspace;
  select count(*) into v_before_links from d5o_hosted.work_identity_links where workspace_id=v_workspace;

  begin
    perform public.d5o_hosted_create_connected_work_v1('rybex','pilot-failure-check',
      v_work_revision,v_catalog_revision,v_version,'technical-delivery',
      'D5O injected failure','Pilot Customer','Pilot Site','Pilot PM',v_actor,v_membership,null);
    raise exception 'failure_injection_did_not_fire';
  exception when raise_exception then
    if sqlerrm <> 'injected_failure' then raise; end if;
  end;
  if (select count(*) from d5o_hosted.work_records where workspace_id=v_workspace) <> v_before_work
    or (select count(*) from d5o_hosted.work_identity_links where workspace_id=v_workspace) <> v_before_links
    or (select pg_catalog.jsonb_array_length(state_json->'records') from d5o_hosted.prototype_states
      where workspace_id=v_workspace and state_key='catalog') <> v_before_catalog then
    raise exception 'atomic_failure_left_partial_work';
  end if;
  raise notice 'injected failure left no Work Record, alias or catalog row';

  v_result := public.d5o_hosted_create_connected_work_v1('rybex','pilot-replay-check',
    v_work_revision,v_catalog_revision,v_version,'technical-delivery',
    'D5O replay check','Pilot Customer','Pilot Site','Pilot PM',v_actor,v_membership,null);
  v_replay := public.d5o_hosted_create_connected_work_v1('rybex','pilot-replay-check',
    v_work_revision,v_catalog_revision,v_version,'technical-delivery',
    'D5O replay check','Pilot Customer','Pilot Site','Pilot PM',v_actor,v_membership,null);
  if v_result is distinct from v_replay or
    (select count(*) from d5o_hosted.work_records where workspace_id=v_workspace) <> v_before_work+1 then
    raise exception 'replay_duplicated_work';
  end if;
  raise notice 'same command replay returned original Work identity once';
  begin
    perform public.d5o_hosted_create_connected_work_v1('rybex','pilot-replay-check',
      v_work_revision,v_catalog_revision,v_version,'technical-delivery',
      'Changed replay','Pilot Customer','Pilot Site','Pilot PM',v_actor,v_membership,null);
    raise exception 'conflicting_replay_was_accepted';
  exception when unique_violation then null; end;
  raise notice 'conflicting replay rejected';
  begin
    perform public.d5o_hosted_create_connected_work_v1('rybex','pilot-worker-check',
      v_work_revision+1,v_catalog_revision+1,v_version,'technical-delivery',
      'Worker cannot create','Pilot Customer','Pilot Site','Pilot Worker',v_worker,v_worker_membership,null);
    raise exception 'worker_create_was_accepted';
  exception when insufficient_privilege then null; end;
  raise notice 'field worker role rejected';
  begin
    perform public.d5o_hosted_create_connected_work_v1('rotork','pilot-cross-tenant-check',
      0,0,v_version,'technical-delivery','Cross-tenant attempt',
      'Other Customer','Other Site','Pilot PM',v_actor,v_membership,null);
    raise exception 'cross_tenant_create_was_accepted';
  exception when insufficient_privilege then null; end;
  raise notice 'cross-tenant membership rejected';
end; $$;
set local role service_role;
select pg_temp.d5o_connected_create_checks();
rollback;
