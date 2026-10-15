# D5O support-document response scope · 15 October 2026

Application source `23f45ecbd10837af35adb77c95cc1e7c6da45860`, displayed Build `23f45ecbd108`, runs at the [disposable preview](http://127.0.0.1:61649/work?workspace=rybex). These are fictional technical checks, not Rybex-user observations or production qualification.

Source inspection found that the authenticated generic draft-save RPC returned its full Work projection while the ordinary authenticated Work read redacted other suppliers' support documents. The main snapshot HTTP route already re-read for supervisors, but direct RPC callers and other server draft-save routes could receive the unfiltered result. This was a response-scope defect; no unauthorized business decision or document download was demonstrated through it.

Forward migration `20261015153000_scope_supervisor_draft_save_return.sql` puts the former writer behind a revoked internal function and applies the existing per-actor redaction to its authenticated return. The service-only command writer also re-reads Work under the acting supervisor's session before returning a saved state. The migration was applied only to the populated disposable 57221 fixture.

In a rollback-only authenticated database probe using a full current Work draft, save returned revision 186 with zero other-supplier assignments. Rollback left the committed Work revision at 185. `authenticated` cannot execute the renamed internal writer but can execute the scoped public entry point. A redacted client draft was rejected by the existing `typed_operate_command_required` guard; it did not commit.

In a fictional supervisor browser on the rebuilt preview, four authenticated responses—Work state, exact Work search, My Work actions and private evidence index—contained neither another supplier's assignment email nor that supplier's retained document ID. Direct retrieval of that document returned HTTP 403 `customer_evidence_authority_required`. The repeatable read-only browser probe is `scripts/qa-d5o-support-cross-route-scope.mjs`.

TypeScript, scoped ESLint and a production-mode build passed. This is a bounded cross-route metadata check, not an exhaustive access audit. The candidate now has 90 ordered migration files: 12 mapped shared-history files and 78 outstanding. File 90 has incremental disposable compatibility evidence; the last fresh empty replay remains the completed 89-file sequence. No shared-project migration, production deployment or preserved observation checkpoint was changed.
