# RC3-C connected-service lifecycle contract

The current authoritative service contract is **post-handover Operate**. The parent Work's support activation must be `Active` before an employee can open a connected service request. The My Work queue and browser forms apply the same boundary. The existing connected-service job is a new child Work related to that request; it does not authorize the parent's field start.

| Boundary | Source evidence |
| --- | --- |
| Request intake | `20261019010000_d5o_configured_delivery_receiver.sql`, `d5o_hosted_operate_command_v1`, `open-request`: rejects when `activation.status <> 'Active'` and also requires a supported asset and complete intake. |
| My Work | `lib/d5o/hosted/customer-work-tasks.ts`, `serviceTasks`: returns no service responsibility until activation is `Active`; requests then route by role and request state in phase `Operate`. |
| Browser | `components/d5o/customer-work/CustomerServiceActions.tsx`: shows the service surface only after activation and disables request opening beforehand. |
| Coverage and triage | The same Operate command records and independently approves coverage terms, opens the asset request, and routes Operations triage. |
| Estimate and customer authority | `d5o_hosted_service_pricing_command_v1` records the estimate, independent pricing review and exact customer authorization. `20261023115306_d5o_phase1b_connected_service_approval.sql` requires the pinned tenant threshold decision before customer authorization and job creation. |
| Child job | `d5o_hosted_service_job_command_v1` checks the current request, coverage, authorization and threshold approval. `20261008250000_d5o_connected_service_job_command.sql` and its forward replacements require active parent support; `20261008230000_d5o_connected_work_identity.sql` validates the parent–child request/asset/job relationship and creates a distinct executable child Work. |
| Child execution | The generated child Work follows its own Design, Develop and Deploy execution path. Its job relationship does not substitute for the parent package's permit or customer acceptance. |

Delivery-stage additional scope is handled by the existing **field-change** domain (`d5o_hosted_field_change_command_v1`, `20261009220510_d5o_connected_field_changes.sql`). Open field changes hold protected field and acceptance decisions until independently resolved. That domain is distinct from an asset service request opened after support activation.

**Contract decision:** Develop-stage connected-service request and job creation on the parent is unsupported by the existing command contract. The RC3 specification's request to place that post-handover service sequence in parent Develop is **NOT MET**. Product behavior and the post-Operate browser sequence can pass without altering commands. Any requirement to sell or authorize additional work during delivery needs a separate product decision about the existing field-change path; RC3-C does not introduce a new workflow or change authoritative prerequisites.

The RC3-C disposable run records an attempted pre-activation request, unchanged Operate revision and unchanged configuration pin, then the supported post-activation two-tenant browser path. Its exact RPC response and later browser receipts are in `evidence/D5O_RC3C_TWO_TENANT_BROWSER.json`.
