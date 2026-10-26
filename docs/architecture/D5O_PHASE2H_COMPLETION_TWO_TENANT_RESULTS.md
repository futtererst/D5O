# Phase 2H completion two-tenant results

The fixture provisions two disposable tenants using the same application build and existing vendor commands. Tenant A publishes a USD 10,000 service-work threshold and required Define risk narrative. Tenant B publishes a USD 25,000 threshold and optional narrative. Both create USD 15,000 connected Work with independent pinned configuration versions.

| Check | Tenant A | Tenant B |
| --- | --- | --- |
| Define draft from My Work | Browser save and submit | Browser save and submit |
| Missing risk narrative | Server rejects `define_risk_narrative_required` | Submission allowed under published policy |
| Define independent reviews and handoff | Separate signed-in actors complete | Separate signed-in actors complete |
| Design package receipt | Signed-in Operations actor, browser control | Signed-in Operations actor, browser control |
| Further Design preparation / Develop / Deploy / Operate | Hosted fixture progression; no complete browser claim | Hosted fixture progression; no complete browser claim |

Machine-readable evidence records exact fixture tenant IDs, Work IDs, configuration pins, decisions, phase projection replay and teardown. Synthetic database containers are removed after the fixture. The test does not establish the user-requested full two-tenant browser journey.
