-- Customer contact is recorded against the reviewed offer. This records an
-- externally reported event; it does not deliver the offer or authenticate a customer.
alter table d5o_hosted.connected_offer_states drop constraint connected_offer_states_status_check;
alter table d5o_hosted.connected_offer_states add constraint connected_offer_states_status_check
  check (status in ('Draft','Internal review','Approved','Changes requested','Submitted'));

create or replace function d5o_hosted.connected_define_projection_v1(p_workspace uuid,p_state jsonb)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when p_state is null then null else
    pg_catalog.jsonb_set(projected,'{records}',coalesce((
      select pg_catalog.jsonb_agg(case when o.work_id is null then item else
        pg_catalog.jsonb_set(
          pg_catalog.jsonb_set(item,'{discovery,phase}',
            pg_catalog.to_jsonb(case when o.proposal->'responseEvents'->-1->>'status' in
              ('Awarded','Not awarded') then 'Outcome' else 'Submitted' end),true),
          '{discovery,outcome}',
          coalesce(pg_catalog.to_jsonb(case o.proposal->'responseEvents'->-1->>'status'
            when 'Awarded' then 'Won' when 'Not awarded' then 'Lost' else null end),
            'null'::jsonb),true)
        end order by ordinal)
      from pg_catalog.jsonb_array_elements(coalesce(projected->'records','[]'::jsonb))
        with ordinality as records(item,ordinal)
      left join d5o_hosted.work_identity_links l on l.workspace_id=p_workspace
        and l.presentation_id=item->>'id'
      left join d5o_hosted.connected_offer_states o on o.workspace_id=p_workspace
        and o.work_id=l.work_id and o.status='Submitted'
    ),'[]'::jsonb)) end
  from (select d5o_hosted.connected_offer_projection_v1(p_workspace,p_state)
    as projected) source;
$$;
revoke all on function d5o_hosted.connected_define_projection_v1(uuid,jsonb)
  from public,anon,authenticated,service_role;

