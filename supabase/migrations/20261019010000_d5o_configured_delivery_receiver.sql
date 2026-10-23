-- Future Work may pin an administrator-published receiving role. Existing Work keeps its pinned Operations role.
-- Support ownership and activation continue to require Operations authority.
alter table d5o_hosted.configuration_handoff_roles drop constraint configuration_handoff_roles_check;

create or replace function d5o_hosted.configured_handoff_role_v1(p_version uuid,p_route text)
returns text language plpgsql stable set search_path='' as $$
declare v_role text;
begin
  if p_route not in ('discoverDefine','designDeploy','deployOperate') then
    raise exception 'handoff_route_unavailable' using errcode='23514'; end if;
  select nullif(v.manifest_json#>>array['d5oPresentation','handoffRoles',p_route],'')
    into v_role from d5o_hosted.configuration_versions v
    where v.id=p_version and v.status in ('published','superseded');
  if v_role is null then
    select r.receiving_role into v_role from d5o_hosted.configuration_handoff_roles r
      where r.configuration_version_id=p_version and r.route_key=p_route;
  end if;
  if v_role not in ('admin','operations_leader','project_manager')
     then
    raise exception 'handoff_route_unavailable' using errcode='23514'; end if;
  return v_role;
end $$;

create or replace function public.d5o_hosted_handoff_configuration_command_v1(
  p_workspace_key text,p_action text,p_version uuid,p_route text,p_role text,
  p_expected_revision integer,p_command_id text
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
  v_member d5o_hosted.memberships%rowtype;v_tenant d5o_hosted.configuration_tenants%rowtype;
  v_active d5o_hosted.configuration_versions%rowtype;v_version d5o_hosted.configuration_versions%rowtype;
  v_receipt d5o_hosted.handoff_configuration_receipts%rowtype;
  v_prior_role text;v_current_revision integer;v_result jsonb;v_routes jsonb;
  v_fingerprint text;v_new_id uuid;v_route record;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or p_action not in ('create-draft','save-route','publish','activate')
    or p_version is null or p_expected_revision is null or p_expected_revision<0
    or length(coalesce(p_command_id,'')) not between 8 and 120
    or (p_action='save-route' and (p_route not in ('discoverDefine','designDeploy','deployOperate')
      or p_role not in ('admin','operations_leader','project_manager')
      ))
    or (p_action<>'save-route' and (p_route is not null or p_role is not null or p_expected_revision<>0))
  then raise exception 'invalid_handoff_configuration_command' using errcode='22023'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active' for share;
  if not found then raise exception 'handoff_route_admin_required' using errcode='42501'; end if;
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor and status='active' and role='admin' for share;
  if not found then raise exception 'handoff_route_admin_required' using errcode='42501'; end if;
  select * into v_tenant from d5o_hosted.configuration_tenants
    where workspace_id=v_workspace.id and status='active' for update;
  if not found then raise exception 'handoff_configuration_unavailable' using errcode='23514'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_workspace_key,p_action,p_version,
    p_route,p_role,p_expected_revision)::text);
  select * into v_receipt from d5o_hosted.handoff_configuration_receipts
    where workspace_id=v_workspace.id and command_id=p_command_id;
  if found then
    if v_receipt.actor_user_id<>v_actor or v_receipt.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_receipt.result;
  end if;
  select * into v_active from d5o_hosted.configuration_versions
    where tenant_id=v_tenant.id and status='published'
      and effective_from<=now() and (effective_to is null or effective_to>now()) for update;
  if not found then raise exception 'handoff_configuration_unavailable' using errcode='23514'; end if;
  if p_action='create-draft' then
    if p_version<>v_active.id or exists(select 1 from d5o_hosted.configuration_versions
      where tenant_id=v_tenant.id and status in ('draft','validated')) then
      raise exception 'stale_handoff_configuration' using errcode='23505'; end if;
    insert into d5o_hosted.configuration_versions(tenant_id,version_number,status,source_sha256,
      manifest_json,source_version_id)
      values(v_tenant.id,(select max(version_number)+1 from d5o_hosted.configuration_versions
        where tenant_id=v_tenant.id),'draft',v_active.source_sha256,v_active.manifest_json,v_active.id)
      returning id into v_new_id;
    insert into d5o_hosted.configuration_work_types(configuration_version_id,work_type_key,display_name,status)
      select v_new_id,work_type_key,display_name,status from d5o_hosted.configuration_work_types
      where configuration_version_id=v_active.id;
    insert into d5o_hosted.configuration_create_rights(configuration_version_id,work_type_key,workspace_role)
      select v_new_id,work_type_key,workspace_role from d5o_hosted.configuration_create_rights
      where configuration_version_id=v_active.id;
    insert into d5o_hosted.configuration_handoff_roles(configuration_version_id,route_key,receiving_role,revision,configured_by)
      select v_new_id,route_key,receiving_role,1,v_actor from d5o_hosted.configuration_handoff_roles
      where configuration_version_id=v_active.id;
    v_result:=pg_catalog.jsonb_build_object('versionId',v_new_id,'status','draft');
  else
    select * into v_version from d5o_hosted.configuration_versions
      where id=p_version and tenant_id=v_tenant.id and source_version_id=v_active.id for update;
    if not found then raise exception 'stale_handoff_configuration' using errcode='23505'; end if;
    if p_action='save-route' then
      if v_version.status<>'draft' then raise exception 'handoff_draft_required' using errcode='23514'; end if;
      select receiving_role,revision into v_prior_role,v_current_revision
        from d5o_hosted.configuration_handoff_roles
        where configuration_version_id=v_version.id and route_key=p_route for update;
      if coalesce(v_current_revision,0)<>p_expected_revision then
        raise exception 'stale_handoff_route' using errcode='23505'; end if;
      if v_current_revision is null then
        insert into d5o_hosted.configuration_handoff_roles(configuration_version_id,route_key,receiving_role,revision,configured_by)
          values(v_version.id,p_route,p_role,1,v_actor);
      else
        update d5o_hosted.configuration_handoff_roles set receiving_role=p_role,
          revision=revision+1,configured_by=v_actor,updated_at=now()
          where configuration_version_id=v_version.id and route_key=p_route;
      end if;
      v_result:=pg_catalog.jsonb_build_object('versionId',v_version.id,'status','draft',
        'route',p_route,'role',p_role,'revision',p_expected_revision+1);
    elsif p_action='publish' then
      if v_version.status<>'draft' or (select count(*) from d5o_hosted.configuration_handoff_roles
        where configuration_version_id=v_version.id)<>3 then
        raise exception 'incomplete_handoff_routes' using errcode='23514'; end if;
      for v_route in select route_key,receiving_role from d5o_hosted.configuration_handoff_roles
        where configuration_version_id=v_version.id loop
        if not exists(select 1 from d5o_hosted.memberships m where m.workspace_id=v_workspace.id
          and m.status='active' and m.role=v_route.receiving_role) then
          raise exception 'configured_receiver_unavailable' using errcode='23514'; end if;
      end loop;
      select pg_catalog.jsonb_object_agg(route_key,receiving_role) into v_routes
        from d5o_hosted.configuration_handoff_roles where configuration_version_id=v_version.id;
      update d5o_hosted.configuration_versions set status='validated',
        source_sha256=pg_catalog.encode(extensions.digest(v_active.source_sha256||v_routes::text,'sha256'),'hex'),
        manifest_json=v_version.manifest_json||pg_catalog.jsonb_build_object('d5oPresentation',
          coalesce(v_version.manifest_json->'d5oPresentation','{}'::jsonb)||
          pg_catalog.jsonb_build_object('handoffRoles',v_routes))
        where id=v_version.id;
      v_result:=pg_catalog.jsonb_build_object('versionId',v_version.id,'status','validated');
    elsif p_action='activate' then
      if v_version.status<>'validated' then
        raise exception 'validated_handoff_configuration_required' using errcode='23514'; end if;
      update d5o_hosted.configuration_versions set status='superseded',effective_to=now()
        where id=v_active.id;
      update d5o_hosted.configuration_versions set status='published',effective_from=now()
        where id=v_version.id;
      v_result:=pg_catalog.jsonb_build_object('versionId',v_version.id,'status','published',
        'supersededVersionId',v_active.id);
    end if;
  end if;
  insert into d5o_hosted.handoff_configuration_events(workspace_id,configuration_version_id,
    action,route_key,prior_role,receiving_role,actor_user_id,membership_id,command_id)
    values(v_workspace.id,coalesce(v_new_id,v_version.id),p_action,p_route,v_prior_role,p_role,
      v_actor,v_member.id,p_command_id);
  insert into d5o_hosted.handoff_configuration_receipts(workspace_id,command_id,actor_user_id,fingerprint,result)
    values(v_workspace.id,p_command_id,v_actor,v_fingerprint,v_result);
  return v_result;
