# D5O local qualification — 29 October 2026

> Historical snapshot from commit `e275da6a`. The current assessment is [D5O final local qualification](../d5o-final-local-qualification/ASSESSMENT.md), with eight canonical finance checks, 66 authenticated browser checks, Prisma 7 advisory remediation, and the current release decision. The findings below retain their original as-of date.

## Decision

**Local qualification: CONDITIONAL. Production promotion: BLOCKED.** The candidate passed the connected two-tenant browser journey, the historical Configuration Foundation suite, local database/Auth/Storage recovery probe, lint, typecheck, build, and focused security checks. The requested exhaustive financial matrix and all browser acceptance details are not yet proven. GREEN matched restore, deployed candidate acceptance, and promotion authorization remain external gates. No production or GREEN state was touched.

The source is the isolated `codex/d5o-quality-recovery-20261029` worktree, initially clean at `ef8d2936d2b9e8651fcaf4aa8a2562b46e2998bc`. This qualification's final commit is stated in the final handoff after all generated evidence is committed. Original-checkout changes were not staged or altered. Test-generated screenshots and machine results in this worktree were preserved as evidence.

## Corrected findings

| ID | Class | Reproduction and root cause | Correction | Verification |
| --- | --- | --- | --- | --- |
| LQ-01 | Test maintenance / Medium | Configuration Foundation's five failures used missing frozen P1-01B.1/.2 baselines and assertions from a superseded release document. | Restored the exact historical artifact folders from the original checkout, pinned their manifest SHA-256 hashes, and asserted the current production decision's local-qualified/production-No-Go language. | `node scripts/verify-configuration-foundation.mjs` passed all six subchecks; the database subcheck separately passed fresh/upgrade migration and 34 RLS/policy checks. |
| LQ-02 | Local infrastructure / Medium | Disposable database verification exhausted Docker's default address pool. | Loopback network creation retries a bounded private subnet only for that exact Docker error; existing loopback-binding checks remain. | Fresh Configuration Foundation database verification passed with clean disposal. |
| LQ-03 | Test assertion / Low | First financial threshold test compared PostgreSQL's `false` output to `f`. | Corrected the fixture assertion without changing application or database behavior. | Fresh 20/20 service approval suite passed. |

No new application defect was verified in the exercised paths. There were no product source or migration changes.

## Financial and authorization evidence

- Genuine authenticated RPC tested tenant A USD 10,000 and tenant B USD 25,000 service approval policies at one unit below, exact, and one unit above. Each accepted/denied result was checked against persisted decision and audit rows. Cross-tenant, wrong-role, and currency bypasses left financial and audit state unchanged. [Machine result](service-threshold-boundaries.json): 20/20, clean teardown.
- Rolled-back database probes tested purchase-order delegation at three bounds and subcontract allocation, agreement, and variation at nine bounds. Wrong reviewer denied, selected delegate allowed; before/after canonical counts equal. [Machine result](financial-delegation-db.json): two suites, 12 cases, clean teardown. These probes test delegation selection and trigger authority, not an end-to-end committed PO or subcontract workflow.
- [Connected browser result](../../docs/release/evidence/D5O_RC3_TWO_TENANT_BROWSER.json): 62/62, clean teardown. It includes independent purchase and labor authority, service price authorization and one job, cross-tenant/role/forgery/stale/replay denials, Finance My Work follow-up, and exact actor/tenant/Work audit linkage. The 47 earlier connected cases and 52 earlier service cases are all present by case name in this 62-case run; the two old suites overlap.
- **Open local financial gaps:** a complete matrix for every configured policy category; cumulative committed/incurred/outstanding totals; simultaneous approvals at a shared budget cap; canonical PO/subcontract variation and labor commitment writes at below/exact/above limits; no-side-effect proof for every rejected financial path. Do not interpret the passing delegation probes as those missing tests.

## Browser and recovery

The connected 62-case run used fictional authenticated actors in two disposable tenants, performed browser decisions through Discover, Define, Develop approval, Design release and evidence, Deploy field execution/acceptance, and Operate support and service. It also performed direct API/RPC negative probes, which are labeled separately in the machine result. Desktop/mobile screenshots are under `docs/release/evidence/rc3-browser/`; focused tablet Pipeline evidence is in the prior recovery assessment. Explicit full tablet acceptance of every page, comprehensive keyboard/accessibility tests, and an independently named refresh/logout/new-session matrix remain open.

The [local recovery result](local-recovery.json) passed five checks: a fictional GoTrue user and private object, rollback of an interrupted transaction, in-memory logical backup of the probe/Auth rows, restored user ID with successful password sign-in, matching database path/object bytes with anonymous denial. Two disposable stacks were cleaned. Storage metadata object UUID changed on reupload; the test proves path and bytes, not physical metadata identity or a matched hosted recovery point. Configuration Foundation's database suite replayed 0001–0026 fresh and upgrade; the connected fixture built the current full schema. A second repeated restore cycle and hosted point-in-time restore remain unverified.

## Dependency and final gates

`npm audit --omit=dev --audit-level=low` found zero advisories. Full `npm audit` found four High and zero Critical, all in dev-only Prisma CLI/config: `deepmerge-ts` and `effect` are exact dependencies of `@prisma/config@6.16.3`, inherited by `prisma`. Prisma CLI is reachable when local/CI `prisma:validate` or `prisma:generate` runs; no application Prisma Client import was found in `app/` or `lib/`, and normal Next build did not invoke it. npm's supported proposed fix is Prisma 7.10.1, a major upgrade; no unsupported override or forced upgrade was applied. Restrict CI inputs and defer a tested Prisma 7 migration; keep these advisories open.

Final local commands: ESLint PASS; `tsc --noEmit` PASS; default Next 16.4.2 production build PASS; RBAC PASS; security foundation PASS; Configuration Foundation static PASS; Configuration Foundation database PASS; 20/20 service threshold PASS; 12 delegation boundary cases PASS; 62/62 connected browser PASS; local restore 5/5 PASS. These runs used the candidate code tree and disposable local infrastructure. [GREEN runbook](GREEN_ACCEPTANCE_RUNBOOK.md) gives the hosted steps and separate promotion decision.

**Release restrictions:** do not promote to production. Close the open financial and browser gaps locally where practical, then obtain GREEN matched database/Auth/Storage restore, verify the exact deployed artifact and migration ledger, repeat hosted two-tenant and financial acceptance, and receive explicit promotion authorization.
