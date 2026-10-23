-- Preserve the existing transactional writers and their revision, role, receipt,
-- and event logic. The public names remain the sole authenticated entry points.
alter function public.d5o_hosted_define_command_v1(
  text,text,text,text,text,text,bigint,integer)
  rename to d5o_hosted_define_command_pre_phase2d_v1;
revoke all on function public.d5o_hosted_define_command_pre_phase2d_v1(
  text,text,text,text,text,text,bigint,integer)
  from public,anon,authenticated,service_role;

create function public.d5o_hosted_define_command_v1(
  p_workspace_key text,p_presentation_id text,p_action text,p_review_role text,
  p_reason text,p_command_id text,p_expected_source_revision bigint,
  p_expected_decision_revision integer)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();
  v_work d5o_hosted.work_records%rowtype;v_config d5o_hosted.configuration_versions%rowtype;
  v_raw d5o_hosted.prototype_states%rowtype;v_control d5o_hosted.connected_define_states%rowtype;
  v_record jsonb;v_definition jsonb;
begin
  if current_setting('role',true) is distinct from 'authenticated' or v_actor is null then
    raise exception 'workspace_forbidden' using errcode='42501'; end if;
  select w.* into v_work from d5o_hosted.work_records w
    join d5o_hosted.work_identity_links l on l.work_id=w.id and l.workspace_id=w.workspace_id
    join d5o_hosted.workspaces s on s.id=w.workspace_id
    join d5o_hosted.memberships m on m.workspace_id=s.id and m.actor_user_id=v_actor
      and m.status='active'
    where s.workspace_key=p_workspace_key and s.status='active'
      and l.presentation_id=p_presentation_id for update of w;
  if not found then raise exception 'connected_work_unavailable' using errcode='42501'; end if;
  if p_action in ('submit','approve-review') and not exists(
    select 1 from d5o_hosted.connected_define_receipts r
    where r.workspace_id=v_work.workspace_id and r.command_id=p_command_id) then
    select c.* into v_config from d5o_hosted.configuration_versions c
      join d5o_hosted.configuration_tenants t on t.id=c.tenant_id
      where c.id=v_work.configuration_version_id and t.workspace_id=v_work.workspace_id
        and c.source_sha256=v_work.configuration_digest
        and c.status in ('published','superseded');
    if not found then raise exception 'pinned_configuration_unavailable' using errcode='42501'; end if;
    if coalesce((v_config.manifest_json#>>'{phase2dRequirements,defineRiskNarrative}')::boolean,false) then
      select * into v_raw from d5o_hosted.prototype_states
        where workspace_id=v_work.workspace_id and state_key='work' for share;
      select item into v_record from pg_catalog.jsonb_array_elements(
        coalesce(v_raw.state_json->'records','[]'::jsonb)) item
        where item->>'id'=p_presentation_id and item->>'canonicalWorkId'=v_work.id::text;
      if v_record is null or v_record->>'phaseConfigurationVersionId'
          is distinct from v_config.id::text then
        raise exception 'source_identity_changed' using errcode='42501'; end if;
      v_definition:=v_record->'definition';
      select * into v_control from d5o_hosted.connected_define_states
        where workspace_id=v_work.workspace_id and work_id=v_work.id for share;
      if p_action='approve-review' then
        v_definition:=v_control.projection;
      elsif v_control.work_id is not null and
          (v_control.status='Draft' or
            v_control.definition_revision>coalesce((v_definition->>'revision')::integer,0)) then
        v_definition:=v_control.projection;
      end if;
      if length(trim(coalesce(v_definition->>'risks','')))<10 then
        raise exception 'define_risk_narrative_required' using errcode='23514'; end if;
    end if;
  end if;
  return public.d5o_hosted_define_command_pre_phase2d_v1(
    p_workspace_key,p_presentation_id,p_action,p_review_role,p_reason,p_command_id,
    p_expected_source_revision,p_expected_decision_revision);
end $$;
revoke all on function public.d5o_hosted_define_command_v1(
  text,text,text,text,text,text,bigint,integer) from public,anon,service_role;
grant execute on function public.d5o_hosted_define_command_v1(
  text,text,text,text,text,text,bigint,integer) to authenticated;

alter function public.d5o_hosted_solution_command_v1(
  text,text,text,text,text,text,bigint,integer,integer)
  rename to d5o_hosted_solution_command_pre_phase2d_v1;
revoke all on function public.d5o_hosted_solution_command_pre_phase2d_v1(
  text,text,text,text,text,text,bigint,integer,integer)
  from public,anon,authenticated,service_role;

create function public.d5o_hosted_solution_command_v1(
  p_workspace_key text,p_presentation_id text,p_action text,p_due_date text,
  p_reason text,p_command_id text,p_expected_source_revision bigint,
  p_expected_decision_revision integer,p_solution_revision integer)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();
  v_work d5o_hosted.work_records%rowtype;v_config d5o_hosted.configuration_versions%rowtype;
  v_raw d5o_hosted.prototype_states%rowtype;v_record jsonb;v_plan jsonb;v_option jsonb;
begin
  if current_setting('role',true) is distinct from 'authenticated' or v_actor is null then
    raise exception 'workspace_forbidden' using errcode='42501'; end if;
  select w.* into v_work from d5o_hosted.work_records w
    join d5o_hosted.work_identity_links l on l.work_id=w.id and l.workspace_id=w.workspace_id
    join d5o_hosted.workspaces s on s.id=w.workspace_id
    join d5o_hosted.memberships m on m.workspace_id=s.id and m.actor_user_id=v_actor
      and m.status='active'
    where s.workspace_key=p_workspace_key and s.status='active'
      and l.presentation_id=p_presentation_id for update of w;
  if not found then raise exception 'connected_work_unavailable' using errcode='42501'; end if;
  if p_action in ('submit-solution','approve-solution') and not exists(
    select 1 from d5o_hosted.connected_solution_receipts r
    where r.workspace_id=v_work.workspace_id and r.command_id=p_command_id) then
    select c.* into v_config from d5o_hosted.configuration_versions c
      join d5o_hosted.configuration_tenants t on t.id=c.tenant_id
      where c.id=v_work.configuration_version_id and t.workspace_id=v_work.workspace_id
        and c.source_sha256=v_work.configuration_digest
        and c.status in ('published','superseded');
    if not found then raise exception 'pinned_configuration_unavailable' using errcode='42501'; end if;
    if coalesce((v_config.manifest_json#>>'{phase2dRequirements,developOptionEvidence}')::boolean,false) then
      select * into v_raw from d5o_hosted.prototype_states
        where workspace_id=v_work.workspace_id and state_key='work' for share;
      select item into v_record from pg_catalog.jsonb_array_elements(
        coalesce(v_raw.state_json->'records','[]'::jsonb)) item
        where item->>'id'=p_presentation_id and item->>'canonicalWorkId'=v_work.id::text;
      if v_record is null or v_record->>'phaseConfigurationVersionId'
          is distinct from v_config.id::text then
        raise exception 'source_identity_changed' using errcode='42501'; end if;
      v_plan:=v_record->'develop';
      select item into v_option from pg_catalog.jsonb_array_elements(
        coalesce(v_plan->'options','[]'::jsonb)) item
        where item->>'id'=v_plan->>'selectedOptionId';
      if length(trim(coalesce(v_option->>'evidence','')))<10 then
        raise exception 'develop_option_evidence_required' using errcode='23514'; end if;
    end if;
  end if;
  return public.d5o_hosted_solution_command_pre_phase2d_v1(
    p_workspace_key,p_presentation_id,p_action,p_due_date,p_reason,p_command_id,
    p_expected_source_revision,p_expected_decision_revision,p_solution_revision);
end $$;
revoke all on function public.d5o_hosted_solution_command_v1(
  text,text,text,text,text,text,bigint,integer,integer) from public,anon,service_role;
grant execute on function public.d5o_hosted_solution_command_v1(
  text,text,text,text,text,text,bigint,integer,integer) to authenticated;
