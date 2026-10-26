# Phase 2H regression results

| Check | Current result |
| --- | --- |
| Phase 2H task-visibility assertions | Passed 8/8 with `node --experimental-strip-types scripts/p0a/verify-phase2h-task-visibility.mjs` |
| TypeScript | Passed with `npm run typecheck` |
| Full ESLint | Passed with `npm run lint` after the final browser-test changes |
| Production build | Passed with `npm run build -- --webpack` after granting local `.next` write access; first sandboxed attempt failed at `mkdir` before compilation |
| Inherited Phase 2G disposable fixture | Passed 48/48 on elevated local Docker rerun; synthetic cleanup verified. Current result in `evidence/phase2h-inherited-phase2g-results.json`. Initial sandbox attempt stopped before assertions because Docker access/cleanup identity could not be verified |
| Dedicated Phase 2H connected fixture | Passed 48/48 with browser-based Define review and handoff for both tenants; strengthened rerun asserts My Work appearance/removal and browser-origin 403 denials. Evidence: `evidence/phase2h-connected-journey-results.json` |
| Phase 1–2F and P0-A separate reruns | Not executed in this slice; inherited Phase 2G evidence is not a new pass |
| New Define API and browser decision journey | Define slice passed for two tenants; full six-phase browser journey not executed |
| Sealed historical M1 and connected pilot | Original fixtures unavailable |

The first fixture attempt overwrote its generated Phase 2G result path with a setup-error record. The successful elevated retry was retained in a Phase 2H-specific result before restoring the committed Phase 2G evidence. No blocked run is counted as passing. The source change is UI/API only and adds no migration.
