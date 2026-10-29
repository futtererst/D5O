# D5O quality recovery assessment — 29 October 2026

## A. Executive assessment and release decision

**BLOCKED for production promotion.** The reconciled local candidate has a clean production dependency audit, passing lint/typecheck/default build, fresh 47/47 and 52/52 authenticated two-tenant connected journeys, local private-object byte recovery, and responsive Pipeline checks. These results materially improve on the earlier FAIL assessment of a stale, dirty June checkout. They do not establish a matched hosted database/Auth/Storage recovery point or acceptance of a deployed candidate. The current production release record explicitly withholds promotion.

The highest remaining risks are the unavailable GREEN PostgreSQL URI and unexecuted historical transfer and final-delta synchronization, the legacy service-role JWT reported in CLI output, missing hosted authenticated smoke and matched restore, four high development-tooling advisories, and incomplete independent exact-boundary financial and fully browser-driven six-phase coverage. No production data, deployment, migration, credential, or paid resource was changed.

## B. Source reconciliation and defect register

GitHub's default `main` was verified at `4cf881b506def45564040d767292c5c8c4ecbe48`. The newer GitHub `codex/d5o-production-execution` tip was verified at `d84a1ac5ffae9b60f83e01926e95d33c35487564`; it is 76 local commits ahead of that main baseline and contains the later release records. The latest production decision identifies `4c8050f3a643bb0e92565fcbd8e1d5df3744d9ea` as its selected application source. That commit is an ancestor of `d84a1ac5`; subsequent changes are primarily release/recovery tooling and records, with changes to two production-security/readiness modules. The selected source is **not** an approved production promotion: the record says GREEN hosted acceptance is partial. The deployed application SHA and effective hosted bindings were not verified in this recovery.

The original checkout remains `feature/billing-v2-guided-ui-replacement` at `ef5cfe85` with 545 pre-existing and prior-audit porcelain entries. Its changes span scripts, docs, source, migrations, artifacts and nested worktrees; [the path manifest](original-checkout-status.txt) records them. Their authorship and intent cannot all be inferred from Git status, so none were staged, discarded, reset, or incorporated wholesale. This audit was executed in the separate, initially clean worktree `codex/d5o-quality-recovery-20261029` based on exact `d84a1ac5`.

The complete disposition and reproduction details are in [DEFECT_REGISTER.md](DEFECT_REGISTER.md). Critical and High findings from the earlier checkout were triaged against the reconciled source before lower-priority work.

## C. Code, architecture, and security assessment

- The legacy generic workflow action accepted a caller-provided workflow snapshot and its privileged adapter used multiple writes without a single transaction. The production route was already unavailable through the proxy, but the action and adapter now independently reject production writes (`3eb15b04`). A future replacement needs one server-owned tenant/role/revision/idempotency/audit transaction. The release candidate's supported hosted commands are separate.
- `runtime-identity.ts` references server secret-key names. Adding `server-only` and keeping the verifier's explicit marker requirement protects its import boundary. The RC2 script now runs under the React server condition without removing assertions. The previous `verify-rbac.mjs` failure was a stale-checkout mismatch; it passes unchanged on the reconciled branch.
- The prior critical Next 16.2.9 finding and four high production advisories are absent in this candidate's Next 16.4.2 production dependency graph. After compatible lockfile updates (`75e9c1ab`), `npm audit --omit=dev` is 0/0/0/0 and full audit reports four High in the Prisma CLI chain: `deepmerge-ts` and `effect`, inherited by `@prisma/config` and `prisma`. npm proposes Prisma 7.10.1, a major version. No application import of Prisma Client was found in `app/` or `lib/`; this limits demonstrated runtime reachability but does not clear build/CI tool exposure. [Current audit snapshot](dependency-audit.json).
- The current configuration RLS and migration-order focused verifiers pass. A legacy aggregate Configuration Foundation verifier fails five assertions about historical artifacts and a superseded No-Go recommendation; this is an open test-maintenance issue, disclosed in the defect register.

## D. Functional coverage matrix

| Area | Implemented/approved candidate scope | Fresh verification | Result and evidence |
| --- | --- | --- | --- |
| Discover | Connected intake, policy and Work creation | Fictional Auth users in two tenants, policy denial, direct RPC entitlement and intake | PASS, [journey](two-tenant-journey.json) |
| Define | Draft, risk requirement, independent review and baseline handoff | Strict-vs-optional tenant policy, draft, approval and handoff | PASS, same journey |
| Develop | Selected solution, estimate, economic and labor authority | Missing option denial, solution and estimate approval, independent purchase/labor approval | PASS for exercised path, same journey |
| Design | Award basis, package, document, reviewed release | Missing award denial; exact awarded scope, package and release | PASS for exercised path, same journey |
| Deploy | Published qualified crew, field evidence, review, acceptance | Authenticated worker/reviewer browser actions, strict policy denial and recovery, two customer/Operations acceptances | PASS for exercised path, same journey and [screenshots](browser/) |
| Operate | Support activation from exact Deploy receipt | Tenant-separated support acceptance, audit continuity, cross-tenant direct RPC denial | PASS for exercised path, same journey |
| Tenant administration and Configuration Center | Onboarding, independent tenant policies and thresholds | Two fictional tenant admins, immutable template and tenant policy publication, entitlement denial | PASS for exercised path, same journey |
| Procurement, subcontract, full finance and My Work | Multiple implemented command paths; some enterprise scenarios outside these runs | Purchase/labor authority in the 47-check journey; service threshold request/approval, wrong-role denial, task links/resolution, authorization, one job per tenant, and replay protection in a separate 52-check run | PASS for exercised service/My Work path; full procurement/subcontract and boundary coverage still partial. [Result](service-my-work-journey.json) |
| Legacy generic workflow endpoint | Not an approved production write path | Production-mode local POST returned 503; source guard and focused verifiers pass | Contained; no direct authenticated action invocation |
| Pipeline responsiveness | Approved current layout | Fresh production-build Chrome at 1440×900, 900×900 and 390×844 | PASS, [measurements](pipeline-layout.json) |

