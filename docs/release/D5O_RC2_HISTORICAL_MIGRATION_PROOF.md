# D5O RC2 Track B — historical migration status

**Result: BLOCKED BY AUTHORIZATION AND SQL-EQUIVALENCE GAP.** No protected production-derived copy was authorized or created; no historical forward migration was applied. Production remains untouched.

The [RC1 ledger comparison](D5O_RC1_LEDGER_COMPARISON.json) observed 177 hosted entries versus 234 RC0 source files: 148 shared version/name entries, 19 possible remappings with no SQL equivalence proof, 10 unmatched legacy entries, and 86 source-only versions (63 from released source, 23 RC0 forward files). After accounting for potential remappings, 44 released-source versions still have no clear hosted counterpart. The [hosted statement hashes](D5O_RC1_HOSTED_LEDGER_STATEMENT_HASHES.json) hash ledger `statements[]`; the [RC0 manifest](D5O_RC0_MIGRATION_CHECKSUMS.json) hashes raw SQL file bytes, so those hash formats cannot by themselves prove equivalence. The actual hosted schema lacks 16 inspected persistence tables and the phase projection objects. A direct 234-file push is a stop condition.

## Exact investigation on an authorized protected copy

1. Capture database/ledger, Auth relationships and private object bytes together, with source timestamps, counts, object SHA-256, owner, bucket and path. Exclude production secrets; restrict access. Take a recoverable checkpoint and record the copy identity.
2. Compare the 148 shared entries and all 19 name-linked remappings by normalized SQL operations, object definitions, ownership, RLS, grants and `SECURITY DEFINER` search paths. Classify the 10 legacy entries and 44 unresolved released-source versions. Preserve the actual provider ledger; do not fabricate history.
3. Review new forward correction migrations for truly missing prerequisites. Do not edit historical applied migrations. Stop on unknown drift, duplicate version, missing prerequisite or unexplained data/permission change.
4. Apply reviewed bridge, then RC0 orders 212–234 only where proven compatible. Validate at organization/onboarding (214–218), lifecycle/configuration (219–223), phase projection (225), service identity (226–228), workforce/Develop (229–233) and final service boundary (234).
5. Compare Work pins, configuration versions, event/projection replay, approvals, receipts, audit, Auth/membership, evidence metadata and object bytes before and after. Exercise cross-tenant and revoked-member denials. Record exact resulting ledger and schema hashes.

RC1's [synthetic 211-to-234 upgrade](D5O_RC1_DISPOSABLE_UPGRADE.json) preserved fictional Work and records and cleaned up; it does not prove the divergent historical hosted state can be upgraded. Track B cannot pass until the protected copy and complete byte-level recovery rehearsal are authorized and executed.
