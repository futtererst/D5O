-- Governed configuration command probe on the isolated populated clone.
-- All configuration and receipt mutations roll back; existing Work pins remain.
\set ON_ERROR_STOP on
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','2c32b7d1-da29-47e5-ba4c-b61d4447c148',true);
do $$
declare
  v_active constant uuid := '83523290-6d9c-4252-a91d-ebc7f654a8f6';
  v_draft uuid;
  v_result jsonb;
begin
  perform set_config('request.jwt.claim.sub','4be53fd7-38fd-4810-9d00-12d8deae0197',true);
  begin
    perform public.d5o_hosted_handoff_configuration_command_v1(
      'rybex','create-draft',v_active,null,null,0,'receiver-probe-wrong-role-20261018');
    raise exception 'pm_configuration_accepted';
  exception when insufficient_privilege then
    if sqlerrm <> 'handoff_route_admin_required' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub','2c32b7d1-da29-47e5-ba4c-b61d4447c148',true);
  v_result := public.d5o_hosted_handoff_configuration_command_v1(
    'rybex','create-draft',v_active,null,null,0,'receiver-probe-create-20261018');
  v_draft := (v_result->>'versionId')::uuid;
  v_result := public.d5o_hosted_handoff_configuration_command_v1(
    'rybex','save-route',v_draft,'deployOperate','project_manager',1,
    'receiver-probe-select-20261018');
  if v_result->>'role' <> 'project_manager' then
    raise exception 'receiver_selection_failed'; end if;
  v_result := public.d5o_hosted_handoff_configuration_command_v1(
    'rybex','publish',v_draft,null,null,0,'receiver-probe-publish-20261018');
  if not exists (
    select 1 from pg_catalog.jsonb_array_elements(
      public.d5o_hosted_handoff_configuration_v1('rybex')->'versions') version,
      lateral pg_catalog.jsonb_array_elements(version->'routes') route
    where version->>'id'=v_draft::text
      and route->>'key'='deployOperate'
      and route->>'role'='project_manager') then
    raise exception 'published_receiver_not_pinned'; end if;
  v_result := public.d5o_hosted_handoff_configuration_command_v1(
    'rybex','activate',v_draft,null,null,0,'receiver-probe-activate-20261018');
  if v_result->>'status' <> 'published' then
    raise exception 'receiver_activation_failed'; end if;
  raise notice 'Admin selected project_manager for future-work Deploy receipt; original Work pins preserved by rollback';
end $$;
rollback;
