# RC12 release decision

**Overall NO-GO.** Real local GoTrue authentication and selected frozen-application operations now work against the actual upgraded historical database. The required direct private Storage user authorization fails under the restored policy set, and the full lifecycle command contract remains unexecuted. Production migration and deployment are not authorized.

| Gate | Result |
| --- | --- |
| Historical upgrade | **PASS:** 177→202 actual source entries, 25/25 frozen migrations, atomic RC8 bridge, source hashes intact. |
| Real GoTrue authentication | **PASS locally:** genuine fictional sessions and JWTs; exact 82-row production provider ledger copied read-only into the incomplete local Auth restore. Checkpoint-instant provider history remains unknown. |
| Application lifecycle HTTP/RPC | **PARTIAL:** real-session Work, connected creation, read surfaces and evidence download passed; later phase commands unexecuted. |
| Business-command security | **PARTIAL:** focused positive and negative controls passed; specialist/customer/field/finance matrices incomplete. |
| Direct private Storage API | **FAIL:** service and application proxy pass, genuine end-user direct GET lacks a positive RLS policy. |
| Historical business data | **PASS for captured original fields:** all original keys and nested Work/catalog entries preserved; provider-managed Storage migration hash drift recorded separately. |
| Local recovery | **PASS within local scope:** 177 and 202 checkpoints restored, hashes and associations verified, injected failure rolled back. No atomic production checkpoint or production RTO/RPO. |
| Actual hosted binding | **BLOCKED:** Vercel project found, required variable names present, effective values not verified; latest production deployment SHA differs from frozen application. |

Read-only metadata identified Vercel project `prj_HF8KhxUFvONQlpMr53FdhEgmIpFG` and latest production deployment SHA `64487f8ec34da78325b0d87958ba5e29c46dd5fc`, while the candidate is `8b6b0d9e4aa484d0f0db1d075a969b79e01b0989`. The production variable **names** include the hosted guard and Supabase bindings; encrypted/secret values and effective acceptance were not inspected. See [binding evidence](evidence/D5O_RC12_SOURCE_AND_BINDING.json).

**Stop conditions:** direct Storage policy remains unapproved or fails positive/negative controls; any later phase command needs a missing object or weakens authority; original protected business fields or object bytes change; provider ledger/schema or 202-entry source ledger drifts; wrong source SHA or runtime binding; no coordinated quiescent database/object checkpoint; or a missing recovery verification. Formal product-owner acceptance of delivery-change versus post-handover-service contract remains **DECISION REQUIRED**. Production stayed read-only; no push, merge, deployment, hosted project or purchase occurred.
