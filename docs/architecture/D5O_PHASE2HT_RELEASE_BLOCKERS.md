# Phase 2H-T release blocker register

| Issue | Impact | Required evidence | Release consequence |
| --- | --- | --- | --- |
| Connected-service Gate B browser chain incomplete | Agreement triage returned `sla_calendar_unresolvable`; no browser-priced request, tenant decision, authorization or executable job was demonstrated. | Rerun `scripts/p0a/run-phase2ht-gate-b.mjs` on an eligible real business shift with the supported `Continuous` agreement calendar. Require both tenants, post-reload state, task reconciliation and verified cleanup. | Blocks Phase 2H-T full qualification. |
| Gate B direct API/RPC security and idempotency matrix | Phase 1B RPC suite passes, but the new tenant-neutral adapters have not passed the full requested cross-tenant and adversarial matrix. | Exercise wrong actor, foreign Work/request/evidence, stale approval, duplicate and concurrent commands through new routes and original RPCs; assert unchanged state. | Blocks Phase 2H-T full qualification. |
| Inherited Deploy/Operate employee UI | Existing supported business commands and test fixture exist, but the complete employee browser workflow remains a separate gap. | Authenticated browser execution by distinct actors. | Blocks complete six-phase employee coverage. |
| Approved staging migration and recovery | New local migrations ran only against disposable PostgreSQL. | Approved staging rehearsal, existing-tenant preservation, forward recovery/rollback evidence. | Blocks production promotion. |
| Historical sealed M1 regression provenance | Original `RUN-MANIFEST.json` absent. | Recover original fixture or preserve replacement coverage as a separate claim. | Blocks historical reproduction claim. |
| General customer staging routes and private evidence | Disposable authorization does not prove deployment configuration. | Authenticated staging Work, Storage, RPC, pilot-coexistence and rollback tests. | Blocks production promotion. |
| Commercial invitation delivery | Synthetic acceptance does not prove live email. | Approved recipient journey. | Blocks commercial onboarding claim. |
| Production readiness failures | `billing_persistence`, `field_issue_persistence`, `closeout_persistence`, `scanner_mode`. | Qualify each separately. | Blocks production readiness. |

No production data, hosted migration, environment setting, deployment, push or merge was changed by this package.
