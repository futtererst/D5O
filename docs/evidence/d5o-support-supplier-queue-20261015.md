# Assigned support-document supplier queue

Application source `ce3f6069f110123e512d67086c3808b187bad107`; isolated production-mode preview `http://127.0.0.1:61649/work?workspace=rybex`; displayed build `ce3f6069f110`. The preview uses only disposable local Supabase `127.0.0.1:57221`. No migration or business command changed.

## Finding and correction

Operations could assign a named field supervisor to supply a document for an accepted turnover, and the governed upload/submit path recognized that assignment. My Work's support projection previously returned no support actions for field supervisors, leaving the named supplier to search the full Work Record. The queue now derives a supply task from the latest **Assigned** turnover assignment for the signed-in actor. It includes the exact Work, named package, turnover and revision. It excludes other suppliers, revoked assignments, submitted documents, review decisions and unrelated support authority. A saved supplier link also checks the current named turnover assignment before showing the focused form. The typed upload and submission commands remain the decision boundary.

## Focused verification

- `node scripts/qa-d5o-support-supplier-queue.mjs`: PASS. The actual projection, with explicit fictional two-package positions, returned one exact preparation task for each assigned supervisor, none for an unassigned or revoked actor, none after submission, and retained the independent Operations review task. This is a projection fixture, not a browser decision.
- `node scripts/qa-d5o-support-supplier-queue-browser.mjs`: PASS against the rebuilt preview with two separate authenticated fictional supervisor sessions. Both loaded their normal My Work page and displayed the expected build. The preserved pilot's North and South documents are already Reviewed, so both had zero current supply tasks; neither received a foreign task. Saved old supply links for each exact turnover displayed “This support action changed or was decided” and a return to refreshed My Work. This browser check does **not** prove that a newly pending supplier card is clickable in a live fixture.
- TypeScript, scoped ESLint and production-mode build: PASS. The existing document-upload authority and cross-supplier denial were qualified earlier in `qa-d5o-support-supplier-browser.mjs`; those mutations were not repeated on preserved pilot history.

Next qualification: in a separate mutable disposable copy with an assigned, outstanding or returned support document, open the new card from the named supervisor's My Work, submit the retained PDF and confirm the card becomes an independent Operations review. Preserve the reviewed North/South history in this pilot.

## Positive browser qualification on a separate clone

That next qualification was completed on application source `717cc0f9aece47301bacbdba95c07952b94161dd`, displayed Build `717cc0f9aece` at `http://127.0.0.1:61650/work?workspace=rybex`. The target is the previously empty disposable `d5o-candidate-89-replay-20261015` project, using API `127.0.0.1:58221` and its already replayed **90-migration** schema. Only this exact loopback API and browser-origin pair was added to the rehearsal allowlists; the required runtime mode, target match, same-origin browser check and business commands were unchanged. The older populated source at `57221` remained on its 89-migration state.

Fixture setup was **not** a business-decision shortcut: a read-only data archive copied fictional Auth, D5O and Storage rows from the separate mutable source into the empty target. All 61 private files and 61 xattr entries were copied and SHA-256-verified there. Before UI mutation, Work/Auth/object counts matched the source at 11/14/31; the target migration ledger had 90 versions. No observation checkpoint or established fictional payment history was reset. The archive and private files remain outside Git in a local temporary folder.

Separate authenticated browser sessions then exercised supported UI controls:

1. The fictional PM supplied a replacement North as-built **index** for accepted turnover `26241096-02c1-4699-8bdc-759f5d83a426`. Evidence `67c8dd40-e484-432a-8bf5-c3945c60b641` superseded prior Reviewed index `10f07bf3-dc20-4e34-a0fb-c3cef532d556`.
2. A separate Operations user found the exact submitted document in My Work, opened it and returned it because an index lacked verified route and label detail. The return and reason were retained; the previous review remained history.
3. The assigned fictional supervisor found **Supply turnover document · North** in My Work, opened the exact turnover and submitted replacement evidence `ae4bdd50-1a34-4ebd-bdf3-3e1bfebdf62f` through the retained-file form. A second authenticated supervisor saw no North supplier card. The old supplier link then reported the changed action and returned to My Work; the supply card disappeared.
4. The Operations user found the new independent review card, retrieved the exact retained 2,299-byte PDF, and compared its bytes and SHA-256 `5e6a6f0e961b51882646de16fcb01756af5c06667828b48ff8df1c486e76cafa` with the fictional source file. Reload retained **Submitted / awaiting independent review**, the prior Returned version and the original Reviewed version. No reviewer decision was fabricated for the new index.

The first browser run stopped before a command because the new local origin was not in the exact allowlist. A later run submitted the PM replacement once, then paused on an asynchronous queue selector. The state was inspected before resuming; Operations returned it once and the supervisor submitted once. The final read-only browser check passed. The source remained 11 Work / 14 Auth / 31 objects / 21 Operate events / 89 migrations. The clone finished 11 / 14 / 33 / 24 / 90 respectively. The additional two objects and three events correspond to the two submissions and one return. No customer acceptance, support activation or Finance decision changed.

This is fictional technical qualification of routing, custody and role separation. The submitted index does **not** establish a complete as-built or real customer documentation approval. The independent Operations review is intentionally pending in the runnable clone.
