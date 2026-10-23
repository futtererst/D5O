-- A field worker sees assigned work through the worker-specific server projection.
-- Workspace membership alone must not expose the canonical Work Record catalog.
drop policy if exists d5o_hosted_work_member_read on d5o_hosted.work_records;
create policy d5o_hosted_work_member_read on d5o_hosted.work_records
  for select to authenticated using (
    exists (select 1 from d5o_hosted.memberships m
      join d5o_hosted.workspaces w on w.id = m.workspace_id
      where m.workspace_id = work_records.workspace_id
        and m.actor_user_id = (select auth.uid())
        and m.status = 'active' and m.role <> 'field_worker'
        and w.status = 'active')
  );

drop policy if exists d5o_hosted_work_event_member_read on d5o_hosted.work_events;
create policy d5o_hosted_work_event_member_read on d5o_hosted.work_events
  for select to authenticated using (
    exists (select 1 from d5o_hosted.work_records r
      join d5o_hosted.memberships m on m.workspace_id = r.workspace_id
      join d5o_hosted.workspaces w on w.id = r.workspace_id
      where r.id = work_events.work_id
        and r.workspace_id = work_events.workspace_id
        and m.actor_user_id = (select auth.uid())
        and m.status = 'active' and m.role <> 'field_worker'
        and w.status = 'active')
  );
