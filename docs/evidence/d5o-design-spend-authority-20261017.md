# Local R1 Design spending authority qualification — 17 October 2026

This is fictional, isolated technical qualification. It is not a customer award, real expenditure, human acceptance, production approval or supplier action. Application source: `6a8e7da`; evidence-only commit may follow. Preview: `http://127.0.0.1:61656/work?workspace=rybex&view=my-work`. Disposable API: `127.0.0.1:58221`. Canonical Hall R Work `rybex-f85daaed685f4b5b9e113b8a0f5cf33c` is separate from the preserved Data Hall C Work `rybex-15a8158698bb4f09859ebd8955435cc6`.

## Bounded current-coverage decision

| Business control | Existing implementation | Observed evidence | Specific gap |
| --- | --- | --- | --- |
| Requirements and ROM basis | Approved Define, independent Develop solution/estimate and proposal decisions | Hall R retained source digest `28e423b65a5755cd7bae8a793759c1b9` | ROM is budget information, not delivery award |
| Customer budget response | Separate customer response and Design-only permission | Hall R source has budget acknowledgment and USD 2,500 internal Design cap | No resulting PO, subcontract or field authority |
| Internal Design economic commitment | Previously a cap on permission with no consumption ledger | New typed window and commitment decisions described below | Only Design effort is connected; purchasing and subcontract expenditure remain outside this ledger |
| Purchasing and subcontract authority | Graybar PO path and roles exist | Existing PO path has its own authorization checks | Its proposed budget input is not yet reconciled to this common Work-level economic authority; subcontract commercial management remains unqualified |
| Historical records | Prior accepted ROM, Design and procurement decisions are retained | No migration backfilled synthetic commitment decisions | Legacy records need explicit compatibility treatment before any future global cap enforcement |

The material R1 gap was the inability to consume the separately authorized Design spend cap through an exact, independent decision. This slice closes that first connected path. R1 as a whole remains **partial**, so subcontract implementation was not started.

## Browser-observed role journey

The PM and Operations accounts were separate authenticated fictional accounts. Each began at My Work, followed the exact Hall R task, and reloaded committed state.

1. PM prepared a USD 1,500 Design-only spending window, exact activity and 17–31 October validity, with retained internal funding source. Authority `9ee6b184-f58e-4421-a23f-fd11025606da`, revision 1.
2. Operations independently approved that exact window from My Work, revision 2. Its review card disappeared after refresh.
3. PM prepared a USD 600 scoped Design effort commitment, `02a0f775-02f5-4622-bc1e-f17fece6336c`, revision 3. Preparing it did not commit spend.
4. Operations independently approved the commitment from My Work, revision 4. Reload retained the approval and updated the balance. The approved customer budget did not become an award, PO or field-start permission.

The first preview exposed an Operations presentation-gate error; the exact-link fix was committed as `0dc68d4` and the successful role journey used that build. A subsequent forward read correction made the balance explicitly use the narrower USD 1,500 window, not only the USD 2,500 Design cap. The final source is `6a8e7da`.

The rebuilt final preview displayed `Build 6a8e7da1d983`. An authenticated PM browser reload of the exact Hall R record returned the persisted revision 10, USD 1,500 window, USD 1,450 approved commitments and USD 50 remaining through the hosted read route. The focused repeatable check is `scripts/verify-d5o-design-spend-preview.mjs`; it reads credentials from a local-only file and prints no password. The final build was produced with the allowlisted disposable Supabase URL and local public key in memory. The preview health check reported origin `http://127.0.0.1:58221`.

## Focused database/API checks

Rollback-only authenticated probes returned exact domain errors: `design_spend_source_changed`, `stale_design_spend_revision`, `independent_design_spend_authority_required`, `workspace_forbidden`, `design_spend_preparer_required`, `design_spend_cap_exceeded`, and `command_reuse_conflict`. Identical replay returned the original authority receipt. An authenticated direct table update failed with insufficient privilege. After those probes, the position remained revision 4 with one USD 600 approved commitment, four events and four receipts.

An expiry probe changed the approved window's end date inside a rolled-back fixture transaction. The PM prepared a linked replacement; a separate Operations actor approved it. The original window and decisions remained unchanged after rollback. Forward migration `20261017050000` supplies this path without altering the applied first migration.

For a real concurrent-cap probe on Hall R, the PM submitted two separate fictional USD 800 drafts when USD 900 remained. Two Operations approvals sent concurrently at revision 6 produced one approval at revision 7 and one `stale_design_spend_revision`. Retrying the loser at revision 7 produced `design_spend_cap_exceeded`; no second USD 800 approval or receipt was created. Operations retained a return, the PM submitted a linked USD 50 correction, and Operations independently approved it. Final fictional ledger: USD 1,450 approved against the USD 1,500 spending window, USD 50 remaining, revision 10; three approved commitments and one returned historical draft. These are synthetic qualification transactions, not incurred cost postings.

Fresh ordered replay on a separate empty disposable Supabase target applied **111 files**, ending at `20261017050000`. `authenticated` has the typed command grant and `anon` does not. The populated browser pilot was patched incrementally; it was not reset.

Scoped ESLint, `tsc --noEmit`, and the production-mode Next.js build passed after the final component correction. The React review checked that the new control derives eligibility from the server source, labels each input and decision, retains focus-specific stale-link handling, and does not mutate authority from a rendered queue card.

## Boundaries and next action

The command derives actor and active membership from the session, locks canonical Work and the spending position, verifies current source and revision, uses integer minor-unit USD amounts, serializes cap consumption, retains events and replay receipts, and does not expose internal helper execution. UI task visibility never grants authority. The React view remains a presentation of the server decision.

The next R1 increment is a single governed purchasing/subcontract commitment that consumes a common commercial budget and checks the exact customer/scope basis. First reconcile the existing Graybar PO's proposed budget input and purchasing delegation with that authority. Only after R1 commitment coverage is qualified should broader subcontract management follow. Funding/credit policy for production and delegated approver assignments remain owner decisions. Data Hall C worker-label amendment and delivery/Operate actions remain pending; its procurement and USD 6,640 material reconciliation were not changed.
