# Phase 2H-T Develop security closure

## Boundary

The existing hosted tenant configuration, crew schedule, workforce profile, membership and field-start commands remain authoritative. The local migrations in this branch add a qualification-expiry attribute to the existing workforce profile and enforce its validity for the entire scheduled shift. The guard runs both in the public crew command and at the schedule-state write boundary in the same database transaction. No published Work configuration or historical decision is rewritten.

The workforce expiry command requires an authenticated tenant administrator, an active membership, the expected profile revision and a unique command ID. It records the actor and prior value in the existing workforce audit stream. A missing expiry on a historical qualification retains the prior behavior until the administrator supplies a date.

The employee schedule read now omits superseded weekly publications from actionable assignments. Historical publications remain in the schedule state for audit. The original function OID applies the same filter for callers with a cached PostgREST plan.

The Develop action and authority HTTP adapters reject client-supplied configuration or policy version IDs. The business commands continue to resolve the Work pin server-side.

## Executed adversarial cases

The disposable Gate A runner exercises expired and valid qualifications, two concurrent conflicting bookings, suspended and removed field membership, tenant suspension, reassignment and a stale browser session, unknown/foreign/draft configuration versions, a forged client version, direct RPC and API bypasses, and unchanged state after denial. The separate approval runner exercises changed amount and scope against the existing Phase 1B approval, authorization and job commands.

Machine-readable evidence: `evidence/phase2ht-gate-a-results.json` and `evidence/phase2ht-approval-gate-results.json`. The Gate A script retains its original failing expiry assertion and now passes after the correction. Both scripts create and clean their own isolated Supabase projects.

## Migration and rollback

The two local migrations are `20261024150000_phase2ht_workforce_qualification_expiry.sql` and `20261024151000_phase2ht_current_worker_assignment.sql`. Apply only after approved staging rehearsal. Forward recovery is preferred once expiry values have been written: disable the new trigger and restore the preceding function bodies only after verifying no active booking relies on an expiry denial. Preserve the new JSONB values and historical audit records. No hosted or production migration was applied in this package.
