# Phase 2H-TD My Work results

The [finite case register](evidence/phase2htd-closure-register.json) records D01–D11. My Work responsibilities are projected from authoritative Work, service decisions, roles and active membership; there is no separate task-completion authority. The [targeted run](evidence/phase2htd-targeted-results.json) passed the stale-task and replay checks with verified disposable cleanup.

| Case | Result | Observed behavior |
| --- | --- | --- |
| D01, D08 | PASS | Another authorized actor or browser session completed the pending decision; the first session's submission returned HTTP 409 and the old task disappeared. |
| D02, D03 | PASS | Suspending or removing membership after a task was opened caused HTTP 403 on submission and denied the queue; business state did not advance. |
| D04, D05 | PASS | Tenant suspension or disabling `connected_work` after task display caused HTTP 403; direct RPC also denied the feature-disabled command. |
| D06, D07 | PASS | Changing amount or scope invalidated the open approval task. Submission returned HTTP 409, the old task ID was removed, and historical approval data remained. |
| D09, D10 | PASS | A created job removed the job-creation responsibility. A completed task URL and concurrent post-job submissions could not create another executable job. |
| D11 | NOT APPLICABLE | Connected-service tasks have no individual assignee or reassignment command. They derive from role and active membership. Revocation and completion by another authorized actor were tested in D01–D03. |

The test helper now checks the exact task ID rather than treating a successor task with the same title and Work URL as an unresolved old task. That reflects the real projection: a new responsibility can occupy the same page after the previous decision completes. The submission path always rechecks server authority and refreshes the projected queue.

The positive authenticated browser run created one executable job per tenant. Tenant A resolved 9/9 connected-service responsibilities; Tenant B resolved 7/7. Browser screenshots from the real local application are in [Phase 2H-TD browser evidence](evidence/phase2htd-browser/). The targeted JSON retains task URLs, actors, HTTP results, authoritative revisions, and cleanup details.
