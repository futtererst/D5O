-- Service commercial and Finance queue positions are projections of committed
-- request and decision state. They never confer command authority.
create or replace function public.d5o_hosted_service_actions_v1(p_workspace_key text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid(); v_workspace uuid; v_member d5o_hosted.memberships%rowtype;
  v_row record; v_request jsonb; v_estimate jsonb; v_auth jsonb; v_fin jsonb;
  v_cycle text; v_kind text; v_status text; v_blocker text; v_role text;
  v_child text; v_actionable boolean; v_ownership text; v_items jsonb:='[]'::jsonb;
  v_customer text;
begin
  if current_setting('role',true)<>'authenticated' or v_actor is null then
    raise exception 'membership_required' using errcode='42501'; end if;
  select id into v_workspace from d5o_hosted.workspaces
    where workspace_key=p_workspace_key and status='active';
  select * into v_member from d5o_hosted.memberships
    where workspace_id=v_workspace and actor_user_id=v_actor and status='active';
  if v_member.id is null then raise exception 'queue_scope_denied' using errcode='42501'; end if;
  if v_member.role not in ('project_manager','billing_commercial_lead',
    'operations_leader','admin','executive') then return v_items; end if;
  for v_row in
    select l.work_id,l.presentation_id,w.title,o.state
    from d5o_hosted.connected_operate_states o
    join d5o_hosted.work_identity_links l on l.workspace_id=o.workspace_id
      and l.work_id=o.work_id and l.parent_work_id is null
    join d5o_hosted.work_records w on w.workspace_id=o.workspace_id and w.id=o.work_id
    where o.workspace_id=v_workspace
    order by w.created_at desc,l.presentation_id
  loop
    select item->>'customer' into v_customer
      from d5o_hosted.prototype_states p,
        lateral pg_catalog.jsonb_array_elements(coalesce(p.state_json->'records','[]'::jsonb)) item
      where p.workspace_id=v_workspace and p.state_key='work'
        and item->>'id'=v_row.presentation_id limit 1;
    for v_request in select item from pg_catalog.jsonb_array_elements(
      coalesce(v_row.state->'requests','[]'::jsonb)) item
    loop
      if coalesce(v_request->>'coverage','') not in ('Chargeable','Partially covered') then continue; end if;
      v_cycle:=coalesce(v_request->>'reopenedAt',v_request->>'reportedAt');
      v_estimate:=v_request->'serviceEstimate';
      v_auth:=v_request->'serviceAuthorization';
      v_fin:=null; v_child:=null; v_kind:=null; v_status:=null; v_blocker:=null;
      v_role:=null;
      select job->>'workId' into v_child
        from pg_catalog.jsonb_array_elements(coalesce(v_row.state->'jobs','[]'::jsonb)) job
        where job->>'requestId'=v_request->>'id'
          and job->>'requestCycleAt'=v_cycle
          and coalesce(v_request->'currentCycleJobIds','[]'::jsonb) ? (job->>'id')
        order by job->>'createdAt' desc limit 1;
      if v_estimate is null or v_estimate->>'requestCycleAt' is distinct from v_cycle
        or v_estimate->>'status' not in ('Approved','Pricing review') then
        v_kind:='Service pricing';v_role:='project_manager';
        v_status:=coalesce(v_estimate->>'status','Missing');
        v_blocker:='Prepare and submit a current-cycle estimate for uncovered scope.';
      elsif v_estimate->>'status'='Pricing review' then
        v_kind:='Service pricing review';
        v_role:=v_estimate#>>'{policySnapshot,pricingApproverRole}';
        v_status:='Pricing review';
        v_blocker:='Independent review of the submitted estimate revision is pending.';
      elsif v_auth is null or v_auth->>'estimateRevision' is distinct from v_estimate->>'revision'
        or v_auth->>'amountMinor' is distinct from v_estimate#>>'{evaluation,proposedPriceMinor}'
        or v_auth->>'currency' is distinct from v_estimate#>>'{evaluation,currency}' then
        v_kind:='Customer service authorization';v_role:='operations_leader';
        v_status:='Awaiting customer source';
        v_blocker:='Record the retained customer decision for this approved estimate.';
      elsif v_request->>'coverage'='Partially covered' and v_request->>'status'='Closed' then
        v_fin:=public.d5o_hosted_service_finance_read_v1(
          p_workspace_key,v_row.presentation_id,v_request->>'id');
        if v_fin->'basis'->>'eligibleForFinanceReview' is distinct from 'true' then
          v_kind:='Service Finance source';v_role:='project_manager';
          v_status:='Source changed';
          v_blocker:='Reconcile the current service execution and commercial source before preparation.';
        elsif (v_fin->>'decisionCurrent')='true'
          and v_fin#>>'{decision,status}'='Ready for billing' then
          v_kind:='Service billing handoff';v_role:='billing_commercial_lead';
          v_status:='Ready for billing';
          v_blocker:='Supported uncovered scope awaits an external invoicing process; no invoice or payment is recorded here.';
        elsif (v_fin->>'decisionCurrent')='true'
          and v_fin#>>'{decision,status}'='Prepared' then
          v_kind:='Service Finance review';v_role:='billing_commercial_lead';
          v_status:='Prepared';
          v_blocker:='Review the exact prepared basis independently; retained billing terms are required for Ready.';
        elsif (v_fin->>'decisionCurrent')='true'
          and v_fin#>>'{decision,status}'='Hold' then
          v_kind:='Service terms follow-up';v_role:='project_manager';
          v_status:='Finance Hold';
          v_blocker:=coalesce(v_fin#>>'{decision,review_reason}',
            'Finance requires a current retained billing-terms source.');
        else
          v_kind:=case when v_fin->>'decision' is null then 'Service Finance preparation'
            else 'Service Finance reassessment' end;
          v_role:='project_manager';
          v_status:=case when v_fin->>'decision' is null then 'Not prepared'
            else 'Historical decision' end;
          v_blocker:=case when v_fin->>'decision' is null then
            'Prepare the current service basis for independent Finance review.'
            else 'The source changed; prepare a new basis before Finance can rely on the historical decision.' end;
        end if;
      end if;
      if v_kind is null then continue; end if;
      v_actionable:=v_member.role=v_role and not (
        v_kind='Service Finance review' and
        v_fin#>>'{decision,prepared_by}'=v_actor::text)
        and v_kind<>'Service billing handoff' and
        not (v_kind='Service pricing review' and
          v_estimate->>'submittedByActorId'=v_actor::text);
      v_ownership:=case when v_kind='Service billing handoff' then 'Information only'
        when v_actionable then 'Available to your role'
        else 'Waiting on another role' end;
      v_items:=v_items||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'kind',v_kind,'workId',v_row.presentation_id,'workTitle',v_row.title,
        'requestId',v_request->>'id','requestTitle',v_request->>'title',
        'customer',v_customer,'childWorkId',v_child,
        'requestCycleAt',v_cycle,'coverage',v_request->>'coverage',
        'requestStatus',v_request->>'status','revision',
          coalesce((v_fin->>'revision')::integer,(v_estimate->>'revision')::integer,0),
        'status',v_status,'blocker',v_blocker,'responsibleRole',v_role,
        'actionable',v_actionable,'ownership',v_ownership,
        'dueDate',null,'serviceResolutionDueAt',v_request->>'resolutionDueAt',
        'panel',case when v_kind like 'Service Finance%' or v_kind in
          ('Service terms follow-up','Service billing handoff') then 'finance' else 'pricing' end));
    end loop;
  end loop;
  return v_items;
end; $$;
revoke all on function public.d5o_hosted_service_actions_v1(text) from public,anon,service_role;
grant execute on function public.d5o_hosted_service_actions_v1(text) to authenticated;
