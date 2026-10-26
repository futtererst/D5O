# Phase 2H-S two-tenant results

The Gate A and Gate B disposable runs each provisioned `tenant_a_test` and `tenant_b_test` through the same vendor command and application code, accepted tenant-bound invitations, published separate configuration versions, and cleaned their synthetic projects. Gate A: 37 passed, 0 failed. Gate B: 40 passed, 0 failed. Both report `cleanupVerified = true` in their JSON evidence.

| Scenario | Rybex Test, Tenant A | Independent Enterprise Test, Tenant B |
| --- | --- | --- |
| Published service threshold | USD 10,000 | USD 25,000 |
| Equivalent synthetic request | USD 15,000 | USD 15,000 |
| Expected Phase 1B threshold decision | Additional approval required | No additional threshold approval |
| Define policy | Risk narrative required and checked | Optional additional narrative |
| Design | Private document issued, independently reviewed, package released and accepted | Same authoritative sequence, independently scoped |
| Develop commercial authority | Separate project-manager submission and administrator approval | Separate project-manager submission and administrator approval |
| Develop crew | Qualified booking, publication, exact worker acknowledgment | Qualified booking, publication, exact worker acknowledgment |
| Field start | Operations authorized through browser | Operations authorized through browser |
| Persisted position | Develop completed; Deploy current; replay matched | Develop completed; Deploy current; replay matched |

The Gate B browser sequence records one connected Work and accepted package per tenant. Each action receipt includes its own configuration pin and actor. The strict and optional service threshold decisions are retained from the Phase 1B approval suite; Gate B publishes both thresholds but does not create child service jobs through its browser journey. Do not interpret its field-start permit as proof of child service-job creation.

The browser and direct-command security checks deny cross-tenant Work access, forged Work identifiers, stale schedule revisions, a disabled `connected_work` flag, and unauthorized field start. Gate A additionally denies invalid or deleted private PDF references and a concurrent conflicting Design write. The local disposable fixture teardown is independently reported by the harness; no hosted or production environment was changed.

The final inherited Phase 2G connected journey also passed 48/48 assertions with cleanup. It verifies that the new connected-only guards preserve downstream Deploy and Operate command progression, audit history, phase projection, and tenant-neutral API checks. Those transitions were exercised by its authenticated fixture and RPC/API paths, not by the Phase 2H-S employee browser controls.
