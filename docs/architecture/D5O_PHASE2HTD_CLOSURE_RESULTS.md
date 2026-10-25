# Phase 2H-TD finite closure results

> **Phase 2H-TE follow-up (2026-10-25):** The TD finite register remains 43 PASS and one NOT APPLICABLE. Its separate inherited Gate B browser blocker is now closed by a 51/51 run with one persisted Work and one receipt per tenant after reload. See [TE results](D5O_PHASE2HTE_QUALIFICATION_RESULTS.md). The TD-era evidence below is retained unchanged as historical context.

Baseline: `88381435a965050402dcd423b4856115246459a3`. Implementation branch: `codex/d5o-phase2htd-security-closure`. The [machine-readable closure register](evidence/phase2htd-closure-register.json) retains the complete inherited Phase 2H-TC register and expands each local blocker into a stable atomic case with risk, target API/RPC, actor, fixture, expected and actual outcome, state-integrity assertion, status, and evidence. The original [TC register](evidence/phase2htc-closure-register.json) remains an immutable record of its earlier PARTIAL decision.

## Finite case matrix

| Gate | Case IDs | Disposition | Verification |
| --- | --- | --- | --- |
| Identity and feature authority | A01, A02, A03, A04, A05, A06, A07, A08, A09 | 9 PASS | Existing sessions, direct RPC, bidirectional tenants, wrong role, unrelated feature scope; denied mutations left revisions and job counts unchanged. |
| Approval and evidence integrity | B01, B02, B03, B04, B05, B06, B07, B08, B09, B10, B11, B12, B13, B14, B15 | 15 PASS | Currency, amount, scope, child/Work linkage, rejection, revoked approver, deleted/missing/forged/foreign evidence and retained-but-unaccepted PDF. |
| Pending concurrency and idempotency | C01, C02, C03, C04, C05, C06, C07 | 7 PASS | Concurrent pricing, customer authorization, approval versus rejection, service authorization and job creation; exact and conflicting command-ID replay. |
| Stale My Work | D01, D02, D03, D04, D05, D06, D07, D08, D09, D10 | 10 PASS | Other actor/session completion, stale membership/tenant/flag, changed amount/scope, existing job and completed URL. |
| Individual task reassignment | D11 | NOT APPLICABLE | This queue has no individual assignment or reassignment command; active role and membership determine responsibility. D01–D03 cover changed employee authority. |
| Final positive journey | R01, R02 | 2 PASS | Tenant A and B browser actions, threshold difference, exactly one executable job each, pinned configuration and authoritative task reconciliation. |

Thus 43 of 44 atomic cases passed and one is not applicable. No atomic case is pending or blocked. The targeted runner reported **60/60 test blocks passed** and verified synthetic cleanup. Test blocks include fixture setup, six-phase prerequisites, browser work, direct API/RPC probes, and the atomic cases. These are different counts and should not be added together.

The original TC register had 12 blocked grouped rows. Eleven map to the passing atomic cases. The remaining grouped row covers inherited administration and six-phase suites, tracked separately in [regression results](D5O_PHASE2HTD_RELEASE_DECISION.md) and the register. A standalone public job-ID lookup does not exist in the connected-service contract; job creation, foreign Work access, and resulting job identity were tested at their actual boundaries. Original sealed M1 provenance and historical connected pilot fixtures remain production-promotion dependencies, not synthetic local passes.

## Repeatability and evidence

Run `node scripts/p0a/run-phase2htd-closure.mjs` from the repository root with local Docker and Playwright available. The runner provisions two disposable tenants through the existing commands, uses actual Supabase Auth users, applies only local migrations, drives the local application, captures [authenticated screenshots](evidence/phase2htd-browser/), verifies final database state, and tears the project down. It writes [targeted JSON](evidence/phase2htd-targeted-results.json). Run `node scripts/p0a/write-phase2htd-register.mjs` afterward to update the finite register. The final JSON includes disposable project ID and port for provenance; both are destroyed after the run.

The fixed qualification clock exists only inside the disposable database. It does not alter production functions or business time. No hosted migration, production data change, deployment, push, or merge occurred in this package.
