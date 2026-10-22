# Guided work navigation prototype

Created 22 October 2026 against `main` at `6bb850e70b2b681630bd1ac46bcbe142a50243f7`.

The reported problem is difficult navigation and insufficient guidance from opportunity creation to completion. The prototype puts a recognisable work record, phase access, the next activity, and receiving owner in one workspace.

## Open the prototype

Open `guided-work-navigation.html` in a desktop browser. It is a self-contained HTML file with no dependencies, server requirements, or external requests. A local HTTP server can also serve it. Browser storage retains fictional records and drafts; if storage is unavailable, a visible message explains the limitation.

This is an isolated interaction prototype. The existing application's routes, permissions, persistence, configuration, and production deployment have not been changed.

## What to try

1. Open any of the six phase views. The viewed phase changes while the current position stays Define.
2. Select **Complete scope**, enter the scope, and save. Reload to confirm the saved activity and selected view remain.
3. Submit for review. Change the fictional role to **Jordan Lee**, open **My Work**, and open the receiving action. Return the revision with a reason or approve it with a decision basis.
4. For a returned revision, switch to Alex, correct the scope, and submit again. The earlier decision remains in History. Jordan's separate approval opens Develop on the same record.
5. Select **Create opportunity**. Enter the customer and customer need, save a draft, close, reload, and resume. Continue through the review screen; creation opens the new record in Discover without qualifying the pursuit.
6. In Work, search and filter by phase, open a record, and return. The list retains its search and phase filter. The URL also retains the selected view, record, phase, and tab for reload.
7. Continue the fictional activities and reviews to Operate. Switch to Casey for Deploy. After acceptance, open Financial closeout and switch to Morgan to record the separate simulated financial review.
8. Repeat navigation at a narrow mobile width. Use Menu for the primary navigation and fictional role selector.

The prototype's task notes are illustrative information, not uploaded documents or approved evidence. Its phase reviews deliberately simplify the real workflow so the navigation can be assessed. A note that a pricing review, customer award, release, or acceptance occurred does not execute or prove that business action. Browser role switching is a simulation, not authorization.

## Source findings that affect implementation

- `components/d5o/platform/WorkPhaseJourney.tsx` already exposes phase views. Its order is **Discover, Define, Develop, Design, Deploy, Operate**. The earlier image's Design/Develop order is corrected here to preserve the source's commercial-before-preparation journey.
- The same component puts record controls in a **Record views** disclosure. The prototype brings the frequently needed controls into visible navigation.
- `components/d5o/platform/D5OPlatform.tsx` combines record selection, phase navigation, numerous cross-work tools, configuration, and appearance controls in the main sidebar. The prototype uses a smaller primary navigation and moves phase context into the record.
- Existing phase workspaces, decision checks, My Work queues, source revisions, and authenticated command paths already exist. Implementation should reuse them rather than build a second workflow engine.
- Current governed position, the phase being viewed, package progress, and financial disposition must remain separate concepts.

## Proposed implementation sequence

1. Apply the record header, phase navigation, and visible record controls to a bounded existing work journey. Preserve existing URLs and direct task entry points.
2. Surface the current permitted activity, actual accountable owner, unmet requirements, and receiving handoff from existing record/configuration/command data. Do not infer completion from phase position or generic percentages.
3. Adapt opportunity capture into short resumable steps using existing tenant-scoped create and draft mechanisms. Reuse customer/site records where supported; do not introduce mock duplicate identities.
4. Connect My Work entries to the exact record, phase, activity, submitted revision, and return location. Restore search, filtering, selected record, and phase on return/reload.
5. Extend the accepted pattern across the remaining work types and phases, preserving their actual branching, concurrent packages, return paths, approval authority, and post-acceptance restrictions.

## Next implementation prompt

> Implement the approved guided work navigation in the existing D5O application. Read this note and open the adjacent HTML prototype first. Inspect the current branch, applicable instructions, and current production/release work before choosing an isolated working branch. Start with the real work-record shell, direct phase access, visible supporting record views, and the current next-action/owner/blocker panel. Preserve the configured phase order and distinguish viewing from progression. Reuse existing phase workspaces, pinned requirements, authenticated commands, role checks, exact-revision decisions, My Work routing, and tenant scope. Do not copy the prototype's browser storage, fictional roles, note-based completion, or simplified review state machine into product behavior. Add a short resumable opportunity intake using the existing record creation path, retaining one canonical identity and required configuration pin. Preserve customer/site linking, existing field and finance entry points, acceptance evidence, and package-level concurrency. Keep production changes reviewable and provide a running implementation preview before extending the pattern. After the preview exists, verify one genuine authorized test journey from creation to the next permitted handoff, read-only/denied actions, reload and back-navigation continuity, and desktop/mobile usability. Report precisely what changed and which journeys remain unverified. Complete required repository checks before merge or deployment, following the existing release authorization.

## Verification

The standalone prototype passed 26 Chromium interaction checks recorded in `guided-work-checks.json`, including draft recovery, independent review, return/resubmit history, all remaining phases through acceptance, separate Finance disposition, literal rendering of entered text, and mobile menu/navigation. No browser JavaScript errors were recorded. After the final mobile layout adjustment, targeted checks confirmed that the next action appears before the checklist and that the page has no horizontal overflow at 390 pixels. Desktop and mobile screenshots were visually inspected.

Screenshots: [desktop](guided-work-desktop.png), [mobile](guided-work-mobile.png). These checks qualify only the isolated prototype, not the application or its authorization.

## Review criterion

A user should identify the work's current position, the next required action, its owner, and any blocker without opening another page. They should open any permitted phase directly, create and resume an opportunity without re-entering saved information, and follow a received task to the exact work context. Representative-user usability review remains outstanding.
