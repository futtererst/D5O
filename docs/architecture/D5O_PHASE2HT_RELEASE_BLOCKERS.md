# Phase 2H-T release blocker register

| Issue | Impact | Required evidence | Release consequence |
| --- | --- | --- | --- |
| Connected-service browser chain | Resolved locally in Phase 2H-TB: both tenants priced, authorized and created one job through authenticated browser controls; final 51/51 run and cleanup passed. | Retain final evidence and staging rehearsal before deployment. | No longer a local Gate B/C blocker. |
| Gate A calendar and adapter edge matrix | Normal, boundary, holiday and DST predicates plus browser triage passed; direct invalid/missing/wrong-tenant calendar and several adapter negative cases remain unexecuted. | Execute authoritative command and API cases with unchanged-state assertions. | Blocks Phase 2H-TB local qualification. |
| Gate D direct API/RPC security and idempotency matrix | Cross-tenant adapter reads/writes and direct job RPC denial passed; wrong-role, revoked/suspended, stale approval, duplicate/concurrent and replay cases are incomplete for the new browser path. | Exercise each requested adversarial case through new routes and original RPCs; assert unchanged state and task reconciliation. | Blocks Phase 2H-TB local qualification. |
| Inherited Deploy/Operate employee UI | Existing supported business commands and test fixture exist, but the complete employee browser workflow remains a separate gap. | Authenticated browser execution by distinct actors. | Blocks complete six-phase employee coverage. |
| Approved staging migration and recovery | New local migrations ran only against disposable PostgreSQL. | Approved staging rehearsal, existing-tenant preservation, forward recovery/rollback evidence. | Blocks production promotion. |
| Historical sealed M1 regression provenance | Original `RUN-MANIFEST.json` absent. | Recover original fixture or preserve replacement coverage as a separate claim. | Blocks historical reproduction claim. |
| General customer staging routes and private evidence | Disposable authorization does not prove deployment configuration. | Authenticated staging Work, Storage, RPC, pilot-coexistence and rollback tests. | Blocks production promotion. |
| Commercial invitation delivery | Synthetic acceptance does not prove live email. | Approved recipient journey. | Blocks commercial onboarding claim. |
| Production readiness failures | `billing_persistence`, `field_issue_persistence`, `closeout_persistence`, `scanner_mode`. | Qualify each separately. | Blocks production readiness. |

No production data, hosted migration, environment setting, deployment, push or merge was changed by this package.
