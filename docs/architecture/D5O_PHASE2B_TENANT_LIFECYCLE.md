# Phase 2B tenant lifecycle

| State | Entry | Allowed next action |
| --- | --- | --- |
| `awaiting_admin` | Transactional vendor provisioning, or invitation recovery | Recipient accepts; vendor recovers invitation |
| `failed` | Provider invitation rejected or uncertain | Vendor recovers and replaces offer |
| `setup_required` | Exact invited recipient accepts | Customer completes required setup and confirms readiness |
| `ready` | Customer readiness command validates required setup | Vendor activates after current-state recheck |
| `active` | Vendor activation | Hosted Work creation allowed |
| `suspended` | Reserved lifecycle value | No UI or command to enter this state in Phase 2B |

The provision command is atomic for database resources. `awaiting_admin` and `failed` do not grant a customer membership. The invitation expiry check and replacement command prevent stale acceptance; accepted offers cannot be recovered. `ready` is a revisioned customer decision, and activation is a separate vendor decision. Opening an onboarding page never advances state. A Work insertion trigger blocks provisioned tenants unless `active`; existing pilot workspaces are unaffected.

Required readiness: valid legal/display names and primary contact; accepted active initial administrator; a current published hosted configuration; explicit service approval policy in the tenant's default currency with `greater_than` semantics and `block` if authority is unavailable; no provisioning failure. Business units, locations, teams, and additional users are displayed as recommended or optional, using existing Phase 2A pages. No fictional operational data is created for readiness.

Each transition records the actor, reason, tenant and outcome in `platform_events`; command receipts prevent duplicate decisions. Concurrent decisions use row locks and revision checks. Invitation dispatch remains an external side effect and is recorded as accepted, rejected, or uncertain; an accepted provider request does not prove delivery to a mailbox.
