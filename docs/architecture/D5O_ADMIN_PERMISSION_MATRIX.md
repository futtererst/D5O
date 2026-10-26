# Administration permission matrix

| Operation | Vendor administrator | Tenant administrator | Project manager | Operations leader | Nonmember or revoked |
| --- | --- | --- | --- | --- | --- |
| Read tenant directory and configuration summary | Allowed with active vendor identity | Denied | Denied | Denied | Denied |
| Tenant provisioning, billing and lifecycle mutation | Unavailable: authoritative command backend required | Denied | Denied | Denied | Denied |
| Read own configuration and history | No implicit customer access | Allowed by active membership RPC | Denied | Denied | Denied |
| Create, edit, validate and activate tenant configuration | No implicit customer access | Allowed with expected version, revision and reason | Denied | Denied | Denied |
| Create service Work | No implicit customer access | If published create right exists | If published create right exists | If published create right exists | Denied |
| Request service approval decision | No implicit customer access | Allowed | Allowed | Allowed | Denied |
| Approve required service request | No implicit customer access | Only when named authority and independent | Denied unless named authority | Only when named authority and independent | Denied |
| Read connected request's threshold status | No implicit customer access | Own tenant only | Own tenant only | Own tenant only | Denied |
| Request connected threshold approval | No implicit customer access | Own tenant and approved estimate | Own tenant and approved estimate | Own tenant and approved estimate | Denied |
| Authorize connected customer service decision | No implicit customer access | Denied unless Operations authority | Denied | Operations leader, with valid threshold decision and exact customer evidence | Denied |
| Create connected service job | No implicit customer access | Denied by connected job command | Published work-type right and valid approval | Published work-type right and valid approval | Denied |
| Cross-tenant configuration or work | Denied without a separate scoped support design | Denied | Denied | Denied | Denied |

The database is authoritative for every decision. Route visibility is a usability aid only. `enterprise_test` customer configuration is enabled exclusively in the disposable pilot runtime; production remains Rybex restricted.
