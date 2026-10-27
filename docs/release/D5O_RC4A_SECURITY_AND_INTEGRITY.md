# RC4-A Scope change security and integrity

[Machine results](evidence/D5O_RC4A_SCOPE_CHANGE_BROWSER.json) contain 18 Scope-specific integrity observations across two independent tenants. For each denied direct RPC, the runner compared change status, revision, facts and evidence association, event and receipt counts, source/Design/Deploy revisions, and the Work configuration pin before and after. Denied calls did not change that protected state. An earlier failed recorder run is retained only as a retry; the final result is 38/38 with cleanup verified.

| Check, per tenant | Actual response | Result |
| --- | --- | --- |
| Cross-tenant review | `42501 field_change_scope_denied` | Denied; unchanged |
| Submitter self-review and wrong-role review | `42501 independent_change_review_required` | Denied; unchanged |
| Stale change revision | `23505 stale_field_change` | Denied; unchanged |
| Forged customer evidence | `23514 exact_customer_evidence_required` | Denied; unchanged |
| Missing customer evidence | `42501 customer_change_source_required` | Denied; unchanged |
| Resolution before newer accepted Design | `23514 revised_design_receipt_required` | Denied; unchanged |
| Concurrent exact replay and conflicting reuse of the recorded resolution command ID | HTTP `200` exact / `409 command_reuse_conflict` conflicting | One authoritative result; unchanged 7 events and 7 receipts per change |
| Stale proposal against completed change | `23505 stale_field_change` | Denied; unchanged |

Both tenants retained one scoped private customer-authorization document in the final change facts (1,429 and 1,432 bytes). The document purpose was `field-change-authorization`, its scope ID was the exact change ID, and the stored SHA-256 checksums matched the uploaded synthetic PDF bytes (`57251418094d16452e0940d2858b77915e09667bd26861e7fa6910ee3b724fe4` and `54ad36ffd11b25b2eab84bca88efa2f8e8e2c5a0c8fd46b1cf141a8a2ce16af8`). The final Work configuration pins remained unchanged; phase-status replay matched; completed field-change tasks disappeared after reload. The local Docker project `d5o-p0a-68c88b84-e45` was removed with zero residual containers.

**Still unexecuted for commercial Scope change:** removed membership, suspended tenant, wrong-Work and deleted evidence, wrong package, stale Design task after package revision, simultaneous *new* decisions before receipt creation, protected field-start/completion/acceptance commands at each unresolved status, and successful field-start reauthorization after resolution. Existing RC3-C security and Deploy correction results support unchanged common boundaries but do not close these Scope-specific cases. The present concurrency check is genuinely parallel replay **after** a browser-recorded decision; it does not prove first-writer concurrency for a new decision. No critical bypass was demonstrated, and full RC4-A integrity qualification remains incomplete.
