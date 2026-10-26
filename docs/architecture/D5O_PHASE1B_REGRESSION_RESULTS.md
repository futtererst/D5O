# Phase 1B regression results

All runtime tests used unique disposable loopback Supabase projects. Each project was stopped and removed; the test JSON records cleanup. No hosted migration or production data was touched. Source branch descends from Phase 1 commit `7b8a629d57f4652acd7545ac244555e228a563d4`; P0-A code is present through cherry-pick `541512a1` of `d54497f7` rather than direct ancestry.

## Passed

| Check | Result | Evidence |
| --- | --- | --- |
| Phase 1B two-tenant connected authorization, job, denial, stale scope, new scoped decision, concurrency, version pin and audit suite | 12/12, cleanup verified | [`phase1b-connected-results.json`](evidence/phase1b-connected-results.json) |
| Original Phase 1 tenant policy publication, Work-level decision, rollback and authenticated admin browser suite against the Phase 1B migration | 18/18, cleanup verified | [`phase1b-phase1-compat-results.json`](evidence/phase1b-phase1-compat-results.json); existing Phase 1 screenshots were restored after this compatibility run |
| P0-A hosted tenant isolation, role change/revocation, direct table privilege, API forgery and pilot allowlist suite | 16/16, cleanup verified | [`phase1b-p0a-runtime-results.json`](evidence/phase1b-p0a-runtime-results.json) |
| Rybex/Rotork published phase-contract checks | Passed | `node scripts/qa-published-phase-contract.mjs` |
| Phase configuration contracts | Passed | `node scripts/qa-phase-configuration.mjs` |
| Scanner readiness invariant and production configuration guard | Passed as local code/config checks; no production setting changed | `node scripts/p0a/verify-readiness-scanner.mjs`; `node scripts/verify-production-config.mjs` |
| TypeScript and ESLint | Passed | `npm run typecheck`; `npm run lint` |
| Optimized application build | Passed with `npm run build -- --webpack` | The worktree uses an existing dependency junction outside its root; default Turbopack package resolution failed in that setup. Webpack built all routes, including the changed approval route. |

## Blocked before assertions

| Script | Exact dependency |
| --- | --- |
| `qa-configuration-publication.mjs`, `qa-configuration-admin-api.mjs`, `qa-phase-contract-activation.mjs` | `scripts/m1/implementation-context.mjs:11` requires the untracked `artifacts/d5o-m1-s1-implementation-20260928T004316Z/domain-implementation-20260928-01/RUN-MANIFEST.json`. Its `boundary()` also requires original worktree identity, the fixed `rybex-cfg03-q-m1-s1-recovery-20260928` project, ownership hash and matching live Docker resources. The old provisioning script itself requires a previously sealed manifest. No safe self-contained fixture generator exists in this branch. |
| `qa-d5o-connected-service-job-pilot.mjs`, `qa-d5o-connected-service-basis-integrity.mjs` | Both require their fixed historical `127.0.0.1:56321` isolated pilot, `D5O_PILOT_CREDENTIALS_FILE` and its synthetic records. They stopped at `disposable_pilot_only`; neither executed assertions. The new Phase 1B suite exercises the changed authorization/job RPCs in a fresh project but is not a substitute for every old assertion. |
| `qa-d5o-work-record-journey.mjs` | Requires the missing M1 `FIXTURE-PLAN-8beb15ad.json`, private password file and fixed browser endpoint. It stopped before the six-phase journey. |

Copying a stale manifest from another worktree or inventing an ownership hash would not restore its bound project. These blocks prevent Phase 1B from being called QUALIFIED. The connected approval bypass checks passed, but the full supported pilot journey and changed Operate UI still need an authenticated browser regression. No blocked test is counted as passing.
