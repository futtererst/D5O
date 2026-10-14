-- Keep the existing typed Operate transition and its replay ledger intact.
-- The accepted-delivery asset command previously checked only the current
-- Work's JSON state. Serialize the tenant/external-identity pair and reject a
-- new duplicate across other Work Records. Existing fictional duplicates are
-- retained for deliberate identity reconciliation; this does not merge them.
alter function public.d5o_hosted_operate_command_v1(
  text,text,text,jsonb,text,bigint,integer,integer)
  rename to d5o_hosted_operate_command_prior_v1;
alter function public.d5o_hosted_operate_command_prior_v1(
  text,text,text,jsonb,text,bigint,integer,integer)
  set schema d5o_hosted;
revoke all on function d5o_hosted.d5o_hosted_operate_command_prior_v1(
  text,text,text,jsonb,text,bigint,integer,integer)
  from public,anon,authenticated,service_role;

create function public.d5o_hosted_operate_command_v1(
  p_workspace_key text,p_presentation_id text,p_action text,p_input jsonb,
  p_command_id text,p_expected_source_revision bigint,
  p_expected_deploy_revision integer,p_expected_operate_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace_id uuid;v_work_id uuid;
  v_role text;v_external_id text;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null then
    raise exception 'operate_membership_required' using errcode='42501';
  end if;
  if p_action='add-asset' then
    select w.id,l.work_id,m.role into v_workspace_id,v_work_id,v_role
      from d5o_hosted.workspaces w
      join d5o_hosted.work_identity_links l on l.workspace_id=w.id
      join d5o_hosted.memberships m on m.workspace_id=w.id
      where w.workspace_key=p_workspace_key and w.status='active'
        and l.presentation_id=p_presentation_id
        and m.actor_user_id=v_actor and m.status='active';
    if v_workspace_id is null or v_role not in ('project_manager','operations_leader') then
      raise exception 'asset_authority_required' using errcode='42501';
    end if;
    -- Let the existing command validate an identical replay (or reject a
    -- conflicting replay) before considering the asset now present.
    if exists(select 1 from d5o_hosted.connected_operate_receipts
      where workspace_id=v_workspace_id and command_id=p_command_id) then
      return d5o_hosted.d5o_hosted_operate_command_prior_v1(
        p_workspace_key,p_presentation_id,p_action,p_input,p_command_id,
        p_expected_source_revision,p_expected_deploy_revision,p_expected_operate_revision);
    end if;
    v_external_id:=pg_catalog.lower(pg_catalog.btrim(coalesce(p_input->>'externalId','')));
    if v_external_id<>'' then
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        v_workspace_id::text||':asset:'||v_external_id,0));
      if exists(select 1 from d5o_hosted.connected_operate_states o,
          lateral pg_catalog.jsonb_array_elements(
            coalesce(o.state->'assets','[]'::jsonb)) a
        where o.workspace_id=v_workspace_id
          and pg_catalog.lower(pg_catalog.btrim(coalesce(a->>'externalId','')))=v_external_id)
      then raise exception 'asset_identity_conflict' using errcode='23505'; end if;
    end if;
  end if;
  return d5o_hosted.d5o_hosted_operate_command_prior_v1(
    p_workspace_key,p_presentation_id,p_action,p_input,p_command_id,
    p_expected_source_revision,p_expected_deploy_revision,p_expected_operate_revision);
end; $$;
revoke all on function public.d5o_hosted_operate_command_v1(
  text,text,text,jsonb,text,bigint,integer,integer)
  from public,anon,service_role;
grant execute on function public.d5o_hosted_operate_command_v1(
  text,text,text,jsonb,text,bigint,integer,integer) to authenticated;
