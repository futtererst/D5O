# RC13 historical application command results

The restored production-derived database began with **177 actual source-ledger entries**. Frozen orders 212–236 completed 25/25 using the unchanged RC8 pre/215/post transaction, ending at **202 actual entries**. All 236 source hashes and both bridge hashes matched. Local GoTrue v2.195.0 supplied genuine sessions for fictional users; Next.js 16.4.2 ran a production build inside an isolated Docker network. The protected historical Work was not edited. [Local identity](evidence/D5O_RC13_LOCAL_IDENTITY.json).

| Command group | Actual HTTP/RPC result | Qualification |
| --- | --- | --- |
| Own/foreign/anonymous Work reads | 200 / 403 / 401 with real sessions | PASS for these controls |
| Admin configuration | Project-manager request 403 | Positive admin operation unexecuted |
| Canonical synthetic Work creation | 201, one linked Work; exact replay 201 same Work; conflicting replay 409; field-worker 403 | PASS for creation and replay controls |
| Private evidence index/download | 200 index and 200 matching bytes; wrong Work 403, foreign 403, anonymous 401 | PASS for tested design-document route |
| Define draft | Save 200 and persisted; stale revision 409; field-worker 403 | PASS for draft and denials |
| Define submission | 409 `definition_incomplete` on synthetic incomplete draft | Business precondition observed; successful submission unexecuted |
| Connected Work | Frozen baseline listed zero selectable published types and returned 409 for a valid type. Narrow correction listed two, created Work 201, exact replay returned same Work, conflicting replay 409, disabled type 409. | PASS only with RC13 correction; baseline defect demonstrated |

Tenant administration positive decisions, My Work reconciliation, Define reviews, Design preparation and independent acceptance, Develop scheduling/authority, field execution and permits, Deploy inspection/completion and customer acceptance, Scope change/holds, Operate support activation, connected-service child Work after Support Active, separate Finance follow-up and their audit/receipt chains remain **UNEXECUTED through historical HTTP/RPC**. Prior clean-install/browser acceptance cannot substitute for this historical-copy gate. The machine-readable [command matrix](evidence/D5O_RC13_LIFECYCLE_MATRIX.json) lists each outstanding group.

The connected-work defect is a real frozen-application compatibility failure: the historical published manifest omits `status` for valid types while the existing canonical pin guard accepts every type except explicit `disabled`. The one-line correction aligns the route's selector with that guard; no database migration or business state rewrite was needed. The corrected build is **not** the frozen SHA and needs separate release acceptance. [Before/after HTTP](evidence/D5O_RC13_CONNECTED_COMPATIBILITY.json) and [draft controls](evidence/D5O_RC13_DEFINE_DRAFT.json).
