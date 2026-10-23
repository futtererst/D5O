-- Canonical Design change intent for an already authorized field-origin scope change.
-- It preserves the issued release, holds the field basis, and leaves the new
-- package subject to the ordinary revision-specific review and release rules.
create function public.d5o_hosted_design_field_change_command_v1(
  p_workspace_key text,p_presentation_id text,p_action text,p_input jsonb,
  p_command_id text,p_expected_source_revision bigint,
  p_expected_decision_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
  v_member d5o_hosted.memberships%rowtype;v_work d5o_hosted.work_records%rowtype;
  v_source d5o_hosted.prototype_states%rowtype;
  v_handoff d5o_hosted.connected_design_handoffs%rowtype;
  v_design d5o_hosted.connected_design_states%rowtype;
  v_receipt d5o_hosted.connected_design_receipts%rowtype;
  v_field d5o_hosted.connected_field_changes%rowtype;
  v_state jsonb;v_target jsonb;v_item jsonb;v_change jsonb;v_release jsonb;
  v_changes jsonb;v_releases jsonb;v_result jsonb;
  v_package text;v_source_id text;v_note text;v_fingerprint text;
  v_now timestamptz:=clock_timestamp();v_revision integer;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or p_action not in ('record-change','acknowledge-hold','resolve-change')
    or p_input is null or pg_catalog.jsonb_typeof(p_input)<>'object'
    or length(coalesce(p_command_id,'')) not between 8 and 120
    or p_expected_source_revision is null or p_expected_source_revision<1
    or p_expected_decision_revision is null or p_expected_decision_revision<1 then
    raise exception 'invalid_design_change_command' using errcode='22023'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor and status='active' for share;
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  if p_action in ('record-change','resolve-change') and
      v_member.role not in ('admin','project_manager','operations_leader')
    or p_action='acknowledge-hold' and
      v_member.role not in ('admin','field_supervisor','operations_leader') then
    raise exception 'design_change_role_denied' using errcode='42501'; end if;
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
  select * into v_source from d5o_hosted.prototype_states
    where workspace_id=v_workspace.id and state_key='work' for share;
  select * into v_handoff from d5o_hosted.connected_design_handoffs
    where workspace_id=v_workspace.id and work_id=v_work.id for share;
  select * into v_design from d5o_hosted.connected_design_states
    where workspace_id=v_workspace.id and work_id=v_work.id for update;
  if not found or v_source.revision is distinct from p_expected_source_revision
    or v_design.decision_revision<>p_expected_decision_revision
    or v_handoff.status is distinct from 'accepted'
    or v_design.source_handoff_revision<>v_handoff.revision then
    raise exception 'stale_design_basis' using errcode='23505'; end if;
  v_state:=v_design.state;
  v_note:=trim(coalesce(p_input->>'note',''));
  if p_action='record-change' then
    v_package:=trim(coalesce(p_input->>'packageId',''));
    v_source_id:=trim(coalesce(p_input->>'source',''));
    if v_source_id !~ '^field-change:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or length(trim(coalesce(p_input->>'reason','')))<20
      or length(trim(coalesce(p_input->>'technicalImpact','')))<10
      or length(trim(coalesce(p_input->>'scheduleImpact','')))<5 then
      raise exception 'design_change_incomplete' using errcode='22023'; end if;
    select * into v_field from d5o_hosted.connected_field_changes
      where workspace_id=v_workspace.id and work_id=v_work.id
        and id=substring(v_source_id from 14)::uuid and package_id=v_package
      for share;
    if not found or v_field.kind<>'Scope change'
      or v_field.status<>'Customer authorized' then
      raise exception 'customer_change_authorization_required' using errcode='23514'; end if;
    select item into v_target from pg_catalog.jsonb_array_elements(
      coalesce(v_state->'packages','[]'::jsonb)) item
      where item->>'packageId'=v_package;
    if v_target is null or (v_target->>'revision')::integer<>v_field.opened_package_revision
      or exists(select 1 from pg_catalog.jsonb_array_elements(
        coalesce(v_state->'changes','[]'::jsonb)) c
        where c->>'packageId'=v_package and c->>'status'='Open') then
      raise exception 'field_change_package_revision_mismatch' using errcode='23514'; end if;
    v_change:=pg_catalog.jsonb_build_object('id',gen_random_uuid(),
      'packageId',v_package,'openedRevision',(v_target->>'revision')::integer,
      'sourceHandoffRevision',v_handoff.revision,'source',v_source_id,
      'sourceFieldRevision',v_field.revision,'reason',trim(p_input->>'reason'),
      'affectedRequirementIds',coalesce(p_input->'affectedRequirementIds','[]'::jsonb),
      'affectedDocumentRefs',coalesce(p_input->'affectedDocumentRefs','[]'::jsonb),
      'technicalImpact',trim(p_input->>'technicalImpact'),
      'commercialImpact',coalesce(p_input->>'commercialImpact',''),
      'scheduleImpact',trim(p_input->>'scheduleImpact'),
      'status','Open','openedAt',v_now,'openedByActorId',v_actor);
    v_changes:=coalesce(v_state->'changes','[]'::jsonb)||pg_catalog.jsonb_build_array(v_change);
    v_state:=pg_catalog.jsonb_set(v_state,'{changes}',v_changes);
    select coalesce(pg_catalog.jsonb_agg(case when item->>'packageId'=v_package
      and item->>'status' in ('Accepted','Awaiting receipt') then
        item||pg_catalog.jsonb_build_object('status','Hold pending acknowledgment',
          'holdAt',v_now,'holdByActorId',v_actor,'holdReason',p_input->>'reason')
      else item end order by ordinal),'[]'::jsonb) into v_releases
      from pg_catalog.jsonb_array_elements(coalesce(v_state->'releases','[]'::jsonb))
        with ordinality as releases(item,ordinal);
    v_state:=pg_catalog.jsonb_set(v_state,'{releases}',v_releases);
  elsif p_action='acknowledge-hold' then
    if length(v_note)<15 then raise exception 'hold_acknowledgment_reason_required' using errcode='22023'; end if;
    select item into v_release from pg_catalog.jsonb_array_elements(
      coalesce(v_state->'releases','[]'::jsonb)) item
      where item->>'id'=p_input->>'releaseId'
        and item->>'status'='Hold pending acknowledgment';
    if v_release is null or v_release->>'holdByActorId'=v_actor::text then
      raise exception 'independent_hold_acknowledgment_required' using errcode='23514'; end if;
    v_package:=v_release->>'packageId';
    select coalesce(pg_catalog.jsonb_agg(case when item->>'id'=p_input->>'releaseId'
      then item||pg_catalog.jsonb_build_object('status','Held',
        'holdAcknowledgedAt',v_now,'holdAcknowledgedByActorId',v_actor,
        'responseNote',v_note) else item end order by ordinal),'[]'::jsonb)
      into v_releases from pg_catalog.jsonb_array_elements(v_state->'releases')
        with ordinality as releases(item,ordinal);
    v_state:=pg_catalog.jsonb_set(v_state,'{releases}',v_releases);
  else
    if length(v_note)<20 then raise exception 'change_resolution_reason_required' using errcode='22023'; end if;
    select item into v_change from pg_catalog.jsonb_array_elements(
      coalesce(v_state->'changes','[]'::jsonb)) item
      where item->>'id'=p_input->>'changeId' and item->>'status'='Open';
    if v_change is null then raise exception 'open_design_change_required' using errcode='23514'; end if;
    v_package:=v_change->>'packageId';
    select item into v_target from pg_catalog.jsonb_array_elements(v_state->'packages') item
      where item->>'packageId'=v_package;
    select * into v_field from d5o_hosted.connected_field_changes
      where workspace_id=v_workspace.id and work_id=v_work.id
        and id=substring(v_change->>'source' from 14)::uuid for share;
    if v_target is null or (v_target->>'revision')::integer<=(v_change->>'openedRevision')::integer
      or not found or v_field.status<>'Customer authorized'
      or exists(select 1 from pg_catalog.jsonb_array_elements(v_state->'releases') r
        where r->>'packageId'=v_package and r->>'status'='Hold pending acknowledgment') then
      raise exception 'change_resolution_premature' using errcode='23514'; end if;
    select coalesce(pg_catalog.jsonb_agg(case when item->>'id'=p_input->>'changeId'
      then item||pg_catalog.jsonb_build_object('status','Resolved',
        'resolvedAt',v_now,'resolvedByActorId',v_actor,'resolution',v_note)
      else item end order by ordinal),'[]'::jsonb) into v_changes
      from pg_catalog.jsonb_array_elements(v_state->'changes')
        with ordinality as changes(item,ordinal);
    v_state:=pg_catalog.jsonb_set(v_state,'{changes}',v_changes);
  end if;
  v_revision:=v_design.decision_revision+1;
  v_state:=v_state||pg_catalog.jsonb_build_object('authorityRevision',v_revision,
    'history',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'at',v_now,'actorId',v_actor,'membershipId',v_member.id,
      'action',p_action||' · '||p_command_id,'note',v_note,
      'packageId',v_package,'revision',coalesce((v_target->>'revision')::integer,0)))
      ||coalesce(v_state->'history','[]'::jsonb));
  update d5o_hosted.connected_design_states set decision_revision=v_revision,
    state=v_state,updated_at=v_now where workspace_id=v_workspace.id and work_id=v_work.id;
  insert into d5o_hosted.connected_design_events(workspace_id,work_id,decision_revision,
    command_id,action,actor_user_id,membership_id,source_handoff_revision,snapshot,reason)
  values(v_workspace.id,v_work.id,v_revision,p_command_id,p_action,v_actor,v_member.id,
    v_handoff.revision,v_state,coalesce(nullif(v_note,''),p_input->>'reason'));
  v_result:=public.d5o_hosted_prototype_read_v1(p_workspace_key,'work');
  insert into d5o_hosted.connected_design_receipts(workspace_id,command_id,work_id,
    actor_user_id,fingerprint,result)
  values(v_workspace.id,p_command_id,v_work.id,v_actor,v_fingerprint,v_result);
  return v_result;
end; $$;
revoke all on function public.d5o_hosted_design_field_change_command_v1(
  text,text,text,jsonb,text,bigint,integer) from public,anon,service_role;
grant execute on function public.d5o_hosted_design_field_change_command_v1(
  text,text,text,jsonb,text,bigint,integer) to authenticated;