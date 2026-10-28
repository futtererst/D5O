# RC13-A historical application lifecycle

The local hosted-mode Next.js production build used application source `d2a06ed796789dc8395386f067ef85545acf586a`, a descendant of the frozen application commit `8b6b0d9e4aa484d0f0db1d075a969b79e01b0989`. This is **not** a byte-identical qualification of the frozen commit. All active records and actors were fictional. Commands below were authenticated HTTP calls through application routes; no employee browser action is claimed. Direct fixture setup is identified separately.

| Area | Actual execution | Result |
| --- | --- | --- |
| Historical upgrade | Restored 177 ledger entries; applied qualified RC8 bridge and source orders 212–236 | 25 applied, final 202; manifest 236, no hash mismatch. |
| Tenant/configuration | Admin configuration, organization overview, published type listing, Work pin read | HTTP 200, 200, 200, 200. |
| Discover | Save intake, submit, independent commercial qualification, submit and independently accept handoff | Five authoritative HTTP 200 responses on fictional Work. |
| Define | Save draft source through state route as **synthetic fixture**; submit, independent commercial and delivery approvals, submit and accept Develop handoff | Six authoritative HTTP 200 responses; final Define Approved and handoff accepted. |
| Develop solution | Save synthetic source option as **fixture**; submit solution and independent Operations approval | Authoritative HTTP 200 and 200; wrong-role approval 403. |
| Design evidence | Insert synthetic Draft document source as **fixture**; upload/receipt/download through application | HTTP 200, matching SHA-256. This does not qualify Design package acceptance. |
| My Work | Pilot workspace request to non-pilot `customer-work` route | HTTP 403 `pilot_route_required`; no My Work acceptance claim. |
| Pricing, proposal, award, Design acceptance; scheduling, permits, field execution, Deploy and customer acceptance; Scope change, Operate, connected service, Finance | Not executed end to end in RC13-A | **PARTIAL** lifecycle. |

An attempted direct source-state transition of the protected Discover decision was rejected by the database guard (`protected_decision_changed`). The subsequent real Discover command sequence supplied the prerequisite. One initial Develop review probe sent a malformed null `dueDate` and returned HTTP 400; a corrected independent review returned 200. Neither diagnostic response is counted as an authorization result.

Machine evidence: [Discover](evidence/D5O_RC13A_DISCOVER_JOURNEY.json), [Define submit](evidence/D5O_RC13A_DEFINE_PROGRESS.json), [Define decisions](evidence/D5O_RC13A_DEFINE_DECISIONS.json), [Develop submit](evidence/D5O_RC13A_DEVELOP_SOLUTION.json), [Develop review](evidence/D5O_RC13A_DEVELOP_REVIEW.json), [surface](evidence/D5O_RC13A_SURFACE_SECURITY.json).
