# Phase 2H Work action architecture

Baseline: Phase 2G `f2cf3a12e737c894a7d3a7443c7a11c8e574f52f`.

The tenant-neutral route retains the Phase 2G membership, lifecycle, connected Work capability, tenant, and configuration-pin checks. The new Define decision adapter accepts only independent review and handoff actions. It supplies the workspace, Work identity and command ID server-side and calls `d5o_hosted_define_command_v1` with the authenticated user's Supabase session. The database command verifies role, submitted-by separation, opposing reviewer separation, source revision, decision revision, pinned configuration and tenant ownership, then records a decision and audit event atomically. The existing bounded Operate handoff and activation adapter remains unchanged.

No direct client table mutation or new business decision engine was added. The browser sends an explicit reason and the current revision. A stale or duplicate decision fails through the authoritative RPC. This slice does **not** expose Define draft editing or the remaining phase commands; those are Phase 2H blockers.

| Phase | Browser action in this slice | Authoritative command | State |
| --- | --- | --- | --- |
| Discover | Existing connected Work creation | Existing connected Work API/RPC | Inherited |
| Define | Commercial/delivery review; approved-scope handoff | `d5o_hosted_define_command_v1` | Browser exercised for both disposable tenants |
| Design | Read current package state | Existing design commands | Action UI deferred |
| Develop | Read preparation state | Existing solution, scheduling and authorization commands | Action UI deferred |
| Deploy | Read acceptance state | Existing field commands | Action UI deferred |
| Operate | Receive handoff; activate accepted support | `d5o_hosted_operate_command_v1` | Inherited |

No migration is required for this slice. Its rollback is reverting the API, task projection and UI commit; published configuration and historical business decisions are unaffected.
