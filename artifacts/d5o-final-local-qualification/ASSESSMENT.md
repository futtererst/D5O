# D5O final local qualification — 29 October 2026

## Decision and exact source

**Local qualification: CONDITIONAL. Production promotion: BLOCKED.** No Critical or High application defect was verified in the implemented paths exercised here. The mandatory local finance and browser suites passed, but an approved purchase-order revision command is absent from the current API and a matched GREEN restore and hosted acceptance have not occurred. Do not promote this candidate.

The isolated branch is `codex/d5o-final-local-qualification-20261029`, created from the clean recovery baseline `e275da6ab0a03c0b5bde5568f12ac7edd4af7ac5`. The application, finance/browser test, dependency, and selected evidence tree passed at `c12d4ca`; its browser code was last changed at `b4b137c`. The supported token-expiry probe and evidence passed at `e03c948`. The final documentation commit and clean-worktree confirmation are stated in the handoff. No original-checkout work, GREEN, or production resource was changed.

## Financial integrity

| Gate | Fresh local result | Persistence and limit |
| --- | --- | --- |
| Tenant-specific service thresholds | [20/20 authenticated cases](evidence/service-thresholds.json) | Tenant A USD 10,000 and tenant B USD 25,000, below/exact/above, wrong role, foreign tenant and currency denial; decision and audit rows checked. |
| Canonical financial commands | [8/8 cases](evidence/canonical-financial.json), clean teardown | Real authenticated PostgREST RPCs and PostgreSQL rows/triggers; one selected delegate also approved a PO through the actual browser UI and Next API. |
| PO approvals | PASS | Two simultaneous USD 3,000 drafts competing for USD 5,000 purchase authority yielded one approval; retry, duplicate, and USD 2,000.01 excess denied. Two approved reservations totaled USD 5,000; denied commands added no Graybar events. |
| PO draft replacement | PASS | Cancel, identical-command replay, new draft for the same BOM allocation, and withdrawal produced no additional purchase reservation. An approved-PO revision command does not exist in the current route/RPC contract. |
| Subcontract and shared parent cap | PASS | USD 4,000 agreement plus USD 1,000 variation combined with USD 5,000 POs reached the USD 10,000 parent cap exactly. A further variation was denied with unchanged reservations and events. |
| Design, labor, delegate | PASS | Concurrent Design approvals serialized at USD 6,000; USD 0.01 excess denied. Labor cap below USD 3,000 existing exposure denied without event; exact replacement approved. Selected USD 1,000 PO delegate approved via UI; nonselected admin denied; Design + labor + PO filled the USD 10,000 parent cap exactly. The labor cap-change fixture seeded the pre-existing reservation; the separate browser suite verified production crew publication persisted real bounded labor reservations. |
| Cross-family concurrency | PASS | With USD 9,000 subcontract already reserved, a USD 1,000 PO and USD 1,000 variation were approved concurrently. Exactly one committed; the other returned `23514`. Purchase + subcontract persistence moved from `0:900000` to `100000:900000` minor units, not USD 11,000. |

The suite checks wrong-role and cross-tenant mutations, command replay, exact/over-limit conditions, committed totals, and audit or reservation counts. It does not prove every possible finance integration or all long-running load patterns.

## Six-phase browser and security acceptance

The [final machine result](evidence/six-phase-browser.json) passed **66/66** with zero failed checks and clean disposal. Fictional authenticated users in two tenant workspaces completed Discover → Define → Develop approval → Design release → Deploy field evidence and independent customer/Operations acceptance → Operate support and service. The run used browser decisions for the connected journey and separately labeled direct API/RPC negative probes. It verified documents, My Work and Finance follow-up, rejection/recovery, phase pins, persisted audit actor/tenant/Work lineage, wrong-role and cross-tenant denials, and bounded published labor reservations in both tenants.

