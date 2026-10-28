# D5O integrated production release status

**Release preparation: PARTIAL. Production cutover is not authorized.** This is the single current register for the approved commercial scope: existing Rybex/Rotork pilot plus vendor-controlled customer onboarding, tenant configuration, Work/My Work, the supported six-phase lifecycle, Scope changes, post-Support-Active connected service, private evidence and separate Finance. Public tenant self-provisioning is excluded. Private evidence is served through authenticated application routes; direct end-user Storage reads remain denied.

**2026-10-28 hosted preflight:** read-only account checks reconfirm the Vercel production deployment is on a different SHA, the Supabase production ledger is 177, the sole visible Supabase organization is Pro, and Preview variable names exist but their effective values/isolation are unverified. No Free organization or D5O staging target is visible. A separate Free organization/project may avoid a subscription charge under published limits, but account eligibility and total Vercel usage cost are not established. See [hosted inventory](evidence/hosted-readonly-20261028.json) and [qualification plan](D5O_HOSTED_QUALIFICATION.md). No hosted staging authorization was given; no hosted test or resource creation occurred.

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

## Local application acceptance

The minimal local fixture completed **24/24** hosted-mode checks with genuine fictional GoTrue sessions and verified cleanup. An administrator invited a project manager; that employee accepted through the corrected route, created connected Work under an administrator-published create right, opened the assigned My Work link in a browser, submitted Discover intake through HTTP 200, and resolved the task. One matching authoritative pursuit event and command receipt were verified; an independent review task appeared next. [Machine result](evidence/employee-acceptance.json) and [assigned](evidence/employee-my-work-assigned.png) / [submitted](evidence/employee-my-work-submitted.png) browser captures are retained. The application candidate did not change.

**LOCAL APPLICATION ACCEPTANCE QUALIFIED for the selected candidate.** The minimal production-mode fixture passed [63/63 hosted lifecycle checks](evidence/hosted-lifecycle-complete.json) with genuine fictional GoTrue sessions. Browser and authoritative command results cover Design release, Develop authority, field execution and evidence, independent inspections and acceptance, Operate Support Active, connected service with one child job, and separate Finance In review. A [47/47 RC4-B.1 branch](evidence/hosted-scope-change-complete.json) covered commercial Scope holds, independent/customer authorization, revised Design and distinct renewed permits, with 23 protected-state denial/replay checks. The earlier second-tenant “Disposition” timeout did not recur in either passing run; its exact original timing cause was not captured. The diagnostic's guarded refresh was not needed in the 63-pass run. No product source or migration changed. Both disposable runs reported verified cleanup. See the [matrix](D5O_RELEASE_ACCEPTANCE_MATRIX.json) for each row's evidence and the separate external gates.

## Release blockers and accountable completion tests

| Blocker | Root cause / impact | Owner and completion test | External approval or cost |
| --- | --- | --- | --- |
| Actual hosted candidate | Production deployment SHA differs. Effective runtime bindings, Auth, Storage and protected hosted route behavior are not qualified for candidate. | Release engineering: isolated hosted deployment tied to nonproduction data and bounded browser/API checks. | Explicit resource/deployment authorization; no unapproved purchase. |
| Coordinated recovery | Existing database and object captures are not atomic. A database-only restore may orphan later evidence or events. | DBA/release owner: write-quiescent checkpoint of DB/Auth/ledger and Storage metadata/bytes; isolated matched restore with associations and hashes. | Approval for later production maintenance/write boundary. |
| Production readiness | Current Vercel key-name inventory omits Billing V2, field-issue, closeout persistence modes and scanner mode/URL. Source readiness guard treats them as blockers; RC1 found their database contracts absent. | Operations and engineering: determine approved in-scope readiness contract, qualify schema/services and `/api/readiness` on exact hosted candidate. Do not set keys merely to force 200. | Potential scanner/service dependency; no expenditure approved. |
| Invitation and spending authority | Local fictional acceptance does not prove live SMTP delivery or actual tenant delegate configuration. | Operations/product owner: approved test recipient end-to-end delivery; read-only tenant authority inventory and bounded authorized test. | Live invitations/configuration require separate authorization. |
| Connected-service contract | Delivery Scope change versus post-handover service wording has no recorded formal owner acceptance. | Product owner: explicitly accept or reject the two-domain wording in [RC4 contract](../D5O_RC4_BUSINESS_CONTRACT_DECISION.md). | Owner decision. |

The immediate authorized work is complete through read-only hosted preflight and recovery planning. The next release action requires one explicit **isolated staging authorization** covering owner/plan/cost ceiling, Preview binding and variable edits, exact candidate deployment, restricted testers and synthetic Auth/test email. Production cutover approval is a later, separate decision.

## Operational readiness classification for the approved scope

| Requirement | Current decision | Completion evidence required |
| --- | --- | --- |
| Billing V2, field-issue and closeout persistence | **MANDATORY / OPEN** under the current global production readiness guard; source requires database mode, and RC1 found missing hosted schema contracts. | Reviewed compatible schema/service behavior, tenant denial and exact hosted `/api/readiness`; setting variable names alone is insufficient. |
| Scanner mode and URL | **MANDATORY / OPEN** for private evidence custody under the current guard. | Approved reachable scanner with clean, infected, error and timeout behavior in isolated hosted staging. No unapproved paid service. |
| SMTP and administrator invitation | **MANDATORY / OPEN** for vendor-controlled onboarding. | Approved test recipient, real delivery/acceptance and no customer invitation during qualification. |
| Production spending authority and tenant configuration | **MANDATORY / OPEN** for authorized commercial commands. | Read-only production role/configuration inventory, named owner and bounded authorized approval test; local fictional delegates do not prove readiness. |
| Private evidence, Work/My Work, field issue and closeout application behavior | **LOCAL PASS where covered; HOSTED OPEN**. | Representative exact-candidate hosted routes and persistent state with independent staging Auth/Storage. |
| Monitoring, logs, on-call and customer support | **MANDATORY / OPEN**. | Named operator, alert route, incident/rollback authority and tested response procedure. |
| Backup, matched restore and retention | **MANDATORY / OPEN**. | Approved write-quiescent checkpoint, database/Auth/ledger plus private bytes, isolated matched restore, retention/disposal owner. |
| Public self-service signup | **OUT OF SCOPE**. | Keep disabled. |

Formal owner acceptance of the delivery Scope-change versus post-handover connected-service wording remains **DECISION REQUIRED**. These readiness items cannot be waived by a local application pass.

Stop on historical-row drift, missing object bytes, tenant/role bypass, unexpected ledger or target, failed restore, unapproved production mutation, or unavoidable unapproved cost. A production migration/deployment authorization request is premature while these gates remain open.
