# D5O Develop destination context — 22 October 2026

## Bounded source

Application commit `2489a5d357f75473d91fb4c6c564ada29e9903af` on `codex/d5o-develop-context-correction` descends from released responsive-layout baseline `695e10f40e634cb448ab48c9fc4fa2168e1724f5` and retains the subsequently deployed Administration/onboarding commits. Draft PR #7 targets that bounded successor branch; unrelated work in the main checkout and broader PR #4 is excluded.

The correction gives Develop three explicit destinations: workspace pipeline/forecast, exact commercial Work workspace, and focused task. A pipeline route ignores and removes a stale `record` query parameter; it displays no selected Work header, governed position, Work switcher, or selected commercial detail. Exact Work links, including older `view=develop&record=<id>` links, open that record. A focused task parameter takes precedence over a stale pipeline marker. Opening a pipeline row sets the exact Work context, and Back to Develop pipeline returns to the browser's retained filter, view, forecast, and browsing context. No business command or persisted data model changed.

## Verification

`npm run verify`, `npm run app-shell:verify`, and `npm run mobile-shell:verify` passed on the application code. The first sandboxed aggregate build could not create a Windows Turbopack junction; rerunning the same source with the required local filesystem permission passed the complete verifier. An exact-commit production build was also compiled in D5O's existing guarded rehearsal runtime against isolated Supabase at `127.0.0.1:59641`.

An ordinary authenticated fictional administrator session in that isolated runtime checked fresh pipeline entry with a stale record parameter; Work A → pipeline → A; Work A → pipeline → B; filtered and phone-scroll return; forecast refresh; Back/Forward; direct Work links; a stale exact pricing-review link; and a Discover pipeline and Define record regression. A separate fictional worker direct Develop link followed its existing denial route to My Schedule. The browser observed zero D5O command requests from these navigation actions. Phone widths 360 and 390, tablet portrait 768 and 820, tablet landscape 1180, and desktop widths 1440 and 1900 had no document-wide overflow. Browser emulation is not physical-device or native-keyboard testing.

The matching isolated production-build viewport captures are [phone pipeline](assets/d5o-develop-context/phone-pipeline.png), [phone workspace](assets/d5o-develop-context/phone-workspace.png), [tablet pipeline](assets/d5o-develop-context/tablet-pipeline.png), [tablet workspace](assets/d5o-develop-context/tablet-workspace.png), [desktop pipeline](assets/d5o-develop-context/desktop-pipeline.png), and [desktop workspace](assets/d5o-develop-context/desktop-workspace.png). All records shown are fictional. The local connected preview is `http://127.0.0.1:61669/work?workspace=rybex&view=develop&developPanel=pipeline` while the isolated rehearsal process remains running.

## Hosted stage

The same clean tracked source was archived into 2,092 files and staged without domain assignment as production-target deployment `dpl_9QMKhpCrNPFrGFpB42KJvXRs61kn` at `https://d5o-system-of-work-909js5584-shawns-projects-21be8f87.vercel.app`. Vercel reports READY; `/api/health` returned 200 and identifies the existing production-backed Supabase origin. Hosted review is read-only. Production promotion and authenticated hosted results will be recorded after completion.

Administrator onboarding and external invitation delivery remain separate from this navigation change.
