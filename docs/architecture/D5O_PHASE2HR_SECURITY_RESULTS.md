# Phase 2H-R security qualification

Evidence: `evidence/phase2hr-design-browser-results.json`, especially the Design API security test and the per-action browser records. This run uses disposable, loopback Supabase and distinct tenant accounts. It does not use production data.

| Attempt | Observed result | State check |
| --- | --- | --- |
| Tenant A actor posts a Design command for Tenant B | HTTP 403 | Design revision unchanged. |
| Forged Work identifier in Tenant A | HTTP 404 | Design revision unchanged. |
| Stale source revision | HTTP 409 | Design revision unchanged. |
| Finance actor attempts Design mutation | HTTP 403 | Design revision unchanged. |
| Finance actor attempts independent document review | HTTP 403 | Design revision unchanged. |
| Tenant A reads Tenant B private Design evidence | HTTP 403 | No foreign receipt returned. |
| Foreign actor calls hosted Design mutation directly | PostgreSQL `42501`, `design_editor_denied` | Hosted command denied. |
| Concurrent identical package creation command | One package and one idempotent receipt | No duplicate package. |
| Two simultaneous release replays with the original command ID | HTTP 200 and 200 | One accepted release. |
| Duplicate receipt with the original command ID | HTTP 200 | One accepted receipt. |
| Suspended Operations membership using an existing browser session | HTTP 403 | No Design mutation. |
| Suspended Operations membership calling the hosted review RPC | PostgreSQL `42501` | No Design mutation. |
| Removed Operations membership using the existing session | HTTP 403 | No Design mutation. |
| Tenant B rollout flag disabled | HTTP 403 | Re-enabled by vendor command after the check. |
| Tenant B suspended | HTTP 403 | Reactivated by vendor command without a new membership grant. |

The adapter rechecks authenticated membership, tenant lifecycle, entitlement and Work identity before invoking the hosted command. The hosted command checks business role, revision, evidence and independent decision authority in its transaction. The local same-origin PDF read exception is restricted to the exact isolated loopback runtime; it is **not** a general customer production grant.

The focused run has not separately exercised an invalid **PDF** reference at the new review route, a concurrent *different* Design decision, or direct Design RPC behavior under a disabled rollout flag. The adapter does not accept a task identifier, so there is no task-ID input to forge; it resolves responsibility from the Work identity and current hosted state. The direct RPC under tenant suspension and the general-customer production PDF route still need separate qualification. Existing hosted guards are not credited as new-route evidence. These targeted gaps prevent a blanket security qualification claim.
