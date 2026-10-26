# Phase 2F two-tenant connected journey

Disposable run: `evidence/phase2f-connected-journey-results.json` (`45 passed`, `0 failed`, setup successful, cleanup verified). Source baseline: `8d536b4ce74282fe6c3a0e2dbb66b1752ca51ec2`. All IDs below belong only to the removed disposable project.

| Evidence | Rybex Test (`tenant_a_test`) | Independent Enterprise Test (`tenant_b_test`) |
| --- | --- | --- |
| Work ID | `85d16b6a-e333-47cf-aad0-f9311a8482ed` | `9d1c8dde-c3cf-4ced-a45b-b05b2183e115` |
| Pinned policy version | `c7180b21-3cb3-4cc5-afb8-141771825766` | `b89546a3-2d36-4179-bb09-d5cb7d58d61f` |
| Service threshold published | USD 10,000 | USD 25,000 |
| Discover and Define | Connected Work created; missing risk narrative denied; independently approved scope and handoff | Connected Work created; risk narrative optional; independently approved scope and handoff |
| Early solution preparation | Missing option evidence denied; documented solution independently approved | Option evidence optional; solution independently approved |
| Design | Package `wp-6d9753dcd7bd4dd4a747ebdb071e8928`; missing method denied; reviewed release accepted | Package `wp-3459cc6946c54f6a94e09b14a36d3f68`; reviewed release accepted with mandatory field method |
| Develop readiness | Approved purchase and labor authority; qualified bound worker; published and acknowledged booking; field-start permit `8d556b64-346a-4c18-8ae2-68bd6c7dea3d` | Same controls; permit `7e49adeb-30bf-46d0-825a-fc4a4b8220d3` |
| Deploy | Completion without reviewed evidence denied (`reviewed_evidence_required`), then completion `18fc0859-0ee4-440d-916b-12828c2707f9`; customer and Operations acceptance recorded | Extra reviewed-evidence policy optional; mandatory measured report and inspection pass; completion `35a17ef8-9dd8-40f4-81da-11fbffbae512`; customer and Operations acceptance recorded |
| Operate | Missing reviewed support document denied (`support_document_review_required`), then exact as-built uploaded, submitted and independently reviewed; support activated | Extra documentation-review policy optional; mandatory handoff, asset and support profile pass; support activated |
| Audit | 14 Deploy and 6 Operate events with correct Work, actor and tenant | 12 Deploy and 4 Operate events with correct Work, actor and tenant |
| Financial state | Pending; financial closeout is outside this package | Pending; financial closeout is outside this package |

After both journeys completed, Tenant A published a newer USD 11,000 threshold as an independent configuration version (`e61b979a-2a83-4ac0-898e-28f234653a37`). Its completed Work still referenced `c7180b21-3cb3-4cc5-afb8-141771825766` and retained its support activation decision.

The same application code, provisioning command, template publication process and business RPCs were used for both tenants. The fixture verified direct foreign-actor Deploy and Operate RPC denials (`field_membership_required`, `asset_authority_required`), unauthorized field-start denial, and a missing qualification denial. No synthetic record remains after teardown.

This is a complete **connected command journey** for one Work record per tenant. It is not a complete authenticated browser journey: full Work UI routing remains pilot scoped. The suite also does not claim financial closeout or a historical sealed pilot replay. Threshold publication is proven here; the separate Phase 1B suite is responsible for USD 15,000 service approval decisions.