end $$;

create or replace function public.d5o_hosted_acceptance_command_v1(
  p_workspace_key text,p_presentation_id text,p_package_id text,
  p_action text,p_input jsonb,p_command_id text,
  p_expected_source_revision bigint,p_expected_design_revision integer,
  p_expected_deploy_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
  v_member d5o_hosted.memberships%rowtype;v_work d5o_hosted.work_records%rowtype;
  v_raw d5o_hosted.prototype_states%rowtype;
  v_design d5o_hosted.connected_design_states%rowtype;
  v_schedule d5o_hosted.connected_schedule_states%rowtype;
  v_deploy d5o_hosted.connected_deploy_states%rowtype;
  v_receipt d5o_hosted.connected_deploy_receipts%rowtype;
  v_state jsonb;v_release jsonb;v_turnover jsonb;v_acceptance jsonb;v_evidence jsonb;v_receiving_role text;
  v_item jsonb;v_requirement text;v_package text;v_current jsonb;
  v_all_turnovers jsonb:='[]'::jsonb;v_release_ids jsonb:='[]'::jsonb;
  v_now timestamptz:=now();v_fingerprint text;v_result jsonb;
  v_note text:=trim(coalesce(p_input->>'note',''));
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or p_action not in ('assemble-turnover','accept-client','accept-work',
      'respond-operate','respond-operate-work')
    or pg_catalog.jsonb_typeof(p_input)<>'object'
    or length(coalesce(p_command_id,'')) not between 8 and 120
    or p_expected_source_revision is null or p_expected_source_revision<1
    or p_expected_design_revision is null or p_expected_design_revision<1
    or p_expected_deploy_revision is null or p_expected_deploy_revision<1 then
    raise exception 'invalid_acceptance_command' using errcode='22023'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor and status='active' for share;
  if not found then raise exception 'acceptance_membership_required' using errcode='42501'; end if;
  select w.* into v_work from d5o_hosted.work_records w
    join d5o_hosted.work_identity_links l on l.work_id=w.id
      and l.workspace_id=w.workspace_id
    where w.workspace_id=v_workspace.id and l.presentation_id=p_presentation_id
      for update of w;
  if not found then raise exception 'connected_work_unavailable' using errcode='42501'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_workspace_key,
    p_presentation_id,p_package_id,p_action,p_input,p_expected_source_revision,
    p_expected_design_revision,p_expected_deploy_revision)::text);
  select * into v_receipt from d5o_hosted.connected_deploy_receipts
    where workspace_id=v_workspace.id and command_id=p_command_id;
  if found then
    if v_receipt.work_id<>v_work.id or v_receipt.actor_user_id<>v_actor
      or v_receipt.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_receipt.result; end if;
  select * into v_raw from d5o_hosted.prototype_states
    where workspace_id=v_workspace.id and state_key='work' for share;
  select * into v_design from d5o_hosted.connected_design_states
    where workspace_id=v_workspace.id and work_id=v_work.id for share;
  select * into v_schedule from d5o_hosted.connected_schedule_states
    where workspace_id=v_workspace.id for share;
  select * into v_deploy from d5o_hosted.connected_deploy_states
    where workspace_id=v_workspace.id and work_id=v_work.id for update;
  if v_raw.revision is distinct from p_expected_source_revision
    or v_design.decision_revision is distinct from p_expected_design_revision
    or v_deploy.decision_revision is distinct from p_expected_deploy_revision then
    raise exception 'stale_acceptance_basis' using errcode='23505'; end if;
  v_state:=v_deploy.state;
  if p_action in ('assemble-turnover','accept-client','respond-operate') then
    select r into v_release from pg_catalog.jsonb_array_elements(v_design.state->'releases') r
      where r->>'packageId'=p_package_id order by r->>'issuedAt' desc limit 1;
    if v_release is null or v_release->>'status'<>'Accepted'
      or (v_release->>'packageRevision')::integer<>
        (select (p->>'revision')::integer from pg_catalog.jsonb_array_elements(
          v_design.state->'packages') p where p->>'packageId'=p_package_id) then
      raise exception 'current_accepted_release_required' using errcode='23514'; end if;
  end if;
  if p_action='assemble-turnover' then
    if v_member.role not in ('project_manager','field_supervisor')
      or p_input ? 'operateOwner' then
      raise exception 'turnover_assembly_authority_required' using errcode='42501'; end if;
    if not exists(select 1 from pg_catalog.jsonb_array_elements(v_state->'completions') c
      where c->>'packageId'=p_package_id and c->>'releaseId'=v_release->>'id'
        and c->>'status'='Reviewed') then
      raise exception 'reviewed_completion_required' using errcode='23514'; end if;
    if exists(select 1 from pg_catalog.jsonb_array_elements(v_state->'issues') i
      where i->>'packageId'=p_package_id and i->>'status'='Open') then
      raise exception 'open_issue_blocks_turnover' using errcode='23514'; end if;
    if exists(select 1 from pg_catalog.jsonb_array_elements(v_state->'turnovers') t
      where t->'releaseIds' ? (v_release->>'id') and t->>'status' in
        ('Draft','Client accepted','Conditionally accepted')) then
      raise exception 'current_turnover_already_exists' using errcode='23514'; end if;
    v_receiving_role:=d5o_hosted.configured_handoff_role_v1(v_work.configuration_version_id,'deployOperate');
    if not exists(select 1 from d5o_hosted.memberships m
      where m.workspace_id=v_workspace.id and m.status='active'
        and m.role=v_receiving_role and m.actor_user_id<>v_actor) then
      raise exception 'configured_receiver_unavailable' using errcode='23514'; end if;
    v_turnover:=pg_catalog.jsonb_build_object('id',gen_random_uuid(),
      'revision',1,'releaseIds',pg_catalog.jsonb_build_array(v_release->>'id'),
      'packageId',p_package_id,'reportIds',
        (select pg_catalog.jsonb_agg(r->>'id') from pg_catalog.jsonb_array_elements(v_state->'reports') r
          where r->>'packageId'=p_package_id and r->>'releaseId'=v_release->>'id'
            and r->>'status'='Reviewed'),
      'inspectionIds',
        (select pg_catalog.jsonb_agg(i->>'id') from pg_catalog.jsonb_array_elements(v_state->'inspections') i
          where i->>'packageId'=p_package_id and i->>'releaseId'=v_release->>'id'
            and i->>'status'='Verified' and i->>'result'='Pass'),
      'evidenceIds',
        (select pg_catalog.jsonb_agg(e->>'id') from pg_catalog.jsonb_array_elements(v_state->'evidence') e
          where e->>'packageId'=p_package_id and e->>'releaseId'=v_release->>'id'
            and e->>'state'='Reviewed'),
      'completionId',(select c->>'id' from pg_catalog.jsonb_array_elements(v_state->'completions') c
        where c->>'packageId'=p_package_id and c->>'releaseId'=v_release->>'id'
          and c->>'status'='Reviewed'
        order by (c->>'reviewedAt')::timestamptz desc limit 1),
      'assembledAt',v_now,'assembledByActorId',v_actor,
      'membershipId',v_member.id,'status','Draft',
      'operateOwner','Configured '||v_receiving_role||' queue',
      'operateRole',v_receiving_role,
      'obligations',trim(coalesce(p_input->>'obligations','')),'receipt','Awaiting');
    v_state:=pg_catalog.jsonb_set(v_state,'{turnovers}',
      v_state->'turnovers'||pg_catalog.jsonb_build_array(v_turnover));
  elsif p_action='accept-client' then
    if v_member.role not in ('project_manager','operations_leader')
      or length(trim(coalesce(p_input->>'signerName','')))<3
      or length(trim(coalesce(p_input->>'signerOrganization','')))<3
      or length(trim(coalesce(p_input->>'authorityBasis','')))<10
      or length(trim(coalesce(p_input->>'signerRole','')))<3
      or p_input->>'evidenceId' is null then
      raise exception 'customer_acceptance_recording_incomplete' using errcode='42501'; end if;
    select t into v_turnover from pg_catalog.jsonb_array_elements(v_state->'turnovers') t
      where t->>'id'=p_input->>'turnoverId' and t->>'status'='Draft'
        and t->'releaseIds' ? (v_release->>'id');
    if v_turnover is null or v_turnover->>'assembledByActorId'=v_actor::text
      or not exists(select 1 from pg_catalog.jsonb_array_elements(v_state->'completions') c
        where c->>'id'=v_turnover->>'completionId' and c->>'status'='Reviewed') then
      raise exception 'independent_current_turnover_required' using errcode='42501'; end if;
    for v_item in select value from pg_catalog.jsonb_array_elements(
      v_release#>'{snapshot,requirementIds}') loop
      v_requirement:=v_item#>>'{}';
      if not exists(select 1 from pg_catalog.jsonb_array_elements(v_state->'inspections') i
        where i->>'id' in (select pg_catalog.jsonb_array_elements_text(v_turnover->'inspectionIds'))
          and i->>'requirementId'=v_requirement and i->>'result'='Pass'
          and i->>'status'='Verified' and i->>'releaseId'=v_release->>'id') then
        raise exception 'turnover_verification_incomplete' using errcode='23514'; end if;
    end loop;
    if exists(select 1 from pg_catalog.jsonb_array_elements(v_state->'issues') i
      where i->>'packageId'=p_package_id and i->>'status'='Open') then
      raise exception 'open_issue_blocks_acceptance' using errcode='23514'; end if;
    v_evidence:=d5o_hosted.require_customer_decision_evidence_v1(
      v_workspace.id,v_work.id,p_input->>'evidenceId','package-acceptance',
      v_turnover->>'id',(v_turnover->>'revision')::integer,
      pg_catalog.jsonb_build_object('releaseIds',v_turnover->'releaseIds',
        'designRevision',v_design.decision_revision));
    v_turnover:=v_turnover||pg_catalog.jsonb_build_object(
      'status',case when trim(coalesce(p_input->>'conditions',''))=''
        then 'Client accepted' else 'Conditionally accepted' end,
      'acceptedAt',v_now,'recordedByActorId',v_actor,'signerName',trim(p_input->>'signerName'),
      'signerOrganization',trim(p_input->>'signerOrganization'),
      'signerRole',trim(p_input->>'signerRole'),
      'authorityBasis',trim(p_input->>'authorityBasis'),
      'source','evidence:'||(v_evidence->>'id'),'customerEvidence',v_evidence,
      'conditions',trim(coalesce(p_input->>'conditions','')),
      'exclusions',trim(coalesce(p_input->>'exclusions','')));
    v_state:=pg_catalog.jsonb_set(v_state,'{turnovers}',
      (select pg_catalog.jsonb_agg(case when t->>'id'=v_turnover->>'id' then v_turnover
        else t end order by ordinal) from pg_catalog.jsonb_array_elements(v_state->'turnovers')
          with ordinality as entries(t,ordinal)));
    v_state:=pg_catalog.jsonb_set(v_state,'{signoffs}',v_state->'signoffs'||
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',gen_random_uuid(),
        'kind','Customer scope acceptance','recordId',v_turnover->>'id',
        'recordRevision',1,'releaseIds',v_turnover->'releaseIds',
        'scope',p_package_id,'statement','Customer acceptance applies only to this exact turnover revision.',
        'signerName',v_turnover->>'signerName',
        'signerOrganization',v_turnover->>'signerOrganization',
        'method','Externally signed document','authorityBasis',v_turnover->>'authorityBasis',
        'source',v_turnover->>'source','capturedByActorId',v_actor,
        'at',v_now,'outcome',case when v_turnover->>'conditions'=''
          then 'Accepted' else 'Conditional' end,
        'conditions',v_turnover->>'conditions','snapshot',v_turnover)));
  elsif p_action='accept-work' then
    if v_member.role not in ('project_manager','operations_leader')
      or v_state->'workAcceptance' is not null
      or length(trim(coalesce(p_input->>'signerName','')))<3
      or length(trim(coalesce(p_input->>'signerOrganization','')))<3
      or length(trim(coalesce(p_input->>'signerRole','')))<3
      or length(trim(coalesce(p_input->>'authorityBasis','')))<10
      or p_input->>'evidenceId' is null
      or trim(coalesce(p_input->>'conditions',''))<>'' then
      raise exception 'whole_work_acceptance_incomplete' using errcode='42501'; end if;
    for v_item in select value from pg_catalog.jsonb_array_elements(v_design.state->'packages') loop
      v_package:=v_item->>'packageId';
      select r into v_current from pg_catalog.jsonb_array_elements(v_design.state->'releases') r
        where r->>'packageId'=v_package order by r->>'issuedAt' desc limit 1;
      select t into v_turnover from pg_catalog.jsonb_array_elements(v_state->'turnovers') t
        where t->>'packageId'=v_package and t->>'status'='Client accepted'
          and t->'releaseIds' ? (v_current->>'id');
      if v_current is null or v_current->>'status'<>'Accepted'
        or v_turnover is null or v_turnover->>'assembledByActorId'=v_actor::text
        or not exists(select 1 from pg_catalog.jsonb_array_elements(v_state->'completions') c
          where c->>'id'=v_turnover->>'completionId' and c->>'status'='Reviewed') then
        raise exception 'all_current_packages_require_acceptance' using errcode='23514'; end if;
      v_all_turnovers:=v_all_turnovers||pg_catalog.jsonb_build_array(v_turnover->>'id');
      v_release_ids:=v_release_ids||pg_catalog.jsonb_build_array(v_current->>'id');
    end loop;
    if pg_catalog.jsonb_array_length(v_all_turnovers)=0 or
      exists(select 1 from pg_catalog.jsonb_array_elements(v_state->'issues') i
        where i->>'status'='Open') then
      raise exception 'whole_work_scope_incomplete' using errcode='23514'; end if;
    v_evidence:=d5o_hosted.require_customer_decision_evidence_v1(
      v_workspace.id,v_work.id,p_input->>'evidenceId','work-acceptance',
      p_presentation_id,1,pg_catalog.jsonb_build_object(
        'turnoverIds',v_all_turnovers,'releaseIds',v_release_ids,
        'designRevision',v_design.decision_revision));
    v_acceptance:=pg_catalog.jsonb_build_object('id',gen_random_uuid(),
      'revision',1,'turnoverIds',v_all_turnovers,'releaseIds',v_release_ids,
      'acceptedAt',v_now,'recordedByActorId',v_actor,
      'signerName',trim(p_input->>'signerName'),
      'signerOrganization',trim(p_input->>'signerOrganization'),
      'signerRole',trim(p_input->>'signerRole'),
      'authorityBasis',trim(p_input->>'authorityBasis'),
      'source','evidence:'||(v_evidence->>'id'),'customerEvidence',v_evidence,
      'conditions','','receipt','Awaiting',
      'receivingRole',d5o_hosted.configured_handoff_role_v1(v_work.configuration_version_id,'deployOperate'));
    v_state:=pg_catalog.jsonb_set(v_state,'{workAcceptance}',v_acceptance);
    v_state:=pg_catalog.jsonb_set(v_state,'{signoffs}',v_state->'signoffs'||
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',gen_random_uuid(),
        'kind','Final client acceptance','recordId',v_acceptance->>'id',
        'recordRevision',1,'releaseIds',v_release_ids,'scope',p_presentation_id,
        'statement','Customer accepts the exact listed package turnovers; Operations receipt is separate.',
        'signerName',v_acceptance->>'signerName',
        'signerOrganization',v_acceptance->>'signerOrganization',
        'method','Externally signed document','authorityBasis',v_acceptance->>'authorityBasis',
        'source',v_acceptance->>'source','capturedByActorId',v_actor,
        'at',v_now,'outcome','Accepted','conditions','','snapshot',v_acceptance)));
  elsif p_action='respond-operate' then
    if v_member.role<>d5o_hosted.configured_handoff_role_v1(v_work.configuration_version_id,'deployOperate')
      or p_input->>'decision' not in ('Accepted','Declined') or length(v_note)<15 then
      raise exception 'operations_receipt_authority_required' using errcode='42501'; end if;
    select t into v_turnover from pg_catalog.jsonb_array_elements(v_state->'turnovers') t
      where t->>'id'=p_input->>'turnoverId' and t->>'status'='Client accepted'
        and t->>'receipt'='Awaiting' and t->'releaseIds' ? (v_release->>'id');
    if v_turnover is null or v_turnover->>'recordedByActorId'=v_actor::text
      or v_turnover->>'assembledByActorId'=v_actor::text
      or (v_turnover->>'operateRole' is not null
        and v_member.role is distinct from v_turnover->>'operateRole') then
      raise exception 'independent_exact_turnover_required' using errcode='42501'; end if;
    v_turnover:=v_turnover||pg_catalog.jsonb_build_object('receipt',
      case when p_input->>'decision'='Accepted' then 'Accepted' else 'Returned' end,
      'receivedByActorId',v_actor,'receivedAt',v_now,'receiptNote',v_note);
    v_state:=pg_catalog.jsonb_set(v_state,'{turnovers}',
      (select pg_catalog.jsonb_agg(case when t->>'id'=v_turnover->>'id' then v_turnover
        else t end order by ordinal) from pg_catalog.jsonb_array_elements(v_state->'turnovers')
          with ordinality as entries(t,ordinal)));
  else
    if v_member.role<>d5o_hosted.configured_handoff_role_v1(v_work.configuration_version_id,'deployOperate')
      or p_input->>'decision' not in ('Accepted','Declined') or length(v_note)<15 then
      raise exception 'operations_receipt_authority_required' using errcode='42501'; end if;
    v_acceptance:=v_state->'workAcceptance';
    if v_acceptance is null or v_acceptance->>'receipt'<>'Awaiting'
      or v_acceptance->>'recordedByActorId'=v_actor::text then
      raise exception 'independent_work_receipt_required' using errcode='42501'; end if;
    if exists(select 1 from pg_catalog.jsonb_array_elements(v_state->'turnovers') t
      where t->>'id' in (select pg_catalog.jsonb_array_elements_text(v_acceptance->'turnoverIds'))
        and t->>'receipt'<>'Accepted') then
      raise exception 'package_receipts_required' using errcode='23514'; end if;
    if exists(select 1 from pg_catalog.jsonb_array_elements(v_design.state->'releases') r
      where r->>'status'='Accepted' and not (v_acceptance->'releaseIds' ? (r->>'id'))) then
      raise exception 'work_release_basis_stale' using errcode='23514'; end if;
    v_acceptance:=v_acceptance||pg_catalog.jsonb_build_object(
      'receipt',case when p_input->>'decision'='Accepted' then 'Accepted' else 'Returned' end,
      'receivedByActorId',v_actor,'receivedAt',v_now,'receiptNote',v_note);
    v_state:=pg_catalog.jsonb_set(v_state,'{workAcceptance}',v_acceptance);
  end if;
  v_state:=v_state||pg_catalog.jsonb_build_object(
    'authorityRevision',v_deploy.decision_revision+1,
    'events',v_state->'events'||pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('id',gen_random_uuid(),
        'commandId',p_command_id,'at',v_now,'actorId',v_actor,
        'membershipId',v_member.id,'action',p_action,
        'packageId',p_package_id,'note',v_note)));
  update d5o_hosted.connected_deploy_states set
    decision_revision=decision_revision+1,state=v_state,updated_at=v_now
    where workspace_id=v_workspace.id and work_id=v_work.id;
  insert into d5o_hosted.connected_deploy_events(workspace_id,work_id,
    decision_revision,command_id,action,actor_user_id,membership_id,
    design_revision,schedule_revision,snapshot)
  values(v_workspace.id,v_work.id,v_deploy.decision_revision+1,p_command_id,
    p_action,v_actor,v_member.id,v_design.decision_revision,
    v_schedule.decision_revision,v_state);
  v_result:=public.d5o_hosted_prototype_read_v1(p_workspace_key,'work');
  insert into d5o_hosted.connected_deploy_receipts(workspace_id,command_id,
    work_id,actor_user_id,fingerprint,result)
  values(v_workspace.id,p_command_id,v_work.id,v_actor,v_fingerprint,v_result);
  return v_result;