create function public.d5o_hosted_customer_decision_command_v1(
  p_workspace_key text,p_presentation_id text,p_action text,p_offer_revision integer,
  p_recipient text,p_method text,p_due_date text,p_response_status text,
  p_received_at text,p_details text,p_source_reference text,p_next_action text,
  p_follow_up_due text,p_command_id text,p_expected_source_revision bigint,
  p_expected_decision_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_workspace d5o_hosted.workspaces%rowtype;
  v_member d5o_hosted.memberships%rowtype;v_work d5o_hosted.work_records%rowtype;
  v_state d5o_hosted.prototype_states%rowtype;
  v_estimate d5o_hosted.connected_estimate_states%rowtype;
  v_offer d5o_hosted.connected_offer_states%rowtype;
  v_receipt d5o_hosted.connected_offer_receipts%rowtype;
  v_fingerprint text;v_raw jsonb;v_submission jsonb;v_response jsonb;
  v_proposal jsonb;v_result jsonb;v_now timestamptz:=now();
  v_policy_id text;v_policy_version integer;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null
    or p_action not in ('record-customer-submission','record-customer-response')
    or length(coalesce(p_command_id,'')) not between 8 and 120
    or p_expected_source_revision is null or p_expected_source_revision<1
    or p_expected_decision_revision is null or p_expected_decision_revision<1
    or p_offer_revision is null or p_offer_revision<1 then
    raise exception 'invalid_customer_command' using errcode='22023'; end if;
  select * into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  if not found then raise exception 'workspace_forbidden' using errcode='42501'; end if;
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace.id and actor_user_id=v_actor and status='active' for share;
  if not found or v_member.role not in ('admin','project_manager','operations_leader') then
    raise exception 'customer_recorder_denied' using errcode='42501'; end if;
  select w.* into v_work from d5o_hosted.work_records w
    join d5o_hosted.work_identity_links l on l.work_id=w.id and l.workspace_id=w.workspace_id
    where w.workspace_id=v_workspace.id and l.presentation_id=p_presentation_id
    for update of w;
  if not found then raise exception 'connected_work_unavailable' using errcode='42501'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_array(p_workspace_key,
    p_presentation_id,p_action,p_offer_revision,p_recipient,p_method,p_due_date,
    p_response_status,p_received_at,p_details,p_source_reference,p_next_action,
    p_follow_up_due,p_expected_source_revision,p_expected_decision_revision)::text);
  select * into v_receipt from d5o_hosted.connected_offer_receipts
    where workspace_id=v_workspace.id and command_id=p_command_id;
  if found then
    if v_receipt.work_id<>v_work.id or v_receipt.actor_user_id<>v_actor
      or v_receipt.fingerprint<>v_fingerprint then
      raise exception 'command_reuse_conflict' using errcode='23505'; end if;
    return v_receipt.result;
  end if;
  select * into v_state from d5o_hosted.prototype_states
    where workspace_id=v_workspace.id and state_key='work' for share;
  select * into v_estimate from d5o_hosted.connected_estimate_states
    where workspace_id=v_workspace.id and work_id=v_work.id for share;
  select * into v_offer from d5o_hosted.connected_offer_states
    where workspace_id=v_workspace.id and work_id=v_work.id for update;
  if v_state.revision is distinct from p_expected_source_revision
    or v_offer.decision_revision is distinct from p_expected_decision_revision
    or v_offer.offer_revision is distinct from p_offer_revision then
    raise exception 'stale_state' using errcode='23505'; end if;
  select item into v_raw from pg_catalog.jsonb_array_elements(v_state.state_json->'records') item
    where item->>'id'=p_presentation_id and item->>'canonicalWorkId'=v_work.id::text;
  if v_raw is null or v_raw->>'phaseConfigurationVersionId' is distinct from
    v_work.configuration_version_id::text
    or v_estimate.status is distinct from 'Approved'
    or v_estimate.estimate_revision<>v_offer.estimate_revision
    or v_offer.offer_digest<>pg_catalog.md5((v_offer.proposal->'package')::text)
    or v_offer.proposal#>>'{review,decidedAt}' is null then
    raise exception 'approved_current_offer_required' using errcode='23514'; end if;
  v_policy_id:=v_estimate.estimate#>>'{detailed,evaluation,policyId}';
  v_policy_version:=(v_estimate.estimate#>>'{detailed,evaluation,policyVersion}')::integer;
  if not exists(select 1 from d5o_hosted.connected_pricing_policies
    where workspace_id=v_workspace.id and policy_id=v_policy_id
      and version=v_policy_version and status='published') then
    raise exception 'pinned_offer_policy_unavailable' using errcode='23514'; end if;
  if p_action='record-customer-submission' then
    if v_offer.status<>'Approved'
      or length(trim(coalesce(p_recipient,''))) not between 2 and 300
      or p_method not in ('Customer portal','Email','Procurement platform','Direct presentation')
      or p_due_date is null or p_due_date !~ '^\d{4}-\d{2}-\d{2}$'
      or pg_catalog.to_char(p_due_date::date,'YYYY-MM-DD')<>p_due_date then
      raise exception 'submission_input_invalid' using errcode='23514'; end if;
    v_submission:=pg_catalog.jsonb_build_object('revision',v_offer.offer_revision,
      'estimateRevision',v_offer.estimate_revision,'recordedAt',v_now,
      'recipient',trim(p_recipient),'method',p_method,'responseDueDate',p_due_date,
      'packageSnapshot',v_offer.proposal->'package','recordedByActorId',v_actor,
      'recordedByMembershipId',v_member.id);
    v_proposal:=v_offer.proposal||pg_catalog.jsonb_build_object(
      'status','Submitted','recipient',trim(p_recipient),'method',p_method,
      'dueDate',p_due_date,'submission',v_submission,
      'submissionHistory',coalesce(v_offer.proposal->'submissionHistory','[]'::jsonb)||
        pg_catalog.jsonb_build_array(v_submission),
      'authorityRevision',v_offer.decision_revision+1);
  else
    if v_offer.status<>'Submitted'
      or v_offer.proposal#>>'{submission,revision}' is distinct from p_offer_revision::text
      or v_offer.proposal#>'{submission,packageSnapshot}' is distinct from
        v_offer.proposal->'package'
      or v_offer.proposal->'responseEvents'->-1->>'status' in ('Awarded','Not awarded')
      or p_response_status not in ('Clarification requested','Commercial negotiation',
        'Decision deferred','Awarded','Not awarded')
      or p_received_at is null or p_received_at !~ '^\d{4}-\d{2}-\d{2}$'
      or pg_catalog.to_char(p_received_at::date,'YYYY-MM-DD')<>p_received_at
      or length(trim(coalesce(p_details,''))) not between 10 and 4000
      or p_response_status in ('Awarded','Not awarded') and
        length(trim(coalesce(p_source_reference,''))) not between 5 and 1000
      or p_response_status not in ('Awarded','Not awarded') and
        (length(trim(coalesce(p_next_action,''))) not between 5 and 500
          or p_follow_up_due is null or p_follow_up_due !~ '^\d{4}-\d{2}-\d{2}$'
          or pg_catalog.to_char(p_follow_up_due::date,'YYYY-MM-DD')<>p_follow_up_due) then
      raise exception 'response_input_invalid' using errcode='23514'; end if;
    v_response:=pg_catalog.jsonb_build_object('revision',v_offer.offer_revision,
      'status',p_response_status,'receivedAt',p_received_at,
      'details',trim(p_details),'sourceReference',nullif(trim(coalesce(p_source_reference,'')),''),
      'nextAction',case when p_response_status in ('Awarded','Not awarded') then null
        else trim(p_next_action) end,
      'followUpDue',case when p_response_status in ('Awarded','Not awarded') then null
        else p_follow_up_due end,
      'recordedByActorId',v_actor,'recordedByMembershipId',v_member.id);
    v_proposal:=v_offer.proposal||pg_catalog.jsonb_build_object(
      'response',trim(p_details),
      'responseEvents',coalesce(v_offer.proposal->'responseEvents','[]'::jsonb)||
        pg_catalog.jsonb_build_array(v_response),
      'authorityRevision',v_offer.decision_revision+1);
  end if;
  update d5o_hosted.connected_offer_states set
    decision_revision=decision_revision+1,status=case
      when p_action='record-customer-submission' then 'Submitted' else status end,
    proposal=v_proposal,updated_at=v_now
    where workspace_id=v_workspace.id and work_id=v_work.id;
  insert into d5o_hosted.connected_offer_events(workspace_id,work_id,
    decision_revision,command_id,action,actor_user_id,membership_id,
    offer_revision,estimate_revision,policy_id,policy_version,snapshot,reason)
  values(v_workspace.id,v_work.id,v_offer.decision_revision+1,p_command_id,p_action,
    v_actor,v_member.id,v_offer.offer_revision,v_offer.estimate_revision,
    v_policy_id,v_policy_version,v_proposal,
    case when p_action='record-customer-submission' then
      p_method||' · '||trim(p_recipient) else trim(p_details) end);
  v_result:=public.d5o_hosted_prototype_read_v1(p_workspace_key,'work');
  insert into d5o_hosted.connected_offer_receipts(workspace_id,command_id,
    work_id,actor_user_id,fingerprint,result)
  values(v_workspace.id,p_command_id,v_work.id,v_actor,v_fingerprint,v_result);
  return v_result;
end; $$;
revoke all on function public.d5o_hosted_customer_decision_command_v1(
  text,text,text,integer,text,text,text,text,text,text,text,text,text,text,bigint,integer)
  from public,anon,service_role;
grant execute on function public.d5o_hosted_customer_decision_command_v1(
  text,text,text,integer,text,text,text,text,text,text,text,text,text,text,bigint,integer)
  to authenticated;

-- The projection is a view, not a new editable source. Draft saves must carry
-- exactly the projected customer phase/outcome and restore the raw values.
create or replace function d5o_hosted.connected_offer_draft_rebase_v1(
  p_workspace uuid,p_raw jsonb,p_submitted jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_new jsonb;v_old jsonb;v_expected jsonb;v_records jsonb:='[]'::jsonb;
begin
  for v_new in select value from pg_catalog.jsonb_array_elements(p_submitted->'records') loop
    select value into v_old from pg_catalog.jsonb_array_elements(p_raw->'records')
      where value->>'id'=v_new->>'id';
    select value into v_expected from pg_catalog.jsonb_array_elements(
      d5o_hosted.connected_define_projection_v1(p_workspace,p_raw)->'records')
      where value->>'id'=v_new->>'id';
    if exists(select 1 from d5o_hosted.work_identity_links l
      join d5o_hosted.connected_offer_states o on o.workspace_id=l.workspace_id
        and o.work_id=l.work_id
      where l.workspace_id=p_workspace and l.presentation_id=v_new->>'id') then
      if v_new#>'{discovery,proposal}' is distinct from
          v_expected#>'{discovery,proposal}'
        or v_new#>'{discovery,phase}' is distinct from
          v_expected#>'{discovery,phase}'
        or v_new#>'{discovery,outcome}' is distinct from
          v_expected#>'{discovery,outcome}' then
        raise exception 'typed_offer_command_required' using errcode='42501'; end if;
      v_new:=pg_catalog.jsonb_set(v_new,'{discovery,proposal}',
        v_old#>'{discovery,proposal}',true);
      v_new:=pg_catalog.jsonb_set(v_new,'{discovery,phase}',
        v_old#>'{discovery,phase}',true);
      if v_old#>'{discovery,outcome}' is null then
        v_new:=v_new#-'{discovery,outcome}';
      else
        v_new:=pg_catalog.jsonb_set(v_new,'{discovery,outcome}',
          v_old#>'{discovery,outcome}',true);
      end if;
      v_new:=v_new||pg_catalog.jsonb_build_object('nextAction',v_expected->'nextAction');
    elsif v_new#>'{discovery,proposal}' is distinct from
        v_old#>'{discovery,proposal}' then
      v_new:=v_new||pg_catalog.jsonb_build_object('nextAction',v_expected->'nextAction');
    end if;
    v_records:=v_records||pg_catalog.jsonb_build_array(v_new);
  end loop;
  return pg_catalog.jsonb_set(p_submitted,'{records}',v_records);
end; $$;
revoke all on function d5o_hosted.connected_offer_draft_rebase_v1(uuid,jsonb,jsonb)
  from public,anon,authenticated,service_role;
