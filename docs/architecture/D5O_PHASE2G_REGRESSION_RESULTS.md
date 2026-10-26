# Phase 2G regression results

Source baseline: Phase 2F `dae8e1fa975bc47ef6d1180b512399683e3c9613`. Results refer only to the disposable local environment.

| Check | Result | Evidence |
| --- | --- | --- |
| Existing Phase 2F journey with new migration | Passed 45/45 | Local console run before Phase 2G assertions |
| Phase 2G connected fixture | Passed 48/48, cleanup verified | `evidence/phase2g-two-tenant-results.json` |
| TypeScript | Passed | `npm run typecheck` |
| ESLint | Passed | `npm run lint` |
| Production build | Passed with Webpack | `npm run build -- --webpack` (worktree uses a dependency junction) |
| Phase 1 | First setup blocked; standalone retry passed 18/18 with cleanup | `evidence/phase2g-regressions/phase1.json`, `phase1-retry.json` |
| Phase 1B | Passed 13/13 with cleanup | `evidence/phase2g-regressions/phase1b.json` |
| Phase 2A | Passed 11/11 with cleanup | `evidence/phase2g-regressions/phase2a.json` |
| Phase 2B | Passed 18/18 with cleanup | `evidence/phase2g-regressions/phase2b.json` |
| Phase 2C | Passed 23/23 with cleanup | `evidence/phase2g-regressions/phase2c.json` |
| Phase 2D | Passed 27/27 with cleanup | `evidence/phase2g-regressions/phase2d.json` |
| P0-A | Passed 16/16 with cleanup | `evidence/phase2g-regressions/p0a.json` |
| Phase contract, configuration, scanner | Passed, exit 0 each | `evidence/phase2g-regressions/summary.json` |
| Original sealed M1 and historical connected pilot | Blocked | Original fixture provenance absent |
| Full UI-driven six-phase browser journey | Blocked | Missing customer action forms |

The sequential runner exited 1 because Phase 1's first local Supabase setup failed before assertions. Its standalone retry then passed 18/18. Both results are retained in `evidence/phase2g-regressions/qualification-summary.json`; neither is silently erased. The failed setup's temporary directory was absent after the attempt. Do not interpret browser readback as browser-driven progression. The standard Turbopack build cannot resolve `next` through this worktree's external `node_modules` junction; the Webpack build uses the same installed dependencies and is the local build check.

Cleanup was independently checked after all runs: `docker ps -a --filter name=d5o-p0a` returned no containers. The final connected fixture also reported `projectDirectoryAbsent=true` and `residualContainers=[]`.
