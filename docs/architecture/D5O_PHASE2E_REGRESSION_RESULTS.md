# Phase 2E regression results

Primary executable fixture: `scripts/p0a/run-phase2e-connected-journey.mjs`; machine-readable result: `evidence/phase2e-connected-journey-results.json`. Final run: **35 passed, 0 failed, cleanup verified**. The fixture records each command-level check and independent cleanup verification. The combined `evidence/phase2e-regressions/manifest.json` lists inherited suites and blocked claims.

The inherited suites ran separately against disposable projects. The confirmed results so far are:

| Suite | Passed | Failed | Cleanup |
| --- | ---: | ---: | --- |
| Phase 1 configuration/approval | 18 | 0 | Verified |
| Phase 1B connected approval | 13 | 0 | Verified |
| Phase 2A organization/access | 11 | 0 | Verified |
| Phase 2B provisioning | 18 | 0 | Verified |
| Phase 2C lifecycle/features | 23 | 0 | Verified |
| Phase 2D configuration policies | 27 | 0 | Verified |
| P0-A tenant isolation | 16 | 0 | Verified |

The Rybex/Rotork published phase-contract, phase-configuration, and scanner invariant scripts exited 0. See `evidence/phase2e-regressions/` for machine-readable exit codes, test counts, and cleanup status. Do not infer a pass from an unexecuted or blocked historical test.

The original sealed M1 `RUN-MANIFEST.json` and historical connected pilot dependencies remain absent. The complete pilot journey and authenticated Operate UI journey are not qualified by this package. TypeScript `tsc --noEmit`, focused ESLint, and JavaScript syntax checks exited 0.
