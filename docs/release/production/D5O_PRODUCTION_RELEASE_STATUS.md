# D5O integrated production release status

**Release preparation: PARTIAL. Production cutover is not authorized.** This is the single current register for the approved commercial scope: existing Rybex/Rotork pilot plus vendor-controlled customer onboarding, tenant configuration, Work/My Work, the supported six-phase lifecycle, Scope changes, post-Support-Active connected service, private evidence and separate Finance. Public tenant self-provisioning is excluded. Private evidence is served through authenticated application routes; direct end-user Storage reads remain denied.

## Immutable candidate and current targets

- Application candidate commit `4c8050f3a643bb0e92565fcbd8e1d5df3744d9ea` (ancestor `6f0bbc8d9ba916c75bf2149a8eaef6e667896072`), `app/` tree `84f2081b3b6266abf7d89906b04f816622838f2c`. The sole product correction admits the existing authenticated `/work/invitation` page through the hosted proxy. No database or business-command source changed.
- Source manifest: 236 executable SQL migrations, all manifest hashes rechecked; one duplicate-version `-ShawnT13.sql` file is excluded as recorded in [RC5 manifest](../evidence/D5O_RC5_COMPLETE_236_MIGRATION_MANIFEST.json). Latest SQL hash: `6fe726239c15941201f3026ab1a0bb5f42ab89d04fc95b294d54164c5ab4cea8`.
- RC8 bridge hashes: pre `0f076c496f756b8f56965b104cddd8c77c558344c89ca84cbf85946dfa924af5`; post `b15dcd56a30fc4b46e81ea792fbfd51e19213630b698bd5734334f0cccbdf5d8`.
- Current read-only Supabase check: project `fcawktdjoxvahhgvkebx`, database `postgres`, PostgreSQL 17.6, 177 ledger entries, latest `20261021123923`.
- Current read-only Vercel check: project `prj_HF8KhxUFvONQlpMr53FdhEgmIpFG`, latest production deployment `dpl_DYXNRK2PyF4UUUKqpPqNHVYhVKXm` at source `64487f8ec34da78325b0d87958ba5e29c46dd5fc`. It is **not** the selected candidate.

## Accepted evidence

- [RC18](../D5O_RC18_RELEASE_DECISION.md): commercial routing approval, local production-mode vendor onboarding, genuine fictional GoTrue, 23/23 checks.
- [RC19](../D5O_RC19_RELEASE_DECISION.md): 90 RPC, four policy, 18 grant and 149 constraint differences individually disposed; no new forward SQL justified. Application-command behavior remains separately unproven.
- [RC20](../D5O_RC20_RELEASE_DECISION.md): exact-candidate onboarding rerun, 177→202 isolated historical upgrade, protected business hashes and 23 private-object hashes. My Work and later lifecycle remain partial.
- [RC13 evidence contract](../D5O_RC13_EVIDENCE_ACCESS_CONTRACT.md): product owner accepted server-mediated private evidence. Do not add direct Storage SELECT.

## Release blockers and accountable completion tests

| Blocker | Root cause / impact | Owner and completion test | External approval or cost |
| --- | --- | --- | --- |
| Exact-candidate employee lifecycle and My Work | Onboarding-only RC20 fixture had no project-manager responsibility. Design through Finance is not fully exercised on the selected source. | Engineering: supported invitation and Work ownership; browser task decision; finite command/security matrix in [acceptance JSON](D5O_RELEASE_ACCEPTANCE_MATRIX.json). | No; local disposable resources only. |
| Employee invitation page rerun | The original production-mode proxy returned 503 before existing employee invitation acceptance. Exact-path correction passes 18/18 proxy checks, TypeScript, targeted ESLint and production build. The disposable end-to-end rerun did not complete because local Docker became unresponsive. | Engineering: restore local Docker health, run the retained supported-invitation regression and record genuine employee acceptance/task decision. | No purchase; no hosted resource. |
| Actual hosted candidate | Production deployment SHA differs. Effective runtime bindings, Auth, Storage and protected hosted route behavior are not qualified for candidate. | Release engineering: isolated hosted deployment tied to nonproduction data and bounded browser/API checks. | Explicit resource/deployment authorization; no unapproved purchase. |
| Coordinated recovery | Existing database and object captures are not atomic. A database-only restore may orphan later evidence or events. | DBA/release owner: write-quiescent checkpoint of DB/Auth/ledger and Storage metadata/bytes; isolated matched restore with associations and hashes. | Approval for later production maintenance/write boundary. |
| Production readiness | Current Vercel key-name inventory omits Billing V2, field-issue, closeout persistence modes and scanner mode/URL. Source readiness guard treats them as blockers; RC1 found their database contracts absent. | Operations and engineering: determine approved in-scope readiness contract, qualify schema/services and `/api/readiness` on exact hosted candidate. Do not set keys merely to force 200. | Potential scanner/service dependency; no expenditure approved. |
| Invitation and spending authority | Local fictional acceptance does not prove live SMTP delivery or actual tenant delegate configuration. | Operations/product owner: approved test recipient end-to-end delivery; read-only tenant authority inventory and bounded authorized test. | Live invitations/configuration require separate authorization. |
| Connected-service contract | Delivery Scope change versus post-handover service wording has no recorded formal owner acceptance. | Product owner: explicitly accept or reject the two-domain wording in [RC4 contract](../D5O_RC4_BUSINESS_CONTRACT_DECISION.md). | Owner decision. |

Stop on historical-row drift, missing object bytes, tenant/role bypass, unexpected ledger or target, failed restore, unapproved production mutation, or unavoidable unapproved cost. A production migration/deployment authorization request is premature while these gates remain open.
