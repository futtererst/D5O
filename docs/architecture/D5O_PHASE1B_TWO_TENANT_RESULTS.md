# Phase 1B two-tenant connected service results

Evidence: [`phase1b-connected-results.json`](evidence/phase1b-connected-results.json). Source baseline `7b8a629d57f4652acd7545ac244555e228a563d4`; Phase 1B local migration `20261023115306_d5o_phase1b_connected_service_approval.sql`. The run used a unique loopback-only Supabase project, separate fictional Auth administrators, managers and Operations leaders, a shared application/RPC build, and synthetic customer decision PDFs uploaded to local Storage. It applied repository migrations only to the disposable local project. Its final result was **12 passed, 0 failed, 0 setup errors; cleanup verified**. Project directory, dedicated network and containers were removed.

| Observation | Tenant A — Rybex Test | Tenant B — Independent Enterprise Test |
| --- | --- | --- |
| Pinned published service threshold | USD 10,000 | USD 25,000 |
| Approved connected service estimate | USD 15,000 | USD 15,000 |
| Additional approval | Required; direct customer authorization and direct job RPC denied while missing | Not required; no approval request row fabricated |
| Independent decision | Operations leader approved the scoped request; request and approval events retained actor, tenant and pinned version | No additional threshold decision needed |
| Customer authorization and job | Existing `d5o_hosted_service_pricing_command_v1` recorded exact synthetic customer evidence; existing `d5o_hosted_service_job_command_v1` created a job | The same authoritative commands recorded customer authorization and created a job |
| Idempotency/concurrency | Exact job-command replay returned the same job ID | Two concurrent job commands produced one job; the other was denied by the existing revision/duplicate controls |

Further checks passed: a second request on A's **same parent Work** could not use the first request's approval; a changed approved amount invalidated A's approval and required a new scoped decision while retaining the prior approved row; a revoked approver invalidated the current decision; the older service-role related-work job path was denied on stale approval; wrong-role and cross-tenant approval attempts failed; the renamed pre-approval functions were not executable by their former API roles. The read RPC returned authoritative `approved`, `not_required` and `stale` status and permission flags. A later synthetic active A version changed the threshold to USD 25,000 for new Work; the existing connected request still resolved its pinned USD 10,000 policy and a new Work pinned the later version. The version change in this connected command fixture was seeded by SQL; the original Phase 1 suite separately exercises the administrator draft/validate/activate command.

The fixture assembled reviewed estimate, connected parent, customer evidence and policy state in an isolated database, then exercised the **real** approval, customer-authorization and job RPCs. It did not replay the entire browser driven pricing or six-phase lifecycle. Its SQL fixture is test setup, not an alternate production command path. Production Rybex/Rotork gates were not changed, and the fictional B tenant remained local only.
