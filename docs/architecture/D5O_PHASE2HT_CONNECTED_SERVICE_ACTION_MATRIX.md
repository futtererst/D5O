# Phase 2H-T connected service command and responsibility matrix

The parent connected Work must be support Active before `open-request`. The supported request is a child of that parent Work and its accepted Design/Deploy/Operate history. The parent Work retains its published configuration pin. The existing hosted commands, rather than browser calculations, own every protected decision.

| Employee action | Authoritative command | Existing role | Exact basis and guard | My Work outcome |
|---|---|---|---|---|
| Record and review service coverage | `d5o_hosted_operate_command_v1` `add-agreement`, `approve-agreement` | Project manager prepares; operations leader independently approves | Parent Work, asset, agreement revision, source and scope | Coverage is visible before triage |
| Open and triage child request | `d5o_hosted_operate_command_v1` `open-request`, `triage-request` | Project manager opens; operations leader triages | Parent Work and asset in one tenant; service category and agreement scope | Triage, then estimate preparation |
| Save and submit exact estimate | `d5o_hosted_service_pricing_command_v1` `save-service-estimate`, `submit-service-pricing` | Project manager | Request cycle, sourced published rate, USD amount, pricing policy and expected revisions | Independent pricing review |
| Review priced service | Same RPC `approve-service-pricing` or `return-service-pricing` | Operations leader | Exact submitted estimate revision; independent actor | Threshold approval request or customer authorization |
| Request and decide tenant threshold approval | `d5o_hosted_connected_service_approval_command_v1` | Project manager requests; independently authorized operations leader decides | Tenant, Work, request, scope, amount/currency, pinned configuration and actor authority | Approved request leaves queue; authorization becomes available |
| Retain external customer decision source | Customer decision evidence route and `d5o_hosted_register_customer_decision_evidence_v1` | Authorized service actor | Storage custody, PDF checksum, exact parent Work/request scope | Evidence can be selected for authorization |
| Record customer service authorization | `d5o_hosted_service_pricing_command_v1` `record-service-authorization` | Operations leader | Exact estimate, customer source, current tenant approval when required; transaction rejects stale/missing approval | Executable job creation becomes available |
| Create executable job | `d5o_hosted_service_job_command_v1` | Project manager | Current authorization, applicable approval, Work/catalog/Operate revisions and command id | Job is visible; create action resolves |

The API adapters are `/api/d5o-hosted/prototype-operate-command`, `/api/d5o-hosted/service-approval`, `/api/d5o-hosted/customer-decision-evidence`, and the read-only pricing and My Work projections. The existing RPCs own role, lifecycle, tenant, feature, approval, audit, concurrency, and idempotency enforcement. The server adapters now accept a separately verified tenant-neutral Work scope while retaining the existing Rybex/Rotork pilot context.

The browser reuses `ServicePricingPanel` and `CustomerDecisionEvidence`. `CustomerServiceActions` exposes the existing coverage, request, triage and job commands in the tenant-neutral Work page. The My Work projection emits actionable service tasks from the authoritative Operate state and approval read command. Task visibility confers no mutation authority.
