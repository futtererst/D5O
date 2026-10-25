# Phase 2H-TC two-tenant connected-service result

The final disposable, authenticated browser run completed **52/52 checks**, reported no setup error and independently verified synthetic cleanup. Both tenants used the same application code and command adapters. The final trace is [machine-readable](evidence/phase2htc-two-tenant-results.json); authenticated screenshots are in `evidence/phase2htc-browser/`.

| Result | Tenant A — Rybex Test | Tenant B — Independent Enterprise Test |
| --- | --- | --- |
| Published service threshold | USD 10,000 | USD 25,000 |
| Priced child request | USD 15,000 | USD 15,000 |
| Additional approval | Required; independent administrator approved | Not required; no approval row or task |
| Premature job | HTTP 409 | HTTP 409 |
| Forged customer evidence | HTTP 409, state unchanged | HTTP 409, state unchanged |
| Customer/service authorization | HTTP 200 | HTTP 200 |
| Executable job | One, browser-created | One, browser-created |
| My Work task entries | 9/9 resolved | 7/7 resolved |
| Pinned configuration | `ca5c898a-479e-4501-819f-947f9290b10b` | `82059e9f-384d-47a7-9dd7-b7c510118fa3` |

The exact Work, request, evidence, approval and job identifiers, actor references, audit decisions, configuration pins and HTTP results remain in the JSON trace. The cross-tenant adapter checks return HTTP 403 for foreign reads and PostgreSQL `42501` for foreign business commands. The final count remains one executable job per tenant after exact replays, conflicting-key submissions and parallel post-job attempts.

Two earlier retries are retained. [The first](evidence/phase2htc-browser-retry-failure.json) exposed an inherited test that waited for a transient creation message after a successful 201 response and navigation. [The second](evidence/phase2htc-my-work-route-retry-failure.json) exposed an intermittent task-route render timeout. The runner now verifies persisted creation and performs one read-only route reload when the authenticated task detail API is healthy. Neither retry changed business state to make a decision pass.
