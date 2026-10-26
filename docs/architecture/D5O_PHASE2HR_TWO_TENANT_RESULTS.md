# Phase 2H-R two-tenant results

Source baseline: `f53aa89192b776221067cc6a761248e87259f82e`. Final disposable run: `evidence/phase2hr-design-browser-results.json`, project `d5o-p0a-2d1de704-8fb`, loopback Supabase and Next.js, 50 passed, 0 failed, clean teardown. The runner recorded **47 authenticated Design control invocations** across the two tenant journeys. The Design handoff was an authorized hosted prerequisite; package actions from creation through receipt used browser controls.

| Evidence | Tenant A: Rybex Test | Tenant B: Independent Enterprise Test |
| --- | --- | --- |
| Workspace | `tenant_a_test` | `tenant_b_test` |
| Published service threshold | USD 10,000 | USD 25,000 |
| Pinned configuration version | `67fe554b-7a8a-4691-9f6c-138c5bc87eb7` | `5ca0845c-6c84-4146-ad55-d61a9d03037a` |
| Work | `2795fdef-d0ae-4211-ae25-358f2303c63e` | `c364b6f9-34f0-434a-9b42-ca0a62ee8d90` |
| Package | `wp-aded9da912c84b628e26190f4f2561b8` | `wp-87ead3ff5f7e485594aa8fa2dea62d8b` |
| Controlled PDF evidence | `50785940-9a4b-4194-9af7-b0b9cf314c93` | `bd0acaff-ccaf-451b-954c-ccf6e75b711d` |
| Additional method policy | Required | Optional |
| Final package release | Accepted by independent Operations actor | Accepted by independent Operations actor |

For each tenant, the Design owner opened the My Work task, created a connected package, saved the document and package basis, retained a private PDF, submitted it, and later issued it after an independent Operations review. The owner saved crew demand and requested Engineering, Delivery, Safety and Quality reviews; the Operations actor approved each through My Work. The owner released, and the independent receiver accepted through the customer Work page. Browser responses, task before/after values, configuration version, and hosted decision references are in `designActions` in the JSON evidence. The actual browser screenshots are in `evidence/phase2hr-design-browser/`.

Tenant A's release returned HTTP 422 with `package_release_readiness_blocked` when the method was absent **after** the other readiness decisions were present. Adding the method created a new package revision. The browser repeated crew demand and independent reviews for that revision, then release and receipt succeeded. Tenant B completed the same mandatory controls without the additional method. Concurrent replays of each release returned 200 twice without a duplicate release; receipt replay returned 200. Existing connected authority checks continued through Deploy and Operate in the inherited RPC fixture; those later decisions are not claimed as browser-qualified by this package.

The final test read the authoritative phase projection after receipt and reload. Design was completed, Develop was active, and early solution approval remained preparation rather than false Develop completion. Cross-tenant customer Work GET/POST requests returned 403 for both tenants. The disposable project stopped with no residual containers or project directory.
