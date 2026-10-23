# Phase 2C tenant lifecycle

The existing `tenant_provisioning` row remains authoritative for newly provisioned tenants. Phase 2C adds vendor-only `active → suspended → active` transitions with expected revision, idempotency key, reason, receipt and `platform_events` audit. Existing pilots have no provisioning row and are not eligible for these commands.

Suspension also changes the hosted workspace status to `disabled`. Existing commands requiring an active workspace reject the same signed-in session immediately. Triggers on hosted Work, prototype state and service approval request mutations check the provisioning lifecycle as a database backstop, including service-role and background writes. Customer operational mutation is blocked; vendor directory, audit, capability changes and reactivation remain available. Customer read routes that require an active workspace may also be unavailable during suspension.

Reactivation requires the suspended state, matching revision, no provisioning failure, at least one active tenant administrator and an active published configuration. It restores workspace status and lifecycle in the same transaction. It does not change any membership or role. A revoked administrator therefore remains revoked. Duplicate command IDs return the recorded receipt; stale and concurrent transitions fail.

Migration `20261023150000_d5o_phase2c_lifecycle_features.sql` is forward-only. In an isolated staging rehearsal, rollback is an audited reactivation for suspended tenants, followed by forward correction. Dropping the migration while tenant states exist is unsafe; restore from the pre-migration backup only under an approved outage and retention plan. No hosted migration or production state was changed in this package.
