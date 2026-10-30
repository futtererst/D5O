-- Run only against an isolated local D5O database with the migration loaded.
-- The caller must wrap this file in a transaction and roll it back.
\set ON_ERROR_STOP on
select w.workspace_key, m.actor_user_id as actor,
  s.decision_revision as expected_revision,
  a->>'workId' as work_id, a->>'packageId' as package_id,
  a->>'id' as published_assignment_id,
  'qa-draft-' || gen_random_uuid()::text as assignment_id,
  a as source_assignment
from d5o_hosted.connected_schedule_states s
join d5o_hosted.workspaces w on w.id=s.workspace_id
join d5o_hosted.memberships m on m.workspace_id=w.id
  and m.status='active' and m.role='admin'
cross join lateral jsonb_array_elements(s.state->'assignments') a
where exists(select 1 from jsonb_array_elements(s.state->'publications') pub
  cross join lateral jsonb_array_elements(pub->'assignments') historical
  where historical->>'id'=a->>'id')
limit 1 \gset
select m.actor_user_id as worker_actor from d5o_hosted.memberships m
join d5o_hosted.workspaces w on w.id=m.workspace_id
where w.workspace_key=:'workspace_key' and m.status='active'
  and m.role='field_worker' limit 1 \gset

-- Clone a local fixture as an unpublished draft; historical publications stay intact.
update d5o_hosted.connected_schedule_states s set state=jsonb_set(s.state,
  '{assignments}',s.state->'assignments' || jsonb_build_array(
    jsonb_set(:'source_assignment'::jsonb,'{id}',to_jsonb(:'assignment_id'::text))))
from d5o_hosted.workspaces w where w.id=s.workspace_id
  and w.workspace_key=:'workspace_key';
select set_config('request.jwt.claim.sub',:'actor',true) as claim_set \gset
select set_config('qa.workspace_key',:'workspace_key',true) as qa_workspace \gset
select set_config('qa.work_id',:'work_id',true) as qa_work \gset
select set_config('qa.package_id',:'package_id',true) as qa_package \gset
select set_config('qa.published_assignment_id',:'published_assignment_id',true) as qa_published \gset
select set_config('qa.next_revision',(:'expected_revision'::integer+1)::text,true) as qa_revision \gset
set local role authenticated;
select public.d5o_hosted_cancel_draft_booking_v1(:'workspace_key',
  :'work_id',:'package_id',:'assignment_id',
  'qa-cancel-command-1',:'expected_revision'::integer) as result \gset
select public.d5o_hosted_cancel_draft_booking_v1(:'workspace_key',
  :'work_id',:'package_id',:'assignment_id',
  'qa-cancel-command-1',:'expected_revision'::integer) as replay \gset
do $$ begin
  perform public.d5o_hosted_cancel_draft_booking_v1(
    current_setting('qa.workspace_key'),current_setting('qa.work_id'),
    current_setting('qa.package_id'),current_setting('qa.published_assignment_id'),
    'qa-cancel-published-denial',current_setting('qa.next_revision')::integer);
  raise exception 'published booking was cancelled';
exception when check_violation then
  if sqlerrm<>'published_booking_cannot_cancel' then raise; end if;
end $$;
select set_config('request.jwt.claim.sub',:'worker_actor',true) as worker_claim_set \gset
do $$ begin
  perform public.d5o_hosted_cancel_draft_booking_v1(
    current_setting('qa.workspace_key'),current_setting('qa.work_id'),
    current_setting('qa.package_id'),current_setting('qa.published_assignment_id'),
    'qa-cancel-wrong-role-denial',current_setting('qa.next_revision')::integer);
  raise exception 'wrong role cancelled a booking';
exception when insufficient_privilege then
  if sqlerrm<>'scheduling_authority_required' then raise; end if;
end $$;
reset role;
-- psql checks below assert the event, receipt and replay without printing identities.
select (:'result'::jsonb=:'replay'::jsonb
  and :'result'::jsonb->>'cancelled'='true'
  and exists(select 1 from d5o_hosted.connected_schedule_events e
    join d5o_hosted.workspaces w on w.id=e.workspace_id
    where w.workspace_key=:'workspace_key' and e.command_id='qa-cancel-command-1'
      and e.action='cancel-draft-booking')
  and exists(select 1 from d5o_hosted.connected_schedule_receipts r
    join d5o_hosted.workspaces w on w.id=r.workspace_id
    where w.workspace_key=:'workspace_key' and r.command_id='qa-cancel-command-1')
  and not exists(select 1 from d5o_hosted.connected_schedule_states s
    join d5o_hosted.workspaces w on w.id=s.workspace_id
    cross join lateral jsonb_array_elements(s.state->'assignments') a
    where w.workspace_key=:'workspace_key' and a->>'id'=:'assignment_id'))
  as draft_cancellation_regression_passed \gset
\if :draft_cancellation_regression_passed
  \echo draft_cancellation_regression_passed
\else
  select 1/0;
\endif
