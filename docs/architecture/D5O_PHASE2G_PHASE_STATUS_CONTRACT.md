# Phase 2G phase-status contract

The order is Discover → Define → Design → Develop → Deploy → Operate. `connected_phase_status` is a private, event-refreshed projection, not a command target. The trigger recomputes from canonical connected Work, pursuit, Define, solution, handoff, Design, package, Deploy and Operate records in the same transaction as each event insert. Only a changed projection advances its revision. The authenticated read RPC checks tenant membership, tenant active status, connected Work capability, and Work identity; it replays the projection and exposes `replayMatches`.

| Phase | Entry basis | Completion basis |
| --- | --- | --- |
| Discover | Canonical Work created | Qualified pursuit handoff |
| Define | Pursuit handoff | Approved Define handoff |
| Design | Accepted Design handoff | All created packages have accepted releases |
| Develop | Accepted Design releases | Authorized field start |
| Deploy | Authorized field start | Whole-Work customer acceptance |
| Operate | Whole-Work customer acceptance | Support is active; financial closeout is tracked independently |

Early approved solution selection is `preparation_in_progress` for Develop while Design is pending. It never completes Develop. `not_started`, `ready_to_enter`, `active`, `blocked`, `preparation_in_progress`, and `completed` are derived from evidence. A historical Work record without connected evidence returns `unresolved`; no phase event or configuration pin is rewritten. The source event, actor, timestamp, revision, tenant, Work, and pinned configuration are stored with the projection. The UI shows `Support: Active` and `Financial closeout: Pending` separately.

An authorized field start completes Develop. A later held permit preserves that historical completion but marks in-progress Deploy as `blocked` until the existing command model resolves the hold. The projection does not grant execution authority.

Operate remains `active` after support activation because financial closeout is a separate outcome and no combined terminal phase decision was qualified. A future terminal state must be based on an authoritative closeout event; this migration does not invent one.

Migration: `20261023201553_phase2g_phase_status.sql`. It is local only. Apply to an approved staging clone, compare replay for existing connected Work, then verify role grants and historical unresolved records before any promotion. Forward recovery can rebuild the private table from canonical records; rollback requires disabling the new route/read RPC and dropping the triggers, function and table after confirming no downstream consumer relies on them. Historical business events remain untouched.

After turning off the new route, a schema-only rollback on an approved clone is:

```sql
begin;
drop trigger if exists phase_status_work_created on d5o_hosted.work_events;
drop trigger if exists phase_status_pursuit on d5o_hosted.connected_pursuit_events;
drop trigger if exists phase_status_define on d5o_hosted.connected_define_events;
drop trigger if exists phase_status_solution on d5o_hosted.connected_solution_events;
drop trigger if exists phase_status_design_handoff on d5o_hosted.connected_design_handoff_events;
drop trigger if exists phase_status_design on d5o_hosted.connected_design_events;
drop trigger if exists phase_status_deploy on d5o_hosted.connected_deploy_events;
drop trigger if exists phase_status_operate on d5o_hosted.connected_operate_events;
drop function if exists public.d5o_hosted_phase_status_read_v1(text,text);
drop function if exists d5o_hosted.refresh_connected_phase_status_v1();
drop function if exists d5o_hosted.connected_phase_projection_v1(uuid,uuid);
drop table if exists d5o_hosted.connected_phase_status;
commit;
```

This drops only derived status data. Reapply/replay from canonical records for forward recovery; do not roll back business events or configuration versions.