Desktop and mobile screenshots remain in the earlier 62-case release evidence. This run measured all six phases at a 900 px touch viewport: document and viewport width were 900 px for each phase, touch navigation reached the work hub, and [the rendered tablet screen](evidence/tablet-operate.png) was inspected. Keyboard navigation reached the work hub and sign-out link; visible customer Work controls had accessible names in the checked screen. Explicit logout denied direct Work navigation, and fresh sign-in recovered the persisted record. Suspension/removal stale-session denials also passed.

A separate [3/3 session-lifetime browser probe](evidence/session-expiry.json) used a copied local Auth config with a five-minute JWT and the production Auth proxy. After 311 seconds, protected `/work` still rendered through token refresh; clearing the browser cookies then redirected protected navigation to sign-in. An initial 60-second probe failed, but [Supabase advises against JWT lifetimes below five minutes](https://supabase.com/docs/guides/auth/sessions); it is retained only as diagnostic runtime output, not as release evidence. This test does not prove hosted inactivity or time-box policies that were not configured locally.

Two preliminary extended runs failed at a transient 401 and a missing task. The second teardown then exposed Docker API 500 and an orphaned disposable stack; that infrastructure failure is confirmed, while the earlier 401's cause was not isolated. After an engine restart and cleanup of this task's exact orphaned stack, the Design task and acceptance paths passed. Two additional failures came from test assumptions (an Account menu on Customer Work and an absolute sign-in return URL); the verifier now follows the actual Switch organization → Sign out UI and uses an internal return path. No application authorization was relaxed.

## Build, database, recovery, dependency and hygiene

- ESLint, TypeScript, default Next 16.4.2 production build, RBAC, and security foundation passed. Prisma 7.10.1 schema validation and client generation passed. The first build attempt hit a sandbox Windows junction permission error; the same build passed with local filesystem permission. No deployment occurred.
- Configuration Foundation static suite passed; fresh and upgrade database replay passed, including all 34 tables with RLS/policies, valid foreign keys, preserved representative P1 rows/hashes, and concurrent effective-date overlap rejection. The full connected fixture also applied the current migrations in a disposable stack.
- [Local recovery](evidence/local-recovery.json) passed 5/5: interrupted transaction rollback, logical database/Auth probe backup and restoration, restored user ID and password sign-in, private Storage path/bytes and anonymous denial, with both stacks cleaned. It is not a provider matched GREEN restore or point-in-time rehearsal.
- Supported Prisma 7 tooling upgrade is in `89fd6462`; `prisma` and `@prisma/client` are 7.10.1, `deepmerge-ts` is 8.0.2, `effect` is 3.20.0, and full `npm audit` reports zero advisories. There is no application Prisma Client import in `app/` or `lib/`; CLI validate/generate, typecheck and production build passed. No schema migration or runtime database change was made for this upgrade.
- Routine test JSON/screenshots now go under ignored `.tmp/d5o-evidence`; the six selected fictional evidence files here were copied deliberately. A guard restores `next-env.d.ts` after the browser/dev server. The previously committed generated screenshots remain as historical evidence. Automatic approval review rejected deletion of two archived duplicate files because they were intentionally preserved and not explicitly identified for deletion; they remain untouched and do not affect the build.

## Remaining qualification limits and action

1. **Release scope decision:** no approved-PO revision action is exposed by the current Graybar route or command function; draft cancellation and replacement are verified. Confirm whether post-approval PO revision is an approved requirement for this release. If so, implement and independently qualify it before local PASS.
2. **Hosted gates:** execute the [GREEN acceptance runbook](../d5o-local-qualification/GREEN_ACCEPTANCE_RUNBOOK.md) against the exact promoted candidate, including matched PostgreSQL/Auth/Storage restore, migration ledger comparison, two-tenant authenticated acceptance, finance boundaries, rollback, and separate production authorization. The prior exposed legacy service-role JWT disposition remains a hosted operator responsibility; no credential was rotated here.

No production readiness claim follows from these local results. The updated [gap register](../d5o-local-qualification/DEFECT_REGISTER.md) retains unresolved scope and hosted blockers.
