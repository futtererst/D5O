# Phase 2A administration permission matrix

The labels below map to existing hosted roles; no custom role engine was added. Database commands recheck these rules independently of UI visibility.

| Operation | Tenant `admin` | Existing functional role | Field worker | Vendor directory role | No active tenant membership |
| --- | --- | --- | --- | --- | --- |
| Read own organization, people, invitations and activity | Yes | No | No | No implicit access | No |
| Edit profile, units, locations and teams | Yes | No | No | No | No |
| Assign teams and workforce organization | Yes | No | No | No | No |
| Invite approved non-admin role | Yes | No | No | No | No |
| Accept own matching invitation | As recipient | As recipient | Worker onboarding stays governed separately | As recipient only with a customer offer | As recipient |
| Change existing approved role | Yes, except self/admin/worker | No | No | No | No |
| Suspend, reactivate or remove ordinary tenant access | Yes, except self/admin/worker | No | No | No | No |
| Promote tenant admin | Existing protected succession only | No | No | No | No |
| Read platform tenant directory | No | No | No | Existing vendor permission only | No |

Assignable existing roles are `executive`, `operations_leader`, `business_development_lead`, `project_manager`, `billing_commercial_lead`, `field_supervisor`, `closeout_lead`, and `read_only_auditor`. `field_worker` is controlled by the existing workforce binding path. There is no unrestricted customer-created role, vendor role assignment, or cross-tenant grant.
