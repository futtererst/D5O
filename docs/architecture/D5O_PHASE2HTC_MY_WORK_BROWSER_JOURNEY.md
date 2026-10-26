# Phase 2H-TC My Work browser journey

The authenticated browser runner `scripts/p0a/run-phase2htc-my-work.mjs` provisions two disposable tenants and opens each supported connected-service responsibility from its actual My Work task link. The task is derived from authoritative Work, approval and job state. The runner checks the Work identity after navigation and verifies that the prior task is no longer actionable when its business decision completes. [Machine results](evidence/phase2htc-two-tenant-results.json) retain `serviceTaskNavigation`, request/job IDs and screenshots under `evidence/phase2htc-browser/`.

| Responsibility | Tenant A actor | Tenant B actor | Result |
| --- | --- | --- | --- |
| Open child service request | Project manager | Project manager | My Work link, then browser command |
| Review coverage agreement | Operations leader | Operations leader | Independent review task; this package fixed the missing draft-agreement task |
| Triage request | Operations leader | Operations leader | Browser command |
| Prepare estimate | Project manager | Project manager | Browser command |
| Approve pricing | Operations leader | Operations leader | Browser command |
| Request additional approval | Project manager | Not required | Tenant A only |
| Decide additional approval | Independent administrator | Not required | Tenant A only |
| Record customer authorization and authorize service | Operations leader | Operations leader | One task leads to the coupled evidence/authorization sequence |
| Create executable job | Project manager | Project manager | Browser command; task disappears after job creation |

The service extension has **9 actionable task entries for A and 7 for B**. Customer authorization evidence is a distinct browser upload, but does not have a separate My Work task: it is a required prerequisite presented within the `authorize-service` responsibility. Estimate submission is part of the estimate/preparation path. The source Work ID is checked at every task entry. A completed create-job task URL is reopened and must not show an executable create action. This is a separate measure from the inherited core six-phase action inventory.

The first failing assertion was a reproducible absence of an Operations agreement-review task. `serviceTasks` now emits that task only for a Draft agreement created by a different actor. [The focused regression](../../scripts/p0a/verify-phase2htc-service-tasks.mjs) covers the independent actor and task disappearance after agreement approval.
