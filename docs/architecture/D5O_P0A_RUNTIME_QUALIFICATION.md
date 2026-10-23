# P0-A disposable runtime qualification

**R** is actual local execution; **C** is code/config inspection. Source baseline `84ad7057f1a0e87c7a7745d7d8bbd2ad229ee249`, branch `codex/d5o-p0a-tenant-qualification`. The final run started **2026-10-23 11:04:06 UTC** and ended **11:06:09 UTC** [R]. Exact sanitized results: [p0a-runtime-results.json](evidence/p0a-runtime-results.json). Reproduce with `node scripts/p0a/run-runtime-qualification.mjs`; the runner and setup/teardown are in `scripts/p0a/`.

## Environment and lineage

`scripts/p0a/disposable-runtime.mjs` creates a unique local Supabase project and Docker network, binds all 11 containers to `127.0.0.1`, applies the copied committed migrations, and verifies the target ID/port before fixtures or app calls [C,R]. Synthetic Auth users use `example.test`, randomized transient passwords, no outbound provider credentials, and A/B/nonmember/revoked/dual-member roles. The local Next.js app uses this same local Supabase URL and ephemeral keys; no production key is read into the test process. B's workspace key is `enterprise_test`, while A uses `rybex` to exercise the preserved pilot gate. The final project ID was `d5o-p0a-c043ded8-6ba` [R]. Cleanup used `supabase stop` exit 0; project directory absent, residual containers empty, dedicated network removed [R].

There were **212 local migration files and 211 applied versions**. Two filenames share prefix `0016`: `0016_p1_01b_2_bid_submission_outcome-ShawnT13.sql` and `0016_p1_01b_2_bid_submission_outcome.sql`. The disposable copy excludes the `-ShawnT13.sql` duplicate, and the test's exact *distinct version set* check passed [R]. Full source-file SHA-256 digest `ee8ab21b943c05325be25bf84c19cf6f05eeaa26a17fb0211549ebb8535f7eaf`; applied-version digest `95aaacc7587775598558637ae7bf64b0c0c2cb48c8efd12f12a3b813ef390859` [R]. A version-set match does not prove that the excluded duplicate SQL applied in any environment. Production migration lineage was unavailable.

## Executed results

**16 passed, 0 failed, 0 setup errors, cleanup verified** [R]. The named checks are in the JSON and mapped in [the test matrix](D5O_P0A_SECURITY_TEST_MATRIX.md). They include authenticated actor and nonmember denial, dual membership, direct work RLS/privilege checks, direct config/audit table denial, invalid token rejection, cross-work RPC, admin read/command permissions, replay and concurrent conflict, revocation and role change, direct Storage and signed URL expiry, Next.js API forged workspace/record denial, and pilot allowlist preservation. Same-tenant A and B hosted work reads succeeded. Cross-tenant assertions failed closed in these tested paths.

The fixture initially failed because the configuration manifest lacked a nonempty work-type entry; it was corrected to satisfy the existing DB validator before security assertions. An initial Storage test incorrectly treated `remove()`'s response as proof of deletion denial; the assertion now reads the service object after each attempted delete. The final run is the one reported above. These harness corrections did not weaken RLS or change production code.

Adjacent checks: `npm run typecheck` **PASS**; `node scripts/verify-foundation-0f-security.mjs` **PASS**; `node scripts/verify-production-config.mjs` **PASS**; `node scripts/p0a/verify-readiness-scanner.mjs` **PASS**; `node scripts/qa-published-phase-contract.mjs` **PASS** after its manifest fixture was brought into line with the existing active registry. `qa-configuration-publication.mjs`, `qa-configuration-admin-api.mjs`, and `qa-phase-contract-activation.mjs` were attempted but each stopped before assertions because their shared `scripts/m1/implementation-context.mjs:11` requires the untracked `artifacts/d5o-m1-s1-implementation-20260928T004316Z/domain-implementation-20260928-01/RUN-MANIFEST.json`, absent in this isolated checkout. They are **BLOCKED**, not passes. Targeted ESLint was attempted but interrupted after no output; no lint pass is claimed. No applicable full six-phase pilot journey was run.

## Limits and gates

The local Supabase stack exercises real PostgreSQL, Supabase Auth/Storage and the local Next.js API, but uses local development settings. It is not the production Vercel/Supabase deployment, and no production database migration/auth session was inspected. Evidence upload through the actual business API, every domain table, privileged service-role path, background retries, exports, support operations and the $10k/$25k approval policy are outside the final run. No production-equivalent scanner service was available.

| Gate | Result | Evidence / blocker |
|---|---|---|
| A readiness diagnosis | **PASS** | Four production 503 codes tied to absent named settings and fail-closed code; production remediation still blocked. |
| B complete boundary coverage | **FAIL** | Static candidate inventory exists, but live privileged paths lack complete manual authorization map and runtime negative tests. |
| C full two-tenant isolation | **FAIL** | 16 representative cases pass, but required business domains, API mutations, evidence business routes, all privileged RPCs and background/support paths are unqualified. |
| D pilot preservation | **PARTIAL** | Rybex/Rotork gates unchanged and tested B denial; focused security/phase tests pass. Three historical regression scripts blocked by missing artifact and no full business journey. |

**Overall: NO-GO for claiming P0-A commercial tenant qualification.** The disposable foundation is repeatable and useful, but Gate B/C coverage and Gate D regressions must close before P1 tenant-neutral rollout.
