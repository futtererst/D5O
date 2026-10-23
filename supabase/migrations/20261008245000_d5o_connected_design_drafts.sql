-- Design draft facts are normalized behind typed intent. No browser-provided
-- Design state, review result, or release can be committed as a snapshot.
create table d5o_hosted.connected_design_states (
  workspace_id uuid not null,work_id uuid not null,
  decision_revision integer not null check(decision_revision>0),
  source_handoff_revision integer not null,
  state jsonb not null check(pg_catalog.jsonb_typeof(state)='object'),
  updated_at timestamptz not null default now(),
  primary key(workspace_id,work_id),
  foreign key(work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id)
);
create table d5o_hosted.connected_design_events (
  workspace_id uuid not null,work_id uuid not null,decision_revision integer not null,
  command_id text not null,action text not null,actor_user_id uuid not null references auth.users(id),
  membership_id uuid not null references d5o_hosted.memberships(id),
  source_handoff_revision integer not null,snapshot jsonb not null,
  reason text not null,occurred_at timestamptz not null default now(),
  primary key(workspace_id,work_id,decision_revision),unique(workspace_id,command_id),
  foreign key(work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id)
);
create table d5o_hosted.connected_design_receipts (
  workspace_id uuid not null,command_id text not null,work_id uuid not null,
  actor_user_id uuid not null references auth.users(id),fingerprint text not null,
  result jsonb not null,primary key(workspace_id,command_id),
  foreign key(work_id,workspace_id) references d5o_hosted.work_records(id,workspace_id)
);
alter table d5o_hosted.connected_design_states enable row level security;
alter table d5o_hosted.connected_design_events enable row level security;
alter table d5o_hosted.connected_design_receipts enable row level security;
revoke all on d5o_hosted.connected_design_states,d5o_hosted.connected_design_events,
  d5o_hosted.connected_design_receipts from public,anon,authenticated,service_role;

create function d5o_hosted.connected_design_projection_v1(
  p_workspace uuid,p_state jsonb
) returns jsonb language sql stable security definer set search_path='' as $$
  select case when p_state is null then null else
    pg_catalog.jsonb_set(p_state,'{records}',coalesce((
      select pg_catalog.jsonb_agg(case when d.work_id is null then item else
        item||pg_catalog.jsonb_build_object('design',d.state) end order by ordinal)
      from pg_catalog.jsonb_array_elements(coalesce(p_state->'records','[]'::jsonb))
        with ordinality as records(item,ordinal)
      left join d5o_hosted.work_identity_links l on l.workspace_id=p_workspace
        and l.presentation_id=item->>'id'
      left join d5o_hosted.connected_design_states d on d.workspace_id=p_workspace
        and d.work_id=l.work_id
    ),'[]'::jsonb)) end;
$$;
revoke all on function d5o_hosted.connected_design_projection_v1(uuid,jsonb)
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
    d5o_hosted.connected_design_projection_v1(v_workspace,
      d5o_hosted.connected_define_projection_v1(v_workspace,v_state.state_json))
    else v_state.state_json end;
  return pg_catalog.jsonb_build_object('revision',v_state.revision,'state',
    d5o_hosted.connected_package_projection_v1(v_workspace,v_projected,p_state_key));
end; $$;
revoke all on function public.d5o_hosted_prototype_read_v1(text,text) from public,anon;
grant execute on function public.d5o_hosted_prototype_read_v1(text,text) to authenticated;

