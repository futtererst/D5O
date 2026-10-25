# Phase 2H-TD security results

Source baseline: `88381435a965050402dcd423b4856115246459a3`. Tests ran against a loopback-only disposable Supabase/PostgreSQL stack with real Auth identities, the local Next application, and the migration in this branch. The [targeted result](evidence/phase2htd-targeted-results.json) reports 60 passed, zero failed, and verified teardown. The [case register](evidence/phase2htd-closure-register.json) records individual actors, fixtures, expected outcomes, state assertions, and evidence.

## Corrected boundary

The customer API checked `connected_work` availability, but authenticated callers could invoke the public connected Operate, pricing, approval, or job RPC directly when the rollout flag was disabled. The local migration `20261025010000_d5o_phase2htd_connected_service_capability_boundary.sql` adds an authenticated tenant, membership, entitlement, and flag check to those authoritative RPC entry points. It also guards the trusted related-Work `create-job` command. The guard locks the relevant tenant and vendor decision rows during the protected transition. Existing business authorization, approval, idempotency, and audit commands remain the inner authority. No hosted migration was applied.

With the flag disabled, the service API returned HTTP 403 and each direct authenticated RPC returned SQLSTATE `42501`; the privileged service-role job RPC also returned `42501`. Tenant provisioning, organization and membership administration, configuration, and ordinary Work remained available under their own permissions. The final state showed no new service authorization, approval, or job from these denied commands.

## Identity and isolation

Suspended and removed users with existing sessions received HTTP 403 at the service API and `42501` at direct RPC where applicable. Their My Work queue became unavailable. A suspended tenant, disabled entitlement, and disabled flag each denied service authorization while leaving Operate revisions and job counts unchanged. A wrong-role field actor could not grant threshold approval (`42501`). A suspended former approver could not authorize new work using an existing approval (`23514`); its historical decision remained readable.

Both directions of the cross-tenant test returned HTTP 403 for approval, pricing, job and evidence adapters, and `42501` for direct approval, pricing and job RPCs. The foreign Operate revisions did not change. Forged or wrong child, parent Work, and evidence references were denied. There is no standalone public job-ID lookup in this connected-service contract; foreign job creation and Work access were exercised at the available authoritative boundaries.

## Financial decision and customer evidence integrity

- Currency change, revised amount, and changed scope did not reuse the prior threshold approval. Stale submissions returned `23514` or HTTP 409. Historical approval rows and configuration pins remained intact.
- Approval for another child or parent Work, an explicit rejected approval, and a revoked approver could not authorize a new request. No job was created by those attempts.
- Missing, deleted, forged, wrong-child, wrong-Work, and foreign-tenant evidence was denied. A retained PDF upload did not count as customer authorization. The denied attempts preserved the Operate revision and executable job count.
- Tenant A's USD 15,000 request under a USD 10,000 threshold required independent approval. Tenant B's identical amount under USD 25,000 required no threshold approval row. Each resulting job retained its tenant configuration pin.

## Pending-decision concurrency

The runner submitted genuinely concurrent pending requests, then queried the final ledger, revision, events and jobs. Conflicting pricing yielded one approved decision and one `23505` revision conflict, with one decision event. Approval versus rejection yielded one terminal state and one terminal event. Competing customer and service authorizations yielded one accepted effect and one conflict, with one authorization event. Concurrent executable job creation yielded one job ID and one executable job. Identical command ID and input returned the same receipt; a changed payload with the same ID returned `23505` without a second effect.

The tested endpoints, exact statuses, revision values, event counts, command IDs and synthetic record IDs are retained in [machine-readable evidence](evidence/phase2htd-targeted-results.json). The synthetic project and its containers were removed by the runner.
