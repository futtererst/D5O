-- An administrator's explicit route revision takes precedence over legacy manifest defaults.
create or replace function d5o_hosted.configured_handoff_role_v1(p_version uuid,p_route text)
returns text language plpgsql stable set search_path='' as $$
declare v_role text;
begin
  if p_route not in ('discoverDefine','designDeploy','deployOperate') then
    raise exception 'handoff_route_unavailable' using errcode='23514'; end if;
  select r.receiving_role into v_role from d5o_hosted.configuration_handoff_roles r
    join d5o_hosted.configuration_versions v on v.id=r.configuration_version_id
    where r.configuration_version_id=p_version and r.route_key=p_route
      and v.status in ('published','superseded');
  if v_role is null then
    select nullif(v.manifest_json#>>array['d5oPresentation','handoffRoles',p_route],'')
      into v_role from d5o_hosted.configuration_versions v
      where v.id=p_version and v.status in ('published','superseded');
  end if;
  if v_role not in ('admin','operations_leader','project_manager')
    or (p_route='deployOperate' and v_role<>'operations_leader') then
    raise exception 'handoff_route_unavailable' using errcode='23514'; end if;
  return v_role;
end $$;
revoke all on function d5o_hosted.configured_handoff_role_v1(uuid,text)
  from public, anon, authenticated;
