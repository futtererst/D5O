# RC5 migration equivalence

Frozen source: application `8b6b0d9e4aa484d0f0db1d075a969b79e01b0989`, evidence `dcb72a3868e48d536449e109872403974b79fa1b`. Git ancestry was verified; the source worktree was clean. There are 237 SQL filenames but exactly 236 executable migrations: the duplicate `0016_p1_01b_2_bid_submission_outcome-ShawnT13.sql` is excluded by the established runtime rule. Every manifest SHA-256 was recomputed against raw source bytes; the final file matches `6fe726239c15941201f3026ab1a0bb5f42ab89d04fc95b294d54164c5ab4cea8`.

Production has 177 ledger rows, first `001`, last `20261021123923`. Every version, name, statement count and stored-statement SHA-256 matches the RC1 read-only capture; no ledger change was observed. The full [236-file manifest](evidence/D5O_RC5_COMPLETE_236_MIGRATION_MANIFEST.json), [current ledger comparison](evidence/D5O_RC5_LEDGER_COMPARISON.json), and [unresolved register](evidence/D5O_RC5_UNRESOLVED_DISCREPANCIES.json) are machine-readable.

| Relationship | Count | Evidentiary conclusion |
| --- | ---: | --- |
| Same source and hosted version/name | 148 | Version match alone proves no SQL equivalence |
| Hosted-only versions with name-linked source candidate | 19 | Three SQL texts are proved equivalent; version handling remains unresolved for all 19 |
| Hosted legacy entries `001`–`010` with no source file | 10 | Historical entry unresolved |
| Source versions absent from hosted ledger | 88 | 44 earlier source files plus 25 later files and 19 name-linked remaps |
| Frozen source bytes equal stored SQL hash | 21 | EXACT MATCH |
| Stored SQL hash equals source after CRLF→LF only | 88 | SQL-EQUIVALENT WITH EVIDENCE; line ending difference only |
| Hosted-linked source SQL hashes still differ | 58 | HISTORICAL ENTRY UNRESOLVED |
| Source files without any hosted counterpart after name links | 69 | HISTORICAL ENTRY UNRESOLVED pending effect/dependency review |

The hash comparison uses SHA-256 of the provider's `array_to_string(statements, newline)`. The 21 raw-byte and 88 line-ending matches are exact SQL-text evidence under that definition. This does **not** prove that later DDL, data, grants or RLS still match the source effect. The 58 mismatches may include different SQL, changed source, or other formatting; no equivalence is asserted. There are 140 unresolved register items: 58 hosted-linked mismatches, 69 source files lacking hosted counterparts, 10 unmatched hosted legacy entries, and three SQL-proved remaps whose source versions remain absent from the ledger.

Each source row in the comparison includes the preceding source migration and static DDL object-effect hints. Those hints are a review index, not a full SQL parser or a claim that dynamic SQL, data changes and dependency effects were proved. Hosted object conflicts and per-migration effective-schema equivalence remain explicitly UNKNOWN until the protected-copy comparison.

No source migration is labeled EFFECTIVE-SCHEMA EQUIVALENT ONLY solely from an object with a similar name. The catalog establishes present objects and conspicuous absences, but an object can be replaced by later migrations; an end-state resemblance cannot prove historical execution. No pending source file is yet classified PENDING AND SAFE CANDIDATE. This conservative classification prevents an unsafe direct `db push`. Existing local RC1/RC2 evidence and the RC4 blocker register remain incorporated by reference, without changing their historical findings.
