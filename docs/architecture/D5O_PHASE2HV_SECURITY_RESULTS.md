# Phase 2H-V security and integrity results

The final 49/49 local result is in `evidence/phase2hv-two-tenant-results.json`. The new Operate denial gate passed with authoritative errors and unchanged Operate revision 6 and Work configuration pin `2bd5c38f-e58c-403b-9760-3269295cc9a4` after denials.

| Tested boundary | Observed result |
| --- | --- |
| Cross-tenant Operate and wrong-role browser/API mutation | HTTP 403 each; direct RPC SQLSTATE `42501` each |
| Forged Work ID and stale decision revision | Direct RPC `42501` and `23505`; no accepted mutation |
| Wrong-purpose evidence and conflicting command-ID replay | Direct RPC `23514` and `23505`; no accepted mutation |
| Foreign private as-built document retrieval | HTTP 403 |
| Suspended receiving member, disabled connected-work rollout, suspended tenant | HTTP 403 and direct RPC `42501` for each; access restored only after authorized reactivation |
| Two competing authenticated support acceptance decisions | One HTTP 200, one HTTP 409; one accepted receipt |
| Historical Work pin and audit | New policy publication left the original pin and decision intact; tenant, actor, Work, revision and command IDs retained for six Tenant A and four Tenant B Operate events before Finance review |

Inherited gates also passed cross-tenant Design and Deploy command denial, field evidence membership/flag/lifecycle access, private evidence read and connected Work audit checks. The two browser journeys proved an independent reviewer for Tenant A. Finance review used the existing billing-role command and left support Active.

**Not yet executed as isolated Operate integrity cases:** removal of an already open receiving employee session, separate entitlement revocation, missing Deploy completion and missing customer acceptance at the Operate command boundary, deleted or wrong-Work as-built evidence, stale document-review basis, exact duplicate acceptance replay, concurrent activation, old My Work URL replay after reassignment, and an explicit wrong pinned configuration-version argument. These are finite qualification gaps, not observed bypasses. No local LOCALLY QUALIFIED claim is made until they are closed with unchanged-state assertions.
