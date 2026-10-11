# D5O role-and-task presentation qualification — 2026-10-11

Shawn directly reported that every page exposed too much information, making D5O confusing and difficult to use. This is product-owner feedback, not a completed Rybex-user walkthrough. Participant results remain blank in the observation record.

## Candidate and isolated targets

- Application source: `1455c8788a983a967bde45bc87943aa1738cb80c`; both production-mode local previews displayed `Build 1455c8788a98`.
- Delivery checkpoint: `http://127.0.0.1:61644/work?workspace=rybex`, local disposable Supabase API `127.0.0.1:56921`.
- Support checkpoint: `http://127.0.0.1:61645/work?workspace=rybex`, local disposable Supabase API `127.0.0.1:56821`.
- Both builds used the existing allowlisted rehearsal command runtime. No production deployment, shared database, membership, alias or migration changed.

The [surface inventory](d5o-role-task-surface-inventory-20261011.md) records the intended primary task and secondary context for every routed and embedded D5O surface. Hosted users land in My Work (workers retain My assigned work). The shared presentation model places daily tasks first and moves broad phase, reference and administration views into explicit secondary navigation. The consolidated queue separates Action needed, Waiting and information handoffs, counts task entries rather than owned Work Records, and retains record browsing as a paginated secondary disclosure. Exact task links retain Work, package/request and revision. They suppress generic phase navigation and unrelated decision panels, while keeping relevant blockers and evidence accessible. Existing typed commands remain the authority boundary.

## Browser observations and focused checks

- `qa-d5o-role-task-presentation.mjs` passed on **both** previews after final build. It signed in separately as fictional PM, commercial, Operations, supervisor, Quality, Finance, executive, administrator and worker accounts. It checked role landing, visible task count against rendered cards, exact task navigation and reload, administrator-only navigation, PM denial of the configuration view, Finance denial from the admin API (403), cross-tenant queue denial, stale support link handling, and desktop/390px mobile overflow. Worker landing remained `/work/my-schedule`.
- Delivery Action needed counts by role: PM 3, commercial 1, Operations 7, supervisor 4, Quality 6, Finance 1, executive 0, admin 0. Support counts: PM 2, commercial 1, Operations 4, supervisor 1, Quality 3, Finance 1, executive 0, admin 0. These are queue task counts, not completion measures.
- The fictional Quality/Operations account opened a submitted North as-built review from its normal My Work page. The exact view showed the retained PDF and current obligation. An unrelated Work Record lifecycle blocker was observed above it, removed, and verified absent. The reviewer used the UI to **Return** the document because the index lacked installed route coordinates and final labels. After reload, the review task disappeared and the PM's supply-document follow-up appeared. This was a disposable technical action, not a real customer or user decision. The support checkpoint was reset afterward and reported `RESET_PASS`, restoring the submitted review for observation.
- The private-file check passed after reset: assigned fictional worker retrieved the 68-byte PNG, SHA-256 `ba6012106ff3e95fa0b94d01a5732e143e8139d8a7b007501b3c3d244ab48cb2`; independent reviewer retrieved the 2,299-byte North PDF, SHA-256 `5e6a6f0e961b51882646de16fcb01756af5c06667828b48ff8df1c486e76cafa`. The script also checked worker denial for the unrelated private document.
- TypeScript and scoped ESLint passed after the final source change. Production-mode builds completed for both disposable targets. No migration changed; ordered migration replay was not repeated.

## Scope and limits

Exact-task presentation was exercised for pending delivery/support and Finance links, with one committed document-review transition. Define and Develop independent-review queue links were added from the existing authenticated review states; the observation checkpoints contained no pending Define or Develop review to complete in a browser. The inventory covers the broader pages through role-aware navigation, secondary context and focused entry; their deeper forms were not each task-completed in this qualification. This technical run establishes routing, responsive layout and one controlled handoff; it does **not** establish that a Rybex user finds the experience understandable or independently operable.

A short Rybex-user retest should start each participant on the normal landing page and ask them to find the next task, explain its exact scope/evidence/blocker, complete or return the permitted decision, and name who acts next. Record assistance, wrong turns and comments in the existing blank observation record. Localhost access requires Shawn to arrange use of the host computer or separately authorize a remote method. Do not treat this automated check as a participant result.
