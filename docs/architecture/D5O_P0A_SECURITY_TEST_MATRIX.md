# P0-A security test matrix

**R** = observed runtime result in [machine output](evidence/p0a-runtime-results.json); **C** = code inspection; **B** = blocked or not executed. Run `node scripts/p0a/run-runtime-qualification.mjs` from this worktree after installing existing dependencies and local Supabase/Docker prerequisites. The runner starts a unique loopback-only Supabase project, copies committed migrations, creates synthetic `rybex` and `enterprise_test` workspaces with four roles each, plus nonmember, revoked and dual-member users, starts the actual Next.js API, and tears down its own project/network. It fails on an unexpectedly successful denial and writes machine-readable results even after test failure. No production URL or key is used.

| Case | Positive and adversarial assertion | Layer | Status/evidence |
|---|---|---|---|
| A1 | A/B actor resolves own active membership; forged other workspace and nonmember denied | Authenticated SQL RPC | **R PASS** `authenticated own actor...`, `independent B...` |
| A2 | Dual member must name workspace; revoked membership and changed role take effect with live session | RPC/DB | **R PASS** `multi-membership...`, `revoked membership...` |
| A3 | Invalid token rejected; actual expired-session refresh path | Auth gateway/API | Invalid token **R PASS**; expiry **B** |
| D1 | A and B work read own row; cross row invisible; anonymous and authenticated direct mutations denied | PostgreSQL grants/RLS and RPC | **R PASS** `direct DB RLS...`, `direct authenticated...`, `RPC work...` |
| D2 | Configuration, receipt and admin event direct table access denied; admin RPC own permitted, cross and ordinary denied | PostgreSQL/RPC | **R PASS** `direct configuration...`, `configuration admin...` |
| D3 | Opportunities, projects, work packages, workforce, scheduling, finance, business events, audit history, evidence metadata: cross read/insert/update/delete | DB/legacy RPC | **B**: fixtures and full table-policy matrix absent |
| C1 | Same command ID/same payload returns receipt; changed payload conflicts; cross-tenant draft denied | Admin RPC | **R PASS** `admin replay...` |
| C2 | Two concurrent B drafts with same expected revision: one succeeds; one conflicts | Admin RPC | **R PASS** `concurrent B draft...` |
| C3 | Every hosted mutation, forged actor/member/version, active-version rollback and cross-tenant replay | API/RPC | **B**: representative paths only |
| S1 | Direct authenticated A/B bucket download/list/signed URL/delete denied; service fixture can upload/read/delete; 1-second signed URL expires | Supabase Storage | **R PASS** `storage direct access...` (delete checked by object survival because Storage may return a no-op success) |
| S2 | Business API upload/read/download/delete/link with forged IDs, role changes and revoked session | API/Storage/RPC | **B**: service-mediated route untested |
| H1 | Anonymous API request denied; A/B own work GET succeeds; forged workspace and cross work ID denied | Next.js API + RPC | **R PASS** `API rejects...`, `API prevents...` |
| H2 | B customer admin API and search remain behind pilot allowlist | Next.js API | **R PASS** `pilot allowlist...` |
| H3 | Membership-access/handoff/search/export/report cache/query isolation | API + service role | **B**: code inspected, no end-to-end negative cases |
| J1 | Hosted scheduled jobs, notification retries, tenant context and external provider isolation | Background process | **B**: no qualified durable hosted job path; outbound providers intentionally unset |
| V1 | Tenant admin cannot grant vendor authority; controlled vendor support audit | Admin/product | **B**: separate vendor control plane absent; A/B ordinary admin read restriction tested only |

The previous architecture plan's S1–S12 matrix in `D5O_TENANT_SECURITY_ASSESSMENT.md` remains the completion target. This package exercised important slices of S1–S10, but **not all of S1–S12**. S11–S12 need an implemented, explicitly tenant-scoped background/support model or a verified declaration that the capability is absent and inaccessible. An HTTP 403/404 alone does not qualify a service-role RPC; the suite checks direct DB/RPC/storage boundaries separately where exercised.

## Additional release tests to implement next

1. Trace every live privileged route in [the candidate inventory](evidence/p0a-boundary-inventory.json) to a specific actor/membership check, RPC authorization, table/grant, evidence object and negative test owner. Start with `membership-access`, evidence API, legacy opportunity service-role update, exports and search.
2. Seed and attack each requested business domain under both tenants, with unchanged row/event/object counts after denial. Include reverse B→A and revoked sessions.
3. Exercise API POST and server actions with forged workspace/record/membership, replay, stale revision and CSRF/origin conditions.
4. Run existing pilot regression scripts and a browser journey in a non-production deployment with production-equivalent environment settings. Prove no Rybex/Rotork allowlist change.

No mock is counted as a database, API, RPC or Storage isolation result. Fixture identities use `example.test`; all records are synthetic. Setup and cleanup are verified in the machine output. The duplicate `0016` migration filename prefix is recorded there; Supabase applied the distinct version set, so file-count and applied-version count differ by one.
