# Phase 2H-R Design browser journey

The executable runner is `node scripts/p0a/run-phase2hr-design-browser.mjs`. It starts a disposable loopback Supabase stack and Next.js app, provisions two tenants with the existing vendor command, publishes separate tenant configuration, and runs the cumulative Define browser checks. Design handoff is prepared through the previously qualified hosted command. All claimed Design package and document actions must then originate from signed-in Playwright controls on `/work/customer/<workspace>`.

The runner records each Design control invocation, actor, tenant, Work ID, HTTP status and authoritative result in `docs/architecture/evidence/phase2hr-design-browser-results.json`. Screenshots from the actual application are written to `docs/architecture/evidence/phase2hr-design-browser/`. The final JSON has a cleanup object from the disposable runtime. A failed browser action remains failed even if later RPC tests progress other records.

| Sequence | Employee responsibility | Existing authority |
| --- | --- | --- |
| 1 | Create connected package | `d5o_hosted_create_connected_package_v2` |
| 2 | Prepare document and package basis | `d5o_hosted_design_draft_command_v1` |
| 3 | Retain private PDF for exact document revision | Design evidence endpoint and hosted custody registration |
| 4 | Submit document | `d5o_hosted_design_review_command_v1` |
| 5 | Independently approve document | Same hosted review command, different Operations actor |
| 6 | Issue approved document | Same hosted review command, Design owner |
| 7 | Save dated crew demand | `d5o_hosted_design_demand_command_v1` |
| 8 | Request and independently approve Engineering, Delivery, Safety and Quality reviews | `d5o_hosted_design_review_command_v1` |
| 9 | Release package with pinned method policy | `d5o_hosted_design_release_command_v1` |
| 10 | Independently accept receipt | Same hosted release command, Operations actor |

Tenant A's missing method is tested **after** the document, dated crew demand, and four reviews exist, isolating the configured method requirement. Correcting the package increments its revision. The browser then re-establishes crew demand and four independent reviews for that revision before release. Tenant B's optional method must still satisfy mandatory document, review, demand and package readiness controls. The final qualification state is determined from the recorded results and is not inferred from form availability.
