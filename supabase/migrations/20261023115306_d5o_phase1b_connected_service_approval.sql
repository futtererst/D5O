-- Phase 1B: extend the existing hosted approval ledger to connected requests.
-- Existing Work-level decisions remain addressable by (work_id, NULL request_id).
alter table d5o_hosted.service_approval_requests
  add column approval_id uuid default gen_random_uuid(),
  add column service_request_id text,
  add column request_cycle_at text,
  add column estimate_revision integer,
  add column scope_fingerprint text;
update d5o_hosted.service_approval_requests set approval_id=gen_random_uuid()
  where approval_id is null;
alter table d5o_hosted.service_approval_requests alter column approval_id set not null;
alter table d5o_hosted.service_approval_events
  drop constraint service_approval_events_work_id_fkey;
alter table d5o_hosted.service_approval_requests
  drop constraint service_approval_requests_pkey;
alter table d5o_hosted.service_approval_requests
  add constraint service_approval_requests_pkey primary key (approval_id);
create unique index service_approval_one_scope_v1
  on d5o_hosted.service_approval_requests(work_id,coalesce(service_request_id,''),
    coalesce(scope_fingerprint,''));
alter table d5o_hosted.service_approval_events
  add column approval_id uuid references d5o_hosted.service_approval_requests(approval_id);
update d5o_hosted.service_approval_events e set approval_id=r.approval_id
  from d5o_hosted.service_approval_requests r
  where e.work_id=r.work_id and r.service_request_id is null;

