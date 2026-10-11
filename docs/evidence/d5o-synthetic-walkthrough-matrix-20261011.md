# D5O synthetic walkthrough matrix — 2026-10-11

**Source:** `ddcf9d867d72598b7f5f37041184f2006266a0e9` at matrix creation. These eight tracks group implemented Rybex prototype capabilities for sampling; they are not a claim that a separate customer-approved list of seven scenarios was found. All records and actors are fictional. A browser action must be observed in this run to count as Passed; prior evidence supplies fixture context only.

| ID / track | Role | Initial state | Browser steps | Expected outcome and evidence |
| --- | --- | --- | --- | --- |
| A01 · Access | PM, worker, Finance, admin | Isolated accounts | Sign in from normal landing; inspect navigation and My Work | Role-relevant links; build and screenshot |
| A02 · Access | Two roles, one browser | Signed-in first account | Sign out/switch account and sign in as second | No prior user's tasks or data; screenshot and account label |
| A03 · Access | Worker, PM | Two tenant workspaces | Attempt other-tenant Work/task URL | Denial or unavailable; no cross-tenant data or decision |
| A04 · Access | Wrong role / reviewer | Submitted decision | Open exact saved link and attempt action | Domain denial, unchanged revision; browser plus separate API/DB probe if needed |
| B01 · Discover→Define | PM | Canonical draft | Open My Work; save and submit intake | Exact revision submitted, PM task becomes waiting |
| B02 · Discover→Define | Commercial reviewer | Submitted intake | Open My Work and qualify/return | Independent decision; next PM handoff task |
| B03 · Discover→Define | PM, named receiver | Qualified intake | Submit Define handoff; receiver accepts/returns | Exact handoff and actor separation; queue transition |
| B04 · Discover→Define | PM, commercial, Operations | Accepted handoff | Prepare structured baseline, submit, review and correct if returned | Requirement/scope/acceptance evidence inspectable; exact approved revision |
| B05 · Develop | PM, Operations | Approved Define receipt | Prepare options and strategy, submit; reviewer returns; PM corrects; reviewer approves | Prior review retained, new revision and pricing preparation task |
| B06 · Develop | PM, commercial/Operations | Approved solution and policy | Save sourced estimate, submit pricing and proposal; independent reviews | Current price/offer source, blockers and next owner; no award inferred |
| C01 · Design | PM/Engineering, Operations | Accepted commercial or service basis | Prepare package/docs/review; issue release; independently receive | Exact package/doc revisions and distinct release/receipt |
| C02 · Design | Wrong role and stale reviewer | Submitted revision | Use obsolete link and unauthorized action | No substitute package or stale approval |
| D01 · Workforce | Admin | Fictional roster | Create/profile/bind an existing account | Stable identity, qualification/capacity; no account provisioning implied |
| D02 · Workforce | Scheduler | Package demand and qualified people | Inspect People & Capacity; book/publish shift | Skills, availability and conflicts match server eligibility |
| D03 · Field | Worker | Published assigned booking | Open My assigned work; acknowledge or cannot attend | Response retained; no field authorization inferred |
| D04 · Field | Operations, worker | Accepted release and booked crew | Assess/start; worker records partial quantities, labor and evidence | Partial actuals retained; no completion from report alone |
| D05 · Field | Quality, supervisor | Failed inspection/submitted report | Review failure, correction, retest and independent report review | Failure blocks completion; passing current test allows reassessment |
| D06 · Delivery | PM, acceptance recorder, Operations | Two reviewed packages | Review completion, prepare turnover, record package and whole-work customer evidence, receipt | One package insufficient; exact scope, independent receipt and retained PDF |
| D07 · Delivery | Stale/wrong actor | Prior release/acceptance | Attempt old task, duplicate and cross-tenant command | No duplicate or stale decision; unchanged state/receipts |
| E01 · Operate | PM, Operations | Accepted turnover | Link handoff, accept support, record contact/coverage/intake, assess activation | Delivery receipt, support ownership and activation remain distinct |
| E02 · Operate | PM, Quality | Active support, open as-built obligation | Supply fictional document; independent review/return | Bytes/checksum and obligation remain linked; history retained |
| E03 · Operate | Operations | Supported asset | Inspect asset, agreement, request, maintenance and support queues | Correct current cycle, obligations and next actor; no inferred coverage |
| F01 · Covered service | PM, Operations, worker, Quality | Covered current request | Accept exact service basis; release/receive, schedule/start, report/verify/accept/return | Job completion separate from request closure; asset history linked |
| F02 · Partial service | PM, Finance, worker, Quality | Partially covered request | Price uncovered scope, retain customer authorization, execute/verify/return | Covered/uncovered distinction and exact request cycle preserved |
| F03 · Service boundary | Wrong role, stale cycle | Changed request/coverage | Try old decision and duplicate asset return | Denial with unchanged source/receipts; no historical evidence reused |
| G01 · Job Finance | Finance | Accepted fixed-price job | Inspect estimate, changes, incurred/committed costs, forecast and bill readiness | Totals drill to sources; unknowns explicit |
| G02 · Job Finance | PM and Finance | Draft bill/invoice | Prepare, independently review, record billed and partial payment, closeout | Receivable distinct from Finance Closed; no overbilling |
| G03 · Service Finance | PM and Finance | Completed partial service | Prepare billing terms, review, issue fictional invoice and partial payment | USD 524.65 invoiced, USD 100 paid, USD 424.65 outstanding in established pilot |
| G04 · Service costs | Finance | Service child and invoice | Record sourced cost and linked correction | Allocation and provisional economics; no fabricated final margin |
| H01 · Cross-surface | PM, Operations, auditor | Multiple Work records | Browse Work hub, Portfolio, registers, evidence and Insights | Same current scope/status/next action; legacy observations labeled |
| H02 · Administration | Admin, non-admin | Published policy and role profiles | Browse configuration/operating model and worker access | Admin controls scoped; non-admin cannot change policy |
| H03 · Interaction | PM, worker, Quality, Finance | Pending tasks | Keyboard-open exact task; 390px mobile; reload and back | No hidden action, overflow or wrong return target; screenshot |

**Result vocabulary:** Passed, Failed, Blocked, Not implemented, Not applicable. The walkthrough report records the observed result for each ID and separates browser, API, database and source-only evidence. A blocked row does not prevent independent rows from running. Observation checkpoint databases and private files are preserved; new mutable work uses the preparation pilot or a separately disposable clone.

