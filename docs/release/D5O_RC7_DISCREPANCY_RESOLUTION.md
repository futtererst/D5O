# RC7 discrepancy resolution

The frozen 236-file manifest was rehashed, including latest SHA-256 `6fe726239c15941201f3026ab1a0bb5f42ab89d04fc95b294d54164c5ab4cea8`. The repository also contains one excluded duplicate `0016_p1_01b_2_bid_submission_outcome-ShawnT13.sql`; it is not an executable manifest entry. Application, source and RC5 evidence commits are ancestors of RC6/RC7 baseline `77f520d625515ad32edb2a32913f96a9b89fb18d`.

The restored actual 177-row ledger was compared in memory with frozen source. The [retained SQL comparison](evidence/D5O_RC7_RETAINED_SQL_COMPARISON.json) and [140-item register](evidence/D5O_RC7_DISCREPANCY_REGISTER.json) contain only identities, hashes and conclusions. The 140 RC5 items now divide as follows:

| Finding | Count | Disposition |
| --- | ---: | --- |
| Early source version absent | 44 | Historical effect mapping unresolved; do not replay |
| Hosted-linked SQL differs | 54 | Object, permission and data-effect review required |
| SQL token equivalent after comments/external whitespace | 4 | SQL text equivalence established; preserve hosted history |
| Late source version absent | 25 | Pending candidates after prerequisite bridge |
| Remapped version with line-ending-equivalent SQL | 3 | SQL effect proved, version-aware executor unresolved |
| Unmatched hosted legacy history | 10 | Preserve actual ledger; map retained SQL effects |

Of the 54 remaining hosted-linked SQL differences, 45 become identical if *all* whitespace is erased, including whitespace inside function bodies or string literals; that observation is **not** proof of SQL equivalence. Nine have non-whitespace differences. Current schema resemblance never proves a particular historical SQL file ran. No ledger row was fabricated.

The first demonstrated historical-data blocker is source order 215, `20261023140000_d5o_phase2b_tenant_onboarding.sql`: its replacement `admin_identity_requests_role_check` excludes `field_worker`, while the restored production state has one `setup_completed` `field_worker` invitation. The check rejects existing data. The row must be preserved, and any grandfathering or correction must be reviewed against authorization policy before an executable bridge can be established.
