# Phase 2H-S regression results

All database runs used fresh loopback-only disposable Supabase projects and report teardown in their JSON summaries. The following are observed execution results, not inferred coverage.

| Suite | Final result | Evidence |
| --- | --- | --- |
| Design Gate A, two-tenant authenticated browser and security | **37 passed, 0 failed**, cleanup verified on the final narrowed-trigger migration | `evidence/phase2hs-design-gate-results.json` |
| Develop Gate B, two-tenant authenticated browser and security | **40 passed, 0 failed**, cleanup verified with final UI and negative cases | `evidence/phase2hs-develop-gate-results.json` |
| Phase 1 service configuration | 18 passed, 0 failed | `evidence/phase2hs-inherited-initial.json`, copied suite result |
| Phase 1B connected approval and job | 13 passed, 0 failed, cleanup verified | `evidence/phase2hs-inherited-initial.json`, copied suite result |
| Phase 2A organization and access | 11 passed, 0 failed | `evidence/phase2hs-inherited-initial.json`, copied suite result |
| Phase 2B onboarding | Initial inherited sweep: 17 passed, 1 failed due an overbroad new generic Work trigger. After narrowing it, targeted rerun: **18 passed, 0 failed**, cleanup verified. | `evidence/phase2hs-inherited-initial.json`; `evidence/phase2hs-phase2b-rerun.json` |
| Phase 2C lifecycle and feature management | Initial inherited sweep: 21 passed, 2 failed for the same generic Work trigger. After correction, targeted rerun: **23 passed, 0 failed**, cleanup verified. | `evidence/phase2hs-inherited-initial.json`; `evidence/phase2hs-phase2c-rerun.json` |
| Phase 2D phase configuration | 27 passed, 0 failed | `evidence/phase2hs-inherited-initial.json`, copied suite result |
| P0-A isolation | 16 passed, 0 failed | `evidence/phase2hs-inherited-initial.json`, copied suite result |
| Phase 2G connected journey, including Phase 2F Deploy/Operate and phase projection | **48 passed, 0 failed**, cleanup verified after the connected-only Saturday overnight fixture correction | `evidence/phase2hs-phase2g-rerun.json` |
| Published phase contract, phase configuration, scanner invariant | All exited 0 | `evidence/phase2hs-inherited-initial.json` |
| My Work task derivation | Develop 10 assertions; Design 14; Define visibility 15; Define draft 13. All passed. | Executable `scripts/p0a/verify-phase2hs-develop-tasks.mjs` and inherited verification scripts |
| TypeScript, ESLint, optimized Next build | **All passed on final code.** An initial sandbox build was blocked by Windows junction permission; the elevated local build passed. | Command output; build route list includes both new Develop APIs and employee assignment page |

The initial inherited sweep exited nonzero and remains in the record. It exposed a real regression: the first capability migration also guarded the generic `work_records` and shared `prototype_states` tables. These serve older Work commands before `connected_work` is granted. The migration now guards connected decision tables only; the connected create RPC retains its existing capability check. Phase 2B/2C targeted reruns passed on this correction. The initial failure is not erased or counted as a pass.

The first Phase 2G rerun stopped before assertions because the inherited fixture required a business-day field start and the local date was Saturday. Its fixture now uses a real, active Friday overnight booking, consistent with the connected field-start command. The final 48/48 run covers downstream Deploy and Operate RPC transitions, projection replay, audit and tenant-neutral API checks. It does not constitute an authenticated employee browser journey through Deploy and Operate.

The original sealed M1 `RUN-MANIFEST.json`, historical connected pilot fixture, full employee Deploy/Operate browser sequence, approved staging recovery, and live commercial invitation delivery remain blocked or outside this package. They are not counted as passed. The static pilot phase-contract checks passed, but they do not reproduce the sealed historical environment.
