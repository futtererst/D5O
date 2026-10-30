-- Withdraw an unpublished draft booking without touching accepted publications or
-- financial reservations. The immutable schedule event retains the decision.
create function public.d5o_hosted_cancel_draft_booking_v1(
  p_workspace_key text, p_work_id text, p_package_id text,
  p_assignment_id text, p_command_id text, p_expected_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_workspace uuid; v_member d5o_hosted.memberships%rowtype;
  v_schedule d5o_hosted.connected_schedule_states%rowtype;
  v_receipt d5o_hosted.connected_schedule_receipts%rowtype;
  v_assignment jsonb; v_state jsonb; v_fingerprint text; v_result jsonb;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or length(coalesce(p_command_id,'')) not between 8 and 120
    or p_expected_revision is null or p_expected_revision<0
    or length(coalesce(p_assignment_id,'')) not between 5 and 100 then
    raise exception 'invalid_cancellation' using errcode='22023'; end if;
  select id into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace and actor_user_id=v_actor and status='active' for share;
  if v_workspace is null or v_member.id is null or
    v_member.role not in ('admin','project_manager','operations_leader') then
    raise exception 'scheduling_authority_required' using errcode='42501'; end if;
  select * into v_schedule from d5o_hosted.connected_schedule_states
    where workspace_id=v_workspace for update;
  if v_schedule.workspace_id is null then
    raise exception 'schedule_unavailable' using errcode='23514'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(
    p_workspace_key,p_work_id,p_package_id,p_assignment_id,p_expected_revision)::text);
  select * into v_receipt from d5o_hosted.connected_schedule_receipts
    where workspace_id=v_workspace and command_id=p_command_id;
  if v_receipt.workspace_id is not null then
    if v_receipt.actor_user_id<>v_actor or v_receipt.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_receipt.result;
  end if;
  if v_schedule.decision_revision<>p_expected_revision then
    raise exception 'stale_schedule' using errcode='23505'; end if;
  select a into v_assignment from pg_catalog.jsonb_array_elements(
    coalesce(v_schedule.state->'assignments','[]'::jsonb)) a
    where a->>'id'=p_assignment_id and a->>'workId'=p_work_id
      and a->>'packageId'=p_package_id;
  if v_assignment is null then
    raise exception 'draft_booking_unavailable' using errcode='23514'; end if;
  if exists(select 1 from pg_catalog.jsonb_array_elements(
      coalesce(v_schedule.state->'publications','[]'::jsonb)) pub
      cross join lateral pg_catalog.jsonb_array_elements(
        coalesce(pub->'assignments','[]'::jsonb)) a
      where a->>'id'=p_assignment_id)
    or exists(select 1 from d5o_hosted.labor_reservations r
      where r.workspace_id=v_workspace and r.assignment_id=p_assignment_id
        and r.status='Active') then
    raise exception 'published_booking_cannot_cancel' using errcode='23514'; end if;
  v_state:=pg_catalog.jsonb_set(v_schedule.state,'{assignments}',
    (select coalesce(pg_catalog.jsonb_agg(a order by ordinal),'[]'::jsonb)
      from pg_catalog.jsonb_array_elements(v_schedule.state->'assignments')
        with ordinality as entries(a,ordinal)
      where a->>'id'<>p_assignment_id));
  v_state:=pg_catalog.jsonb_set(v_state,'{draftRevision}',
    pg_catalog.to_jsonb(coalesce((v_state->>'draftRevision')::integer,0)+1));
  update d5o_hosted.connected_schedule_states set
    decision_revision=decision_revision+1,state=v_state,updated_at=now()
    where workspace_id=v_workspace;
  insert into d5o_hosted.connected_schedule_events(workspace_id,decision_revision,
    command_id,action,actor_user_id,membership_id,snapshot)
  values(v_workspace,v_schedule.decision_revision+1,p_command_id,
    'cancel-draft-booking',v_actor,v_member.id,v_state);
  v_result:=pg_catalog.jsonb_build_object('cancelled',true,
    'assignmentId',p_assignment_id,'revision',v_schedule.decision_revision+1);
  insert into d5o_hosted.connected_schedule_receipts(workspace_id,command_id,
    actor_user_id,fingerprint,result)
  values(v_workspace,p_command_id,v_actor,v_fingerprint,v_result);
  return v_result;
end; $$;
revoke all on function public.d5o_hosted_cancel_draft_booking_v1(
  text,text,text,text,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.d5o_hosted_cancel_draft_booking_v1(
  text,text,text,text,text,integer) to authenticated;
