# RC6 coordinated recovery proof

**NOT RUN.** No historical database checkpoint, Auth copy or private Storage object-byte copy exists in RC6. Recovery duration and data-loss window are therefore **UNKNOWN**, and coordinated restoration is **UNPROVED**.

The authorized rehearsal must restore database state and the real migration ledger, relevant Auth relationships, private Storage metadata and object bytes to an isolated target. Compare pre/post object hashes, bucket/path/owner/tenant/Work associations, RLS and function grants. If restored Storage metadata identifiers change, prove the application resolves the same evidence or review and test an explicit association repair before claiming recovery. Test an interrupted or failed upgrade, measure actual restore duration, and identify the last consistent write across database and Storage.

Restoring an earlier database while later business events or evidence bytes remain risks orphaned files, missing approvals or receipts, stale Work authority and mismatched evidence references. A database-only restore is not a recovery PASS. No recovery action touched production.
