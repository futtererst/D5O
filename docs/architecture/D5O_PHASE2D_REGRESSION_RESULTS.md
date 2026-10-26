# Phase 2D regression results

The inherited suites ran sequentially against separate disposable local Supabase projects on the Phase 2D worktree. Machine-readable output, environment IDs, and per-suite cleanup results are under `evidence/phase2d-regressions/`. The Phase 2C compatibility rerun is `evidence/phase2d-phase2c-compatibility.json`.

| Suite | Passed | Failed | Cleanup |
| --- | ---: | ---: | --- |
| Phase 1 configuration and service approval | 18 | 0 | Verified |
| Phase 1B connected service approval | 13 | 0 | Verified |
| Phase 2A organization and access | 11 | 0 | Verified |
| Phase 2B onboarding and provisioning | 18 | 0 | Verified |
| P0-A tenant isolation | 16 | 0 | Verified |
| Phase 2C compatibility on Phase 2D migrations | 23 | 0 | Verified |

The Rybex/Rotork published phase-contract check, phase-configuration check, and scanner invariant check all exited 0. TypeScript `tsc --noEmit`, focused ESLint and JavaScript syntax checks passed. The Phase 2D two-tenant suite's final result is recorded separately in `D5O_PHASE2D_TWO_TENANT_RESULTS.md`.

One initial Phase 2D diagnostic run recorded two failures: the service template omitted a selected policy key, and enabling Tenant B's entitlement for a policy test conflicted with a later disabled-feature browser assertion. The migration now inserts the supported boolean key and validates its type; the test restores Tenant B's entitlement boundary before that browser assertion. The subsequent Phase 2D run passed 27/27 with cleanup.

**Blocked and not counted as passes:** the three historical M1 configuration scripts still require the sealed project-bound `RUN-MANIFEST.json`, ownership hash, and original isolated resources; the historical connected pilot scripts require their owned fixture; the complete six-phase pilot and commercial-customer journeys were not executed. The five Phase 2D policy consumers were not all advanced through valid positive business transitions. These are release gates, not green tests.

No hosted migration, production data change, production readiness setting change, deployment, push, or merge occurred.