The 47-check runner uses authoritative RPC fixtures for some early setup, then real authenticated browser actors for field, review, acceptance and administration. It is a connected business journey, not proof that every phase is entirely browser-driven. Unimplemented or future functions are not entered as code defects merely for being outside this candidate's accepted release scope.

## E. Test, database, recovery, and performance report

| Gate | Fresh result on the isolated candidate | Limit |
| --- | --- | --- |
| `npm run typecheck`, `npm run lint` | PASS | Static checks only. |
| `npm run build` | PASS with Next 16.4.2 default Turbopack, 45 static pages generated | Initial sandbox runs failed creating Windows junctions; rerun with local junction privilege and clean ignored output passed. |
| Security foundation, RBAC, workflow action/runtime, production no-local-fallback, RC2 runtime (21 synthetic cases) | PASS | Source/synthetic tests complement, but do not replace, Auth/RLS tests. |
| Authenticated two-tenant connected browser/RPC journey | 47 PASS, 0 FAIL; setup and teardown verified | Disposable local stack; not hosted acceptance. [Result](two-tenant-journey.json). |
| Expanded service approval and My Work journey | 52 PASS, 0 FAIL; setup and teardown verified | Authenticated task links, threshold approval, service job, wrong-role/cross-tenant/replay denials; exact-limit/below-limit/above-limit matrix remains unrun. [Result](service-my-work-journey.json). |
| Cross-tenant and wrong-role requests | PASS within journey: direct RPC and API adapter denials with unchanged state, Design/Deploy/Operate denial | Scoped to exercised objects and roles. |
| Fresh migration replay | Disposable Supabase startup passed; checksum verifier reported 235 existing checksums matching and 236 executable migrations | No historical hosted ledger upgrade or restored production-schema comparison this turn. |
| Private Storage object recovery | Exact bytes restored, anonymous read denied before/after, teardown clean; 412 ms object restore | New object UUID differs; no DB/Auth restore or matched hosted recovery point. [Result](local-object-recovery.json). The probe script carries an old hardcoded `candidateCommit` field; this report identifies the actual source separately. |
| Pipeline browser | 1440, 900, 390 px: 200, 0 overflow, 0 page errors | One route and Chrome engine; no complete tablet/mobile audit of all pages. [Result](pipeline-layout.json). |
| Dependency scan | 0 production advisories; full scan 4 High, 0 Critical | Advisory reachability beyond observed dependency graph not proven. [Result](dependency-audit.json). |
| Performance | 412 ms for one local object restore; browser load/performance thresholds not established | No representative load, API latency, memory or production-scale capacity claim. |

The earlier 37-pass/10-fail journey was **not** reused as final evidence. Its first failure was the fictional authority interval beginning after the pinned booking date. The corrected fixture in `1418ff9a` was followed by the fresh 47/47 and 52/52 runs. The five-failure historical Configuration Foundation verifier remains recorded and is not a current green gate.

## F. Remediation record

| Commit | Change | Independent post-change evidence |
| --- | --- | --- |
| `3eb15b04c49a4055225cc8bdb7f532fb4a87ec52` | Reject production generic workflow writes at action and persistence boundary; add server-only identity import and adjust intact verifiers. | Focused verifiers, RC2 21-case synthetic runtime, typecheck, build, production-mode route 503. |
| `75e9c1ab67f48238cef5d401e7f92733113acfef` | Compatible transitive dependency lockfile refresh. | Fresh production audit zero; full audit four Prisma-chain High. |
| `530a47889996efa8a288125397cf99d0b26065fd` | Pipeline intermediate tablet layout. | Production-build browser at three viewport sizes; zero document overflow. |
| `1418ff9afedff630774ff4f7428c1ae579e8ddb2` | Correct fictional labor authority dates in disposable journey. | Fresh 47/47 two-tenant journey and clean teardown. |

The code tree qualified in this report is the exact tree at `1418ff9afedff630774ff4f7428c1ae579e8ddb2`; the following assessment/evidence commit changes documentation and captured artifacts only. No production promotion or push was performed.

## G. Recommendation and release conditions

**BLOCKED. Do not promote the candidate.** The local fixes are reviewable and the exercised operating path works, but required hosted acceptance and recovery evidence cannot currently be obtained. Next actions, in order:

1. Obtain the restricted GREEN PostgreSQL connection and provider-supported database/Auth/Storage transfer procedure; rotate or disable the exposed legacy service-role JWT before any hosted users.
2. Build a synchronized final-delta checkpoint, verify historical row/object/auth identities and hashes on GREEN, rehearse matched restore and failure recovery, and validate migration ledger/schema equivalence without touching BLUE production until a separately authorized cutover.
3. Deploy only to an authorized protected nonproduction candidate, verify effective bindings and authenticated multi-role/two-tenant business, financial and direct API negative cases, then repeat the six-phase journey there.
4. Complete exact/below/above financial limit and concurrent commitment tests, procurement/subcontract cases, remaining My Work and full UI/device/accessibility and performance gates. Resolve the four Prisma tooling advisories through a tested supported upgrade or documented compensating controls.
5. Reconcile the historical Configuration Foundation verifier with its frozen intended baseline; rerun all gates on the exact final commit before any new release decision.
