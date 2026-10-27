# RC6 forward migration bridge

**No executable bridge can be justified yet.** The actual hosted 177-row ledger remains authoritative. Source order 1 is still the first stop because hosted legacy version `001` is a different history. No historical file was changed, no ledger entry was invented and no forward SQL was authored.

The only defensible sequence is conditional:

1. Confirm the authorized copy's database, Auth and Storage identity, consistent checkpoint, full retained ledger SQL, grants, policies and private-object hashes.
2. Resolve the 140 RC5 discrepancies. For the 44 early source files without hosted versions, compare each required object/data effect against the hosted starting state. For 19 remaps, establish SQL/effect equivalence and a reviewed version-aware executor strategy without ledger fabrication. Stop on any unexplained collision.
3. Write minimal **new forward corrections** only for demonstrated gaps. Each correction needs exact source/hosted dependencies, before/after object definitions, data precondition query, transaction and failure behavior, permission/RLS diff, postcondition query and recovery checkpoint.
4. Rehearse those corrections on the protected copy. Then apply frozen source orders 212–236 in manifest order only where proved pending and compatible. The exact ordered filenames and SHA-256 values are in [the RC5 manifest](evidence/D5O_RC5_COMPLETE_236_MIGRATION_MANIFEST.json).
5. Before the final permit-order migration, compare the last appended permit with timestamp selection for every historical package; identify ties, malformed arrays, Held/Authorized transitions and release/publication references under restricted access. Stop on any unexplained case. Preserve existing permit records and evidence associations.
6. Require a bounded write freeze and verified coordinated database/Auth/Storage recovery checkpoint before any real hosted cutover.

**Stop conditions:** unknown target identity; unavailable or inconsistent protected checkpoint; incomplete ledger SQL; unproved history mapping; duplicate version; object or permission drift; missing historical record; changed Work pin, receipt, event, approval or evidence association; tenant isolation regression; ambiguous permit choice; missing private bytes; or unsuccessful coordinated restore. No production migration is authorized by this document.
