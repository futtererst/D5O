# D5O preparation and solution queue qualification — 2026-10-11

Technical qualification with fictional accounts and local disposable Supabase only. No Rybex user was observed. The delivery and support observation checkpoints at ports 61644/61645 were not changed.

## Isolated source and roles

- Candidate Work: `rybex-3636863bf1d24d698c5537607a5667ec`, fictional controls upgrade, Fictional Pilot Customer, Pilot Station B.
- Isolated target: `d5o-preparation-solution-20261011`, local API `127.0.0.1:56621`; preview `http://127.0.0.1:61643/work?workspace=rybex`.
- Fictional PM `d5o-pilot-pm@example.test`; independent commercial reviewer `d5o-pilot-commercial@example.test`; independent Define receiver and solution reviewer `d5o-pilot-operations@example.test`; fictional administrator `d5o-pilot-admin@example.test` configured the required published Develop policy. Credentials stay only in the local pilot file, outside Git.
- Fixture setup: fresh local Supabase and the ordered 75 candidate migrations, followed by the existing isolated-pilot account/configuration seed. This setup is distinct from browser business actions.

## Authenticated browser actions

1. PM used **Start work** to create the canonical fictional Work and was routed to **Prepare Discover intake** in My Work. PM saved the intake, submitted revision 2, and reloaded. An invalid nonnumeric indicative amount was rejected without a decision; a numeric amount saved.
2. Commercial lead found **Review Discover intake**, inspected the exact submission and qualified it. PM then submitted a named Define handoff; the independent Operations account received it from My Work.
3. PM prepared the structured Define basis, including confirmed requirement, scope item, acceptance criterion, exclusion, interface, schedule dependency and risk, then submitted revision 1. Commercial and Operations accounts independently approved their own Define reviews. PM submitted the approved basis to Develop; Operations independently received it.
4. PM found **Prepare solution**, saved a viable sequential option and a rejected parallel alternative, linked the confirmed requirement, recorded rationale and a delivery strategy. The first submit was held because the fresh target lacked an active published pricing policy. Administrator created, published and activated a fictional USD policy using the existing UI. The server then rejected a missing due date and an incomplete strategy; the focused PM task now exposes those required inputs before submission.
5. PM submitted solution revision 4 with a review due date. Operations found **Solution review** from My Work, inspected the selected option, alternative, confirmed requirement, supporting source and rationale, then returned it for supplier sequencing and witnessed-test ownership. PM followed **Prepare solution**, saved the correction as revision 5 and resubmitted. Operations approved exact revision 5. The PM queue then showed **Prepare detailed estimate**. No estimate or proposal approval was manufactured.

Observed successful draft POST durations in this journey were 846 ms for an alternative, 864 ms for initial strategy and 957 ms for corrected strategy. These are browser-observed samples, not a performance benchmark. Typed decision responses were HTTP 200; server-side command authority remained unchanged.

An obsolete solution-review link for revision 4 displayed “This task changed or was decided,” offered return to refreshed My Work, and exposed no decision control or substitute record. At 390 px width, the pricing preparation task had no horizontal document overflow; keyboard Enter opened its focused link and reload retained it. Browser checks of option evidence, alternative, requirement and rationale all passed. These are technical observations only.

## Resettable retest position

After the technical journey, a second fictional Work (`rybex-edaa20bcfdb549238d605bdceeb544c9`, “Fictional relay review - PM retest”) was created through the PM browser and left at **Prepare Discover intake**. A local-only data checkpoint captured this PM task alongside the **Submitted** solution-review position. Archive: `%TEMP%\d5o-preparation-solution-20261011\preparation-review-ready.dump`, SHA-256 `82A0BB7271AC9EA367960EC8E78798A70691D9F6E2420AE79C135D3E06523D72`. Its scoped restore list includes fictional Auth identities, D5O data and Storage metadata. There were zero private Storage objects in this new checkpoint. No dump, password or token is committed.

After the live technical journey, reset only this target with `pwsh -NoProfile -File scripts/reset-d5o-preparation-checkpoint.ps1`. The script checks the exact local project ID, port, archive hash and container before resetting. It must never be run while a participant is using the target. The strict local reset was exercised and returned `RESET_PASS` for canonical Work `3636863b-f1d2-4d69-8c55-37607a5667ec:5:Submitted`; nine fictional Auth users were restored. An initial restore attempted to copy an empty Storage bucket already recreated by migrations and failed on a duplicate key. The scoped list was corrected to omit migration-created bucket rows; no private objects existed in this checkpoint. The reset returns both the fictional PM Discover intake preparation and Operations solution review for revision 5. Earlier PM solution preparation/correction history remains available as supporting context.

## Limits

This proves command and navigation connectivity for fictional roles, not actual Rybex-user comprehension. The fictional rate policy, site facts and evidence references are not real customer or supplier authority. Production and shared Supabase were unchanged. A new customer job still needs its own genuine configuration, commercial basis and independent decisions.
