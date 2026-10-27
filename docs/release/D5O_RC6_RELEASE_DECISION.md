# RC6 production migration decision

**NO-GO for production migration.** The user authorized a protected local copy and supplied a restricted direct PostgreSQL URI. The read-only client's direct DNS route failed, and no usable Session pooler connection or consistent copy was established. The 140 discrepancies remain unresolved at historical SQL/data level. Production was read-only throughout.

| Gate | Status | Evidence limit |
| --- | --- | --- |
| Actual production state reconstructed | BLOCKED | RC5 catalog and current aggregate sizing only; no historical copy |
| Historical SQL/effective-schema equivalence | PARTIAL | 109 SQL-text matches inherited from RC5; 58 differing texts and 10 legacy entries require retained SQL |
| Blocking discrepancies resolved | BLOCKED | 140 items remain open; static triage does not prove effects |
| Forward migration sequence tested | BLOCKED | No justified bridge or historical rehearsal |
| Historical records preserved | BLOCKED | No authorized copy was executed |
| Security invariants preserved | BLOCKED | Catalog snapshot only; no historical role/tenant tests |
| Coordinated recovery passed | BLOCKED | No database/Auth/private-object restoration |
| Remaining unknowns identified | PASS | Credential, checkpoint, ledger SQL, historical effects, permit data, object bytes and recovery |

Release stop conditions are listed in [the bridge plan](D5O_RC6_FORWARD_MIGRATION_BRIDGE.md). No hosted migration, ledger edit, Auth/Storage change, deployment, push, merge or billable infrastructure creation occurred. Formal product-owner acceptance of the delivery-change versus post-handover connected-service contract remains **DECISION REQUIRED**.

The single next action is to provide the D5O **Session pooler** URI in a restricted local file outside Git, then validate it with read-only commands and establish an isolated, consistent protected-copy method. The URI and all copied data must remain outside the repository.
