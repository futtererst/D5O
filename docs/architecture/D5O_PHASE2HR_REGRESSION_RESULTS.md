# Phase 2H-R regression results

All database suites below ran against disposable local Supabase projects and reported clean teardown. Machine-readable copies are in `evidence/phase2hr-inherited/`; the source wrapper result, including its captured stdout and stderr, is `evidence/phase2hr-inherited/summary.json`.

| Suite | Initial run | Final finding |
| --- | --- | --- |
| Phase 1 configuration | 18 passed, 0 failed | Passed. |
| Phase 1B approval | 13 passed, 0 failed | Passed. |
| Phase 2A organization/access | 11 passed, 0 failed | Passed. |
| Phase 2B onboarding | 18 passed, 0 failed | Passed. |
| Phase 2C lifecycle/features | 22 passed, 1 failed | The new automatic Work-creation redirect replaced the confirmation expected by its browser check. The redirect was removed; the focused rerun passed **23/23** with clean teardown. Both results are retained as `phase2c.json` and `phase2c-corrected.json`. |
| Phase 2D configuration | 27 passed, 0 failed | Passed. |
| P0-A isolation | 16 passed, 0 failed | Passed. |

The current Phase 2H-R runner also exercises the inherited connected Phase 2E–2H progression, cumulative Define browser actions, tenant-neutral Work access, and the new Design browser sequence. Its authoritative result is `evidence/phase2hr-design-browser-results.json`. These are scenario assertions, distinct from the employee action coverage numerator in `D5O_PHASE2HR_ACTION_INVENTORY.json`.

TypeScript, full ESLint, and the Next.js production build passed after installing the lockfile dependencies inside the isolated worktree. Turbopack initially failed on the borrowed `node_modules` junction and on sandboxed junction creation; the actual build passed with a private install and local build privilege. Published phase-contract, phase-configuration and scanner-invariant checks all passed. The scanner check continues to report unsupported readiness modes as blockers, rather than changing production settings.

**Blocked historical claims:** the original sealed M1 `RUN-MANIFEST.json` and original connected pilot fixture remain unavailable. The disposable replacement suites do not reproduce their provenance. No blocked test is counted as passed. No production migration, deployment or configuration change occurred.
