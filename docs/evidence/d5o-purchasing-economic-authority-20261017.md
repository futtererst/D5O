# Work-level Graybar purchasing authority — local qualification, 17 October 2026

This is fictional technical qualification on disposable local persistence. It records no real supplier submission, customer authorization or production delegation. Application commit: `601fbc2847320b5da2d0ec3276b5d8c190187389`. Preview: `http://127.0.0.1:61656/work?workspace=rybex&view=my-work`, displayed `Build 601fbc284732`, connected to disposable API `127.0.0.1:58221`. The new fictional Hall P Work is `rybex-46111f1e1ad0473aba57df5cb50e0f7e`. Data Hall C remained untouched.

## Control map and correction

| Control | Prior effective path | Gap | Current path |
| --- | --- | --- | --- |
| Exact source | Approved Define, reviewed ROM, Design BOM and Graybar quote/line | PO draft budget was preparer-entered | Work authority pins approved scope, commercial/funding basis, entity, account and BOM; approval rechecks offer and source |
| Spending rights | PM draft, administrator independent PO approval | No governed Work cap or purchasing allocation | PM prepares Work cap and purchasing sublimit; independent administrator approves; PO approval reserves both atomically |
| Accounting | Finance posts PO commitment, then reconciles matched supplier invoice into incurred cost | PO approval and Finance posting had no stable shared reservation | Reservation links the approved PO and Finance source; incurred posting reduces outstanding commitment, not consumed authority |
| Historical records | Earlier approved POs and cost events persisted | A new cap could falsely appear to cover old purchase | Legacy Work with unlinked approved PO is held for explicit transition; no fabricated reservation or authority |

The parent limit counts Design commitments and approved purchase reservations once. The purchasing sublimit is contained within, not added to, the parent. Drafts reserve nothing. Approved POs reserve immediately, including before supplier submission. Submission confirms the exact approved reservation and current quote/BOM/authority. An approved-unsent-unposted PO may be canceled by typed decision with retained history; its reservation releases once. A recorded receipt, matched supplier invoice or incurred posting never releases economic capacity.

## Browser-observed fictional journey

Separate authenticated PM, Operations, administrator and Finance accounts used normal pages and My Work links. The PM created Hall P canonical Work and advanced an approved Define, independent Develop review, quote-sourced ROM and Design BOM. These upstream decisions were observed in the local browser journey; their detailed historical records remain in the disposable pilot. The two-line private quote was uploaded through the browser after the forward migration admitted CSV MIME. Its retained document is `b1c94f3e-bc8b-4f0f-b053-b24719fc6eb5`, 511 bytes, SHA-256 `325999fae78afb2d0a8508466d1fe0e331e23399f5eb4052a15e5198294a8984`; authorized browser retrieval matched those bytes. Operations assessed the candidate lines, and separately approved BOM `7a700b86-1d7d-4ed8-940a-c3ed0056e019`. The quote-to-ROM difference remained explicit; customer price was not silently revised.

A separate Design-only window committed USD 1,450 of fictional internal Design effort. From My Work, PM prepared a Work USD 10,000 parent cap and USD 7,500 purchasing allocation; admin independently approved authority `795b9790-591e-40b8-a40e-4248b11158b1`. PM drafted USD 6,640 PO `086fb74d-f5ac-4668-b0cb-a389d9825d01`; the draft consumed zero. Admin approved it from My Work, creating reservation `82601606-d727-4bf0-8cb9-33fb1120f6d6`. Reload showed parent consumption USD 8,090 and remaining USD 1,910; purchasing remaining USD 860. PM drafted a separate USD 900 accessory PO; the administrator's attempted approval was held as `purchasing_sublimit_exceeded`, despite USD 1,910 parent headroom.

The first PO was marked **controlled local test submission**, not sent to Graybar. Operations recorded fictional acknowledgment, shipment and one-kit physical receipt, each separately. Finance posted the original USD 6,640 material commitment, independently matched a fictional USD 6,640 supplier invoice, then posted USD 6,640 incurred cost. Reload and canonical ledger query showed historical committed USD 6,640, outstanding commitment USD 0, incurred USD 6,640, and **unchanged** authority consumption. Invoice, receipt and commitment did not create duplicate incurred costs.

PM canceled the held USD 900 draft without a budget effect. Admin revoked the old authority for future commitments, retaining its approved PO history; PM prepared a linked replacement and admin independently approved a USD 7,600 purchasing sublimit within the same USD 10,000 parent. A USD 900 accessory PO then approved exactly once. After approval, parent remaining was USD 1,010 and purchasing remaining USD 60. Admin canceled that approved, unsent, unposted PO through its typed decision. Its reservation became Released; parent remaining returned to USD 1,910 and purchasing remaining to USD 960. The original USD 6,640 reservation stayed consumed despite full invoicing.

## Focused API and database boundary evidence

Authenticated rejection probes gave exact domain responses: `purchasing_sublimit_exceeded` for the USD 900 PO under USD 7,500 allocation; `independent_purchasing_authority_required` for PM PO approval; `workspace_forbidden` for cross-tenant request; `stale_state` for old revision; `command_reuse_conflict` for conflicting replay. Identical replay returned the original receipt without new events or reservations. Two concurrent administrator approvals of the same final-capacity PO produced one commit and one `stale_state`; one reservation existed. A separate competing-PO cap race was not executed, so its prevention is supported by the Work row lock and serial cap check, not separately observed.

Rollback-only source probes made the authority expired or its source digest incompatible, then attempted approval with an otherwise valid draft. Both returned `approved_purchase_authority_required`; rollback preserved the actual source. Direct authenticated UPDATE on authority reservations and Graybar state was denied. Rejected role/cap/replay probes left Graybar revisions, events, receipts and authority reservations unchanged at the probe checkpoint.

Authenticated Hall C inspection showed the preexisting approved PO has no new reservation, its Finance source links remain historical, and the ledger still reports USD 6,640 committed, USD 6,640 incurred, USD 0 outstanding. A PM preparation attempt returned `legacy_purchase_transition_required` without mutation. My Work labels this as a historical authority transition for administrator resolution; no new purchasing permission was fabricated.

## Build, migration and limits

TypeScript, scoped ESLint and production build passed on the application commit; the running build displays its SHA. The populated pilot received the forward migration and narrow function corrections incrementally. A separate fresh disposable full-stack reset of the final **112-file** ordered candidate sequence is recorded in the migration manifest; it verifies schema order, not populated recovery or shared-project compatibility. The 12 shared-history mappings are unchanged, leaving 100 candidate files outstanding there. Shared and production persistence were not modified.

This qualifies the local **Graybar PO purchasing slice**, not all R1. Production funding/credit rules and delegated purchasing thresholds remain unconfigured. Legacy PO transition needs a governed owner decision before new spending. Subcontract commercial authority and field-labor expenditure remain outside this slice. Live Graybar and live AI remain unconfigured. No actual order or payment occurred.


