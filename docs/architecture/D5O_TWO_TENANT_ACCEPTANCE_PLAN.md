# D5O two-tenant acceptance plan

Baseline `origin/main` `4cf881b5`. **C** code/migration inspection; **T** existing test source, not a result; **R** actual runtime observation. This is an executable **design**, not a claim that the scenario passed.

## Current determination

**Cannot pass today.** `components/d5o/platform/work-types.ts:1` has only `rybex | rotork` [C]; `app/work/admin/[[...section]]/page.tsx:35-36` and `app/api/d5o-hosted/admin-configuration/route.ts:13` accept Rybex only [C]. The hosted configuration `save-policy` whitelist in `supabase/migrations/20261019213000_d5o_hosted_configuration_management.sql:179-223` has no service-work approval amount [C]. `lib/d5o/prototype-work/pricing-policy-command.ts` is a separate prototype policy path [C]. Existing pinned version and audit mechanisms are promising but do not demonstrate this monetary scenario (`components/d5o/platform/published-phase-configuration.ts:88-99`, hosted migration `:365-377`) [C].

## Fixture and setup

Run only against an isolated disposable Supabase project and a local app build using the same commit. Apply **committed** migrations in order and verify migration hashes/status. Disable outbound email/SMS/web push and use in-memory or sink adapters. Record project ref, build SHA, migration list and test-run ID. Create tenant A `rybex-acceptance` and tenant B `fictional-enterprise-acceptance` with distinct workspace IDs, both active; create admin, manager, approver and ordinary member for each, plus a user with no membership. Use unique work and evidence markers. Do not copy real customer records or modify production. See `scripts/qa-d5o-hosted-workspace-authority.sql` and `scripts/qa-d5o-connected-customer-integrity.mjs` [T source] for fixture/test patterns; create a dedicated new suite for this proof.

## Required execution order and expected results

| Step | Action | Required assertion/evidence |
|---|---|---|
| 1 | A and B admins authenticate and list their own workspace inventory. | Each sees only own workspace/user/config/work/evidence; unauthenticated and nonmember denied. |
| 2 | From same application build, A drafts threshold `USD 10000.00`; B drafts `USD 25000.00`. | Separate tenant draft IDs, expected active version, revision, admin actor and reason. Neither can read/edit the other's draft. |
| 3 | Validate then publish and activate each draft without code deployment. | Bounded validator accepts values; version IDs differ; active versions are unique per tenant; event/receipt has actor, membership, tenant, reason, before/after and command ID. |
| 4 | A and B each submit one `USD 15000.00` service-work request. | A receives `additional_approval_required`; B follows its configured path without A's extra approval. Both decision events cite their exact pinned version, amount in minor units and evaluated rule. |
| 5 | Try A actor against B record, config version, user, evidence object and search/export. Repeat with forged workspace ID and membership ID. | 403/404 or DB denial, no B bytes/metadata, no state or audit success event, no cached leak. Repeat B→A. |
| 6 | Retry a command with identical ID/payload, then same ID/different payload; submit stale expected revision/default. | Exact replay returns same receipt; altered replay and stale requests fail atomically. |
| 7 | Revoke A approver membership while session/token remains; retry pending approval. | DB command denies immediately; no decision event or work mutation. |
| 8 | Change A threshold in a later valid version, leaving old A request in progress. | New A work uses new version; old A work stays pinned to old version and retains its approval requirement. Historical event remains reproducible. |
| 9 | Roll back A's active policy to prior valid version for new work. | New A work follows restored policy; old work, decisions and event history are unchanged. B remains unaffected. |
| 10 | Exercise six-phase journey for each tenant and a restart/reload. | Discover → Define → Design → Develop → Deploy → Operate commands persist and enforce same tenant and version; evidence and approval gates cannot be bypassed. |

For every step, save HTTP request/response status, actor and membership IDs, workspace ID, configuration-version ID, work ID, DB query result, audit sequence and storage object inventory. Redact tokens and secret values. Use transaction-scoped cleanup or delete the disposable project after evidence capture. An unauthorized attempt must have **zero** successful state delta. A pass requires every expected assertion, not merely a green UI screenshot.

## Minimum code changes before execution

1. Complete P0 tenant-boundary inventory and negative suite in the roadmap; fix any observed isolation fault.
2. Extend the hosted version manifest and admin validator/command with bounded `serviceWorkApprovalThresholdMinor` and currency. Keep vendor ceilings and mandatory approval/evidence invariants.
3. Resolve customer admin workspace from authenticated membership and a verified tenant registry; gate rollout instead of removing pilot protections wholesale.
4. Add one authoritative server service-work decision command using the work record's exact pinned hosted version, immutable decision event and idempotent receipt.
5. Add tenant-safe fixture/provisioning and rollback path for the disposable test, plus focused regression tests for Rybex/Rotork.

Existing sources `scripts/qa-configuration-publication.mjs`, `scripts/qa-configuration-admin-api.mjs`, `scripts/qa-published-phase-contract.mjs` and `scripts/qa-phase-contract-activation.mjs` [T source] test related legacy/prototype behavior; they are not a substitute for the hosted scenario. No production data is needed. No runtime infrastructure for a second commercial tenant was made available to this assessment.
