# Phase 2H-T connected-service browser journey

The disposable journey starts with the Phase 2F connected Work fixture, its accepted Design package, qualified Develop assignment, completed Deploy receipt, and active Operate support. The employee interface then uses the same authenticated tenant-neutral Work page for coverage, child request, triage, estimate, pricing review, tenant approval, customer source, service authorization, and job creation. `ServicePricingPanel` and `CustomerDecisionEvidence` are reused; no alternate pricing or approval computation is introduced.

The browser captures each actual server response from the UI action. The executable is `scripts/p0a/run-phase2ht-gate-b.mjs`; machine results are `evidence/phase2ht-gate-b-results.json` and screenshots are under `evidence/phase2ht-gate-b-browser/`. The final release recommendation must use the last completed run only. A denied policy guard or a rendered form alone is not counted as a completed authorization or job.

The parent Work is the lifecycle record. The service request and job remain linked downstream records. Support activation and financial closeout retain separate states.