-- This fingerprint is computed from authoritative Operate state, never caller JSON.
create function d5o_hosted.connected_service_approval_basis_v1(
  p_work uuid,p_request jsonb
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_work d5o_hosted.work_records%rowtype;
  v_version d5o_hosted.configuration_versions%rowtype;
  v_policy jsonb;v_estimate jsonb;v_amount bigint;v_cycle text;v_scope text;
begin
  select * into v_work from d5o_hosted.work_records where id=p_work;
  if not found then raise exception 'service_work_unavailable' using errcode='23503'; end if;
  select * into v_version from d5o_hosted.configuration_versions
    where id=v_work.configuration_version_id
      and tenant_id=v_work.configuration_tenant_id and status in ('published','superseded');
  if not found then raise exception 'pinned_configuration_unavailable' using errcode='23514'; end if;
  v_policy:=v_version.manifest_json->'serviceWorkApproval';
  if v_policy is null then
    -- Historical pilot versions had no hosted threshold. Keep their existing
    -- customer pricing/evidence controls, without silently repinning Work.
    return pg_catalog.jsonb_build_object('legacy',true,'approvalRequired',false,
      'configurationVersionId',v_version.id);
  end if;
  if v_policy->>'currency' is distinct from 'USD'
    or v_policy->>'comparison' is distinct from 'greater_than'
    or v_policy->>'unavailableBehavior' is distinct from 'block'
    or coalesce(v_policy->>'authorityRole','') not in ('admin','operations_leader')
    or coalesce(v_policy->>'thresholdMinor','') !~ '^[0-9]{1,12}$'
    or (v_policy->>'thresholdMinor')::bigint not between 0 and 100000000000 then
    raise exception 'service_policy_unavailable' using errcode='23514'; end if;
  if p_request is null or p_request->>'id' is null then
    raise exception 'service_request_unavailable' using errcode='23514'; end if;
  if p_request->>'coverage'='Covered' then
    return pg_catalog.jsonb_build_object('legacy',false,'approvalRequired',false,
      'configurationVersionId',v_version.id,'amountMinor',0,'currency','USD',
      'thresholdMinor',(v_policy->>'thresholdMinor')::bigint);
  end if;
  v_estimate:=p_request->'serviceEstimate';
  v_cycle:=coalesce(p_request->>'reopenedAt',p_request->>'reportedAt');
  if p_request->>'coverage' not in ('Partially covered','Chargeable')
    or v_estimate->>'status' is distinct from 'Approved'
    or v_estimate->>'requestCycleAt' is distinct from v_cycle
    or coalesce(v_estimate#>>'{evaluation,proposedPriceMinor}','') !~ '^[0-9]{1,12}$'
    or v_estimate#>>'{evaluation,currency}' is distinct from 'USD'
    or coalesce(v_estimate->>'revision','') !~ '^[1-9][0-9]*$' then
    raise exception 'approved_usd_service_estimate_required' using errcode='23514'; end if;
  v_amount:=(v_estimate#>>'{evaluation,proposedPriceMinor}')::bigint;
  if v_amount>100000000000 then
    raise exception 'invalid_service_amount' using errcode='23514'; end if;
  v_scope:=pg_catalog.md5(pg_catalog.jsonb_build_array(
    p_request->>'id',v_cycle,p_request->>'assetId',p_request->>'agreementId',
    p_request->>'title',p_request->>'description',p_request->>'coverage',
    v_estimate->>'revision',v_estimate->'input',v_amount,'USD')::text);
  return pg_catalog.jsonb_build_object('legacy',false,
    'approvalRequired',v_amount>(v_policy->>'thresholdMinor')::bigint,
    'configurationVersionId',v_version.id,'amountMinor',v_amount,'currency','USD',
    'thresholdMinor',(v_policy->>'thresholdMinor')::bigint,
    'authorityRole',v_policy->>'authorityRole','scopeFingerprint',v_scope,
    'requestCycleAt',v_cycle,'estimateRevision',(v_estimate->>'revision')::integer);
end $$;
revoke all on function d5o_hosted.connected_service_approval_basis_v1(uuid,jsonb)
  from public,anon,authenticated,service_role;

-- Invoked by every protected command in the SAME transaction as its update.
create function d5o_hosted.require_connected_service_approval_v1(
  p_workspace uuid,p_work uuid,p_request_id text
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_work d5o_hosted.work_records%rowtype;
  v_state d5o_hosted.connected_operate_states%rowtype;
  v_request jsonb;v_basis jsonb;v_decision d5o_hosted.service_approval_requests%rowtype;
begin
  select * into v_work from d5o_hosted.work_records
    where id=p_work and workspace_id=p_workspace;
  if not found then raise exception 'service_work_unavailable' using errcode='42501'; end if;
  -- A historical pilot pin without this setting retains its pre-Phase-1
  -- command contract. The published version is still checked by the basis.
  if not exists(select 1 from d5o_hosted.configuration_versions v
      where v.id=v_work.configuration_version_id
        and v.tenant_id=v_work.configuration_tenant_id
        and v.status in ('published','superseded')
        and v.manifest_json ? 'serviceWorkApproval') then
    return d5o_hosted.connected_service_approval_basis_v1(p_work,'{}'::jsonb);
  end if;
  select * into v_state from d5o_hosted.connected_operate_states
    where workspace_id=p_workspace and work_id=p_work for share;
  select item into v_request from pg_catalog.jsonb_array_elements(
    coalesce(v_state.state->'requests','[]'::jsonb)) item
    where item->>'id'=p_request_id;
  if v_request is null then raise exception 'service_request_unavailable' using errcode='23514'; end if;
  v_basis:=d5o_hosted.connected_service_approval_basis_v1(p_work,v_request);
  if not (v_basis->>'approvalRequired')::boolean then return v_basis; end if;
  select * into v_decision from d5o_hosted.service_approval_requests
    where work_id=p_work and workspace_id=p_workspace
      and service_request_id=p_request_id
      and scope_fingerprint=v_basis->>'scopeFingerprint' for share;
  if not found or v_decision.status<>'approved'
    or v_decision.configuration_version_id<>v_work.configuration_version_id
    or v_decision.amount_minor<>(v_basis->>'amountMinor')::bigint
    or v_decision.currency is distinct from v_basis->>'currency'
    or v_decision.scope_fingerprint is distinct from v_basis->>'scopeFingerprint'
    or v_decision.request_cycle_at is distinct from v_basis->>'requestCycleAt'
    or v_decision.estimate_revision<>(v_basis->>'estimateRevision')::integer
    or v_decision.authority_role is distinct from v_basis->>'authorityRole'
    or not exists(select 1 from d5o_hosted.memberships m
      where m.workspace_id=p_workspace and m.actor_user_id=v_decision.decided_by
        and m.role=v_decision.authority_role and m.status='active') then
    raise exception 'connected_service_approval_required' using errcode='23514'; end if;
  return v_basis||pg_catalog.jsonb_build_object('approvalId',v_decision.approval_id,
    'approvedBy',v_decision.decided_by,'approvedAt',v_decision.decided_at);
end $$;
revoke all on function d5o_hosted.require_connected_service_approval_v1(uuid,uuid,text)
  from public,anon,authenticated,service_role;

-- One approval ledger and one policy evaluator. This adapter attaches a
-- connected request to the existing ledger after pricing review.
create function public.d5o_hosted_connected_service_approval_command_v1(
  p_workspace_key text,p_parent_presentation_id text,p_request_id text,
  p_action text,p_command_id text
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
  v_member d5o_hosted.memberships%rowtype;v_work d5o_hosted.work_records%rowtype;
  v_state d5o_hosted.connected_operate_states%rowtype;v_request jsonb;v_basis jsonb;
  v_decision d5o_hosted.service_approval_requests%rowtype;
  v_receipt d5o_hosted.service_approval_receipts%rowtype;
  v_result jsonb;v_fingerprint text;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or p_action not in ('request','approve','reject')
    or length(coalesce(p_command_id,'')) not between 8 and 120
    or length(coalesce(p_request_id,'')) not between 1 and 120 then
    raise exception 'invalid_service_approval_command' using errcode='22023'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  if not found then raise exception 'service_approval_denied' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('d5o-connected:'||v_workspace.id::text,0));
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor and status='active' for share;
  if not found then raise exception 'service_approval_denied' using errcode='42501'; end if;
  select w.* into v_work from d5o_hosted.work_records w
    join d5o_hosted.work_identity_links l on l.workspace_id=w.workspace_id
      and l.work_id=w.id and l.parent_work_id is null
    where w.workspace_id=v_workspace.id and l.presentation_id=p_parent_presentation_id
    for update of w;
  if not found then raise exception 'service_approval_denied' using errcode='42501'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(
    p_workspace_key,p_parent_presentation_id,p_request_id,p_action)::text);
  select * into v_receipt from d5o_hosted.service_approval_receipts
    where workspace_id=v_workspace.id and command_id=p_command_id;
  if found then
    if v_receipt.actor_user_id<>v_actor or v_receipt.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_receipt.result;
  end if;
  select * into v_state from d5o_hosted.connected_operate_states
    where workspace_id=v_workspace.id and work_id=v_work.id for share;
  select item into v_request from pg_catalog.jsonb_array_elements(
    coalesce(v_state.state->'requests','[]'::jsonb)) item
    where item->>'id'=p_request_id;
  if v_request is null then raise exception 'service_request_unavailable' using errcode='23514'; end if;
  v_basis:=d5o_hosted.connected_service_approval_basis_v1(v_work.id,v_request);
  if (v_basis->>'legacy')::boolean or not (v_basis->>'approvalRequired')::boolean then
    raise exception 'additional_approval_not_required' using errcode='23514'; end if;
  select * into v_decision from d5o_hosted.service_approval_requests
    where work_id=v_work.id and service_request_id=p_request_id
      and scope_fingerprint=v_basis->>'scopeFingerprint' for update;
  if p_action='request' then
    if v_member.role not in ('admin','project_manager','operations_leader') then
      raise exception 'service_approval_denied' using errcode='42501'; end if;
    if found then raise exception 'service_request_already_evaluated' using errcode='23505'; end if;
    insert into d5o_hosted.service_approval_requests(work_id,workspace_id,
      configuration_version_id,amount_minor,currency,threshold_minor,comparison,
      authority_role,approval_required,status,requested_by,service_request_id,
      request_cycle_at,estimate_revision,scope_fingerprint)
    values(v_work.id,v_workspace.id,v_work.configuration_version_id,
      (v_basis->>'amountMinor')::bigint,'USD',(v_basis->>'thresholdMinor')::bigint,
      'greater_than',v_basis->>'authorityRole',true,'pending',v_actor,p_request_id,
      v_basis->>'requestCycleAt',(v_basis->>'estimateRevision')::integer,
      v_basis->>'scopeFingerprint') returning * into v_decision;
  else
    if not found or v_decision.status<>'pending'
      or v_decision.configuration_version_id<>v_work.configuration_version_id
      or v_decision.scope_fingerprint is distinct from v_basis->>'scopeFingerprint'
      or v_decision.amount_minor<>(v_basis->>'amountMinor')::bigint
      or v_decision.estimate_revision<>(v_basis->>'estimateRevision')::integer then
      raise exception 'pending_approval_required' using errcode='23514'; end if;
    if v_member.role<>v_decision.authority_role or v_actor=v_decision.requested_by
      or v_actor=(v_request->'serviceEstimate'->>'submittedByActorId')::uuid then
      raise exception 'independent_approval_required' using errcode='42501'; end if;
    update d5o_hosted.service_approval_requests set
      status=case when p_action='approve' then 'approved' else 'rejected' end,
      decided_by=v_actor,decided_at=now() where approval_id=v_decision.approval_id;
  end if;
  v_result:=v_basis||pg_catalog.jsonb_build_object('workId',v_work.id,
    'requestId',p_request_id,'approvalId',v_decision.approval_id,
    'status',case when p_action='request' then 'pending'
      when p_action='approve' then 'approved' else 'rejected' end);
  insert into d5o_hosted.service_approval_events(workspace_id,work_id,
    configuration_version_id,action,actor_user_id,membership_id,command_id,result,
    approval_id)
  values(v_workspace.id,v_work.id,v_work.configuration_version_id,p_action,v_actor,
    v_member.id,p_command_id,v_result,v_decision.approval_id);
  insert into d5o_hosted.service_approval_receipts(workspace_id,command_id,
    actor_user_id,fingerprint,result)
  values(v_workspace.id,p_command_id,v_actor,v_fingerprint,v_result);
  return v_result;
end $$;
revoke all on function public.d5o_hosted_connected_service_approval_command_v1(
  text,text,text,text,text) from public,anon,service_role;
grant execute on function public.d5o_hosted_connected_service_approval_command_v1(
  text,text,text,text,text) to authenticated;

create function public.d5o_hosted_connected_service_approval_read_v1(
  p_workspace_key text,p_parent_presentation_id text,p_request_id text
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
  v_member d5o_hosted.memberships%rowtype;v_work d5o_hosted.work_records%rowtype;
  v_state d5o_hosted.connected_operate_states%rowtype;v_request jsonb;v_basis jsonb;
  v_decision d5o_hosted.service_approval_requests%rowtype;v_status text;v_ready boolean;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null then
    raise exception 'service_approval_denied' using errcode='42501'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor and status='active';
  select w.* into v_work from d5o_hosted.work_records w
    join d5o_hosted.work_identity_links l on l.workspace_id=w.workspace_id
      and l.work_id=w.id and l.parent_work_id is null
    where w.workspace_id=v_workspace.id and l.presentation_id=p_parent_presentation_id;
  if v_member.id is null or v_work.id is null then
    raise exception 'service_approval_denied' using errcode='42501'; end if;
  select * into v_state from d5o_hosted.connected_operate_states
    where workspace_id=v_workspace.id and work_id=v_work.id;
  select item into v_request from pg_catalog.jsonb_array_elements(
    coalesce(v_state.state->'requests','[]'::jsonb)) item
    where item->>'id'=p_request_id;
  if v_request is null then raise exception 'service_request_unavailable' using errcode='23514'; end if;
  v_basis:=d5o_hosted.connected_service_approval_basis_v1(v_work.id,v_request);
  if (v_basis->>'legacy')::boolean then v_status:='legacy';
  elsif not (v_basis->>'approvalRequired')::boolean then v_status:='not_required';
  else
    select * into v_decision from d5o_hosted.service_approval_requests
      where work_id=v_work.id and service_request_id=p_request_id
        and scope_fingerprint=v_basis->>'scopeFingerprint';
    if not found then
      v_status:=case when exists(select 1 from d5o_hosted.service_approval_requests
        where work_id=v_work.id and service_request_id=p_request_id)
        then 'stale' else 'required' end;
    elsif v_decision.configuration_version_id<>v_work.configuration_version_id
      or v_decision.scope_fingerprint is distinct from v_basis->>'scopeFingerprint'
      or v_decision.amount_minor<>(v_basis->>'amountMinor')::bigint
      or v_decision.estimate_revision<>(v_basis->>'estimateRevision')::integer
      or (v_decision.status='approved' and not exists(
        select 1 from d5o_hosted.memberships m where m.workspace_id=v_workspace.id
          and m.actor_user_id=v_decision.decided_by and m.status='active'
          and m.role=v_decision.authority_role)) then v_status:='stale';
    else v_status:=v_decision.status; end if;
  end if;
  v_ready:=v_status in ('legacy','not_required','approved');
  return v_basis||pg_catalog.jsonb_build_object('status',v_status,
    'approvalId',v_decision.approval_id,'requestedBy',v_decision.requested_by,
    'decidedBy',v_decision.decided_by,'decidedAt',v_decision.decided_at,
    'canRequest',v_status in ('required','stale') and v_member.role in
      ('admin','project_manager','operations_leader'),
    'canDecide',v_status='pending' and v_member.role=v_basis->>'authorityRole'
      and v_actor is distinct from v_decision.requested_by
      and v_actor is distinct from (v_request->'serviceEstimate'->>'submittedByActorId')::uuid,
    'canAuthorize',v_ready and v_member.role='operations_leader',
    'canCreateJob',v_ready and v_member.role in ('project_manager','operations_leader'));
end $$;
revoke all on function public.d5o_hosted_connected_service_approval_read_v1(
  text,text,text) from public,anon,service_role;
grant execute on function public.d5o_hosted_connected_service_approval_read_v1(
  text,text,text) to authenticated;

-- Revoke the old directly callable entry points. Wrappers below preserve
-- signatures and run the shared approval guard in the same transaction.
alter function public.d5o_hosted_service_pricing_command_v1(
  text,text,text,text,jsonb,text,bigint,integer)
  rename to d5o_hosted_service_pricing_command_pre_approval_v1;
revoke all on function public.d5o_hosted_service_pricing_command_pre_approval_v1(
  text,text,text,text,jsonb,text,bigint,integer) from public,anon,authenticated,service_role;
create function public.d5o_hosted_service_pricing_command_v1(
  p_workspace_key text,p_parent_presentation_id text,p_request_id text,
  p_action text,p_input jsonb,p_command_id text,p_expected_work_revision bigint,
  p_expected_operate_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_workspace uuid;v_work uuid;
begin
  if p_action='record-service-authorization' then
    select w.id,v.id into v_workspace,v_work from d5o_hosted.workspaces w
      join d5o_hosted.work_identity_links l on l.workspace_id=w.id
      join d5o_hosted.work_records v on v.id=l.work_id and v.workspace_id=w.id
      where w.workspace_key=p_workspace_key and w.status='active'
        and l.presentation_id=p_parent_presentation_id and l.parent_work_id is null;
    if v_work is null then raise exception 'service_approval_denied' using errcode='42501'; end if;
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('d5o-connected:'||v_workspace::text,0));
    perform d5o_hosted.require_connected_service_approval_v1(v_workspace,v_work,p_request_id);
  end if;
  return public.d5o_hosted_service_pricing_command_pre_approval_v1(
    p_workspace_key,p_parent_presentation_id,p_request_id,p_action,p_input,
    p_command_id,p_expected_work_revision,p_expected_operate_revision);
end $$;
revoke all on function public.d5o_hosted_service_pricing_command_v1(
  text,text,text,text,jsonb,text,bigint,integer) from public,anon,service_role;
grant execute on function public.d5o_hosted_service_pricing_command_v1(
  text,text,text,text,jsonb,text,bigint,integer) to authenticated;

alter function public.d5o_hosted_service_job_command_v1(
  text,text,text,date,text,text,bigint,bigint,integer)
  rename to d5o_hosted_service_job_command_pre_approval_v1;
revoke all on function public.d5o_hosted_service_job_command_pre_approval_v1(
  text,text,text,date,text,text,bigint,bigint,integer) from public,anon,authenticated,service_role;
create function public.d5o_hosted_service_job_command_v1(
  p_workspace_key text,p_parent_presentation_id text,p_request_id text,
  p_due_date date,p_owner text,p_command_id text,p_expected_work_revision bigint,
  p_expected_catalog_revision bigint,p_expected_operate_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_workspace uuid;v_work uuid;
begin
  select w.id,v.id into v_workspace,v_work from d5o_hosted.workspaces w
    join d5o_hosted.work_identity_links l on l.workspace_id=w.id
    join d5o_hosted.work_records v on v.id=l.work_id and v.workspace_id=w.id
    where w.workspace_key=p_workspace_key and w.status='active'
      and l.presentation_id=p_parent_presentation_id and l.parent_work_id is null;
  if v_work is null then raise exception 'service_approval_denied' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('d5o-connected:'||v_workspace::text,0));
  perform d5o_hosted.require_connected_service_approval_v1(v_workspace,v_work,p_request_id);
  return public.d5o_hosted_service_job_command_pre_approval_v1(
    p_workspace_key,p_parent_presentation_id,p_request_id,p_due_date,p_owner,
    p_command_id,p_expected_work_revision,p_expected_catalog_revision,
    p_expected_operate_revision);
end $$;
revoke all on function public.d5o_hosted_service_job_command_v1(
  text,text,text,date,text,text,bigint,bigint,integer) from public,anon,service_role;
grant execute on function public.d5o_hosted_service_job_command_v1(
  text,text,text,date,text,text,bigint,bigint,integer) to authenticated;

alter function public.d5o_hosted_create_related_work_v1(
  text,text,text,text,bigint,bigint,jsonb,jsonb,uuid,uuid)
  rename to d5o_hosted_create_related_work_pre_approval_v1;
revoke all on function public.d5o_hosted_create_related_work_pre_approval_v1(
  text,text,text,text,bigint,bigint,jsonb,jsonb,uuid,uuid)
  from public,anon,authenticated,service_role;
create function public.d5o_hosted_create_related_work_v1(
  p_workspace_key text,p_command_id text,p_action text,
  p_parent_presentation_id text,p_expected_work_revision bigint,
  p_expected_catalog_revision bigint,p_parent_after jsonb,p_child jsonb,
  p_actor_user_id uuid,p_membership_id uuid
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_workspace uuid;v_work uuid;v_request_id text;
begin
  if p_action='create-job' then
    select w.id,v.id into v_workspace,v_work from d5o_hosted.workspaces w
      join d5o_hosted.work_identity_links l on l.workspace_id=w.id
      join d5o_hosted.work_records v on v.id=l.work_id and v.workspace_id=w.id
      where w.workspace_key=p_workspace_key and w.status='active'
        and l.presentation_id=p_parent_presentation_id and l.parent_work_id is null;
    v_request_id:=p_child#>>'{serviceSource,requestId}';
    if v_work is null or v_request_id is null then
      raise exception 'service_approval_denied' using errcode='42501'; end if;
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('d5o-connected:'||v_workspace::text,0));
    perform d5o_hosted.require_connected_service_approval_v1(v_workspace,v_work,v_request_id);
  end if;
  return public.d5o_hosted_create_related_work_pre_approval_v1(
    p_workspace_key,p_command_id,p_action,p_parent_presentation_id,
    p_expected_work_revision,p_expected_catalog_revision,p_parent_after,p_child,
    p_actor_user_id,p_membership_id);
end $$;
revoke all on function public.d5o_hosted_create_related_work_v1(
  text,text,text,text,bigint,bigint,jsonb,jsonb,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.d5o_hosted_create_related_work_v1(
  text,text,text,text,bigint,bigint,jsonb,jsonb,uuid,uuid) to service_role;

-- Keep Work-level decisions scoped to their original (NULL request) row.
create or replace function public.d5o_hosted_service_approval_command_v1(
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
  select * into v_request from d5o_hosted.service_approval_requests where work_id=p_work_id and service_request_id is null for update;
  if p_action='request' then
    if v_member.role not in ('admin','project_manager','operations_leader') then
      raise exception 'service_approval_denied' using errcode='42501'; end if;
    if found then raise exception 'service_request_already_evaluated' using errcode='23505'; end if;
    v_required:=p_amount_minor>(v_policy->>'thresholdMinor')::bigint;
    insert into d5o_hosted.service_approval_requests(work_id,workspace_id,configuration_version_id,
      amount_minor,currency,threshold_minor,comparison,authority_role,approval_required,status,requested_by)
      values(p_work_id,v_workspace.id,v_version.id,p_amount_minor,'USD',
        (v_policy->>'thresholdMinor')::bigint,'greater_than',v_policy->>'authorityRole',v_required,
        case when v_required then 'pending' else 'not_required' end,v_actor)
      returning * into v_request;
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
      decided_by=v_actor,decided_at=now() where work_id=p_work_id and service_request_id is null;
    v_result:=pg_catalog.jsonb_build_object('workId',p_work_id,'configurationVersionId',v_version.id,
      'approvalRequired',true,'status',case when p_action='approve' then 'approved' else 'rejected' end);
  end if;
  insert into d5o_hosted.service_approval_events(workspace_id,work_id,configuration_version_id,
    action,actor_user_id,membership_id,command_id,result,approval_id)
    values(v_workspace.id,p_work_id,v_version.id,p_action,v_actor,v_member.id,p_command_id,v_result,v_request.approval_id);
  insert into d5o_hosted.service_approval_receipts(workspace_id,command_id,actor_user_id,fingerprint,result)
    values(v_workspace.id,p_command_id,v_actor,v_fingerprint,v_result);
  return v_result;
end $$;
