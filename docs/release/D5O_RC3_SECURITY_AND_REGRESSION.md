# RC3 security and integrated regression

## Executed local result

Final machine result: [`evidence/D5O_RC3_TWO_TENANT_BROWSER.json`](evidence/D5O_RC3_TWO_TENANT_BROWSER.json), **61 passed / 0 failed**, no setup error. The same disposable run exercised vendor provisioning, tenant administration, published configurations, Discover through Operate, child connected service, My Work, tenant isolation, evidence authorization, phase projection and Finance follow-up. Authenticated browser business actions are distinct from fixture provisioning and negative API/direct-RPC probes in the result.

The negative probes returned authoritative denials and verified unchanged protected state for foreign tenant Work/tasks/evidence; wrong-role Design, service, Deploy and Operate decisions; suspended/removed membership; stale field-worker session; disabled feature; suspended tenant; forged Work/package/evidence identifiers; stale revisions; invalid configuration versions; and duplicate/conflicting service commands. Concurrent identical provisioning returned one tenant. Concurrent Design release replay returned the same accepted result. Concurrent conflicting crew demand returned one success and one conflict. Post-job replay and concurrent create-job probes left exactly one job per request. Private evidence access rechecked tenant lifecycle, membership and rollout state.

The source configuration pin remained `0ba93294-6946-4905-a425-88787cc467be` for A and `b7528296-5063-44a6-9835-2c97116a0cc1` for B even after a new policy version was published. Cross-tenant phase projection access returned `phase_status_forbidden`; event replay matched both stored projections. Audit checks retained tenant, Work and actual actor references. The runner restored its synthetic project: `stopExit: 0`, project directory absent, no residual containers, `clean: true`.

## Code and migration gates

| Gate | Result |
| --- | --- |
| TypeScript (`npm run typecheck`) | PASS |
| ESLint (`npm run lint`) | PASS |
| Production build (`npx next build --webpack`) | PASS: compiled, TypeScript, 45 static pages and build traces completed. Webpack was needed in this checkout because Turbopack could not resolve `next` through the local dependency junction. |
| Migration verifier (`scripts/p0a/verify-phase2hvc-migrations.mjs`) | PASS: 235 ordered executable files; all 234 historical SHA-256 checksums match. Forward Operate migration `20261027085730_d5o_operate_acceptance_one_time_guard.sql` SHA-256 `d0ec41ca79f9adbc5a95d3ce814fbf1ce7a8c615ec1ec3d021e686f8edf35bd1`. |
| Disposable schema and integrated suite | PASS: full local fixture reached all 61 checks; cleanup verified. |

Earlier attempts exposed test-harness integration faults: offer draft endpoint selection, replacement worker tab after reassignment, shared configuration draft selection, ambiguous selector, and a click before React hydration. Each was corrected and the full run was repeated; none is counted as a passing security denial. Two read-only handoff page reloads are recorded under `navigationRetries`. The final result contains no failed checks. Hosted staging, historical hosted migration equivalence, coordinated private-object recovery and commercial email delivery remain separate release gates.
