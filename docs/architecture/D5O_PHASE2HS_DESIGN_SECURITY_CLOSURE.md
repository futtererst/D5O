# Phase 2H-S Design security closure

Gate A passed in the owned disposable runtime: 37 checks passed, none failed, and teardown verified. The executable entry point is `node scripts/p0a/run-phase2hs-design-gate.mjs`; raw results are in `evidence/phase2hs-design-gate-results.json`.

| Previously open category | Actual result | Correction |
| --- | --- | --- |
| Invalid private PDF references | Nonexistent, other-package/document, other-tenant/Work, and raw Storage objects without an evidence receipt returned HTTP 422; issue before review returned RPC `42501`. After object deletion, private GET returned 404 and review returned `23514`; Design revision stayed 29. | The private route now verifies object bytes against the registered size and SHA-256 on each read. Existing review and issue RPC checks remain authoritative. |
| Concurrent conflicting Design writes | Two distinct demand decisions against the same revision returned `[200,409]` for A and `[200,409]` for B. One revision won; the losing command did not create a second accepted event. | Existing transactional revision compare and receipt semantics were retained. |
| Disabled feature direct RPC | With `connected_work` disabled for an otherwise authorized member, the API returned 403 and direct Design draft RPC returned `42501`, with unchanged Design revision. | Local migration `20261024105438_phase2hs_connected_design_capability_gate.sql` adds a non-exposed mutation guard to connected Work and Design state. |

The same run denied cross-tenant Design API access (403), forged Work (404), wrong-role reviewer (403), stale revision (409), suspended/removed membership (403), and suspended tenant (403). Both tenants completed browser Design release and independent receipt. Pilot workspace guards were retained. No hosted migration or production change was made.