end; $$;

create or replace function public.d5o_hosted_operate_command_internal_v1(
  p_workspace_key text,p_presentation_id text,p_action text,p_input jsonb,
  p_command_id text,p_expected_source_revision bigint,
  p_expected_deploy_revision integer,p_expected_operate_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
  v_member d5o_hosted.memberships%rowtype;v_work d5o_hosted.work_records%rowtype;
  v_raw d5o_hosted.prototype_states%rowtype;
  v_deploy d5o_hosted.connected_deploy_states%rowtype;
  v_operate d5o_hosted.connected_operate_states%rowtype;
  v_receipt d5o_hosted.connected_operate_receipts%rowtype;
  v_policy jsonb;v_state jsonb;v_source jsonb;v_asset jsonb;
  v_agreement jsonb;v_request jsonb;v_now timestamptz:=now();
  v_fingerprint text;v_result jsonb;v_note text:=trim(coalesce(p_input->>'note',''));
  v_id uuid;v_count integer;v_hours integer;v_due timestamptz;
  v_cursor timestamptz;v_added integer;v_local timestamp;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or p_action not in ('receive-handoff','add-asset','accept-support','activate',
      'add-agreement','approve-agreement','open-request','triage-request','update-finance')
    or pg_catalog.jsonb_typeof(p_input)<>'object'
    or length(coalesce(p_command_id,'')) not between 8 and 120
    or p_expected_source_revision is null or p_expected_source_revision<1
    or p_expected_deploy_revision is null or p_expected_deploy_revision<1
    or p_expected_operate_revision is null or p_expected_operate_revision<0 then
    raise exception 'invalid_operate_command' using errcode='22023'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor and status='active' for share;
  if not found then raise exception 'operate_membership_required' using errcode='42501'; end if;
  select w.* into v_work from d5o_hosted.work_records w
    join d5o_hosted.work_identity_links l on l.work_id=w.id
      and l.workspace_id=w.workspace_id
    where w.workspace_id=v_workspace.id and l.presentation_id=p_presentation_id
      for update of w;
  if not found then raise exception 'connected_work_unavailable' using errcode='42501'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(
    p_workspace_key,p_presentation_id,p_action,p_input,p_expected_source_revision,
    p_expected_deploy_revision,p_expected_operate_revision)::text);
  select * into v_receipt from d5o_hosted.connected_operate_receipts
    where workspace_id=v_workspace.id and command_id=p_command_id;
  if found then
    if v_receipt.work_id<>v_work.id or v_receipt.actor_user_id<>v_actor
      or v_receipt.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_receipt.result; end if;
  select * into v_raw from d5o_hosted.prototype_states
    where workspace_id=v_workspace.id and state_key='work' for share;
  select * into v_deploy from d5o_hosted.connected_deploy_states
    where workspace_id=v_workspace.id and work_id=v_work.id for share;
  select * into v_operate from d5o_hosted.connected_operate_states
    where workspace_id=v_workspace.id and work_id=v_work.id for update;
  if v_raw.revision is distinct from p_expected_source_revision
    or v_deploy.decision_revision is distinct from p_expected_deploy_revision
    or coalesce(v_operate.decision_revision,0) is distinct from p_expected_operate_revision then
    raise exception 'stale_operate_basis' using errcode='23505'; end if;
  select wt->'operateControls' into v_policy
    from d5o_hosted.configuration_versions c,
      lateral pg_catalog.jsonb_array_elements(
        c.manifest_json#>'{d5oPresentation,phaseContract,workTypes}') wt
    where c.id=v_work.configuration_version_id
      and wt->>'workTypeKey'=v_work.work_type_key;
  if v_policy is null or (v_policy->>'version')::integer<>1 then
    raise exception 'pinned_operate_policy_unavailable' using errcode='23514'; end if;
  v_state:=coalesce(v_operate.state,pg_catalog.jsonb_build_object(
    'assets','[]'::jsonb,'agreements','[]'::jsonb,'requests','[]'::jsonb,
    'jobs','[]'::jsonb,'maintenance','[]'::jsonb,
    'customerReviews','[]'::jsonb,'lifecycleLinks','[]'::jsonb,
    'finance',pg_catalog.jsonb_build_object('status','Pending','owner','Finance','note',''),
    'lessons','[]'::jsonb,'events','[]'::jsonb));
  if p_action='receive-handoff' then
    if v_member.role<>d5o_hosted.configured_handoff_role_v1(v_work.configuration_version_id,'deployOperate') or length(v_note)<15
      or v_state->'source' is not null then
      raise exception 'operations_receipt_required' using errcode='42501'; end if;
    v_source:=v_deploy.state->'workAcceptance';
    if v_source is null or v_source->>'receipt'<>'Accepted'
      or v_source->>'receivedByActorId'<>v_actor::text
      or v_source->>'id'<>p_input->>'workAcceptanceId'
      or (v_source->>'revision')::integer is distinct from
        (p_input->>'workAcceptanceRevision')::integer then
      raise exception 'exact_received_turnover_required' using errcode='23514'; end if;
    v_state:=pg_catalog.jsonb_set(v_state,'{source}',
      pg_catalog.jsonb_build_object('kind','Accepted Deploy',
        'workAcceptanceId',v_source->>'id','revision',(v_source->>'revision')::integer,
        'turnoverIds',v_source->'turnoverIds','acceptedAt',v_now,
        'acceptedByActorId',v_actor,'note',v_note));
  elsif p_action='add-asset' then
    if v_member.role not in ('project_manager','operations_leader')
      or v_state->'source' is null
      or length(trim(coalesce(p_input->>'name','')))<3
      or length(trim(coalesce(p_input->>'kind','')))<3
      or length(trim(coalesce(p_input->>'location','')))<3 then
      raise exception 'asset_record_incomplete' using errcode='42501'; end if;
    if exists(select 1 from pg_catalog.jsonb_array_elements(v_state->'assets') a
      where (a->>'name'=p_input->>'name' and a->>'location'=p_input->>'location')
        or (nullif(p_input->>'externalId','') is not null
          and a->>'externalId'=p_input->>'externalId')) then
      raise exception 'asset_identity_conflict' using errcode='23505'; end if;
    select gen_random_uuid() into v_id;
    v_asset:=pg_catalog.jsonb_build_object('id',v_id,'name',trim(p_input->>'name'),
      'kind',trim(p_input->>'kind'),'customer',
        (select r->>'customer' from pg_catalog.jsonb_array_elements(v_raw.state_json->'records') r
          where r->>'id'=p_presentation_id),
      'site',(select r->>'site' from pg_catalog.jsonb_array_elements(v_raw.state_json->'records') r
          where r->>'id'=p_presentation_id),
      'location',trim(p_input->>'location'),
      'externalId',nullif(trim(coalesce(p_input->>'externalId','')),''),
      'sourceWorkIds',pg_catalog.jsonb_build_array(p_presentation_id),
      'sourceTurnoverId',v_state#>>'{source,workAcceptanceId}',
      'status','Pending','owner',coalesce(nullif(trim(p_input->>'owner'),''),v_member.role),
      'documentation',trim(coalesce(p_input->>'documentation','')),
      'history',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'at',v_now,'action','Asset identified','source','Accepted Deploy','actorId',v_actor)));
    v_state:=pg_catalog.jsonb_set(v_state,'{assets}',
      v_state->'assets'||pg_catalog.jsonb_build_array(v_asset));
  elsif p_action='accept-support' then
    if v_member.role<>'operations_leader' or v_state->'source' is null
      or pg_catalog.jsonb_array_length(v_state->'assets')=0
      or length(trim(coalesce(p_input->>'escalation','')))<5
      or length(trim(coalesce(p_input->>'intakeRoute','')))<5
      or (v_policy->>'requireCustomerContact')::boolean
        and length(trim(coalesce(p_input->>'customerContact','')))<3
      or (v_policy->>'requireDocumentationReview')::boolean
        and length(trim(coalesce(p_input->>'documentation','')))<5
      or (v_policy->>'requireExplicitCoverageDisposition')::boolean
        and (length(trim(coalesce(p_input->>'warrantyDisposition','')))<3
          or length(trim(coalesce(p_input->>'serviceDisposition','')))<3)
      or (exists(select 1 from pg_catalog.jsonb_array_elements(v_deploy.state->'turnovers') t
        where trim(coalesce(t->>'obligations',''))<>'')
        and length(trim(coalesce(p_input->>'residualOwner','')))<3) then
      raise exception 'support_profile_incomplete' using errcode='23514'; end if;
    v_state:=pg_catalog.jsonb_set(v_state,'{support}',
      pg_catalog.jsonb_build_object('owner',v_member.role,'ownerActorId',v_actor,
        'acceptedAt',v_now,'customerContact',trim(coalesce(p_input->>'customerContact','')),
        'escalation',trim(p_input->>'escalation'),'intakeRoute',trim(p_input->>'intakeRoute'),
        'warrantyDisposition',trim(coalesce(p_input->>'warrantyDisposition','')),
        'serviceDisposition',trim(coalesce(p_input->>'serviceDisposition','')),
        'documentationReviewed',trim(coalesce(p_input->>'documentation','')),
        'residualOwner',trim(coalesce(p_input->>'residualOwner',''))));
  elsif p_action='activate' then
    if v_member.role<>'operations_leader' or v_state->'source' is null
      or v_state->'support' is null or v_state->'activation' is not null
      or pg_catalog.jsonb_array_length(v_state->'assets')=0
      or v_state#>>'{source,workAcceptanceId}'<>
        v_deploy.state#>>'{workAcceptance,id}'
      or v_deploy.state#>>'{workAcceptance,receipt}'<>'Accepted' then
      raise exception 'operational_readiness_incomplete' using errcode='23514'; end if;
    v_state:=pg_catalog.jsonb_set(v_state,'{activation}',
      pg_catalog.jsonb_build_object('status','Active','at',v_now,'actorId',v_actor,
        'basis',coalesce(nullif(v_note,''),'Recorded support readiness'),
        'sourceRevision',v_state#>'{source,revision}',
        'history',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'at',v_now,'action','Activated','actorId',v_actor,'reason',v_note))));
    v_state:=pg_catalog.jsonb_set(v_state,'{assets}',
      (select pg_catalog.jsonb_agg(a||pg_catalog.jsonb_build_object('status','Supported'))
        from pg_catalog.jsonb_array_elements(v_state->'assets') a));
  elsif p_action='add-agreement' then
    if v_member.role not in ('project_manager','operations_leader')
      or not exists(select 1 from pg_catalog.jsonb_array_elements(v_state->'assets') a
        where a->>'id'=p_input->>'assetId')
      or p_input->>'kind' not in ('Warranty','Service agreement','No coverage')
      or length(trim(coalesce(p_input->>'name','')))<3
      or (p_input->>'effectiveFrom')::date>(p_input->>'effectiveTo')::date
      or pg_catalog.jsonb_typeof(p_input->'serviceCategories')<>'array'
      or pg_catalog.jsonb_array_length(p_input->'serviceCategories')=0
      or pg_catalog.jsonb_typeof(p_input->'laborCovered')<>'boolean'
      or pg_catalog.jsonb_typeof(p_input->'partsCovered')<>'boolean'
      or pg_catalog.jsonb_typeof(p_input->'travelCovered')<>'boolean'
      or length(trim(coalesce(p_input->>'source','')))<10 then
      raise exception 'structured_agreement_required' using errcode='23514'; end if;
    if p_input->>'kind'='No coverage' and not (v_policy->>'allowNoCoverage')::boolean then
      raise exception 'no_coverage_disallowed' using errcode='23514'; end if;
    v_agreement:=pg_catalog.jsonb_build_object('id',gen_random_uuid(),
      'name',trim(p_input->>'name'),'kind',p_input->>'kind','status','Draft',
      'assetIds',pg_catalog.jsonb_build_array(p_input->>'assetId'),
      'effectiveFrom',p_input->>'effectiveFrom','effectiveTo',p_input->>'effectiveTo',
      'serviceCategories',p_input->'serviceCategories',
      'laborCovered',p_input->'laborCovered','partsCovered',p_input->'partsCovered',
      'travelCovered',p_input->'travelCovered',
      'includes',trim(coalesce(p_input->>'includes','')),
      'excludes',trim(coalesce(p_input->>'excludes','')),
      'responseHours',coalesce((p_input->>'responseHours')::integer,
        (v_policy->>'defaultResponseHours')::integer),
      'calendar',coalesce(p_input->>'calendar',v_policy->>'responseCalendar'),
      'timezone',v_policy->>'timezone','source',trim(p_input->>'source'),
      'revision',1,'createdByActorId',v_actor);
    v_state:=pg_catalog.jsonb_set(v_state,'{agreements}',
      v_state->'agreements'||pg_catalog.jsonb_build_array(v_agreement));
  elsif p_action='approve-agreement' then
    if v_member.role<>'operations_leader' or length(v_note)<15 then
      raise exception 'agreement_approval_authority_required' using errcode='42501'; end if;
    select a into v_agreement from pg_catalog.jsonb_array_elements(v_state->'agreements') a
      where a->>'id'=p_input->>'agreementId' and a->>'status'='Draft';
    if v_agreement is null or v_agreement->>'createdByActorId'=v_actor::text then
      raise exception 'independent_agreement_review_required' using errcode='42501'; end if;
    v_agreement:=v_agreement||pg_catalog.jsonb_build_object('status','Active',
      'approvedAt',v_now,'approvedBy',v_actor);
    v_state:=pg_catalog.jsonb_set(v_state,'{agreements}',
      (select pg_catalog.jsonb_agg(case when a->>'id'=v_agreement->>'id'
        then v_agreement else a end order by ordinal)
        from pg_catalog.jsonb_array_elements(v_state->'agreements')
          with ordinality as entries(a,ordinal)));
  elsif p_action='open-request' then
    if v_member.role not in ('project_manager','operations_leader')
      or v_state#>>'{activation,status}'<>'Active'
      or not exists(select 1 from pg_catalog.jsonb_array_elements(v_state->'assets') a
        where a->>'id'=p_input->>'assetId')
      or length(trim(coalesce(p_input->>'title','')))<5
      or length(trim(coalesce(p_input->>'description','')))<10
      or length(trim(coalesce(p_input->>'contact','')))<3
      or p_input->>'impact' not in ('Standard','High','Critical') then
      raise exception 'request_intake_incomplete' using errcode='23514'; end if;
    v_request:=pg_catalog.jsonb_build_object('id',gen_random_uuid(),
      'assetId',p_input->>'assetId','title',trim(p_input->>'title'),
      'description',trim(p_input->>'description'),'impact',p_input->>'impact',
      'contact',trim(p_input->>'contact'),'reportedAt',v_now,
      'owner',coalesce(nullif(trim(p_input->>'owner'),''),v_member.role),
      'status','New','coverage','Awaiting','jobIds','[]'::jsonb,
      'currentCycleJobIds','[]'::jsonb,
      'history',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'at',v_now,'action','Opened','actorId',v_actor,'note',v_note)));
    v_state:=pg_catalog.jsonb_set(v_state,'{requests}',
      v_state->'requests'||pg_catalog.jsonb_build_array(v_request));
  elsif p_action='triage-request' then
    if v_member.role<>'operations_leader' then
      raise exception 'request_triage_authority_required' using errcode='42501'; end if;
    select r into v_request from pg_catalog.jsonb_array_elements(v_state->'requests') r
      where r->>'id'=p_input->>'requestId' and r->>'status' in ('New','Reopened');
    if v_request is null or length(trim(coalesce(p_input->>'serviceCategory','')))<3 then
      raise exception 'current_request_required' using errcode='23514'; end if;
    select count(*) into v_count
      from pg_catalog.jsonb_array_elements(v_state->'agreements') a
      where a->>'status'='Active' and a->'assetIds' ? (v_request->>'assetId')
        and (a->>'effectiveFrom')::date<=v_now::date
        and (a->>'effectiveTo')::date>=v_now::date;
    if v_count>1 then raise exception 'coverage_conflict_requires_decision' using errcode='23514'; end if;
    select a into v_agreement from pg_catalog.jsonb_array_elements(v_state->'agreements') a
      where a->>'status'='Active' and a->'assetIds' ? (v_request->>'assetId')
        and (a->>'effectiveFrom')::date<=v_now::date
        and (a->>'effectiveTo')::date>=v_now::date limit 1;
    if v_agreement is null then
      v_request:=v_request||pg_catalog.jsonb_build_object('coverage','Chargeable',
        'coverageBasis','No active agreement; customer pricing and authorization required');
    elsif v_agreement->>'kind'='No coverage'
      or not (v_agreement->'serviceCategories' ? (p_input->>'serviceCategory')) then
      v_request:=v_request||pg_catalog.jsonb_build_object('coverage','Chargeable',
        'coverageBasis','Recorded terms do not cover this service category',
        'agreementId',v_agreement->>'id');
    else
      v_request:=v_request||pg_catalog.jsonb_build_object(
        'coverage',case when (v_agreement->>'laborCovered')::boolean
          and (v_agreement->>'partsCovered')::boolean
          and (v_agreement->>'travelCovered')::boolean then 'Covered'
          else 'Partially covered' end,
        'coverageBasis','Structured agreement scope and labor/parts/travel terms reviewed',
        'agreementId',v_agreement->>'id');
    end if;
    v_hours:=coalesce((v_agreement->>'responseHours')::integer,
      (v_policy->>'defaultResponseHours')::integer);
    if v_hours is not null and v_hours between 1 and 720 then
      if coalesce(v_agreement->>'calendar',v_policy->>'responseCalendar')='Continuous' then
        v_due:=v_now+pg_catalog.make_interval(hours=>v_hours);
      else
        v_cursor:=v_now;v_added:=0;
        while v_added<v_hours loop
          v_cursor:=v_cursor+interval '1 hour';
          v_local:=v_cursor at time zone (v_policy->>'timezone');
          if extract(isodow from v_local)<6
            and extract(hour from v_local)>=(coalesce((v_policy->>'businessStartHour')::integer,9))
            and extract(hour from v_local)<(coalesce((v_policy->>'businessEndHour')::integer,17))
            and not (v_policy->'holidayDates' ? v_local::date::text) then
            v_added:=v_added+1; end if;
          if v_cursor>v_now+interval '120 days' then
            raise exception 'sla_calendar_unresolvable' using errcode='23514'; end if;
        end loop;
        v_due:=v_cursor;
      end if;
    end if;
    v_request:=v_request||pg_catalog.jsonb_build_object('status','Triaged',
      'serviceCategory',p_input->>'serviceCategory',
      'responseDueAt',v_due,'owner',coalesce(nullif(trim(p_input->>'owner'),''),v_member.role),
      'slaBasis',pg_catalog.jsonb_build_object('configurationVersionId',
        v_work.configuration_version_id,'agreementId',v_agreement->>'id',
        'agreementRevision',(v_agreement->>'revision')::integer,
        'calendar',coalesce(v_agreement->>'calendar',v_policy->>'responseCalendar'),
        'timezone',v_policy->>'timezone','responseHours',v_hours));
    v_state:=pg_catalog.jsonb_set(v_state,'{requests}',
      (select pg_catalog.jsonb_agg(case when r->>'id'=v_request->>'id'
        then v_request else r end order by ordinal)
        from pg_catalog.jsonb_array_elements(v_state->'requests')
          with ordinality as entries(r,ordinal)));
  else
    if v_member.role<>'billing_commercial_lead'
      or p_input->>'status' not in ('Pending','In review','Closed')
      or length(v_note)<10
      or v_deploy.state#>>'{workAcceptance,receipt}'<>'Accepted' then
      raise exception 'finance_closeout_authority_required' using errcode='42501'; end if;
    v_state:=pg_catalog.jsonb_set(v_state,'{finance}',
      pg_catalog.jsonb_build_object('status',p_input->>'status',
        'owner',v_member.role,'ownerActorId',v_actor,'note',v_note,'at',v_now));
  end if;
  v_state:=v_state||pg_catalog.jsonb_build_object('authorityRevision',
    coalesce(v_operate.decision_revision,0)+1,
    'events',v_state->'events'||pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('id',gen_random_uuid(),
        'commandId',p_command_id,'fingerprint',v_fingerprint,
        'at',v_now,'actorId',v_actor,'membershipId',v_member.id,
        'action',p_action,'detail',v_note)));
  if v_operate.work_id is null then
    insert into d5o_hosted.connected_operate_states(workspace_id,work_id,
      decision_revision,state) values(v_workspace.id,v_work.id,1,v_state);
  else
    update d5o_hosted.connected_operate_states set
      decision_revision=decision_revision+1,state=v_state,updated_at=v_now
      where workspace_id=v_workspace.id and work_id=v_work.id;
  end if;
  insert into d5o_hosted.connected_operate_events(workspace_id,work_id,
    decision_revision,command_id,action,actor_user_id,membership_id,
    deploy_revision,snapshot)
  values(v_workspace.id,v_work.id,coalesce(v_operate.decision_revision,0)+1,
    p_command_id,p_action,v_actor,v_member.id,v_deploy.decision_revision,v_state);
  v_result:=public.d5o_hosted_prototype_read_v1(p_workspace_key,'work');
  insert into d5o_hosted.connected_operate_receipts(workspace_id,command_id,
    work_id,actor_user_id,fingerprint,result)
  values(v_workspace.id,p_command_id,v_work.id,v_actor,v_fingerprint,v_result);
  return v_result;
end; $$;
