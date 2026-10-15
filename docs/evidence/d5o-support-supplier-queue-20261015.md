# Assigned support-document supplier queue

Application source `ce3f6069f110123e512d67086c3808b187bad107`; isolated production-mode preview `http://127.0.0.1:61649/work?workspace=rybex`; displayed build `ce3f6069f110`. The preview uses only disposable local Supabase `127.0.0.1:57221`. No migration or business command changed.

## Finding and correction

Operations could assign a named field supervisor to supply a document for an accepted turnover, and the governed upload/submit path recognized that assignment. My Work's support projection previously returned no support actions for field supervisors, leaving the named supplier to search the full Work Record. The queue now derives a supply task from the latest **Assigned** turnover assignment for the signed-in actor. It includes the exact Work, named package, turnover and revision. It excludes other suppliers, revoked assignments, submitted documents, review decisions and unrelated support authority. A saved supplier link also checks the current named turnover assignment before showing the focused form. The typed upload and submission commands remain the decision boundary.

## Focused verification

- `node scripts/qa-d5o-support-supplier-queue.mjs`: PASS. The actual projection, with explicit fictional two-package positions, returned one exact preparation task for each assigned supervisor, none for an unassigned or revoked actor, none after submission, and retained the independent Operations review task. This is a projection fixture, not a browser decision.
- `node scripts/qa-d5o-support-supplier-queue-browser.mjs`: PASS against the rebuilt preview with two separate authenticated fictional supervisor sessions. Both loaded their normal My Work page and displayed the expected build. The preserved pilot's North and South documents are already Reviewed, so both had zero current supply tasks; neither received a foreign task. Saved old supply links for each exact turnover displayed “This support action changed or was decided” and a return to refreshed My Work. This browser check does **not** prove that a newly pending supplier card is clickable in a live fixture.
- TypeScript, scoped ESLint and production-mode build: PASS. The existing document-upload authority and cross-supplier denial were qualified earlier in `qa-d5o-support-supplier-browser.mjs`; those mutations were not repeated on preserved pilot history.

Next qualification: in a separate mutable disposable copy with an assigned, outstanding or returned support document, open the new card from the named supervisor's My Work, submit the retained PDF and confirm the card becomes an independent Operations review. Preserve the reviewed North/South history in this pilot.
