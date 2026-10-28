# RC20 finite acceptance matrix

Candidate: `6f0bbc8d9ba916c75bf2149a8eaef6e667896072`; `app/` tree `84f2081b3b6266abf7d89906b04f816622838f2c`. The RC18 source correction is only hosted routing. Earlier RC3/RC4 browser results used ancestor application trees; they are scoped regressions, not exact-candidate hosted acceptance.

| Required action | Hosted route / authority | Actor and prerequisite | Expected task and state | Existing evidence | RC20 gap |
| --- | --- | --- | --- | --- | --- |
| Vendor provisioning and customer setup | `/api/d5o-platform/provisioning`, `/work/onboarding` and configuration RPCs | Vendor, invited administrator | Active tenant and published version | RC18 exact-candidate production-mode, 23/23, genuine fictional Auth | Reuse; no rerun without changed dependency |
| Work creation, configuration pin | `/api/d5o-hosted/work`, customer workspace | Administrator/project manager; active tenant | New synthetic Work pinned to published version | RC18 clean hosted checks | Reuse; verify task projection in continuation |
| My Work and Design decisions | `/work/customer/{workspace}?work=…&task=…`, `/api/d5o-hosted/customer-design-action` | Assigned independent reviewer; accepted prerequisite package | Task resolves, next responsibility visible | RC14 historical HTTP, RC3 ancestor browser | Exact-candidate hosted browser action |
| Develop workforce, schedule, authority, permit | Customer workspace, `/api/d5o-hosted/customer-develop-action` and specialist APIs | Qualified workers, independent approvers, accepted Design | Field authorization and acknowledgment | RC14 only purchase/labor; RC3 ancestor browser | Exact-candidate hosted execution |
| Deploy execution and private evidence | Customer field/deploy pages and hosted evidence APIs | Assigned worker, inspector, reviewer | Evidence, inspected completion, turnover | RC13-A evidence; RC3 ancestor browser | Exact-candidate hosted continuation and denials |
| Customer acceptance | Customer decision APIs and server-mediated evidence | Authorized customer actor; reviewed turnover | Acceptance receipt and Operate handoff | RC14 evidence route; RC3 ancestor browser | Hosted customer decision |
| Scope change and hold | Hosted field-change/commercial commands | Separate eligible synthetic Work, independent reviewer/customer | Hold, revised Design, new permit | RC4-B.1 ancestor, 47/47 | Focused exact-candidate hold and release |
| Operate support | Hosted Operate command and customer workspace | Documentation reviewer/support owner | Support Active | RC3 ancestor browser | Exact-candidate hosted command and task |
| Connected service and Finance | Hosted service approval/job/finance commands | Support Active, threshold approval/customer | One child Work; Finance In review separately | Ancestor suites only | Exact-candidate hosted execution |

The supported customer My Work surface is the task list and task-linked detail in `/work/customer/{workspace}`; field workers use `/work/customer/{workspace}/assignments`. `/work/my-work` is an older redirect into `/work` and is not the customer task-link contract. All claimed browser actions must be actually clicked and followed by authoritative-state verification. Synthetic setup is recorded separately.

**Executed RC20 boundary:** the exact-candidate hosted onboarding setup again passed 23/23. The customer My Work page rendered, but its fictional Work had no assigned task after onboarding. No task-linked decision was executed. The first probe used a broad sidebar selector that selected a Work-record link; the bounded retry identified the missing task prerequisite. Neither probe is an authorization denial or product task-link defect. The remaining Design-to-Finance rows above are unexecuted in RC20.
