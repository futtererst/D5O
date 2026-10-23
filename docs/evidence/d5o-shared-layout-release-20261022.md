# D5O shared layout release — 22 October 2026

## Source and requirement boundary

- Qualified layout application source: `9b50a3fb0c96ea772203602a80b6ef572032557f`; connected browser-emulation evidence is in [the layout review](d5o-shared-layout-20261022/README.md).
- Final tested and deployed source: `695e10f40e634cb448ab48c9fc4fa2168e1724f5` on `codex/d5o-shared-layout-release` (draft PR #5). The additional commits repair repository verification and three real legacy regressions; they do not alter the D5O layout under review.
- Staged and then promoted deployment: `dpl_EvBtaV3vJigEuDkYgfdRkaDBMRPP`. The production alias `https://d5o-system-of-work.vercel.app` resolves to that exact deployment. The normal authenticated `/work` route displays Build `695e10f40e63`. `/api/health` returned 200 and reported the intended hosted Supabase origin `https://fcawktdjoxvahhgvkebx.supabase.co`.
- Previous production deployment for rollback: `dpl_CdZ5UUNKx7VBuVM8Ca4tQGy5Zn66`. Rollback should reassign the prior deployment after confirming the target; no migration or environment change was made in this release.

`docs/deployment-readiness.md` describes the legacy seed/demo Command Center and Admin checklist, including scaffolded persistence. It does not authorize putting hosted D5O in seed mode. Its repository-wide `npm run verify` requirement was honored. Hosted D5O requires authenticated, persisted operation and the established clean tracked-source staging, target-origin check, read-only authenticated review, promotion of the same deployment ID, and post-promotion alias/build verification.

## Aggregate verifier correction

The Billing V2 UI verifier referenced `docs/billing-v2-guided-ui-replacement-report.md`, but the report was never committed after the verifier was introduced. A substantive June 2026 local report remained untracked in the original checkout. It was recovered and committed without implying production payment acceptance; it still calls for manual acceptance. The verifier now reports missing evidence as an actionable failure instead of throwing an uncaught `ENOENT`. Its Billing-only changed-file rule remains in the focused command and is bypassed only when the same verifier runs as part of repository-wide `npm run verify`.

The aggregate run then exposed obsolete expectations in Pilot Billing and action-first page verification, plus missing Pilot Mode entry and duplicate React keys in legacy lists. The focused tests were updated to current controls while retaining guided interaction, command, evidence, and route checks; the real UI regressions were corrected in separate commits. No check or advisory was suppressed.

`npm run verify` **passed** on `695e10f4`, including typecheck, lint, production build, production dependency audit (zero findings), demo check, all repository verifiers, and 28/28 route smoke. Focused `npm run billing-v2:qa`, `npm run runtime:qa`, `npm run pilot-mode:verify`, `npm run pilot-billing-task:verify`, `npm run runtime:verify`, and `npm run simplify:verify` passed. The missing Billing report was also removed temporarily to confirm the focused verifier exits 1 with a clear missing-file message, then restored.

## Hosted read-only review

On the staged authenticated `/work` route, the fictional Work register populated with 18 records. A selected fictional record retained its identity and governed Design position while switching to Design and its Work packages section. The desktop selected-record header and complete phase workspace measured identical outer bounds (left 104 px, right 1664 px in a 1707 px viewport; 0 px delta). At emulated 390 × 844 px, the labelled phase menu exposed all six destinations, Design used a labelled section and package selector, and a populated Develop register rendered 16 stacked rows with table `scrollWidth = clientWidth = 365 px` and document `scrollWidth = innerWidth = 390 px`.

After promotion, the public alias displayed the exact final build in an authenticated session. The same fictional record's desktop header and phase workspace again measured 0 px edge delta. A 390 px emulated production Develop register again had 16 populated rows, no table horizontal overflow, and no document horizontal overflow. The production health endpoint returned 200. Navigation used read-only controls; no business command was submitted in hosted review. The broader isolated connected audit had recorded zero business-command requests from navigation and worker permission denial, but worker-role denial was not repeated in this bounded hosted review.

The Develop tenant-wide pipeline currently carries a selected Work header when reached from a record. This is a pre-existing contextual presentation issue observed during hosted review; the pipeline rows reflow correctly. It was not changed in this release-focused correction.

Browser viewport emulation is not physical-device testing. Physical iPhone/iPad and native mobile keyboard checks remain unperformed. Hosted review did not exercise business mutations or every rare populated register state.
