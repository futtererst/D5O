# RC10 release decision

**Overall: PARTIAL; production migration and deployment remain NO-GO.** RC10 found that RC9's six missing public tables are not required by the *conditional hosted D5O runtime*, so no speculative forward schema SQL is justified. An ACL-faithful historical restore completed the 25-file upgrade to 202 real ledger rows with protected historical hashes and focused tenant checks intact. This does not meet the requested **HISTORICAL APPLICATION COMPATIBILITY QUALIFIED** threshold because the full frozen application operations, Storage API permissions, deployment environment binding, and coordinated recovery were not proven.

| Gate | Result |
| --- | --- |
| Six missing tables and transitive scope | PARTIAL: direct source/dependency evidence and hosted gates established; dynamic and legacy callable closure incomplete. |
| 72 relations / 212 policies | CONDITIONAL: inapplicable to hosted path; 18 policies on present legacy tables and 54 historical effects remain audit items. |
| Compatibility bridge | ZERO NEW SQL: retain exact RC8 order-215 bridge and frozen 212–236 sequence. |
| Historical upgrade | PASS locally: 177→202, 25/25, hashes and 814 FKs preserved. |
| Hosted application/security | PARTIAL: route/RPC inventory and targeted `42501` probes pass; full HTTP/command authorization not run. |
| Private evidence/recovery | PARTIAL: 23 byte hashes and associations pass; Storage API and atomic checkpoint unproven. |

**Stop conditions:** unexpected project, ledger, source/bridge hash or ACL; absent hosted env binding; exposed legacy route; missing dynamic RPC dependency; changed historical hashes or Work pins; incorrect permit selection; any new anonymous/tenant authorization; missing private object; failed quiescence or inconsistent database/object checkpoint. Formal product-owner acceptance of delivery-change versus post-handover service contract remains **DECISION REQUIRED**.

Immutable references: frozen app `8b6b0d9e4aa484d0f0db1d075a969b79e01b0989`; RC9 base `22a1aec332cfad1061535f1ff23986e09f454f82`; 236-entry source manifest in [RC5 evidence](evidence/D5O_RC5_COMPLETE_236_MIGRATION_MANIFEST.json). No production write, deployment, push or merge occurred. Protected encrypted checkpoints remain outside Git under approved controls.
