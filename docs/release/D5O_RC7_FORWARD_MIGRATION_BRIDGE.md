# RC7 forward migration bridge

**Status: NO EXECUTABLE BRIDGE YET.** Source migration 215 fails against an actual historical record. Applying the frozen 236 files in order, or marking source-only versions applied, would misrepresent production history. No historical file or hosted ledger entry was changed.

The only defensible ordered proposal is:

1. Preserve the actual 177-row ledger and the encrypted database/Auth/Storage checkpoint. Maintain a bounded application write freeze for a later cutover.
2. Resolve 44 early absent-source effects and 10 legacy hosted effects against retained SQL and restored object definitions. Resolve 54 SQL differences, including nine with non-whitespace differences, and all 19 version remaps. Define a version-aware executor that does not insert fictitious ledger rows.
3. Review the completed historical `field_worker` invitation against tenant onboarding policy. Produce a narrow forward-only compatibility correction that keeps its identity, status and audit trail. Verify that migration 215's new constraint can be installed without rejecting this row or permitting unauthorized new invitations. Do not patch frozen source SQL in place.
4. Run source orders 212–236, by manifest hash and order, only after all prior effects and version mappings are proven. Orders 212–214 passed a cumulative transaction probe on the restored copy; order 215 failed and rolled back; 216–236 were not reached.
5. Before order 236, verify historical permit selection and function grants. The restored copy has six permits in six package groups, no timestamp ties or append-versus-timestamp disagreement; it contains no multi-permit historical group, so the changed-selection case remains untested on actual data.
6. Verify post-upgrade ledger, schema, RLS, grants, Work pins, events, approvals, receipts, evidence associations and application behavior on the approved historical copy, then rehearse coordinated recovery.

**Stop conditions:** unknown project/SSL/read-only boundary; missing or inconsistent protected checkpoint; unexplained retained SQL or version mapping; migration 215 check violation; permission/RLS weakening; missing or changed Work, configuration pin, event, approval, receipt, audit or evidence association; historical permit ambiguity; private-byte/hash mismatch; or incomplete coordinated recovery. Production execution remains unauthorized.
