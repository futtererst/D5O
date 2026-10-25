# Phase 2H-U security and regression results

The executable [two-tenant result](evidence/phase2hu-two-tenant-results.json) is the source for individual assertions, HTTP results, RPC errors, Work revisions, actor and tenant references, and disposable cleanup. The final browser run records 47 PASS, 0 FAIL, no setup error and verified teardown. Two preceding fixture runs failed during read-only acceptance navigation after successful decisions; their [interrupted-navigation](evidence/phase2hu-interrupted-navigation-run.json) and [hydration](evidence/phase2hu-hydration-run.json) results are retained separately. The harness now waits for the hydrated acceptance control and panel before the next decision. No business command is replayed by that recovery.

## Executed Deploy and Operate checks

| Check | Observed result |
| --- | --- |
| Strict pinned Deploy policy | Tenant A completion without independent evidence review returned HTTP 409 `reviewed_evidence_required`, then HTTP 200 after the reviewer opened and reviewed the private file; Tenant B followed its optional additional rule. |
| Open field exception | The authoritative completion attempt was denied while the condition was Open. Independent assessment and controlled resolution preceded successful completion. |
| Private object retrieval | Assigned workers reopened their own uploaded PNG after reload: HTTP 200, 68 bytes. The independent reviewer opened the actual object before deciding. A forged evidence ID returned 404. |
| Foreign actor API | Manager route from a worker: 403 `work_role_forbidden`; foreign worker evidence and foreign manager Work: 403 `workspace_forbidden`; foreign issue read: 403 `connected_work_unavailable`. The checked Deploy revision did not change. |
| Cross-tenant direct RPC | Foreign Deploy and Operate calls were rejected with `field_membership_required` and `connected_service_forbidden`; no cross-tenant transition was recorded. |
| Existing session and lifecycle | The assigned worker's private evidence read returned 403 after membership suspension, rollout disablement and tenant suspension. Reactivation restored only previously authorized access. A suspended worker's field RPC returned SQLSTATE 42501 `field_membership_required`; the Deploy revision was unchanged. |
| Pending field decision under disabled feature | With a submitted field report still awaiting review, a direct `d5o_hosted_field_fact_command_v1` review call under a disabled `connected_work` flag returned SQLSTATE 42501. The runner restored the flag and verified that the Deploy revision did not change. This exercises the existing connected Deploy database capability trigger. |
| Historical policy | A later publication did not repin completed Work. The connected event checks retained exact Work, actor and tenant. Operate support acceptance followed the exact Deploy receipt and left financial closeout Pending. |

## Technical and inherited checks

- TypeScript (`npm run typecheck`): PASS.
- ESLint (`npm run lint`): PASS.
- Production build (`npm run build`): PASS after running outside the Windows filesystem sandbox, which had denied Next.js junction creation under generated `.next`. The successful build compiled, type-checked, generated 45 static pages and listed the new dynamic field and Deploy routes.
- Published phase contract, phase configuration contract, readiness scanner invariant: PASS.
- Shared My Work visibility: 15/15 PASS; Design task projection: 14/14 PASS; Develop task projection: 10/10 PASS.
- Phase 1B connected approval and job integrity: 13/13 PASS with cleanup verified.
- Inherited [Phase 1–2D/P0-A bundle](evidence/phase2hu-inherited-regressions.json): Phase 1 18/18, Phase 1B 13/13, Phase 2A 11/11, Phase 2B 18/18, Phase 2C 23/23, Phase 2D 27/27, P0-A 16/16; zero failed or setup errors and cleanup verified for all seven suites. Its phase contract, configuration contract and scanner checks also passed. Historical sealed M1 and original connected-pilot fixture are not represented by replacement tests.
- Inherited Phase 2G tenant-neutral Work and phase projection replay: 48/48 PASS with verified cleanup using the existing fixed disposable qualification clock. An initial Sunday run stopped before assertions with `business_day_required_for_field_start`; the fixed-clock run supplied the controlled business date without weakening the command. See [Phase 2G machine result](evidence/phase2hu-phase2g-regression.json).
- Inherited Phase 2H-TC My Work and connected service journey: 52/52 PASS, zero failures, cleanup verified. It retained the two-tenant approval difference, one executable job per tenant, task reconciliation and cross-tenant denial. See [TC machine result](evidence/phase2hu-phase2htc-regression.json).
- Inherited Phase 2H-TD security and concurrency closure: 60/60 PASS, zero failures, cleanup verified. It exercised pending service decisions, exact child and parent evidence, membership revocation, stale tasks and command receipts. See [TD machine result](evidence/phase2hu-phase2htd-regression.json). These inherited service tests do not replace the unexecuted Deploy-specific races below.
- Inherited Phase 2H-TE Gate B Work-creation browser regression: 51/51 PASS, zero failures, cleanup verified. Its visible creation receipt and persisted Work assertions remained in place. See [TE machine result](evidence/phase2hu-phase2hte-regression.json).

## Unverified Phase 2H-U cases

The browser run proves the complete positive Deploy chain and targeted identity, policy, evidence and cross-tenant denials. It does **not** yet execute a finite pending-decision race for the Deploy completion and evidence-review commands, duplicate acceptance with conflicting command payloads, or all reassignment, wrong-package and deleted-object cases. Those are local qualification gaps, not passing tests. No critical bypass was observed in the executed cases. A release decision must remain PARTIAL unless these specific cases are closed with unchanged-state and audit assertions.
