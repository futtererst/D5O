# Phase 2H-S Develop employee browser journey

Source: `evidence/phase2hs-develop-gate-results.json`, produced by `node scripts/p0a/run-phase2hs-develop-gate.mjs` against a newly created, loopback-only Supabase project. The runner uses separate authenticated project-manager, administrator, Operations, and field-worker sessions for each independently provisioned tenant. It invokes the displayed application controls, records the resulting HTTP request and command UUID, reloads state, and verifies the persisted phase projection. Its `developActions` records distinguish browser commands from fixture setup and RPC security probes.

| Business decision | Actor and browser control | Authoritative command | Observed result |
| --- | --- | --- | --- |
| Economic authority submission | Project manager, My Work → Submit economic authority | `d5o_purchase_authority_command_v1` | HTTP 200 in A and B; preparation task removed |
| Economic authority approval | Independent tenant administrator, My Work → Approve economic authority | Same command | HTTP 200 in A and B; review task removed |
| Labor authority submission | Project manager, My Work → Submit labor authority | `d5o_labor_authority_command_v1` | HTTP 200 in A and B; preparation task removed |
| Labor authority approval | Independent tenant administrator, My Work → Approve labor authority | Same command | HTTP 200 in A and B; review task removed |
| Qualified crew booking | Operations, My Work → Save crew booking | `d5o_hosted_crew_command_v1` | HTTP 200 in A and B; task becomes Publish crew assignment |
| Crew publication | Operations, My Work → Publish crew week | Same command | HTTP 200 in A and B; task becomes Await employee assignment response |
| Assignment acknowledgment | Exact bound field employee, independent sign-in → Acknowledge assignment | Same command | HTTP 200 in A and B; worker page confirms acknowledgment |
| Field-start decision | Operations, My Work → Authorize field start, with explicit confirmation | `d5o_hosted_field_start_command_v1` | HTTP 200 in A and B; task leaves Develop queue |

The accepted Design package and early solution decision are displayed as prerequisites. Early solution selection remains preparation, not Develop completion. Workforce rows show qualification, recorded absence and weekly capacity; the hosted scheduling command independently enforces the complete eligibility and overlap checks. The field employee cannot acknowledge for another person. After Operations issues the permit, the worker page shows the next Deploy responsibility. The test does **not** execute a Deploy business command.

For both tenants, `d5o_hosted_phase_status_read_v1` reports `Develop.status = completed`, `currentPhase = Deploy`, and `replayMatches = true`. The pinned configuration version remains unchanged. Machine-readable action receipts retain Work, actor, task link, HTTP status, command UUID, resulting phase, and screenshot path. Screenshots are under `evidence/phase2hs-develop-browser/`; the worker acknowledgment and Deploy responsibility images show independently authenticated employee state.

The existing Phase 1B connected-service approval and job commands remain a separate child service-request path. This connected Work browser journey does not count them as a browser-qualified service job. See `D5O_PHASE2HS_ACTION_COVERAGE.md` for the distinction.
