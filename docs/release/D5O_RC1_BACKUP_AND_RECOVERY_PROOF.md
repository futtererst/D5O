# D5O RC1 backup and recovery proof

**Gate C: BLOCKED.** No approved staging database-and-Storage copy, protected checkpoint, or restoration target was available. A full restore, recovery time objective (RTO), and recovery point objective (RPO) are unmeasured. Database metadata alone cannot recover private evidence bytes.

Read-only hosted inventory found 23 objects in the private `d5o-deploy-evidence` bucket, along with 15 Work records and 4 configuration versions. Object paths, bytes, content checksums, and evidence-to-Work bindings were not exported from protected hosted state. The hosted bucket is private; that alone does not prove restored authorized retrieval.

The RC1 [local object rehearsal](D5O_RC1_LOCAL_OBJECT_RECOVERY.json) used a fictional PDF in a uniquely named loopback-only Supabase stack with all RC0 migrations. It captured the bytes, SHA-256 and Storage metadata ID, deleted the object, re-uploaded the saved bytes to the same private path, downloaded them again and verified the SHA-256. Anonymous download failed both before and after. The object-only recovery operation measured **438 ms** in that local stack; this is not an application RTO. The restored Storage metadata **ID changed**, so a metadata record that references the old ID would require a coordinated metadata restore or validated forward reconciliation. This rehearsal is deliberately not labeled full evidence recovery. The stack and network were cleaned.

The separate [disposable forward upgrade](D5O_RC1_DISPOSABLE_UPGRADE.json) preserved a fictional published configuration pin, Work identity, event and command receipt across the 23 RC0 forward migrations. It did not restore a database snapshot and did not use hosted data.

## Required authorized rehearsal

1. Freeze or explicitly account for writes, identify exact staged database/Auth/Storage project refs, and take a protected database checkpoint plus an object-byte and metadata inventory. Record path, bucket, object ID/version, size, checksum, tenant ownership and Work/evidence association for each relevant private object.
2. Restore the checkpoint and objects into a second approved isolated target. Confirm database ledger, roles, Auth dependencies, RLS, grants, object IDs/versions or their supported forward mapping, and access policies before sending test traffic.
3. Apply the reviewed migration bridge and RC0 forward list. Run representative authorized commands and independently denied cross-tenant reads. Record pre/post Work pins, phase events/projections, approvals, receipts, audit rows and object checksums.
4. Rehearse restoring or supported forward recovery after a simulated failure. Measure from recovery start to verified application and evidence access. Verify tenant isolation and record the last recoverable write. Remove disposable resources only after inventories and results are retained.

An RPO is the maximum accepted data-loss interval; no interval has been agreed or measured. An RTO is the time to restore usable service; the 438 ms single-object measurement is not that time. Restoring a pre-migration snapshot after new business writes can discard those writes or conflict with later command receipts and evidence. A promotion plan therefore needs a write freeze or a reviewed reconciliation ledger with command IDs and object versions. No production backup, restore or mutation was attempted.
