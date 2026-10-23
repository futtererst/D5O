# Explicit service billing terms — isolated pilot, 10 October 2026

This is a fictional qualification record. It does not establish real customer authority, an invoice, payment or service financial closeout. Production and shared Supabase were unchanged.

## Source and retained decision

- Starting branch/head: `codex/d5o-enterprise-readiness` / `c1441d9f69dd936139fed0cd1d7623a06dd140a3`. Previously tested application source: `bdbb4a2696c4fbfd9230ddabe157a83e7750d805`.
- Isolated application: `http://127.0.0.1:61644/work?workspace=rybex&view=record&section=Operate&record=rybex-a8fd95e7e20d4bb3881c3549459c99e0&focus=finance`; disposable Supabase API `127.0.0.1:56321`.
- Request `abe94af3-bdc5-435b-b6ad-ca810293988e`, current cycle `2026-10-09T04:59:55.355872+00:00`, child `a11c09e6-03a2-4835-9205-ec84f0af4ae8`, asset `091d1025-9763-4f03-a429-afbac103c432`. Classification remains **Partially covered** and operational request **Closed**.
- The original service authorization and approved estimate revision 2 remain history. The uncovered authorized amount is **USD 524.65**. The supplement states a fixed fee for that uncovered scope, triggered by accepted service scope, with fictional Net 30 days from invoice terms. Covered work is not charged.
- Private fictional PDF evidence `fb1adb39-7ec9-485b-b132-585f8a5ab1d6` has SHA-256 `d61d079201ff2c247c1a7d846e998614a0f2591dc0eb43b2fb9b541c5d3dba26`; its 1,309 bytes match the retained private download. The document and entered customer identity/authority are explicitly fictional and require independent human verification in a real workflow.
- Project-manager browser action recorded terms revision 1, then prepared the source-bound Finance basis. A separate authenticated Finance browser session reviewed it and committed **Ready for billing**, Finance disposition revision 4. Both roles reloaded and retained the result. The prior **Hold** remains in event history. Invoice and payment are still pending/unknown.

## Defect reproduction and correction

In a separate disposable fixture, a rollback-only test set the existing authorization's `conditions` to **“Escort required in Data Hall B; no unaccompanied access.”** All other prerequisites were valid. Before the correction, the read basis returned `eligibleForFinanceReview=true` and `billingTermsKnown=true`; a project-manager preparation followed by a separate Finance `review-ready` committed **Ready for billing** inside the rolled-back transaction. The original pilot was not changed by this test.

After the forward migration, the same rollback-only fixture returned `billingTermsKnown=false` and rejected preparation that tried to reuse the operational condition and authorization PDF as terms with exact `service_finance_preparation_invalid`. The replacement Finance function now recognizes only a current, exact, separately retained terms supplement. Its prior authenticated entry point was replaced, not left as a bypass.

## Focused qualification

- Separate PM/Finance browser journey and reload passed; private PDF retrieval returned HTTP 200 and matching SHA-256 for Finance, HTTP 403 for a worker.
- Rollback-only database probes passed: wrong Finance role for terms recording, cross-tenant attempt, stale terms revision, caller-supplied alternative amount, missing or wrong-purpose evidence, identical replay, conflicting replay and supersession invalidating the earlier Finance decision. A separate freshly replayed fixture changed the request cycle and rejected the old source before document evaluation with `stale_service_billing_terms_source`. Both transactions rolled back. The active pilot retained exactly one terms event/receipt and four Finance events/receipts from the browser journey, with no probe records.
- The fresh disposable `d5o-preclosure-20261010` target replayed **69 candidate migrations in filename order**, including new `20261010150000_connected_service_billing_terms.sql`; exit 0. The active fictional pilot was incrementally patched, not used as full replay evidence.
- TypeScript, scoped ESLint and production-mode Next build passed against the allowlisted disposable target. A read-only check of the separate changed-job fixture still showed Finance **Closed**, billed **$109,977.15**, paid **$25,000**.

Terms recording supports only the demonstrated USD fixed-fee uncovered scope, accepted-service trigger and explicit invoice payment terms. Ambiguous or different pricing methods are rejected or held for a separate governed basis. PDF wording is human-attested by the fictional recorder and independently reviewed by Finance; the prototype does not perform semantic PDF validation or external customer identity proof.
