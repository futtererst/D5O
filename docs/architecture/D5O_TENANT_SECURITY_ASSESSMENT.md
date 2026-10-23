# D5O tenant security assessment

Baseline and evidence convention: `origin/main` `4cf881b5`; **C** code/migration inspection, **T** test source or execution, **R** runtime observation, **D** prior documentation. No production database or authenticated second-tenant session was inspected. The public health endpoint answered HTTP 200 on 2026-10-23 [R]; it does not qualify isolation.

## Boundary inventory and findings

| Boundary | Current evidence | Finding and required qualification |
|---|---|---|
| Identity/session | `proxy.ts:56-91` uses Supabase SSR `getUser`; `lib/d5o/hosted/prototype-context.ts:25-42` obtains actor/workspace [C]. | Authenticate on each sensitive request; test expired/revoked sessions, membership revocation and workspace switching. MFA/SSO/SCIM policy not established in repo. |
| Workspace/membership | `20261007013134_d5o_hosted_workspace_authority.sql:3-105` creates hosted workspace and membership objects and active actor RPC; `20261007013707_d5o_hosted_workspace_invoker_hardening.sql:4-25` adds RLS/invoker behavior [C]. | Good foundation; prove that every hosted read/write derives active workspace server-side. |
| Business records | `20261008230000_d5o_connected_work_identity.sql:579-633` checks actor, membership, workspace and revision; `lib/d5o/hosted/prototype-context.ts:52-79` forwards actor/membership to service-role RPC [C]. | Medium qualification risk: privileged RPC bypasses ordinary RLS, so malicious forwarded IDs, cross-tenant IDs and revocation need runtime negative tests. No exploit demonstrated. |
| Legacy direct mutation | `lib/d5o/opportunities/supabase-repository.ts:421-473` uses a service-role client to read/update an opportunity after a separate scoped read; the UPDATE filters ID and version but not workspace ID [C]. | Determine whether this route remains reachable in each deployment mode. Move any reachable write to an atomic workspace/actor-checked command; test race, revocation and cross-tenant ID. No cross-tenant exploit is established by inspection alone. |
| Configuration | `20261019213000_d5o_hosted_configuration_management.sql:114-153,365-377` checks active admin membership, tenant/version ownership, idempotency and event audit [C]. | Rybex-only API/UI blocks tenant B; test cross-tenant version IDs and stale revisions. |
| Evidence/storage | `app/api/d5o-hosted/design-document-evidence/route.ts:15-38,61-96` scopes object path and document registration; `app/api/d5o-hosted/private-evidence-index/route.ts` reads index [C]. | Test forged path, object ID, signed URL, listing, upload, deletion and retention across tenants. Service-role storage access is a privileged boundary. |
| Search/report/export | `app/api/d5o-hosted/prototype-search/route.ts:51-95` validates named workspace and uses service-role connected read after actor context [C]. | Test query and pagination leakage, cache keys, exports and error messages. Inventory other report endpoints before qualification. |
| Admin/support | `20261019183127_d5o_admin_backend.sql:205-265` rechecks active admin membership for service-role membership command; `app/api/d5o-hosted/admin-audit/route.ts:10-26` is Rybex-only [C]. | Vendor support identity is not a separate product or audited impersonation flow. No unrestricted DB UI should be introduced. |
| Jobs/integrations | Hosted schedule reports unavailable: `app/api/d5o-hosted/prototype-schedule/route.ts:11-15,93-99`; local JSON outbox `lib/d5o/scheduling/notification-delivery.ts:11-75` [C]. | No qualified hosted tenant propagation/retry. Require workspace ID in durable job payload and reauthorization before delivery. |
| Pilot controls | `lib/d5o/auth/hosted-target.ts:3-30`, `lib/d5o/auth/approved-test-recipient.ts:5-24`, `components/d5o/platform/work-types.ts:1`, and multiple `app/api/d5o-hosted/*` allowlists [C]. | Intentional containment also limits commercial onboarding. Replace through verified tenant registry and rollout gate, never simply delete. |

