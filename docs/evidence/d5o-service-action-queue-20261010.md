# Service commercial and Finance queues — disposable prototype evidence (10 October 2026)

This increment adds an authenticated, read-only service-action projection. It reads current canonical Operate requests and the exact service Finance basis. It never grants command authority. My Work and the Operate support queue link to the exact parent Work Record and request; the destination rereads the authoritative Finance basis before showing controls. A closed operational request can still carry financial follow-up. Ready for billing is informational because the prototype has no service invoice or payment command.

The fictional fixture was `d5o-preclosure-20261010` at `127.0.0.1:56821`, viewed at `http://127.0.0.1:61645/work?workspace=rybex`. It contained parent `rybex-a8fd95e7e20d4bb3881c3549459c99e0`, current-cycle request `abe94af3-bdc5-435b-b6ad-ca810293988e` (Partially covered, Closed), its completed service child `a11c09e6-03a2-4835-9205-ec84f0af4ae8`, and another covered request on the same parent. The original completed pilot at `127.0.0.1:56321` was unchanged.

## Observed browser actions

- An authenticated project manager opened **Service Finance preparation** from My Work and prepared the current basis. An independent authenticated Finance user opened **Service Finance review** from their queue and recorded a Hold because no retained billing terms were present.
- The project manager reopened the exact request from **Service terms follow-up**, uploaded a fictional private PDF, recorded source-bound terms and prepared a new basis. Finance opened the exact request from My Work and recorded **Ready for billing** for the previously approved USD 524.65 uncovered scope. The request stayed Partially covered and Closed. No invoice, payment, new service visit or Finance closeout was created.
- After navigation back to My Work, Ready appeared as **Service billing handoff**, explicitly informational. The project manager recorded a second fictional terms-source revision through the existing UI. The old Ready remained in history, and My Work projected **Service Finance reassessment** for the current source.
- On the Operate overview, the closed request remained visible in the support queue with an exact request link. A stale/invalid request link showed a clear warning and no unrelated Finance panel. The same parent also had a covered request, which was not substituted for the linked partial request.

The browser harness initially timed out after the successful Ready decision because it asserted on My Work while still viewing the Work Record. Navigating back to My Work confirmed the informational position; this was a harness navigation error, not a failed command.

## Focused API/database checks

- Authenticated PM sees reassessment as actionable; Finance sees it waiting on the PM; a worker receives no service Finance actions; calling another workspace without membership fails with SQLSTATE `42501`.
- In rollback-only transactions, removing the current partial-service estimate projected **Service pricing** for the PM, and removing customer authorization projected **Customer service authorization** for Operations. The transactions were rolled back.
- A rollback-only change of the displayed request owner to the worker's email still returned zero actions for that worker. Membership, not owner text, determines eligibility.
- The new migration replayed with all **70 candidate files** in filename order on a fresh disposable local Supabase project `d5o-queue-replay-20261010` at `127.0.0.1:56921`. `supabase_migrations.schema_migrations` ended at `20261010170000` with 70 rows. The function grant is authenticated=true, anonymous=false. The local replay used its own explicit Docker subnet after automatic address allocation was exhausted; it did not share the active pilot network.
- Scoped ESLint, `tsc --noEmit`, and the production-mode Next build passed. The browser journey ran first on the development preview; the production-mode build and read-path preview were checked afterward. Business decision commands remain governed by their existing RPCs.

Production/shared Supabase, memberships, traffic and aliases were unchanged. PR #2 remains draft. Fictional documents and roles do not establish real customer authority. Service invoicing, payment collection and independent service financial closeout remain unsupported in this slice.
