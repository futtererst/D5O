# RC5 recovery prerequisites

No coordinated production recovery has been rehearsed. Before a hosted migration, obtain authorization for a protected copy and a consistent checkpoint that binds database, Auth and private Storage to one cutover time. Record project identity, PostgreSQL version, source/evidence commits, source manifest hash, full ledger including stored SQL, backup identifiers, object inventory timestamps and restoration target. Restrict access to the protected copy; RC5 did not export protected business rows or files.

Protect and verify:

1. PostgreSQL schema and data, extensions, owners, grants, RLS, policies, triggers, functions, sequences and migration ledger.
2. Auth users, identities, invitations, sessions as relevant, and membership/tenant foreign keys. Verify restored role and revocation behavior, not only counts.
3. Tenant configuration versions, publication state, activation history, hashes and every Work pin to its configuration version/digest.
4. Work/phase events and projections, Design releases, field permits, customer approvals, command receipts, audit history and financial follow-up. Compare IDs, counts, order, hashes and representative authorized reads before and after.
5. Private Storage buckets and object metadata **and bytes**: bucket/path, owner, tenant/Work/evidence association, size, content SHA-256, version or etag where available. Verify authorized retrieval and cross-tenant denial after restore.

The real cutover needs an application write freeze or equivalent consistency barrier across database writes, Auth relationship changes and private-object uploads. Take the coordinated checkpoint after writes quiesce. An earlier database restore after later business events or evidence bytes were written can orphan files, lose event/receipt history, resurrect revoked authority or leave approvals pointing to missing objects. Conversely, restoring object bytes from an earlier point with a later database can leave metadata referencing missing files. Define the replay/reconciliation policy and the maximum accepted data-loss window before any upgrade.

Subsequent authorized rehearsal: restore the protected database and object bytes into an isolated target; verify identity and ledger first; run the reviewed forward bridge and 212–236 sequence with checkpoint comparisons; exercise interrupted migration recovery; restore the pre-upgrade checkpoint; compare database/ledger hashes, Auth relationships, permissions, Work pins, event/receipt/audit identities, object byte hashes and evidence associations; prove both allowed and denied access. Record duration and a real recovery decision deadline. Do not claim PASS until that complete cycle is observed.
