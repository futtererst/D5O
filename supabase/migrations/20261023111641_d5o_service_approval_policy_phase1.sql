-- Extend the existing hosted configuration command; retain its authorization, receipts and version history.
create or replace function public.d5o_hosted_configuration_admin_command_v1(
  p_workspace_key text,p_action text,p_version uuid,p_expected_active uuid,
  p_expected_revision integer,p_input jsonb,p_reason text,p_command_id text
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
  v_member d5o_hosted.memberships%rowtype;v_tenant d5o_hosted.configuration_tenants%rowtype;
  v_active d5o_hosted.configuration_versions%rowtype;v_version d5o_hosted.configuration_versions%rowtype;
  v_receipt d5o_hosted.configuration_admin_receipts%rowtype;
  v_manifest jsonb;v_before jsonb;v_after jsonb;v_result jsonb;v_fp text;
  v_new uuid;v_key text;v_value text;v_type text;v_role text;v_template text;
  v_type_index integer;v_phase_index integer;v_role_count integer;v_work_types jsonb;
  v_contract_type jsonb;v_routes jsonb;v_route record;v_item jsonb;v_entry jsonb;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or p_action not in ('create-draft','save-policy','save-route','create-work-type','rename-work-type',
      'retire-work-type','set-create-role','validate-publish','activate')
    or p_version is null or p_expected_active is null
    or p_expected_revision is null or p_expected_revision<0
    or pg_catalog.jsonb_typeof(p_input)<>'object'
    or length(coalesce(p_reason,'')) not between 8 and 500
    or length(coalesce(p_command_id,'')) not between 8 and 120 then
    raise exception 'invalid_configuration_command' using errcode='22023'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active' for share;
  if not found then raise exception 'configuration_admin_required' using errcode='42501'; end if;
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor and status='active' and role='admin' for share;
  if not found then raise exception 'configuration_admin_required' using errcode='42501'; end if;
  select * into v_tenant from d5o_hosted.configuration_tenants
    where workspace_id=v_workspace.id and status='active' for update;
  if not found then raise exception 'configuration_unavailable' using errcode='23514'; end if;
  v_fp:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_workspace_key,p_action,p_version,
    p_expected_active,p_expected_revision,p_input,trim(p_reason))::text);
  select * into v_receipt from d5o_hosted.configuration_admin_receipts
    where workspace_id=v_workspace.id and command_id=p_command_id;
  if found then
    if v_receipt.actor_user_id<>v_actor or v_receipt.fingerprint<>v_fp then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_receipt.result;
  end if;
  select * into v_active from d5o_hosted.configuration_versions
    where tenant_id=v_tenant.id and status='published' and effective_from<=now()
      and (effective_to is null or effective_to>now()) for update;
  if not found or v_active.id<>p_expected_active then
    raise exception 'stale_configuration_default' using errcode='23505'; end if;
  if p_action='create-draft' then
    if p_version<>v_active.id or p_expected_revision<>v_active.edit_revision
      or exists(select 1 from d5o_hosted.configuration_versions
        where tenant_id=v_tenant.id and status in ('draft','validated')) then
      raise exception 'stale_configuration_draft' using errcode='23505'; end if;
    insert into d5o_hosted.configuration_versions(tenant_id,version_number,status,source_sha256,
      manifest_json,source_version_id)
      values(v_tenant.id,(select max(version_number)+1 from d5o_hosted.configuration_versions
        where tenant_id=v_tenant.id),'draft',v_active.source_sha256,v_active.manifest_json,v_active.id)
      returning id into v_new;
    insert into d5o_hosted.configuration_work_types(configuration_version_id,work_type_key,display_name,status)
      select v_new,work_type_key,display_name,status from d5o_hosted.configuration_work_types
      where configuration_version_id=v_active.id;
    insert into d5o_hosted.configuration_create_rights(configuration_version_id,work_type_key,workspace_role)
      select v_new,work_type_key,workspace_role from d5o_hosted.configuration_create_rights
      where configuration_version_id=v_active.id;
    insert into d5o_hosted.configuration_handoff_roles(configuration_version_id,route_key,receiving_role,revision,configured_by)
      select v_new,route_key,receiving_role,1,v_actor from d5o_hosted.configuration_handoff_roles
      where configuration_version_id=v_active.id;
    v_before:=pg_catalog.jsonb_build_object('activeVersionId',v_active.id);
    v_after:=pg_catalog.jsonb_build_object('draftVersionId',v_new,'status','draft','revision',1);
    v_result:=pg_catalog.jsonb_build_object('versionId',v_new,'status','draft','revision',1);
  else
    select * into v_version from d5o_hosted.configuration_versions
      where id=p_version and tenant_id=v_tenant.id and source_version_id=v_active.id for update;
    if not found or v_version.edit_revision<>p_expected_revision then
      raise exception 'stale_configuration_revision' using errcode='23505'; end if;
    if (p_action='activate' and v_version.status<>'validated') or
       (p_action<>'activate' and v_version.status<>'draft') then
      raise exception 'configuration_state_invalid' using errcode='23514'; end if;
    v_manifest:=v_version.manifest_json;
    v_before:=pg_catalog.jsonb_build_object('revision',v_version.edit_revision,
      'manifestSha256',v_version.source_sha256,'status',v_version.status);
    if p_action='save-policy' then
      v_key:=p_input->>'key';v_value:=p_input->>'value';v_type:=p_input->>'workTypeKey';
      if v_key='service-approval' then
        if pg_catalog.jsonb_typeof(p_input->'thresholdMinor') is distinct from 'number'
          or (p_input->>'thresholdMinor') !~ '^[0-9]{1,12}$'
          or (p_input->>'thresholdMinor')::bigint not between 0 and 100000000000
          or p_input->>'currency' is distinct from 'USD'
          or p_input->>'comparison' is distinct from 'greater_than'
          or coalesce(p_input->>'authorityRole','') not in ('admin','operations_leader')
          or p_input->>'unavailableBehavior' is distinct from 'block' then
          raise exception 'invalid_service_approval_policy' using errcode='22023'; end if;
        v_manifest:=pg_catalog.jsonb_set(v_manifest,'{serviceWorkApproval}',
          pg_catalog.jsonb_build_object('schemaVersion',1,
            'thresholdMinor',(p_input->>'thresholdMinor')::bigint,
            'currency','USD','comparison','greater_than',
            'authorityRole',p_input->>'authorityRole',
            'unavailableBehavior','block'),true);
      elsif v_key='phase-label' and p_input->>'phase' in ('discover','define','develop','design','deploy','operate')
        and length(trim(coalesce(v_value,''))) between 2 and 80 then
        v_manifest:=pg_catalog.jsonb_set(v_manifest,'{d5oPresentation,phaseLabels}',
          coalesce(v_manifest#>'{d5oPresentation,phaseLabels}','{}'::jsonb)||
          pg_catalog.jsonb_build_object(p_input->>'phase',trim(v_value)),true);
      else
        select (ordinality-1)::integer into v_type_index from pg_catalog.jsonb_array_elements(
          v_manifest#>'{d5oPresentation,phaseContract,workTypes}') with ordinality x(item,ordinality)
          where item->>'workTypeKey'=v_type;
        if v_type_index is null then raise exception 'unsupported_work_type' using errcode='22023'; end if;
        if v_key='phase-purpose' and p_input->>'phase' in ('discover','define','develop','design','deploy','operate')
          and length(trim(coalesce(v_value,''))) between 8 and 240 then
          select (ordinality-1)::integer into v_phase_index from pg_catalog.jsonb_array_elements(
            v_manifest#>array['d5oPresentation','phaseContract','workTypes',v_type_index::text,'phases']) with ordinality x(item,ordinality)
            where item->>'key'=p_input->>'phase';
          if v_phase_index is null then raise exception 'invalid_phase' using errcode='22023'; end if;
          v_manifest:=pg_catalog.jsonb_set(v_manifest,array['d5oPresentation','phaseContract','workTypes',v_type_index::text,'phases',v_phase_index::text,'purpose'],pg_catalog.to_jsonb(trim(v_value)),false);
        elsif v_key in ('design-require-permit','design-require-access','deploy-require-reviewed-evidence')
          and v_value in ('true','false') then
          v_manifest:=pg_catalog.jsonb_set(v_manifest,array['d5oPresentation','phaseContract','workTypes',v_type_index::text,
            case when v_key like 'design-%' then 'designControls' else 'deployControls' end,
            case v_key when 'design-require-permit' then 'requirePermit' when 'design-require-access' then 'requireAccess'
              else 'requireReviewedEvidence' end],pg_catalog.to_jsonb(v_value::boolean),false);
        elsif v_key in ('design-review-lead','design-procurement-buffer','deploy-start-lead','deploy-max-hours','operate-response-hours')
          and v_value ~ '^[0-9]{1,4}$' and (
            (v_key in ('design-review-lead','design-procurement-buffer') and v_value::integer between 0 and 90) or
            (v_key='deploy-start-lead' and v_value::integer between 0 and 60) or
            (v_key='deploy-max-hours' and v_value::integer between 1 and 24) or
            (v_key='operate-response-hours' and v_value::integer between 1 and 720)) then
          v_manifest:=pg_catalog.jsonb_set(v_manifest,array['d5oPresentation','phaseContract','workTypes',v_type_index::text,
            case when v_key like 'design-%' then 'designControls' when v_key like 'deploy-%' then 'deployControls' else 'operateControls' end,
            case v_key when 'design-review-lead' then 'reviewLeadDays' when 'design-procurement-buffer' then 'procurementBufferDays'
              when 'deploy-start-lead' then 'fieldStartLeadMinutes' when 'deploy-max-hours' then 'maxActualHoursPerShift'
              else 'defaultResponseHours' end],pg_catalog.to_jsonb(v_value::integer),false);
        elsif v_key='operate-timezone' and length(trim(coalesce(v_value,''))) between 3 and 80
          and exists(select 1 from pg_catalog.pg_timezone_names where name=v_value) then
          v_manifest:=pg_catalog.jsonb_set(v_manifest,array['d5oPresentation','phaseContract','workTypes',v_type_index::text,
            'operateControls','timezone'],pg_catalog.to_jsonb(v_value),false);
        else raise exception 'unsupported_policy_change' using errcode='22023'; end if;
      end if;
      if v_manifest=v_version.manifest_json then raise exception 'configuration_unchanged' using errcode='23514'; end if;
      update d5o_hosted.configuration_versions set manifest_json=v_manifest,
        edit_revision=edit_revision+1 where id=v_version.id;
    elsif p_action='save-route' then
      v_key:=p_input->>'key';v_role:=p_input->>'role';
      if v_key not in ('discoverDefine','designDeploy','deployOperate')
        or v_role not in ('admin','project_manager','operations_leader') then
        raise exception 'invalid_receiving_role' using errcode='22023'; end if;
      update d5o_hosted.configuration_handoff_roles set receiving_role=v_role,
        revision=revision+1,configured_by=v_actor,updated_at=now()
        where configuration_version_id=v_version.id and route_key=v_key;
      if not found then raise exception 'missing_receiving_route' using errcode='23514'; end if;
      v_manifest:=pg_catalog.jsonb_set(v_manifest,array['d5oPresentation','handoffRoles',v_key],
        pg_catalog.to_jsonb(v_role),true);
      update d5o_hosted.configuration_versions set manifest_json=v_manifest,
        edit_revision=edit_revision+1 where id=v_version.id;
    elsif p_action='create-work-type' then
      v_key:=p_input->>'key';v_value:=trim(coalesce(p_input->>'label',''));v_template:=p_input->>'templateKey';
      if v_key !~ '^[a-z][a-z0-9-]{1,63}$' or length(v_value) not between 2 and 120
        or v_template not in ('technical-delivery','lifecycle-service')
        or exists(select 1 from d5o_hosted.configuration_work_types t
          join d5o_hosted.configuration_versions v on v.id=t.configuration_version_id
          where v.tenant_id=v_tenant.id and t.work_type_key=v_key) then
        raise exception 'invalid_or_reused_work_type_key' using errcode='22023'; end if;
      select item into v_contract_type from pg_catalog.jsonb_array_elements(
        v_manifest#>'{d5oPresentation,phaseContract,workTypes}') x(item)
        where item->>'workTypeKey'=v_template;
      if v_contract_type is null or v_contract_type->>'version'<>'prototype-v2' then
        raise exception 'unsupported_engine_template' using errcode='22023'; end if;
      v_contract_type:=pg_catalog.jsonb_set(pg_catalog.jsonb_set(v_contract_type,
        '{workTypeKey}',pg_catalog.to_jsonb(v_key),false),'{workTypeLabel}',pg_catalog.to_jsonb(v_value),false)
        || pg_catalog.jsonb_build_object('engineTemplateKey',v_template);
      v_work_types:=v_manifest#>'{d5oPresentation,phaseContract,workTypes}';
      v_manifest:=pg_catalog.jsonb_set(v_manifest,'{d5oPresentation,phaseContract,workTypes}',
        v_work_types||pg_catalog.jsonb_build_array(v_contract_type),false);
      v_manifest:=pg_catalog.jsonb_set(v_manifest,'{workTypes}',
        (v_manifest->'workTypes')||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'key',v_key,'label',v_value,'templateKey',v_template,'status','active')),false);
      insert into d5o_hosted.configuration_work_types(configuration_version_id,work_type_key,display_name,status)
        values(v_version.id,v_key,v_value,'active');
      insert into d5o_hosted.configuration_create_rights(configuration_version_id,work_type_key,workspace_role)
        select v_version.id,v_key,workspace_role from d5o_hosted.configuration_create_rights
          where configuration_version_id=v_version.id and work_type_key=v_template;
      update d5o_hosted.configuration_versions set manifest_json=v_manifest,
        edit_revision=edit_revision+1 where id=v_version.id;
    elsif p_action='rename-work-type' then
      v_key:=p_input->>'key';v_value:=trim(coalesce(p_input->>'label',''));
      if length(v_value) not between 2 and 120
        or not exists(select 1 from d5o_hosted.configuration_work_types
          where configuration_version_id=v_version.id and work_type_key=v_key
            and display_name<>v_value) then
        raise exception 'invalid_work_type_label' using errcode='22023'; end if;
      select (ordinality-1)::integer into v_type_index from pg_catalog.jsonb_array_elements(v_manifest->'workTypes')
        with ordinality x(item,ordinality) where item->>'key'=v_key;
      select (ordinality-1)::integer into v_phase_index from pg_catalog.jsonb_array_elements(
        v_manifest#>'{d5oPresentation,phaseContract,workTypes}') with ordinality x(item,ordinality)
        where item->>'workTypeKey'=v_key;
      if v_type_index is null or v_phase_index is null then
        raise exception 'work_type_manifest_mismatch' using errcode='23514'; end if;
      v_manifest:=pg_catalog.jsonb_set(v_manifest,array['workTypes',v_type_index::text,'label'],
        pg_catalog.to_jsonb(v_value),false);
      v_manifest:=pg_catalog.jsonb_set(v_manifest,array['d5oPresentation','phaseContract',
        'workTypes',v_phase_index::text,'workTypeLabel'],pg_catalog.to_jsonb(v_value),false);
      update d5o_hosted.configuration_work_types set display_name=v_value
        where configuration_version_id=v_version.id and work_type_key=v_key;
      update d5o_hosted.configuration_versions set manifest_json=v_manifest,
        edit_revision=edit_revision+1 where id=v_version.id;
    elsif p_action='retire-work-type' then
      v_key:=p_input->>'key';
      if not exists(select 1 from d5o_hosted.configuration_work_types
          where configuration_version_id=v_version.id and work_type_key=v_key and status='active')
        or (select count(*) from d5o_hosted.configuration_work_types
          where configuration_version_id=v_version.id and status='active')<=1 then
        raise exception 'work_type_retirement_unavailable' using errcode='23514'; end if;
      update d5o_hosted.configuration_work_types set status='disabled'
        where configuration_version_id=v_version.id and work_type_key=v_key;
      select (ordinality-1)::integer into v_type_index from pg_catalog.jsonb_array_elements(v_manifest->'workTypes')
        with ordinality x(item,ordinality) where item->>'key'=v_key;
      if v_type_index is null then raise exception 'work_type_manifest_mismatch' using errcode='23514'; end if;
      v_manifest:=pg_catalog.jsonb_set(v_manifest,array['workTypes',v_type_index::text,'status'],'"disabled"'::jsonb,true);
      update d5o_hosted.configuration_versions set manifest_json=v_manifest,
        edit_revision=edit_revision+1 where id=v_version.id;
    elsif p_action='set-create-role' then
      v_key:=p_input->>'key';v_role:=p_input->>'role';
      if v_role not in ('admin','project_manager')
        or not exists(select 1 from d5o_hosted.configuration_work_types
          where configuration_version_id=v_version.id and work_type_key=v_key and status='active')
        or pg_catalog.jsonb_typeof(p_input->'enabled')<>'boolean' then
        raise exception 'invalid_create_role' using errcode='22023'; end if;
      if (p_input->>'enabled')::boolean then
        insert into d5o_hosted.configuration_create_rights(configuration_version_id,work_type_key,workspace_role)
          values(v_version.id,v_key,v_role) on conflict do nothing;
      else
        delete from d5o_hosted.configuration_create_rights where configuration_version_id=v_version.id
          and work_type_key=v_key and workspace_role=v_role;
      end if;
      update d5o_hosted.configuration_versions set edit_revision=edit_revision+1 where id=v_version.id;
    elsif p_action='validate-publish' then
      if v_manifest ? 'serviceWorkApproval' and (
        pg_catalog.jsonb_typeof(v_manifest#>'{serviceWorkApproval,thresholdMinor}') is distinct from 'number'
        or (v_manifest#>>'{serviceWorkApproval,thresholdMinor}') !~ '^[0-9]{1,12}$'
        or (v_manifest#>>'{serviceWorkApproval,thresholdMinor}')::bigint not between 0 and 100000000000
        or v_manifest#>>'{serviceWorkApproval,currency}' is distinct from 'USD'
        or v_manifest#>>'{serviceWorkApproval,comparison}' is distinct from 'greater_than'
        or coalesce(v_manifest#>>'{serviceWorkApproval,authorityRole}','') not in ('admin','operations_leader')
        or v_manifest#>>'{serviceWorkApproval,unavailableBehavior}' is distinct from 'block'
        or not exists(select 1 from d5o_hosted.memberships m
          where m.workspace_id=v_workspace.id and m.status='active'
            and m.role=v_manifest#>>'{serviceWorkApproval,authorityRole}')
      ) then raise exception 'invalid_service_approval_policy' using errcode='23514'; end if;
      if (select count(*) from d5o_hosted.configuration_handoff_roles where configuration_version_id=v_version.id)<>3
        or (select count(*) from d5o_hosted.configuration_work_types where configuration_version_id=v_version.id and status='active')<1
        or pg_catalog.jsonb_typeof(v_manifest->'workTypes')<>'array'
        or pg_catalog.jsonb_typeof(v_manifest#>'{d5oPresentation,phaseContract,workTypes}')<>'array'
        or (select count(*) from d5o_hosted.configuration_work_types where configuration_version_id=v_version.id)
           <>pg_catalog.jsonb_array_length(v_manifest->'workTypes')
        or (select count(*) from d5o_hosted.configuration_work_types where configuration_version_id=v_version.id)
           <>pg_catalog.jsonb_array_length(v_manifest#>'{d5oPresentation,phaseContract,workTypes}') then
        raise exception 'incomplete_configuration' using errcode='23514'; end if;
      for v_route in select route_key,receiving_role from d5o_hosted.configuration_handoff_roles
        where configuration_version_id=v_version.id loop
        if not exists(select 1 from d5o_hosted.memberships m where m.workspace_id=v_workspace.id
          and m.status='active' and m.role=v_route.receiving_role) then
          raise exception 'configured_receiver_unavailable' using errcode='23514'; end if;
        if v_manifest#>>array['d5oPresentation','handoffRoles',v_route.route_key] is distinct from v_route.receiving_role then
          raise exception 'route_manifest_mismatch' using errcode='23514'; end if;
      end loop;
      for v_item in select value from pg_catalog.jsonb_array_elements(v_manifest->'workTypes') loop
        v_key:=v_item->>'key';v_template:=coalesce(v_item->>'templateKey',v_key);
        if v_template not in ('technical-delivery','lifecycle-service')
          or not exists(select 1 from d5o_hosted.configuration_work_types t
            where t.configuration_version_id=v_version.id and t.work_type_key=v_key
              and t.display_name=v_item->>'label' and t.status=case when v_item->>'status'='disabled' then 'disabled' else 'active' end)
          or not exists(select 1 from pg_catalog.jsonb_array_elements(
            v_manifest#>'{d5oPresentation,phaseContract,workTypes}') c(value)
            where c.value->>'workTypeKey'=v_key and c.value->>'workTypeLabel'=v_item->>'label'
              and coalesce(c.value->>'engineTemplateKey',v_key)=v_template)
          then raise exception 'work_type_manifest_mismatch' using errcode='23514'; end if;
        if v_item->>'status' is distinct from 'disabled' then
          select count(*) into v_role_count from d5o_hosted.configuration_create_rights
            where configuration_version_id=v_version.id and work_type_key=v_key;
          if v_role_count<1 then raise exception 'work_type_creator_unavailable' using errcode='23514'; end if;
        end if;
      end loop;
      for v_item in select value from pg_catalog.jsonb_array_elements(
        v_manifest#>'{d5oPresentation,phaseContract,workTypes}') c(value) loop
        if v_item->>'version'<>'prototype-v2'
          or (select pg_catalog.jsonb_agg(phase->'key' order by ordinal)
             from pg_catalog.jsonb_array_elements(v_item->'phases') with ordinality p(phase,ordinal))
             <>'["discover","define","develop","design","deploy","operate"]'::jsonb
          or (v_item->'designControls'->>'reviewLeadDays')::integer not between 0 and 90
          or (v_item->'designControls'->>'procurementBufferDays')::integer not between 0 and 90
          or (v_item->'deployControls'->>'fieldStartLeadMinutes')::integer not between 0 and 60
          or (v_item->'deployControls'->>'maxActualHoursPerShift')::integer not between 1 and 24
          or (v_item->'operateControls'->>'timezone') is null then
          raise exception 'invalid_phase_policy' using errcode='23514'; end if;
      end loop;
      v_routes:=(select pg_catalog.jsonb_object_agg(route_key,receiving_role)
        from d5o_hosted.configuration_handoff_roles where configuration_version_id=v_version.id);
      update d5o_hosted.configuration_versions set status='validated',
        source_sha256=pg_catalog.encode(extensions.digest(v_manifest::text||
          coalesce((select pg_catalog.string_agg(work_type_key||':'||workspace_role,',' order by work_type_key,workspace_role)
            from d5o_hosted.configuration_create_rights where configuration_version_id=v_version.id),''),'sha256'),'hex'),
        edit_revision=edit_revision+1 where id=v_version.id;
    elsif p_action='activate' then
      update d5o_hosted.configuration_versions set status='superseded',effective_to=now()
        where id=v_active.id;
      update d5o_hosted.configuration_versions set status='published',effective_from=now(),
        edit_revision=edit_revision+1 where id=v_version.id;
    end if;
    v_after:=pg_catalog.jsonb_build_object('revision',v_version.edit_revision+1,
      'status',case when p_action='validate-publish' then 'validated'
        when p_action='activate' then 'published' else 'draft' end,'change',p_input,
      'activeVersionId',case when p_action='activate' then v_version.id else v_active.id end);
    v_result:=pg_catalog.jsonb_build_object('versionId',v_version.id,
      'status',v_after->>'status','revision',v_version.edit_revision+1,
      'activeVersionId',v_after->>'activeVersionId');
  end if;
  insert into d5o_hosted.configuration_admin_events(workspace_id,version_id,action,
    actor_user_id,membership_id,command_id,reason,before_json,after_json)
    values(v_workspace.id,coalesce(v_new,v_version.id),p_action,v_actor,v_member.id,
      p_command_id,trim(p_reason),v_before,v_after);
  insert into d5o_hosted.configuration_admin_receipts(workspace_id,command_id,
    actor_user_id,fingerprint,result)
    values(v_workspace.id,p_command_id,v_actor,v_fp,v_result);
  return v_result;
end $$;
revoke all on function public.d5o_hosted_configuration_admin_command_v1(
  text,text,uuid,uuid,integer,jsonb,text,text) from public,anon;
grant execute on function public.d5o_hosted_configuration_admin_command_v1(
  text,text,uuid,uuid,integer,jsonb,text,text) to authenticated;

-- A request is evaluated once against the Work Record's immutable version pin.
create table d5o_hosted.service_approval_requests (
  work_id uuid primary key,
  workspace_id uuid not null,
  configuration_version_id uuid not null references d5o_hosted.configuration_versions(id),
  amount_minor bigint not null check (amount_minor between 0 and 100000000000),
  currency text not null check (currency = 'USD'),
  threshold_minor bigint not null,
  comparison text not null check (comparison = 'greater_than'),
  authority_role text not null check (authority_role in ('admin','operations_leader')),
  approval_required boolean not null,
  status text not null check (status in ('pending','not_required','approved','rejected')),
  requested_by uuid not null references auth.users(id),
  decided_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  foreign key (work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id)
);
create table d5o_hosted.service_approval_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references d5o_hosted.workspaces(id),
  work_id uuid not null references d5o_hosted.service_approval_requests(work_id),
  configuration_version_id uuid not null references d5o_hosted.configuration_versions(id),
  action text not null check (action in ('request','approve','reject')),
  actor_user_id uuid not null references auth.users(id),
  membership_id uuid not null references d5o_hosted.memberships(id),
  command_id text not null,
  result jsonb not null,
  occurred_at timestamptz not null default now(),
  unique (workspace_id,command_id)
);
create table d5o_hosted.service_approval_receipts (
  workspace_id uuid not null references d5o_hosted.workspaces(id),
  command_id text not null,
  actor_user_id uuid not null references auth.users(id),
  fingerprint text not null,
  result jsonb not null,
  primary key (workspace_id,command_id)
);
alter table d5o_hosted.service_approval_requests enable row level security;
alter table d5o_hosted.service_approval_events enable row level security;
alter table d5o_hosted.service_approval_receipts enable row level security;
revoke all on d5o_hosted.service_approval_requests,d5o_hosted.service_approval_events,
  d5o_hosted.service_approval_receipts from public,anon,authenticated,service_role;

create function public.d5o_hosted_service_approval_command_v1(
  p_workspace_key text,p_work_id uuid,p_action text,p_amount_minor bigint,
  p_currency text,p_command_id text
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
  v_member d5o_hosted.memberships%rowtype;v_work d5o_hosted.work_records%rowtype;
  v_version d5o_hosted.configuration_versions%rowtype;
  v_request d5o_hosted.service_approval_requests%rowtype;
  v_receipt d5o_hosted.service_approval_receipts%rowtype;
  v_policy jsonb;v_result jsonb;v_fingerprint text;v_required boolean;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or p_action not in ('request','approve','reject') or p_work_id is null
    or p_amount_minor is null or p_amount_minor not between 0 and 100000000000
    or p_currency is distinct from 'USD'
    or length(coalesce(p_command_id,'')) not between 8 and 120 then
    raise exception 'invalid_service_approval_command' using errcode='22023'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active' for share;
  if not found then raise exception 'service_approval_denied' using errcode='42501'; end if;
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor and status='active' for share;
  if not found then raise exception 'service_approval_denied' using errcode='42501'; end if;
  select * into v_work from d5o_hosted.work_records
    where id=p_work_id and workspace_id=v_workspace.id for update;
  if not found then raise exception 'service_approval_denied' using errcode='42501'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(
    p_workspace_key,p_work_id,p_action,p_amount_minor,p_currency)::text);
  select * into v_receipt from d5o_hosted.service_approval_receipts
    where workspace_id=v_workspace.id and command_id=p_command_id;
  if found then
    if v_receipt.actor_user_id<>v_actor or v_receipt.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_receipt.result;
  end if;
  select * into v_version from d5o_hosted.configuration_versions
    where id=v_work.configuration_version_id and tenant_id=v_work.configuration_tenant_id
      and status in ('published','superseded');
  if not found then raise exception 'pinned_configuration_unavailable' using errcode='23514'; end if;
  if not exists(select 1 from pg_catalog.jsonb_array_elements(v_version.manifest_json->'workTypes') t(item)
      where item->>'key'=v_work.work_type_key and
        coalesce(item->>'templateKey',item->>'key')='lifecycle-service') then
    raise exception 'service_work_required' using errcode='23514'; end if;
  v_policy:=v_version.manifest_json->'serviceWorkApproval';
  if v_policy is null or v_policy->>'currency' is distinct from 'USD'
    or v_policy->>'comparison' is distinct from 'greater_than'
    or v_policy->>'unavailableBehavior' is distinct from 'block'
    or coalesce(v_policy->>'authorityRole','') not in ('admin','operations_leader')
    or (v_policy->>'thresholdMinor') !~ '^[0-9]{1,12}$'
    or (v_policy->>'thresholdMinor')::bigint not between 0 and 100000000000 then
    raise exception 'service_policy_unavailable' using errcode='23514'; end if;
  select * into v_request from d5o_hosted.service_approval_requests where work_id=p_work_id for update;
  if p_action='request' then
    if v_member.role not in ('admin','project_manager','operations_leader') then
      raise exception 'service_approval_denied' using errcode='42501'; end if;
    if found then raise exception 'service_request_already_evaluated' using errcode='23505'; end if;
    v_required:=p_amount_minor>(v_policy->>'thresholdMinor')::bigint;
    insert into d5o_hosted.service_approval_requests(work_id,workspace_id,configuration_version_id,
      amount_minor,currency,threshold_minor,comparison,authority_role,approval_required,status,requested_by)
      values(p_work_id,v_workspace.id,v_version.id,p_amount_minor,'USD',
        (v_policy->>'thresholdMinor')::bigint,'greater_than',v_policy->>'authorityRole',v_required,
        case when v_required then 'pending' else 'not_required' end,v_actor);
    v_result:=pg_catalog.jsonb_build_object('workId',p_work_id,'configurationVersionId',v_version.id,
      'amountMinor',p_amount_minor,'currency','USD','thresholdMinor',(v_policy->>'thresholdMinor')::bigint,
      'approvalRequired',v_required,'status',case when v_required then 'pending' else 'not_required' end);
  else
    if not found or v_request.status<>'pending'
      or v_request.amount_minor<>p_amount_minor or v_request.currency is distinct from p_currency
      or v_request.configuration_version_id<>v_version.id then
      raise exception 'pending_approval_required' using errcode='23514'; end if;
    if v_member.role<>v_request.authority_role or v_actor=v_request.requested_by then
      raise exception 'independent_approval_required' using errcode='42501'; end if;
    update d5o_hosted.service_approval_requests set
      status=case when p_action='approve' then 'approved' else 'rejected' end,
      decided_by=v_actor,decided_at=now() where work_id=p_work_id;
    v_result:=pg_catalog.jsonb_build_object('workId',p_work_id,'configurationVersionId',v_version.id,
      'approvalRequired',true,'status',case when p_action='approve' then 'approved' else 'rejected' end);
  end if;
  insert into d5o_hosted.service_approval_events(workspace_id,work_id,configuration_version_id,
    action,actor_user_id,membership_id,command_id,result)
    values(v_workspace.id,p_work_id,v_version.id,p_action,v_actor,v_member.id,p_command_id,v_result);
  insert into d5o_hosted.service_approval_receipts(workspace_id,command_id,actor_user_id,fingerprint,result)
    values(v_workspace.id,p_command_id,v_actor,v_fingerprint,v_result);
  return v_result;
end $$;
revoke all on function public.d5o_hosted_service_approval_command_v1(
  text,uuid,text,bigint,text,text) from public,anon;
grant execute on function public.d5o_hosted_service_approval_command_v1(
  text,uuid,text,bigint,text,text) to authenticated;

create function public.d5o_hosted_configuration_history_v1(p_workspace_key text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace uuid;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null then
    raise exception 'configuration_admin_required' using errcode='42501'; end if;
  select w.id into v_workspace from d5o_hosted.workspaces w
    join d5o_hosted.memberships m on m.workspace_id=w.id
    where w.workspace_key=p_workspace_key and w.status='active'
      and m.actor_user_id=v_actor and m.status='active' and m.role='admin';
  if v_workspace is null then raise exception 'configuration_admin_required' using errcode='42501'; end if;
  return coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'versionId',e.version_id,'action',e.action,'actor',coalesce(u.email,e.actor_user_id::text),
    'occurredAt',e.occurred_at,'reason',e.reason,'changedSettings',e.after_json->'change',
    'commandId',e.command_id) order by e.occurred_at desc)
    from d5o_hosted.configuration_admin_events e
    left join auth.users u on u.id=e.actor_user_id
    where e.workspace_id=v_workspace),'[]'::jsonb);
end $$;
revoke all on function public.d5o_hosted_configuration_history_v1(text) from public,anon;
grant execute on function public.d5o_hosted_configuration_history_v1(text) to authenticated;

-- Vendor identity is separate from customer membership. Provisioning this role is an
-- offline controlled operation until a vendor identity administration command exists.
create table d5o_hosted.platform_administrators (
  actor_user_id uuid primary key references auth.users(id),
  status text not null check (status in ('active','suspended')),
  granted_at timestamptz not null default now()
);
alter table d5o_hosted.platform_administrators enable row level security;
revoke all on d5o_hosted.platform_administrators from public,anon,authenticated,service_role;

create function public.d5o_platform_tenant_directory_v1()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or not exists(select 1 from d5o_hosted.platform_administrators
      where actor_user_id=v_actor and status='active') then
    raise exception 'platform_administrator_required' using errcode='42501'; end if;
  return coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'workspaceId',w.id,'workspaceKey',w.workspace_key,'name',w.display_name,
    'status',w.status,'configurationTenantId',t.id,
    'activeVersionId',v.id,'activeVersion',v.version_number,
    'activeSince',v.effective_from,
    'serviceApproval',v.manifest_json->'serviceWorkApproval',
    'versionCount',(select count(*) from d5o_hosted.configuration_versions history
      where history.tenant_id=t.id)) order by w.display_name)
    from d5o_hosted.workspaces w
    left join d5o_hosted.configuration_tenants t on t.workspace_id=w.id and t.status='active'
    left join d5o_hosted.configuration_versions v on v.tenant_id=t.id and v.status='published'
      and v.effective_from<=now() and (v.effective_to is null or v.effective_to>now())),'[]'::jsonb);
end $$;
revoke all on function public.d5o_platform_tenant_directory_v1() from public,anon;
grant execute on function public.d5o_platform_tenant_directory_v1() to authenticated;
