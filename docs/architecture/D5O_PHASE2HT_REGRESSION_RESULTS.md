# Phase 2H-T regression results

## Executed

| Suite | Actual result | Evidence |
|---|---|---|
| Gate A Develop security, two-tenant authorization and browser checks | 42 passed, 0 failed; setup complete, cleanup verified | `evidence/phase2ht-gate-a-results.json`, `evidence/phase2ht-gate-a-browser/` |
| Phase 1B connected service approval integrity | 14 passed, 0 failed; cleanup verified | `evidence/phase2ht-approval-gate-results.json` |
| Gate B inherited connected-work plus new service browser checks, last complete run | 47 passed, 3 failed; cleanup verified | `evidence/phase2ht-gate-b-results.json` |
| TypeScript, ESLint, production build | Passed. Initial sandboxed Turbopack build was blocked by Windows junction permissions; elevated local retry compiled and completed page generation. | Local command output |
| Local migration smoke | Both new migrations applied to a disposable project; teardown returned `stopExit=0` with no residual containers or project directory. | `scripts/p0a/run-phase2ht-migration-smoke.mjs` command output |

The Gate B failure chain begins at `triage-request`: the synthetic agreement chose `Business hours`, but the disposable tenant's SLA business-hours calendar could not resolve. The RPC returned HTTP 409 `sla_calendar_unresolvable`, and its request state did not advance. The subsequent estimate/job test had no priced request to read. The third failure was the inherited tenant-neutral browser creation status wait during a development-server reload. These are failures, not passes. The form and fixture now support the existing `Continuous` agreement calendar, but that correction has not been exercised through the full browser journey on a clean eligible shift.

The final Gate B attempt cleaned its disposable project (`stopExit=0`, no residual containers, project directory absent). Earlier failed Gate B attempts also cleaned up; only the last completed result is the current qualification evidence.

## Blocked or not claimed

- A clean Gate B rerun after the calendar correction is blocked by the real field-start shift window on the current Saturday. The runner now fails early outside an eligible shift instead of fabricating a clock or field-start decision. Run it on the next eligible business shift.
- Full service employee authorization, job creation, post-reload My Work reconciliation, and the Gate B security matrix are not qualified by the last run.
- The historical sealed M1 `RUN-MANIFEST.json` and historical connected pilot provenance remain unavailable. The owned disposable tests do not reproduce that sealed historical environment.
- Approved staging migration/recovery, live commercial invitation delivery, and production readiness are separate release gates.
