# RC6 discrepancy resolution

The [sanitized 140-row triage](evidence/D5O_RC6_SAFE_DISCREPANCY_TRIAGE.json) was regenerated from frozen RC5 hashes, source files and catalog snapshots. All 236 source SHA-256 values were rechecked. This is static evidence only: the authorized full hosted ledger SQL and historical records have not yet been copied because no direct database connection credential was available. No discrepancy is represented as historically resolved by this pass.

| Group | Count | Current disposition |
| --- | ---: | --- |
| Hosted-linked stored SQL hash differs | 58 | Obtain retained SQL, compare semantics, objects, grants, RLS and data effects |
| Source orders 1–44 without hosted counterpart | 44 | Determine whether hosted legacy operations supply each effect; bridge only proven gaps |
| Source orders 212–236 absent | 25 | Candidate after the historical bridge and data preconditions pass |
| SQL-proved remaps with source version still absent | 3 | Resolve safe version-aware executor treatment; do not forge ledger history |
| Legacy hosted `001`–`010` unmatched | 10 | Preserve and inspect actual retained SQL and surviving effects |

The remaining 16 name-linked remaps are included in the 58 differing-SQL group. The machine file records source identity, hosted identity and hash, static object-effect hints, current catalog name observations, risk and required next evidence for every item. A present object name is not proof of historical execution or semantic equivalence. A missing object name may reflect a later drop; it is a precondition for investigation, not automatic proof of drift.

**Release blockers:** unknown retained SQL for 58 hosted-linked differences and 10 legacy entries; unproved effects for 44 early source files; unresolved handling for 19 remapped source versions; historical data behavior for permits, Work pins, approvals, receipts, events, Auth and private evidence. The actual production copy and object-byte evidence are absent.
