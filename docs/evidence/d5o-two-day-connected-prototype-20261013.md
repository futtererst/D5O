# Connected D5O prototype checkpoint — 2026-10-13

Application commit: `4e371e07a510c9b572e13410032a5f0185b5da69` (production-mode local build displayed `4e371e07a510`). Preview: `http://127.0.0.1:61643/work?workspace=rybex`. Database: disposable local Supabase target at `127.0.0.1:56621`; production and shared Supabase were not changed. All people, customers, documents, decisions and payments here are fictional pilot data.

## Retained connected position

- Two-package customer job `rybex-d86cdd4cd0c04dea97da79c382cf790c` retains accepted package releases, independently reviewed completion, scoped customer acceptance and whole-work Operations receipt. Supported asset: `1631d90d-340e-4cc0-8b27-8065a3a42c08`. Support is Active while Finance remains Pending.
- New covered service request `b792764d-d9a3-49c9-b830-6ea5e44d15fa` created child Work `rybex-7fbf86e5a5c74176b4911367cb90a9a3`. The accepted service execution basis is revision 1. Design package `wp-8db4b55aa1c14275a7da4a8496d052e0` is revision 3. Its exact fictional issued private PDF is `a3c9c92c-b518-473e-9daa-6ddc3add8db1@1`, SHA-256 `c60324f942a24147381c9f097d28f610016d1b48a152bf4f101e4d5d5783f513`. Release `35fd9ae7-22b0-4d2c-aff3-16d6529df565` was independently received by Operations.
- Operations published a two-person Controls service crew booking for 2026-10-14, 07:00–15:30 America/New_York. Nate Walker and Rina Patel acknowledged in separate worker browser sessions. The service request remains In progress. The field start, actuals, verification, acceptance, asset-history return and request closure have **not** occurred.

## Current slice and qualification

The server rejected release when crew demand still pointed to package revision 1 after the engineering package moved to revision 3 (`dated_crew_demand_required`), while the Design UI had shown Ready. The Design assessment now blocks stale or missing canonical crew-demand revision pins and gives a corrective action. A focused regression script covers stale, missing, current and legacy pins. After saving demand against revision 3, the existing typed release command succeeded; the guard was not relaxed.

My Work previously omitted package preparation for an independently accepted service execution basis. Its projection now offers the assigned project manager a focused preparation card when that accepted source has no package. The destination verifies the exact basis revision and current source; it shows service scope, coverage, exclusions and verification. Once a package exists, the link is obsolete and no substitute package is selected. Package creation still uses the existing authenticated command. This new card has source-level and type/lint qualification; a fresh un-packaged service browser fixture is still needed to positively exercise its appearance and creation from My Work.

Browser-observed on the displayed build: the Operations session opened the retained child from My Work, showing one accepted release, one published booking, both worker acknowledgments, and a truthful **Hold for resolution**. The next action says to authorize start during the published shift, no earlier than one hour before it begins. No field authorization was attempted outside that window.

Checks: `npm run typecheck` passed; scoped ESLint passed; `node scripts/verify-d5o-design-demand-revision.mjs` passed; production-mode build passed. No migration was added by this slice. The browser observation checks the committed service position, not the unexercised new preparation card.

Next: within the permitted shift, use separate authorized Operations, worker and Quality sessions to authorize field start, capture factual work/evidence, independently verify completion, accept the scoped visit and return it to asset history. Use a separate disposable un-packaged service fixture to check the new My Work preparation link before considering that routing fully qualified.
