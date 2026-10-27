# RC9 release decision

**Overall: NO-GO for production migration and frozen-application deployment.** RC8's historical late-migration execution and RC9's bridge rollback proof remain valuable. RC9 did not establish full final effective-schema compatibility, all 73 history dispositions, Storage API authorization, or atomic database/object recovery. Production was unchanged.

| Gate | Result | Evidence/limit |
| --- | --- | --- |
| A — history | BLOCKED | 19 SQL-equivalent remaps; 44 early and 10 legacy effects unresolved in 73-item matrix |
| B — bridge | PARTIAL | Four atomic rollback probes passed, correct receipt/history and restricted grants; production connection identity and complete final grants need verification |
| C — final schema/security | NO-GO | Six frozen-app-referenced tables directly confirmed absent after upgrade; clean-versus-upgraded catalog has 72 missing relations and 212 missing policies |
| D — historical preservation | PARTIAL | RC8 259 prior table counts, ten targeted hashes, 814 FKs and 23 associations passed; broader financial/permit/application checks remain |
| E — private Storage API | BLOCKED | 23 bytes and metadata hashes verified; no API-serving authorization tests |
| F — recovery | PARTIAL | RC7/RC8 isolated pre/post restores and RC9 interrupted-bridge rollback passed; no atomic production database/object checkpoint |

The exact proposed forward SQL sequence remains RC8 source orders 212–236, with pre/unchanged 215/post as one transaction. No forward correction is justified yet: first confirm final missing objects and assess the required business/security effects. The production ledger must retain all 177 actual historical rows. No production operation is authorized by this report.

**Stop conditions:** unexpected ledger/source/checkpoint hash; wrong project or schema; migration error; missing application object; any altered owner/grant/RLS or tenant isolation; changed historical pin/event/approval/receipt/audit/financial/evidence hash; incorrect newest-appended permit; missing private byte or broken association; incomplete restore; absent quiescence or coordinated checkpoint. Product-owner acceptance of delivery-change versus post-handover service contract remains **DECISION REQUIRED**.

Baseline: frozen application `8b6b0d9e4aa484d0f0db1d075a969b79e01b0989`, RC8 evidence `9c07ce85af0c1cba04e8d33b159c12b7a463be57`, 236-file manifest with final SHA-256 `6fe726239c15941201f3026ab1a0bb5f42ab89d04fc95b294d54164c5ab4cea8`. Protected checkpoints stay outside Git under approved retention controls. [Cleanup verification](evidence/D5O_RC9_CLEANUP_VERIFICATION.json) found no RC9 disposable containers, networks, labeled volumes, temp project directory or temporary junction.
