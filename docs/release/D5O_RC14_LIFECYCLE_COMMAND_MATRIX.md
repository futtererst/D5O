# RC14 lifecycle command matrix

All RC14 active commands used fictional GoTrue users, a fictional Work, the selected production build, and the upgraded isolated historical database. `docs/release/evidence/D5O_RC14_*.json` records sanitized HTTP statuses. RC13-A Discover, Define, and Develop solution results are reusable because the application tree and those command contracts are unchanged.

| Stage | Actual result | Qualification |
| --- | --- | --- |
| Discover, Define, Develop solution | RC13-A authenticated HTTP commands passed; independent reviews and replay controls recorded in RC13-A evidence. | PASS within that scope |
| Estimate and commercial review | Initial fictional estimate lacked a historical service rate (409); documented fictional manual rate resolved the prerequisite. Estimate, pricing submission, and independent Operations review returned 200. | PASS for fictional path |
| Offer, customer award, Design handoff | Offer fixture saved through application state route; authoritative proposal submit, independent review, customer submission and award, Design handoff and acceptance returned 200. | PASS for tested path |
| Design document and private evidence | Package creation 201; document save, submit, independent review and issue 200. Genuine-session upload/download and historical customer-decision download 200 with matching hashes. | PASS for tested path |
| Design package | Historical pinned policy required five specialist reviews and a valid material basis. Engineering, Delivery, Safety, Quality, Procurement reviews, release, and independent receipt acceptance returned 200 after correcting fictional fixture inputs. | PASS for tested path |
| Develop purchase and labor authority | Prepared purchase returned 200; independent approval first returned 409 `spending_delegate_or_sponsor_required`. A fictional delegate rule was added by authenticated admin only in this disposable copy. Resumed purchase and labor prepare/approve returned 200. | CONDITIONAL: tenant-level synthetic prerequisite, no production policy decision inferred |
| Workforce, schedule, field acknowledgment, field start | Not executed against this Work. | UNEXECUTED |
| Deploy, inspection, turnover, customer acceptance | Not executed against this Work. | UNEXECUTED |
| Commercial Scope change and revised field authority | Not executed. | UNEXECUTED |
| Operate, Support Active, connected child Work, Finance | Not executed. | UNEXECUTED |
| My Work task navigation | Pilot page returned 200 at `/work?workspace=rybex&view=my-work`; no authenticated browser task-link execution. | PARTIAL |

The tested commands are HTTP/API operations, not browser-executed employee actions. The initial 409 responses are actual failed preconditions, not security denials or release defects. Receipt, audit, and phase-projection verification for later phases remains unexecuted. The full historical lifecycle is **PARTIAL**.
