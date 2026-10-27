# RC8 release decision

**RC8 overall: PARTIAL. Production migration: NO-GO pending history/effective-schema and coordinated-recovery proof.** The migration-215 defect is explained and corrected in an auditable local bridge. The actual production-derived copy completed all 25 pending migrations with unchanged targeted history and focused security checks. Production remained read-only.

| Gate | Result |
| --- | --- |
| Migration 215 root cause | PASS — valid prior pilot field-worker proposal rejected by new global role check |
| Compatibility policy | PASS locally — preserve completed history; pilot-only guard for future proposals |
| Exact auditable bridge | PASS locally — pre/frozen/post in one transaction, all three texts in actual ledger, private receipt |
| Historical 25-file upgrade | PASS locally — 177 to 202 actual ledger entries, source 212–236 executed |
| Historical data integrity | PASS for tested counts/hashes — 259 prior table counts and ten targeted hashes unchanged; 814 FKs valid |
| RLS and privileged access | PARTIAL — bridge and focused tenant/revocation checks pass; full effective-schema equivalence remains open |
| Private evidence associations | PASS for 23 copied objects and restored metadata/hashes; API serving untested |
| Database/object recovery | PARTIAL — pre/post isolated restores pass; no atomic production checkpoint or Storage API serving proof |
| Historical migration equivalence | PARTIAL — 58 hosted-linked SQL formatting differences proved equivalent; 44 early effects, 19 remap treatments and 10 legacy effects remain |

The [disposition register](evidence/D5O_RC8_DISCREPANCY_DISPOSITIONS.json) tracks every RC7 discrepancy. The 25 late versions are genuinely executed only in the local copy. All 58 previously differing hosted-linked SQL texts have operator-sensitive token equivalence evidence (42 same-version, 16 remapped); three other remaps have line-ending SQL proof. All 19 remaps still need a version-aware production executor policy. No hosted history was fabricated.

Source anchors: frozen application `8b6b0d9e4aa484d0f0db1d075a969b79e01b0989`; RC7 evidence `c5a8d46dc5859b34fed946f904c89aff7195e25c`; frozen 236-file manifest and latest SHA-256 `6fe726239c15941201f3026ab1a0bb5f42ab89d04fc95b294d54164c5ab4cea8`. Delivery-change versus post-handover service contract acceptance remains **DECISION REQUIRED**. Do not execute production migrations from this document.

Cleanup: both disposable RC8 PostgreSQL containers and their anonymous volumes were removed; zero remained. The encrypted historical and post-upgrade checkpoints remain outside Git under a local-user/SYSTEM ACL for continued authorized qualification or secure disposal. See [cleanup verification](evidence/D5O_RC8_CLEANUP_VERIFICATION.json).