No `FORCE ROW LEVEL SECURITY` statement was found by a search of committed migrations [C]. Hosted tables use RLS and direct grants are restricted in the initial hosted migration, but privileged owners/`SECURITY DEFINER` functions may bypass RLS. Whether FORCE is appropriate must be decided table by table after confirming owners, grants, policies and command semantics in a disposable database; absence alone is not proof of a vulnerability. Legacy `0005_identity_workspace_security.sql:291-297` allows profile self-update under RLS; column grants and runtime behavior must be checked before any severity claim.

## Severity and containment

**High release-blocking qualification gap:** independent tenant isolation has not been demonstrated end to end. Preconditions for a breach would include a service-role RPC or route accepting a forged workspace, record, actor or membership combination, or a storage path escaping its workspace. Code contains mitigating checks, so this is a test requirement rather than a confirmed cross-tenant exploit. Until the P0 gate passes, keep named pilot allowlists and verified target controls in `hosted-target.ts` and hosted routes. If a negative test reveals leakage, disable only the affected route/command, preserve audit evidence, then repair and retest before expansion.

## Isolated, non-destructive test matrix

Use a disposable Supabase project and local app with the committed migration set applied in order. Snapshot an empty baseline. Create fictional tenant A (Rybex test copy) and tenant B (Fictional Enterprise), each with admin, manager and ordinary member; add a vendor support actor with **no** customer membership. Use distinct records, config versions, evidence objects and unique marker strings. Never use production tenant rows. After each negative command, assert unchanged row counts, immutable event sequence and no storage object mutation.

| Case | Actor / operation | Expected |
|---|---|---|
| S1 | A admin lists A work/config/users/evidence | A resources only. |
| S2 | B admin lists B work/config/users/evidence | B resources only. |
| S3 | A member reads B work ID via page, search, RPC, report/export | Denied or not found; no B metadata in body, logs or cache. |
| S4 | A manager mutates B work ID with A workspace, then with B workspace | Denied; B and A state unchanged. |
| S5 | A admin passes B configuration version ID to draft/save/publish/activate | Denied; no B event or receipt. |
| S6 | A admin reads/downloads B object ID, guessed path or signed URL | Denied; no object bytes or metadata. |
| S7 | Ordinary A member calls A admin, membership and support commands | Denied and audited as appropriate. |
| S8 | Revoke A manager membership, reuse live browser/token, retry command | Denied immediately at DB command boundary. |
| S9 | Replay same command ID with same and changed payload | Same receipt for exact replay; conflict for changed payload. |
| S10 | Concurrent draft edits/activation with stale revision/default | One winner; stale request fails without partial writes. |
| S11 | Background payload with B ID under A actor, plus retry after revocation | No cross-tenant delivery or mutation; isolated failure. |
| S12 | Vendor support without scoped grant attempts A/B data | Denied; any approved support access records actor, tenant, reason, duration. |

Existing narrow negative-test sources include `scripts/qa-d5o-hosted-workspace-authority.sql`, `scripts/qa-d5o-connected-customer-integrity.mjs:54-62` and `scripts/qa-d5o-next-priorities-integrity.mjs:26-35` [T source]. They do not replace the matrix or demonstrate production success. Record SQL role, JWT claims, membership status, HTTP response, DB row diff, storage diff, audit event and request ID for every case.

## Tenancy deployment recommendation

Keep a **pooled database with workspace-keyed rows and verified RPC/RLS boundaries** for the first commercial tenants, because that is the implemented model and supports shared code/configuration. Add tenant-aware backup/restore procedures and isolation evidence. Offer dedicated Supabase projects only for contractual isolation, residency or operational requirements, after cost and migration design. Schema-per-tenant adds migration overhead without a demonstrated need. No tenancy rewrite is justified before P0 testing.
