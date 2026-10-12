# D5O atomic synthetic scenario matrix — 2026-10-11

Application source: fccecd4dc99f68b66c42e50d9aaf9c8299ca609b. Earlier mixed-build observations remain in prior-run-results.json; current outcomes and evidence are in results.json. A fixture fact or old-build result is never a current pass.

| ID | Track | Role | Initial state | Browser action or probe | Expected outcome |
| --- | --- | --- | --- | --- | --- |
| A01 | Access | PM | Existing pilot account | Sign in from normal landing | PM identity and assigned or eligible tasks shown |
| A02 | Access | Worker | Bound worker account | Sign in from normal landing | Only assigned worker surface and work shown |
| A03 | Access | Finance | Finance account | Sign in from normal landing | Finance tasks and no general admin authority |
| A04 | Access | PM and Finance | Two authenticated accounts | Switch account in one browser | No prior identity or task leakage |
| A05 | Access | Other tenant account | Authenticated session | Open another tenant Work and task | No tenant data or command authority |
| A06 | Access | Wrong-role actor | Submitted decision | Attempt consequential action | Exact domain rejection and unchanged state |
| A07 | Access | Decision preparer | Submitted decision | Attempt self-review | Independent review denied without mutation |
| B01 | Discover | PM | Canonical draft | Save intake | Current saved revision survives reload |
| B02 | Discover | PM | Saved intake | Submit intake | Exact revision routed to reviewer |
| B03 | Discover | Commercial reviewer | Submitted intake | Qualify or return from My Work | Independent decision and next owner |
| B04 | Define | PM | Qualified intake | Submit Define receiving handoff | Exact source and receiving task |
| B05 | Define | Operations receiver | Submitted handoff | Accept or return from My Work | Independent receipt and PM preparation task |
| B06 | Define | PM | Accepted receiving | Prepare structured requirements scope and acceptance | Reviewable exact baseline draft |
| B07 | Define | PM | Complete draft | Submit baseline | Exact revision in independent review |
| B08 | Define | Commercial reviewer | Submitted baseline | Return with reason | Historical return and correction task |
| B09 | Define | PM | Returned baseline | Correct and resubmit | New revision retained; old decision historical |
| B10 | Define | Operations reviewer | Resubmitted baseline | Approve delivery review | Independent decision on current revision |
| B11 | Define | Commercial reviewer | Resubmitted baseline | Approve commercial review | Independent decision on current revision |
| B12 | Define | Develop receiver | Approved baseline | Accept into Develop | Exact pinned source received |
| C01 | Develop | PM | Accepted Define | Prepare and submit solution | Selected option alternatives coverage and rationale visible |
| C01B | Develop | PM | Multiple valid solution options | Compare documented alternatives | Selection tradeoff and requirement coverage of alternatives visible |
| C02 | Develop | Independent reviewer | Submitted solution | Return with reason | Correction task and retained history |
| C03 | Develop | PM | Returned solution | Correct and resubmit | New exact revision in review |
| C04 | Develop | Independent reviewer | Resubmitted solution | Approve | Pricing preparation task appears |
| C05 | Develop | PM | Approved solution | Save sourced detailed estimate | Policy and calculation retained |
| C06 | Develop | PM | Saved estimate | Submit pricing | Independent pricing task appears |
| C07 | Develop | Pricing authority | Submitted estimate | Approve or return | Exact revision decision and next owner |
| C08 | Develop | PM | Approved pricing | Prepare and submit proposal | Offer snapshot and exact estimate link |
| C09 | Develop | Proposal reviewer | Submitted proposal | Approve or return | Exact independent internal decision |
| C10 | Develop | PM | Internally approved proposal | Record fictional customer outcome with retained source | Award distinct from internal approval |
| C10B | Develop | PM | Fictional award | Inspect retained external customer award file | Customer award document custody and independent authority source verified |
| C11 | Develop | Design receiver | Awarded source | Accept or return commercial handoff | Exact source pin and owner |
| D01 | Design | PM or Engineering | Accepted source | Create and enrich first shared package | Stable package ID and source requirements |
| D02 | Design | PM or Engineering | First package draft | Create second package and dependencies | Two distinct scoped packages |
| D02B | Design | PM or Engineering | Two draft packages | Link predecessor dependency | Dependency retained and used by release/readiness |
| D03 | Design | Engineering | Draft package and document | Submit exact revision for review | Independent review task |
| D04 | Design | Reviewer | Submitted package revision | Approve or return | Exact decision and history |
| D05 | Design | Delivery authority | Reviewed package | Issue Design release | Exact source package and document revisions |
| D06 | Design | Deploy receiver | Issued release | Accept or return | Receipt distinct from release |
| D07 | Design | Engineering | Issued package | Revise after field change | Prior release retained and affected scope held |
| D08 | Design | Delivery authority | Revised basis | Issue revised release | Only revised accepted scope executable |
| D09 | Design boundary | Wrong role or stale link | Submitted or revised package | Attempt stale or unauthorized decision | No substitute or stale approval |
| D10 | Design boundary | Accepted whole-work scope | Attempt new package | Package-set freeze rejects addition without mutation |  |
| E01 | Workforce | Admin | Existing fictional roster | Create active person with qualifications and capacity | Stable tenant identity survives reload |
| E02 | Workforce | Admin | Existing pilot Auth user and person | Bind account | Account and roster link retained |
| E03 | Workforce | Scheduler | Demand and roster | Inspect eligible and ineligible people | Qualification availability and binding agree with booking guard |
| E03B | Workforce | Scheduler | Unbound or ineligible roster person | Attempt selection | Ineligible person not represented as bookable |
| E04 | Scheduling | Scheduler | Qualified demand | Publish booking | Named shift and immutable publication |
| E05 | Scheduling | Scheduler | Overlapping or ineligible demand | Attempt conflicting booking | Domain rejection and unchanged schedule |
| E06 | Scheduling | Worker | Published own booking | Acknowledge or cannot attend | Worker response retained; no start authorization |
| E07 | Field | Operations | Accepted release and booking | Assess and authorize start | Prerequisites and exact release checked |
| E08 | Field | Worker | Authorized assignment | Submit partial report with labor quantity and evidence | Actuals retained but completion blocked |
| E09 | Field | Supervisor | Submitted report | Independently review | Reviewed actuals distinct from submission |
| E10 | Field | Worker | Unexpected condition | Raise evidence-linked issue and technical query | Package release and report linkage retained |
| E11 | Field change | PM and Commercial | Assessed proposed change | Price and independently approve commercial change | Original estimate and decisions retained |
| E12 | Field change | Customer recorder | Approved change | Retain fictional customer authorization | Additional scope not executable before revised release |
| E13 | Field | Quality | Failed inspection | Record independent failure | Completion blocked with defect visible |
| E14 | Field | Worker and Quality | Corrected work | Submit retest and independently pass | Current verification supersedes failure without erasure |
| E15 | Delivery | Completion reviewer | Reviewed actuals and passing tests | Approve first package completion | Exact reviewed quantity and verification bound |
| E16 | Delivery | PM and recorder | First completed package | Prepare turnover and PDF-backed acceptance | One package accepted; whole work incomplete |
| E17 | Delivery | Operations | Accepted first package | Independently receive package | Package receipt retained; second package pending |
| E18 | Delivery | Worker and reviewers | Second package incomplete | Report verify and complete second package | Two current package completions |
| E19 | Delivery | PM and recorder | Both packages accepted | Record exact whole-work acceptance | Scope bound PDF and signatures retained |
| E20 | Delivery | Operations | Whole-work accepted | Independently receive work | Receipt actor and exact scope retained |
| E21 | Delivery boundary | Stale or duplicate actor | Decided turnover | Replay or open stale link | No duplicate decision or substitute package |
| E21B | Delivery boundary | Stale or duplicate actor | Decided turnover | Replay duplicate command | Identical replay stable; conflicting replay rejected |
| F01 | Operate | PM | Accepted delivery | Link exact handoff | Exact turnover source and residual obligations |
| F02 | Operate | Operations | Submitted handoff | Accept support ownership independently | Owner authority distinct from delivery receipt |
| F03 | Operate | PM and Operations | Accepted support | Record contacts intake warranty and coverage disposition | Explicit facts not inferred coverage |
| F04 | Operate | Operations | Complete profile | Assess and activate support | Activation independent of Finance |
| F05 | Operate | PM | Open documentation obligation | Upload fictional replacement document | Private bytes checksum and exact obligation link |
| F06 | Operate | Independent reviewer | Submitted document | Approve or return exact version | History and obligation state retained |
| F07 | Operate | Operations | Supported asset | Browse asset agreement request and maintenance | Correct current cycle and next action |
| F08 | Operate boundary | Wrong role or stale link | Accepted support | Attempt obsolete or unauthorized action | No mutation or substituted target |
| G01 | Covered service | PM | Supported asset and covered request | Prepare scoped service basis | Coverage matches exact authorized scope |
| G02 | Covered service | Independent Operations | Submitted service basis | Accept then Design receive and release | Distinct decisions on exact cycle |
| G03 | Covered service | Scheduler worker reviewer | Accepted service release | Book authorize report inspect and complete | Actual visit and independent review |
| G04 | Covered service | Operations | Completed child | Return evidence to asset and resolve request | Job completion separate from current-cycle closure |
| G05 | Partial service | PM and Finance | Partially covered request | Price uncovered scope and retain authorization | Covered and uncovered amounts distinct |
| G06 | Partial service | PM and Operations | Authorized partial request | Accept service basis and release | Exact pricing coverage and cycle pinned |
| G07 | Partial service | Worker reviewers Operations | Started partial child | Report verify accept return and close request | Asset history and current-cycle closure |
| G08 | Service boundary | Wrong role stale cycle | Changed request or source | Attempt old closure or duplicate return | No historical evidence reused or duplicate history |
| H01 | Job Finance | Finance | Accepted fixed-price job | Inspect baseline changes costs commitments and forecast | Source drilldown and unknowns explicit |
| H02 | Job Finance | PM and Finance | Accepted billable scope | Draft review issue bill and record payment | Receivable distinct from closeout |
| H03 | Job Finance | Finance | Invoice after Finance Closed | Record additional partial payment | Closed status retained and receivable reduced |
| H04 | Service Finance | PM and Finance | Completed partially covered service | Prepare terms and independent Ready review | No invoice inferred from readiness |
| H05 | Service Finance | PM and Finance | Ready basis | Draft review and issue USD 524.65 invoice | Immutable invoice and due terms |
| H06 | Service Finance | Finance | USD 524.65 issued invoice | Record fictional USD 100 payment | USD 424.65 outstanding survives reload |
| H07 | Service cost | Finance | Service child | Record sourced incurred cost and correction | Allocation source and original adjustment retained |
| H08 | Service boundary | Finance or wrong role | Invoice and costs | Probe overpayment duplicate source stale replay | No mutation or duplicate receipt |
| I01 | Cross-surface | PM Operations auditor | Several Work records | Compare My Work hub Portfolio registers evidence and Insights | Same current scope blocker and next owner |
| I02 | Administration | Admin | Published policy and roster | Open configuration operating model and workforce | Scoped controls and readable identity |
| I03 | Administration | Non-admin | Published policy | Attempt restricted administration | No admin decision authority |
| I04 | Interaction | PM worker Quality Finance | Pending tasks | Use desktop mobile keyboard back and reload | Exact task and result without overflow |
| I05 | Interaction | Any reviewer | Saved queue link | Decide or supersede elsewhere then open saved link | Changed source explained without substitute |
| E16C | Delivery boundary | PM and independent Operations | South turnover Draft on current release | Upload exact fictional PDF and record conditional package acceptance; refresh PM queue | Conditional outcome retained and no false executable second-turnover action |
| I06 | Cross-surface | Finance | Historical three-package expanded-scope bill | Open Billing review from My Work; attempt review | Queue distinguishes unavailable historical bill basis from executable Finance decision |
| I07 | Cross-surface | PM | Approved solution/pricing/released job | Open Work hub and exact Work Record | Summary reflects current authoritative phase decisions and blocker |
| I08 | Role routing | PM/Operations | Approved proposal and submitted Design handoff | Inspect My Work for next handoffs | Customer submission preparation and Design receipt tasks discoverable |
| I09 | Interaction | PM/Operations | Four support document obligations | Read My Work cards | Readable package names distinguish North and South documents |
| D11 | Design boundary | PM | Whole-work accepted customer job | Attempt adding another package | Accepted package set frozen; historical acceptance retained |
| D12 | Design boundary | PM | Whole-work accepted service visit | Attempt adding another package | Accepted service package set frozen; historical acceptance retained |
| G09 | Service boundary | PM/Operations | Pre-closure request cycle | Attempt premature closure before completion/resolution | Specific domain rejection with unchanged state |
| G10 | Service boundary | PM/Operations | Changed request cycle | Attempt old execution/closure decision | Old cycle cannot satisfy current request |
| H09 | Job Finance | Finance | Finance Closed with outstanding invoice | Record later receivable payment | Finance remains Closed; receivable decreases without rewriting history |
| E22 | Field change | Worker/PM/Engineering | Unexpected condition on released package | Issue, price/authorize change, revise and release | Original history retained; additional scope held until revised release |
| H10 | Service Finance | Finance | Ready service basis and issued invoice | Pay part of invoice after source change | Retained issued invoice remains collectible; no new billing authority inferred |

Status vocabulary: Passed, Failed, Blocked, Not run, Not implemented, Not applicable. Blocked requires an actual attempt and named blocker. Browser decisions, API probes and database probes are recorded separately. The delivery and support observation checkpoints and private files are preserved; the mutable pilot is separate.
