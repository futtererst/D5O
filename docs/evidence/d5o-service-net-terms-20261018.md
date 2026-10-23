# Documented service payment terms — bounded local correction, 18 October 2026

This is a fictional, disposable technical check. No real customer terms, invoice, payment or production policy were changed.

## Demonstrated gap and correction

The installed service billing-terms command accepted a retained supplement stating `Net N days from invoice` (up to three digits), but the invoice command accepted only `Net 30 days from invoice` or `Due on receipt of invoice`. The form also offered only those two values. An otherwise supported, independently reviewed Net 45 supplement could therefore be retained yet could not proceed through invoice preparation. This was a mismatch between existing commands, not a reason to infer new customer terms.

Forward migration `20261018230000_d5o_service_invoice_documented_net_terms.sql` keeps the supported USD fixed fee for approved uncovered scope and accepted-service trigger. It makes both commands use the same canonical Net 1–999 or due-on-receipt syntax. The invoice issue command computes the due date from the exact retained term through a private database helper. Source, role, independent Finance review, exact revisions, evidence, replay and issued-snapshot checks remain in the existing typed commands. Existing issued invoices are not rewritten. Unsupported bases and triggers remain held for a separately governed method.

The service terms form now asks for the documented number of calendar days when Net terms apply. It presents fixed fee and service acceptance as the current supported method, rather than as one-option user decisions. A fictional recorder still attests that the retained PDF states the entered terms; this change does not parse or verify document semantics.

## Focused verification

- Source before change: application `14a3a2fab50c4d6397ccfdcd10d833469f7196ca`; evidence HEAD `e8d537b40cfe7e47e91ebd149b047a252e1b4a58`. Final application/source commit: `e09c5f60c51e8297034f2357d1258c66b1205514`.
- Verified disposable populated clone: `d5o-graybar-final-full-replay-20261016`, API `http://127.0.0.1:58521`, zero service billing-terms and invoice records before this migration. The corrected function definitions applied transactionally. The clone's older partial migration ledger was not backfilled.
- Separate empty replay target: `d5o-delegation-137-replay-20261018`. Final **147-file** ordered `supabase db reset --local --yes` completed, exit 0; ledger ends at `20261018230000` and Work count is zero. This reset did not touch the populated clone or observation checkpoints.
- On the replay target, the exact helper used by invoice issuance returned 2026-12-02 for a 2026-10-18 invoice with Net 45, 2026-11-17 for Net 30, and 2026-10-18 for due-on-receipt. Net 0, Net 1000 and unsupported `On completion` raised the expected invalid-term error. Authenticated callers cannot execute the private helper directly.
- TypeScript, scoped ESLint and a production build passed. The rebuilt preview at `http://127.0.0.1:61661/work?workspace=rybex&view=my-work` displayed `e09c5f60c51e`; an authenticated fictional PM reached data-backed My Work on the intended disposable API at `127.0.0.1:58521`. No valid pending service invoice with a documented non-30-day term was present in the preserved populated clone, so a positive browser decision and issued-invoice readback for Net 45 remain **unqualified**. The database arithmetic and ordered migration replay are not being counted as that journey.

Customer term semantics, real customer authority, production billing policy, populated cutover and shared release remain outside this local correction.
