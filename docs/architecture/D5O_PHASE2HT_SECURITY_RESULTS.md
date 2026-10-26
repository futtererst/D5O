# Phase 2H-T security results

Gate A: `evidence/phase2ht-gate-a-results.json` records 42 passes, zero failures, no setup error, and verified cleanup. It covers expired qualification versus valid qualification, conflicting concurrent booking, stale assignment publication, suspended/removed worker and tenant denial through browser/API/RPC, forged configuration references, and feature-scope denial while unrelated administration remains functional. The browser images are under `evidence/phase2ht-gate-a-browser/`.

Service approval integrity: `evidence/phase2ht-approval-gate-results.json` records 14 passes, zero failures, and verified cleanup. The authoritative approval and job guards reject stale amount/scope and revoked authority; historical decisions remain retained.

Gate B retains inherited cross-tenant connected Deploy and Operate RPC denials and phase-projection checks in `evidence/phase2ht-gate-b-results.json`. Its service-specific browser/API security matrix did not run to completion after triage failed. Those cases remain blocked, even though Gate A and the Phase 1B RPC suite pass. No transport error is counted as an authorization denial.