create function public.d5o_hosted_design_draft_command_v1(
  p_workspace_key text,p_presentation_id text,p_action text,p_input jsonb,
  p_command_id text,p_expected_source_revision bigint,
  p_expected_decision_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
  v_member d5o_hosted.memberships%rowtype;v_work d5o_hosted.work_records%rowtype;
  v_state d5o_hosted.prototype_states%rowtype;
  v_handoff d5o_hosted.connected_design_handoffs%rowtype;
  v_design d5o_hosted.connected_design_states%rowtype;
  v_receipt d5o_hosted.connected_design_receipts%rowtype;
  v_fingerprint text;v_source jsonb;v_previous jsonb;v_document jsonb;
  v_package jsonb;v_basis jsonb;v_input jsonb;v_next jsonb;
  v_result jsonb;v_id text;v_revision integer;v_now timestamptz:=now();
  v_item jsonb;v_ref text;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or p_action not in ('save-document','save-package')
    or p_input is null or pg_catalog.jsonb_typeof(p_input)<>'object'
    or length(coalesce(p_command_id,'')) not between 8 and 120
    or p_expected_source_revision is null or p_expected_source_revision<1
    or p_expected_decision_revision is null or p_expected_decision_revision<0 then
    raise exception 'invalid_design_draft_command' using errcode='22023'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor and status='active' for share;
  if not found or v_member.role not in ('admin','project_manager','operations_leader') then
    raise exception 'design_editor_denied' using errcode='42501'; end if;
  select w.* into v_work from d5o_hosted.work_records w
    join d5o_hosted.work_identity_links l on l.work_id=w.id and l.workspace_id=w.workspace_id
    where w.workspace_id=v_workspace.id and l.presentation_id=p_presentation_id
    for update of w;
  if not found then raise exception 'connected_work_unavailable' using errcode='42501'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_workspace_key,
    p_presentation_id,p_action,p_input,p_expected_source_revision,
    p_expected_decision_revision)::text);
  select * into v_receipt from d5o_hosted.connected_design_receipts
    where workspace_id=v_workspace.id and command_id=p_command_id;
  if found then
    if v_receipt.work_id<>v_work.id or v_receipt.actor_user_id<>v_actor
      or v_receipt.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_receipt.result;
  end if;
  select * into v_state from d5o_hosted.prototype_states
    where workspace_id=v_workspace.id and state_key='work' for share;
  select * into v_handoff from d5o_hosted.connected_design_handoffs
    where workspace_id=v_workspace.id and work_id=v_work.id for share;
  select * into v_design from d5o_hosted.connected_design_states
    where workspace_id=v_workspace.id and work_id=v_work.id for update;
  if v_state.revision is distinct from p_expected_source_revision
    or coalesce(v_design.decision_revision,0)<>p_expected_decision_revision
    or v_handoff.status is distinct from 'accepted'
    or v_design.source_handoff_revision is not null and
      v_design.source_handoff_revision<>v_handoff.revision then
    raise exception 'stale_design_basis' using errcode='23505'; end if;
  select item into v_source from pg_catalog.jsonb_array_elements(
    d5o_hosted.connected_package_projection_v1(v_workspace.id,
      d5o_hosted.connected_define_projection_v1(v_workspace.id,v_state.state_json),
      'work')->'records') item
    where item->>'id'=p_presentation_id and item->>'canonicalWorkId'=v_work.id::text;
  if v_source is null or v_source->>'phaseConfigurationVersionId' is distinct from
    v_work.configuration_version_id::text
    or v_source#>>'{discovery,designHandoff,status}' is distinct from 'accepted'
    or v_source#>>'{definition,revision}' is distinct from
      v_handoff.handoff#>>'{brief,definitionRevision}' then
    raise exception 'accepted_design_source_required' using errcode='23514'; end if;
  v_next:=coalesce(v_design.state,pg_catalog.jsonb_build_object(
    'documents','[]'::jsonb,'packages','[]'::jsonb,'reviews','[]'::jsonb,
    'releases','[]'::jsonb,'history','[]'::jsonb));
  if p_action='save-document' then
    v_input:=p_input->'document';
    if pg_catalog.jsonb_typeof(v_input)<>'object'
      or length(trim(coalesce(v_input->>'title',''))) not between 3 and 200
      or length(trim(coalesce(v_input->>'type',''))) not between 2 and 100
      or length(trim(coalesce(v_input->>'source',''))) not between 5 and 2000
      or pg_catalog.jsonb_typeof(v_input->'packageIds')<>'array'
      or pg_catalog.jsonb_typeof(v_input->'requirementIds')<>'array' then
      raise exception 'document_draft_invalid' using errcode='22023'; end if;
    for v_item in select value from pg_catalog.jsonb_array_elements(v_input->'packageIds') loop
      if pg_catalog.jsonb_typeof(v_item)<>'string' or not exists(
        select 1 from pg_catalog.jsonb_array_elements(v_source->'packages') p
          where p->>'id'=v_item#>>'{}') then
        raise exception 'document_package_reference_invalid' using errcode='23514'; end if;
    end loop;
    for v_item in select value from pg_catalog.jsonb_array_elements(v_input->'requirementIds') loop
      if pg_catalog.jsonb_typeof(v_item)<>'string' or not exists(
        select 1 from pg_catalog.jsonb_array_elements(
          coalesce(v_source#>'{definition,scopeControl,requirements}','[]'::jsonb)) r
          where r->>'id'=v_item#>>'{}') then
        raise exception 'document_requirement_reference_invalid' using errcode='23514'; end if;
    end loop;
    v_id:=coalesce(nullif(trim(v_input->>'id'),''),gen_random_uuid()::text);
    select max((d->>'revision')::integer) into v_revision
      from pg_catalog.jsonb_array_elements(v_next->'documents') d where d->>'id'=v_id;
    v_revision:=coalesce(v_revision,0)+1;
    v_document:=pg_catalog.jsonb_build_object('id',v_id,'revision',v_revision,
      'type',trim(v_input->>'type'),'title',trim(v_input->>'title'),
      'source',trim(v_input->>'source'),
      'owner',coalesce(nullif(trim(v_input->>'owner'),''),v_actor::text),
      'packageIds',v_input->'packageIds',
      'requirementIds',v_input->'requirementIds',
      'status','Draft','dueDate',coalesce(v_input->>'dueDate',''),
      'createdAt',v_now,'createdByActorId',v_actor);
    v_next:=pg_catalog.jsonb_set(v_next,'{documents}',
      v_next->'documents'||pg_catalog.jsonb_build_array(v_document));
  else
    v_input:=p_input->'package';
    v_id:=v_input->>'packageId';
    if pg_catalog.jsonb_typeof(v_input)<>'object' or v_id is null
      or not exists(select 1 from pg_catalog.jsonb_array_elements(
        coalesce(v_source->'packages','[]'::jsonb)) p where p->>'id'=v_id)
      or pg_catalog.jsonb_typeof(v_input->'requirementIds')<>'array'
      or pg_catalog.jsonb_typeof(v_input->'predecessorIds')<>'array'
      or pg_catalog.jsonb_typeof(v_input->'documentRefs')<>'array'
      or v_input#>>'{completionBasis,kind}' not in ('Measured','Qualitative')
      or v_input#>>'{completionBasis,kind}'='Measured' and
        (coalesce((v_input#>>'{completionBasis,plannedQuantity}')::numeric,0)<=0
          or length(trim(coalesce(v_input#>>'{completionBasis,unit}','')))=0)
      or v_input#>>'{completionBasis,kind}'='Qualitative' and
        length(trim(coalesce(v_input#>>'{completionBasis,criterion}','')))<10 then
      raise exception 'package_draft_invalid' using errcode='22023'; end if;
    for v_item in select value from pg_catalog.jsonb_array_elements(v_input->'predecessorIds') loop
      if v_item#>>'{}'=v_id or not exists(select 1 from
        pg_catalog.jsonb_array_elements(v_source->'packages') p
        where p->>'id'=v_item#>>'{}') then
        raise exception 'package_predecessor_invalid' using errcode='23514'; end if;
    end loop;
    for v_item in select value from pg_catalog.jsonb_array_elements(v_input->'requirementIds') loop
      if not exists(select 1 from pg_catalog.jsonb_array_elements(
        coalesce(v_source#>'{definition,scopeControl,requirements}','[]'::jsonb)) r
        where r->>'id'=v_item#>>'{}') then
        raise exception 'package_requirement_invalid' using errcode='23514'; end if;
    end loop;
    for v_item in select value from pg_catalog.jsonb_array_elements(v_input->'documentRefs') loop
      v_ref:=v_item#>>'{}';
      if not exists(select 1 from pg_catalog.jsonb_array_elements(v_next->'documents') d
        where (d->>'id')||'@'||(d->>'revision')=v_ref
          and d->'packageIds' ? v_id) then
        raise exception 'package_document_invalid' using errcode='23514'; end if;
    end loop;
    if v_input->>'commercialDisposition' not in ('None','Assessment required',
      'Routed to Develop') or v_input->>'materialStatus' not in
      ('Unknown','Planned','Ordered','Supplier confirmed','Received','Available') then
      raise exception 'package_status_invalid' using errcode='22023'; end if;
    select p into v_previous from pg_catalog.jsonb_array_elements(v_next->'packages') p
      where p->>'packageId'=v_id;
    if exists(select 1 from pg_catalog.jsonb_array_elements(v_next->'releases') r
      where r->>'packageId'=v_id and r->>'status' in ('Awaiting receipt','Accepted')) then
      raise exception 'released_package_locked' using errcode='23514'; end if;
    v_revision:=coalesce((v_previous->>'revision')::integer,0)+1;
    v_basis:=v_input->'completionBasis';
    v_package:=pg_catalog.jsonb_build_object(
      'packageId',v_id,'revision',v_revision,'scope',coalesce(v_input->>'scope',''),
      'location',coalesce(v_input->>'location',''),
      'systems',coalesce(v_input->>'systems',''),
      'completionBasis',v_basis,'requirementIds',v_input->'requirementIds',
      'predecessorIds',v_input->'predecessorIds',
      'documentRefs',v_input->'documentRefs',
      'materials',coalesce(v_input->>'materials',''),
      'materialLines',coalesce(v_input->'materialLines','[]'::jsonb),
      'materialStatus',v_input->>'materialStatus',
      'materialRequiredDate',coalesce(v_input->>'materialRequiredDate',''),
      'materialForecastDate',coalesce(v_input->>'materialForecastDate',''),
      'materialSource',coalesce(v_input->>'materialSource',''),
      'access',coalesce(v_input->>'access',''),
      'permit',coalesce(v_input->>'permit',''),
      'safetyControls',coalesce(v_input->>'safetyControls',''),
      'equipment',coalesce(v_input->>'equipment',''),
      'method',coalesce(v_input->>'method',''),
      'rollback',coalesce(v_input->>'rollback',''),
      'verification',coalesce(v_input->>'verification',''),
      'proof',coalesce(v_input->>'proof',''),
      'acceptingAuthority',coalesce(v_input->>'acceptingAuthority',''),
      'windowStart',coalesce(v_input->>'windowStart',''),
      'windowEnd',coalesce(v_input->>'windowEnd',''),
      'targetReleaseDate',coalesce(v_input->>'targetReleaseDate',''),
      'crewDemandRequired',coalesce((v_input->>'crewDemandRequired')::boolean,true),
      'crewExemptionReason',coalesce(v_input->>'crewExemptionReason',''),
      'commercialImpact',coalesce(v_input->>'commercialImpact',''),
      'commercialDisposition',v_input->>'commercialDisposition',
      'status','Draft');
    v_next:=pg_catalog.jsonb_set(v_next,'{packages}',
      (select coalesce(pg_catalog.jsonb_agg(p order by ordinal),'[]'::jsonb)
        from pg_catalog.jsonb_array_elements(v_next->'packages')
          with ordinality as entries(p,ordinal) where p->>'packageId'<>v_id)
        ||pg_catalog.jsonb_build_array(v_package));
  end if;
  v_next:=v_next||pg_catalog.jsonb_build_object(
    'authorityRevision',coalesce(v_design.decision_revision,0)+1,
    'history',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'at',v_now,'actorId',v_actor,'membershipId',v_member.id,
      'action',p_action||' · '||p_command_id,'note',coalesce(p_input->>'note',''),
      'packageId',case when p_action='save-package' then v_id else null end,
      'revision',v_revision))||coalesce(v_next->'history','[]'::jsonb));
  if v_design.work_id is null then
    insert into d5o_hosted.connected_design_states(workspace_id,work_id,
      decision_revision,source_handoff_revision,state)
    values(v_workspace.id,v_work.id,1,v_handoff.revision,v_next);
  else
    update d5o_hosted.connected_design_states set
      decision_revision=decision_revision+1,state=v_next,updated_at=v_now
      where workspace_id=v_workspace.id and work_id=v_work.id;
  end if;
  insert into d5o_hosted.connected_design_events(workspace_id,work_id,
    decision_revision,command_id,action,actor_user_id,membership_id,
    source_handoff_revision,snapshot,reason)
  values(v_workspace.id,v_work.id,coalesce(v_design.decision_revision,0)+1,
    p_command_id,p_action,v_actor,v_member.id,v_handoff.revision,v_next,
    coalesce(p_input->>'note',''));
  v_result:=public.d5o_hosted_prototype_read_v1(p_workspace_key,'work');
  insert into d5o_hosted.connected_design_receipts(workspace_id,command_id,
    work_id,actor_user_id,fingerprint,result)
  values(v_workspace.id,p_command_id,v_work.id,v_actor,v_fingerprint,v_result);
  return v_result;
end; $$;
revoke all on function public.d5o_hosted_design_draft_command_v1(
  text,text,text,jsonb,text,bigint,integer) from public,anon,service_role;
grant execute on function public.d5o_hosted_design_draft_command_v1(
  text,text,text,jsonb,text,bigint,integer) to authenticated;

create function d5o_hosted.connected_design_draft_rebase_v1(
  p_workspace uuid,p_raw jsonb,p_submitted jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_new jsonb;v_old jsonb;v_expected jsonb;v_records jsonb:='[]'::jsonb;
begin
  for v_new in select value from pg_catalog.jsonb_array_elements(p_submitted->'records') loop
    select value into v_old from pg_catalog.jsonb_array_elements(p_raw->'records')
      where value->>'id'=v_new->>'id';
    if exists(select 1 from d5o_hosted.work_identity_links l
      join d5o_hosted.connected_design_states d on d.workspace_id=l.workspace_id
        and d.work_id=l.work_id
      where l.workspace_id=p_workspace and l.presentation_id=v_new->>'id') then
      select value into v_expected from pg_catalog.jsonb_array_elements(
        d5o_hosted.connected_design_projection_v1(p_workspace,
          d5o_hosted.connected_define_projection_v1(p_workspace,p_raw))->'records')
        where value->>'id'=v_new->>'id';
      if v_new->'design' is distinct from v_expected->'design' then
        raise exception 'typed_design_command_required' using errcode='42501'; end if;
      if v_old->'design' is null then v_new:=v_new-'design';
      else v_new:=pg_catalog.jsonb_set(v_new,'{design}',v_old->'design',true); end if;
    end if;
    v_records:=v_records||pg_catalog.jsonb_build_array(v_new);
  end loop;
  return pg_catalog.jsonb_set(p_submitted,'{records}',v_records);
end; $$;
revoke all on function d5o_hosted.connected_design_draft_rebase_v1(uuid,jsonb,jsonb)
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
    d5o_hosted.connected_design_projection_v1(v_workspace,
      d5o_hosted.connected_define_projection_v1(v_workspace,v_prior.state_json)),'work');
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
            d5o_hosted.connected_package_draft_rebase_v1(v_workspace,v_prior.state_json,
              d5o_hosted.connected_design_draft_rebase_v1(
                v_workspace,v_prior.state_json,v_input)))))),v_prior.revision+1);
  update d5o_hosted.prototype_states set revision=revision+1,state_json=v_state,
    updated_by=auth.uid(),updated_at=now()
    where workspace_id=v_workspace and state_key='work' returning revision into v_revision;
  insert into d5o_hosted.prototype_state_revisions(
    workspace_id,state_key,revision,state_json,actor_user_id,membership_id)
  values(v_workspace,'work',v_revision,v_state,auth.uid(),v_membership.id);
  return pg_catalog.jsonb_build_object('revision',v_revision,'state',
    d5o_hosted.connected_package_projection_v1(v_workspace,
      d5o_hosted.connected_design_projection_v1(v_workspace,
        d5o_hosted.connected_define_projection_v1(v_workspace,v_state)),'work'));
end; $$;
revoke all on function public.d5o_hosted_prototype_save_v1(text,text,bigint,jsonb)
  from public,anon;
grant execute on function public.d5o_hosted_prototype_save_v1(text,text,bigint,jsonb)
  to authenticated,service_role;
