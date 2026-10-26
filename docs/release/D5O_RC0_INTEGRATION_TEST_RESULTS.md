# D5O RC0 integration test results

Application commit: `3710ecace04e54769b5761da83f12594562e95b3` on `codex/d5o-rc0-integration`, with parents `origin/main` `4cf881b5` and local development tip `9a088699`. The authoritative machine summary is [D5O_RC0_INTEGRATION_RESULTS.json](D5O_RC0_INTEGRATION_RESULTS.json).

## Passed on the combined candidate

| Check | Result | Evidence |
| --- | --- | --- |
| `npm ci --no-audit --no-fund` | PASS; 530 packages | Lockfile install in the isolated worktree. |
| `npm run typecheck` | PASS | TypeScript exit 0. |
| `npm run lint` | PASS | ESLint exit 0. |
| `npm run build` | PASS | Next.js 16.4.2 compiled; 45 static pages and new dynamic hosted routes generated. |
| `npm run verify` | PASS | Full repository verifier; 28 legacy route smoke checks returned HTTP 200. |
| Published phase contract | PASS | Tenant isolation, pins, six-phase labels, protected rules, malformed version fail-closed. |
| Readiness scanner invariant | PASS | Unsupported scanner modes remain blockers. |
| Fresh disposable migration stack | PASS | 234 included migrations started under isolated project `d5o-p0a-9c3ec071-2e1`; teardown clean. |
| Released-main forward upgrade | PASS for seeded historical records | [Upgrade machine result](D5O_RC0_UPGRADE_SMOKE.json): started from 211 main migrations, retained fictional tenant, published configuration version, pinned Work, event and receipt; applied 23 pending versions in order; identity, pin and counts unchanged; teardown clean. |
| Integrated two-tenant browser | **47/47 PASS**, 0 FAIL; teardown verified | [Full machine result](../architecture/evidence/phase2hu-two-tenant-results.json), refreshed from the integrated worktree on 2026-10-26. It includes platform onboarding, independent tenant configuration and policies, Work/Define/Design/Develop, published crew, field execution, private evidence, review, two customer acceptances, Operate handoff, phase pins, audit and cross-tenant denials. |
| Tenant organization/people | **11/11 PASS**, 0 FAIL; teardown verified | [Machine result](../architecture/evidence/phase2a-two-tenant-results.json), rerun on the integrated tree. |
| Connected-service security closure | **60/60 PASS**, 0 FAIL; teardown verified | [Machine result](../architecture/evidence/phase2htd-targeted-results.json), rerun on the integrated tree; includes pending service decisions, evidence scope, stale tasks and command receipts. |
| Tenant-neutral Work and phase replay | **48/48 PASS**, 0 FAIL; teardown verified | [Machine result](../architecture/evidence/phase2g-two-tenant-results.json), rerun alone after the contention attempt; includes browser Work creation, phase projection/replay and cross-tenant denial. |
| Deploy integrity closure | **47/47 inherited checks and 8/8 finite integrity cases PASS**; teardown verified | [Machine result](D5O_RC0_DEPLOY_INTEGRITY.json): suspended and removed worker denial, wrong Work/package and forged evidence denial, conflicting review serialization, concurrent completion, deleted evidence denial, simultaneous scoped and whole-Work acceptance, and exact/conflicting replay. |

The browser runner used actual local Supabase Auth sessions, an isolated Supabase stack, and a local Next.js server. Both tenants were fictional. Its final machine result records `baseline: 3710ecace04e54769b5761da83f12594562e95b3`, the integrated application commit.

## Failed checks

`node scripts/verify-configuration-foundation.mjs` failed in its `verify-no-regression` document assertions: missing historical P1-01B.1/P1-01B.2 accepted-baseline markers and three expectations in `docs/recommended-next-implementation.md`. The migration-order, schema, RLS and effective-resolution static subchecks passed. The five failures concern legacy document expectations; this run is still recorded as failed. It is not evidence that integrated business commands passed those assertions.

An initial Phase 2G replay attempt was started concurrently with Phase 2H-TD in the same checkout. Its Next.js server could not acquire the shared development-server state (`next_start_timeout`), and it finished 34 PASS / 14 FAIL with clean teardown. The [failed attempt](D5O_RC0_PHASE2G_CONTENTION_ATTEMPT.json) is retained. The subsequent isolated 48/48 pass above qualifies the candidate for this gate.

The first Deploy integrity probe finished 44/47 because its acceptance test omitted `turnoverId`; both protected RPCs denied the invalid request. The [failed probe](D5O_RC0_DEPLOY_INTEGRITY_FIRST_ATTEMPT.json) is retained. The corrected fixture passed 47/47 plus all eight finite cases on a clean disposable stack. No application or SQL change was required.

## Separate staging and production gates

- The seeded upgrade covers Work/configuration pins and one event/receipt. It does not include every historical private evidence object or a hosted data copy.
- Hosted production migration ledger and staging data-copy compatibility were not read or mutated; no approved isolated staging copy was identified for this run.

Historical Phase 1–2H-U test files remain in `docs/architecture/evidence/`, but they are not substituted for the new integrated browser run above.
