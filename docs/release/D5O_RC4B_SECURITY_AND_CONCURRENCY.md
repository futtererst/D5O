# RC4-B security and concurrency

[Final machine result](evidence/D5O_RC4B_EXECUTION_HOLDS.json): 40 passed gates, zero failed gates; 66 recorded authenticated browser decisions; 18 Scope-specific integrity observations inherited and rerun from RC4-A; eight new causal field-start denials; two revised-release browser authorizations. The fixture `d5o-p0a-861497f3-7f3` stopped with no residual containers or project directory.

The Scope-specific RPC observations cover cross-tenant review (`42501`), self-review and wrong-role review (`42501`), stale change revision (`23505`), forged and missing customer evidence (`23514` / `42501`), premature resolution before revised Design (`23514`), stale completed proposal (`23505`), and simultaneous replay **after** a browser-recorded resolution (exact HTTP `200`, conflicting HTTP `409`). Each denied change command preserved the change facts and revision, source/Design/Deploy revisions, event and receipt counts, evidence association, and configuration pin. The eight field-start probes also preserved Deploy state, event and receipt counts, and projection.

| Requested case | RC4-B status |
| --- | --- |
| Cross-tenant, wrong-role, forged evidence, stale proposal, duplicate/conflicting replay | Passed in the final two-tenant fixture as described above |
| Removed or suspended employee with an already open Scope session; suspended tenant | Not executed against this Scope command |
| Wrong-Work or deleted customer evidence; wrong Design package; stale Design task link; wrong configuration basis | Not executed against this Scope command |
| Concurrent **first** submissions before any receipt exists | Not executed. The passing replay is after the first receipt and is not a substitute. |
| Completion, turnover and customer/Work acceptance while unresolved | Not executed with otherwise complete prerequisites |

No critical bypass was demonstrated in the cases actually run. The remaining cases prevent an RC4-B local qualification claim. Existing RC3-C and RC4-A results support shared authorization boundaries but do not close these Scope-specific gaps.

The final run used the 235-file executable migration manifest without changing migration SQL. SHA-256 verification found zero mismatches; the one extra SQL file is the manifest's previously excluded historical file. TypeScript, ESLint, and a local production Webpack build passed. A sandboxed Webpack attempt hit `EPERM` creating `.next` output; the identical unsandboxed local command completed successfully. No hosted or production resource was touched.
