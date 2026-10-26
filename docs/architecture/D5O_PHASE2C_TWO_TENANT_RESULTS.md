# Phase 2C disposable two-tenant results

Source baseline: `b4a4e5c43c3e3a78dc07191019dd0ba638bf4a63`. **Final isolated execution: 23 passed, 0 failed, cleanup verified.** The executable harness is `scripts/p0a/run-phase2c-enterprise-admin.mjs`. It creates a loopback-only Supabase project, fictional Auth users and two tenants through the Phase 2B vendor command, applies only local migrations, uses authenticated RPC/API/browser paths, and verifies container, network and project-directory cleanup. The exact project ID, API port, per-test detail and cleanup result are retained in [`evidence/phase2c-two-tenant-results.json`](evidence/phase2c-two-tenant-results.json).

| Scenario | Rybex Test | Independent Enterprise Test |
| --- | --- | --- |
| Published service approval threshold | USD 10,000 | USD 25,000 |
| Equivalent service request | USD 15,000 | USD 15,000 |
| Authoritative approval decision | `pending`, additional approval required | `not_required` |
| Connected Work entitlement and rollout | Both enabled, available | Flag enabled without entitlement, unavailable |
| Connected Work command | Missing Discover intake denied; valid request created | Direct RPC and API requests denied |
| Tenant suspension | Remained active and available | Existing session and background Work update denied; reactivation restored prior membership authority |

Customer administrators could publish their own configuration; Tenant A published `discoverIntake.requireInitialDiscovery=true` and the connected Work command enforced it. Invalid policy input was rejected. A duplicate connected command returned the same receipt. The renamed core was inaccessible through direct Data API invocation. Cross-tenant configuration and capability reads were denied. A browser administrator published a further version, then an audited new draft restored a prior published manifest; existing Work kept its earlier configuration pin.

Vendor capability, suspension and reactivation actions were exercised through authenticated UI sessions. The customer Connected Work page created Work for Tenant A, cleared the form and showed no error alert. Tenant B had no Connected Work administration navigation link, saw an unavailable page and its direct POST was denied. Actual application screenshots are in [`evidence/phase2c-admin-ui/`](evidence/phase2c-admin-ui/). The preview server was ephemeral and shut down before fixture cleanup.

The final test count and pass/fail/blocked distinction are recorded in the [release recommendation](D5O_PHASE2C_RELEASE_RECOMMENDATION.md). The isolated result does not prove production migrations, external mail delivery, the full six-phase commercial journey or production readiness.
