# RC7 production migration decision

**Overall: NO-GO for production migration.** The protected copy and local recovery are materially stronger than RC5/RC6, but a real historical row blocks migration 215. Production remained read-only; no production migration, Auth/Storage mutation, deployment, push, merge, hosted project or billable resource was performed.

| Gate | Decision | Evidence |
| --- | --- | --- |
| Production connectivity and identity | PASS | Session pooler, PostgreSQL `170006`, database `postgres`, TLS, 177-row ledger, explicit read-only transactions |
| Protected database/Auth/Storage copy | PARTIAL | Encrypted archives and 23 private hashes pass; no atomic cross-service checkpoint; Auth secrets excluded |
| Historical local restore | PARTIAL | Schema/data/relationships restored; 763 FKs valid; Auth sign-in and Storage serving untested |
| 140 discrepancy resolution | PARTIAL | Four SQL-formatting items proved; 54 SQL differences, 44 early effects, 19 remaps, 10 legacy effects remain material |
| Exact forward bridge | NO-GO | Order 215 rejects one completed historical field-worker invitation |
| Historical upgrade | NO-GO | Cumulative probe stops at 215; 216–236 untested on actual historical starting state |
| Historical permit selection | PARTIAL | Six single-permit groups; no multi-permit case |
| Security invariants after upgrade | BLOCKED | Upgrade did not complete; restored RLS/FK counts alone are insufficient |
| Recovery | PARTIAL | Fresh local DB/Auth/metadata/hash recovery in 48.4 seconds; Storage API serving and coordinated checkpoint unproven |

Immutable references: frozen application `8b6b0d9e4aa484d0f0db1d075a969b79e01b0989`, frozen source/evidence `dcb72a3868e48d536449e109872403974b79fa1b`, RC5 evidence `a674bf6ba113b31310428bc9ab79564642542bbe`, RC6 starting point `77f520d625515ad32edb2a32913f96a9b89fb18d`. Delivery-change versus post-handover connected-service contract acceptance remains **DECISION REQUIRED**.

The next release-critical action is a narrowly reviewed forward compatibility design for the historical completed field-worker invitation and a full 54-SQL-difference/effect mapping. Only after that bridge is executable should the 25 late migrations be rehearsed and security/recovery gates repeated. The encrypted protected checkpoint remains outside Git under restricted local access pending authorized continuation or secure disposal.

Cleanup: both disposable PostgreSQL containers and their anonymous volumes were removed; zero RC7 containers remained. The encrypted checkpoint remains outside Git with an ACL limited to the local user and SYSTEM. See [cleanup verification](evidence/D5O_RC7_CLEANUP_VERIFICATION.json).
