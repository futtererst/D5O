# D5O synthetic walkthrough — 2026-10-11

This is fictional technical qualification by Codex, **not** observed Rybex-user usability or real business approval. Scenario definitions: [matrix](../d5o-synthetic-walkthrough-matrix-20261011.md). Machine results: [results.json](results.json). The eight tracks are an implementation-based grouping; no separate approved list of seven customer scenarios was established.

## Isolated targets and actors

| Target | URL | Displayed build | Use in this run |
| --- | --- | --- | --- |
| Preparation | http://127.0.0.1:61643/work?workspace=rybex | `9400887adcb0` | Mutable fictional Discover and solution decisions |
| Delivery observation | http://127.0.0.1:61644/work?workspace=rybex | `25440792b5c8` | Read-only nine-role queue/mobile check; checkpoint and private files preserved |
| Support observation | http://127.0.0.1:61645/work?workspace=rybex | `25440792b5c8` | Read-only nine-role queue/mobile check; checkpoint and private files preserved |

Source at start: `ddcf9d867d72598b7f5f37041184f2006266a0e9`. Fictional account references are the `pm`, `commercial`, `operations`, `supervisor`, `quality`, `finance`, `executive`, `admin`, and `worker` keys in the existing local pilot credential files. Passwords, tokens, database dumps and private files are not included here. The preparation Work Records were `rybex-edaa20bcfdb549238d605bdceeb544c9` (fictional relay review) and `rybex-3636863bf1d24d698c5537607a5667ec` (fictional controls upgrade). The observation checkpoints were not mutated by this walkthrough.

## Browser-observed decisions

1. PM opened **Prepare Discover intake** from My Work for the relay review, entered fictional customer need, outcome, indicative USD 18,000 value, date and risk, and saved. The POST returned 200 in 211 ms. PM submitted revision 2. [Task screenshot](screenshots/preparation-pm-task.png).
2. A separate commercial account opened **Review Discover intake** from My Work and qualified revision 2 with a recorded basis. Its review card disappeared, and PM's next card was **Prepare Define handoff**. [Review screenshot](screenshots/discover-independent-review.png).
3. PM submitted the exact Define receiving brief. A separate Operations account opened **Receive Define handoff**, accepted it, and PM's next card became **Prepare definition**. [Receipt screenshot](screenshots/define-receiving.png). The new definition still had eight configured requirements open; no Define approval is claimed.
4. On the existing controls-upgrade fixture with an independently accepted Define baseline, Operations opened **Independent solution review** and returned submitted solution revision 5 for clearer rollback and witnessed testing. PM then used **Prepare solution**, revised a viable option, selected it with rationale, and submitted solution revision 8. A separate Operations account approved revision 8. The old returned review remained historical; the submitted review card disappeared. The correction harness initially waited for a `PUT` response although the draft save used another route; this was a test-harness timeout, and reload confirmed the saved option. A later browser diagnostic observed the actual solution-submit POST return 200. No pricing decision is claimed.
5. Nine fictional roles signed in separately on each preserved observation preview. My Work action-card counts matched the displayed counts. The worker reached only the assignment-scoped schedule. Finance could not open administration; an authenticated cross-tenant action-queue request was denied. PM and worker layouts at 390 px did not overflow horizontally. A Finance task's **Back to tasks** link worked by keyboard Enter after visiting Portfolio. Stale Finance and support task links showed a changed/decided task rather than substituting another Work Record. [Delivery desktop](screenshots/delivery/pm-desktop.png), [delivery mobile](screenshots/delivery/pm-mobile.png), [worker mobile](screenshots/delivery/worker-mobile.png), [support desktop](screenshots/support/pm-desktop.png).

## Reproducible finding and correction

**F-01 — Delivery package cards omit the package name.** On the delivery PM mobile screenshot, two **Prepare package turnover** cards had the same Work title and `Package scope · revision 2`; the package identities were not readable without opening each task. This impairs task selection in a two-package job. `deliveryRoleActions` already computed `packageName`, but the hosted search enrichment could overwrite it with `undefined` when the loaded Work projection lacked the package entry. `FocusedMyWorkBoard` then ignored it and used generic text. The bounded correction preserves the existing projected name and renders it on the card. No command, authority or schema changed. The preserved 61644 preview still runs its older build, so its post-change card check correctly continued to show the old text. The changed build requires a separate isolated preview before F-01 can be marked browser-verified. TypeScript, scoped lint and the production build passed.

**U-01 — Dense Define preparation.** The PM's focused `Prepare definition` task showed a broad five-step baseline with eight configured requirements open. The task gives the correct next owner and supporting sections, but completing a new structured definition requires several section changes. This is a synthetic inspection, not evidence that a Rybex user was confused. No redesign was made in this bounded defect fix.

## Run interruption and discarded checks

After the early decisions, both preparation and delivery local Supabase Auth health endpoints temporarily timed out at three seconds while the Next.js preview HTML still returned 200 (61643: 175 ms, 61644: 27 ms, 61645: 26 ms). Docker CLI inspection also hung. Subsequent browser sign-ins and the post-fix nine-role rerun timed out. The Auth endpoints later returned 200 without a database reset. The observation databases and private files were left untouched. A quick route sweep sampled headings before client hydration and was discarded; a slower sweep then timed out on navigation. Neither is counted as page coverage. Historical journeys and existing fixture states were not counted as current passes.

The matrix records 9 Passed and 23 Blocked scenario rows. Passed means the sampled behavior described there was observed, not exhaustive coverage of the row's wider domain. Blocked means implementation may exist but this run did not execute the complete scenario. None of the untested workflows is labeled Passed. No production/shared persistence, membership, alias or external communication was changed.

## Resume point

Restore isolated Docker/Auth responsiveness without resetting the three checkpoint volumes. Rebuild the changed source and verify the package-name card on 61644 through a fresh PM sign-in, then continue B04/B06 and independent Design/Deploy/Operate/Finance paths with normal browser controls. Prepare a separate mutable clone before making business decisions from the observation checkpoints. Keep all real-user usability findings pending actual observation.



