# RC17 release decision

**PARTIAL split qualification; production migration and deployment remain NO-GO.** The two-environment strategy protects historical records while allowing fictional functional acceptance. It is not a complete historical application qualification. The unchanged production-hosted candidate also blocks the documented new-customer provisioning API and customer workspace page. No guard or application source was changed.

| Gate | Result |
| --- | --- |
| Provisioning restriction diagnosis | PASS: source and prior genuine-session HTTP evidence identify proxy 503 and pilot `invalid_target` boundaries. |
| Historical upgrade and original-row preservation | PASS within reused RC16 local scope: 177 to 202 actual ledger entries and no original-row change at the tested boundary. RC14 Auth artifact cause remains unknown. |
| Fully synthetic two-tenant onboarding | PASS, **23/23** local test/pilot checks on selected tree; clean ledger was not separately captured. |
| Full exact-candidate Develop-to-Finance and My Work | **NOT QUALIFIED**; ancestor browser results are scoped evidence. |
| Active hosted schema/security equivalence | PARTIAL: 112 names present; final definitions, grants, RLS, dynamic dependencies and command behavior not fully compared. |
| Private evidence and recovery | PARTIAL: earlier server-mediated route and 23-byte checks; no RC17 Storage run or atomic production checkpoint. |
| Actual hosted binding and operational readiness | BLOCKED: effective deployment environment, spending authority and invitation delivery remain unproved. |

**Qualification-boundary decision:** Option B is defensible for a *restricted existing-pilot* release only if the owner accepts split evidence and the remaining active-contract, security, private-evidence and recovery gaps are closed. It cannot establish new-customer onboarding in the current hosted runtime. If new customers are in scope, Option A is necessary: the owner must authorize a narrowly scoped hosted routing correction and its security review before source changes. The correction must retain the shared-Auth legacy denylist, vendor-only provisioning, membership checks and customer route isolation. No product correction is included in RC17. The delivery-change versus post-handover connected-service contract remains **DECISION REQUIRED**.

**Stop conditions:** any original-row mutation, privilege/RLS weakening, missing active RPC or dependency, different protected business outcome across environments, private-object hash/association mismatch, unexpected ledger or source hash, unverified hosted project/secret binding, absent coordinated write-quiescent checkpoint or failed restore, and absent explicit production cutover approval. The encrypted checkpoint remains under approved controls outside Git. RC17 authorizes no production write freeze, migration, deployment, purchase or spending.
