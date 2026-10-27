# RC5 forward upgrade plan

**Status: conditional, not executable against production.** The exact forward sequence is not yet established. The [ordered proposal](evidence/D5O_RC5_ORDERED_MIGRATION_PROPOSAL.json) lists all 236 frozen files and the current treatment of each. Order 1 is already a stop: source `0001` has no hosted ledger counterpart, while hosted legacy `001` exists. Applying the 236 files or inserting synthetic ledger rows would erase the distinction between these histories.

The single proposed path is:

1. On an authorized protected copy, preserve the actual 177-row ledger including `statements[]`; classify legacy `001`–`010`, the 58 SQL differences, and the 69 source files lacking hosted counterparts against their object effects, Auth/Storage dependencies and historical data. Resolve the 19 remaps with stored SQL and object definitions, not names.
2. For each truly missing prerequisite among source orders 1–44, write a **new forward correction**, never edit an applied historical file or forge a ledger entry. Review creation collisions, column defaults, constraints, data transformations, triggers, RLS, owners, grants and SECURITY DEFINER search paths before execution. No correction SQL is justified yet because the exact missing effects are not proven.
3. Establish and rehearse the exact reviewed bridge on the protected copy. Require tenant provisioning, organization/membership, published configuration and Work pin invariants before later phase, My Work, Design, Develop, Deploy, commercial Scope, Operate, child Work, finance, audit and receipt transitions. Stop if any earlier function signature, trigger or grant would be overwritten incompatibly.
4. Only after that bridge passes, evaluate source orders **212–236 in filename order** as forward candidates. Verify boundaries after organization/onboarding (214–218), lifecycle/configuration (219–223), phase projection (225), child-service identity (226–228), Develop/workforce (229–233), service boundary (234), one-time Operate acceptance (235), and permit order (236). Order 236 must see the expected field-fact RPC signature and preserve owner, authenticated execute grant, empty search path, receipts and RLS.
5. Before order 236, run bounded protected-copy preconditions for every Deploy state's permit array: JSON array shape; per-package append order; Held/Authorized transitions; duplicate IDs; release and publication associations; timestamp ties; null/malformed `at`; and any record where the last append differs from timestamp selection. Review each exceptional Work under access controls. After applying, prove latest append selection, no resurrection of Held authority, existing report/inspection/receipt references, replay behavior, cross-tenant denial and independent reviewer rules.
6. Apply during a bounded application write freeze with an exclusive migration executor, consistent database/Auth/Storage checkpoint and rollback decision time. Verify schema, ledger, functions, RLS/grants, pins, events, approvals, receipts, audit and private-object associations before reopening writes.

The **conditional later-source sequence**, to run only after the historical bridge is proved, is:

212. `20261023111641_d5o_service_approval_policy_phase1.sql`
213. `20261023115306_d5o_phase1b_connected_service_approval.sql`
214. `20261023123751_d5o_phase2a_organization_people.sql`
215. `20261023140000_d5o_phase2b_tenant_onboarding.sql`
216. `20261023141000_d5o_phase2b_onboarding_commands.sql`
217. `20261023142000_d5o_phase2b_vendor_controls.sql`
218. `20261023143000_d5o_phase2b_template_governance.sql`
219. `20261023150000_d5o_phase2c_lifecycle_features.sql`
220. `20261023151000_d5o_phase2c_discover_policy.sql`
221. `20261023152000_d5o_phase2c_connected_work_gate.sql`
222. `20261023153646_d5o_phase2d_phase_policies.sql`
223. `20261023153752_d5o_phase2d_define_develop_guards.sql`
224. `20261023180000_d5o_phase2f_operate_review_guard.sql`
225. `20261023201553_phase2g_phase_status.sql`
226. `20261024010000_d5o_service_sla_calendar_validation.sql`
227. `20261024011000_d5o_service_job_stable_work_type_key.sql`
228. `20261024012000_d5o_service_child_identity_guard.sql`
229. `20261024105438_phase2hs_connected_design_capability_gate.sql`
230. `20261024112500_phase2hs_overnight_crew_eligibility.sql`
231. `20261024113000_phase2hs_connected_develop_capability_gate.sql`
232. `20261024150000_phase2ht_workforce_qualification_expiry.sql`
233. `20261024151000_phase2ht_current_worker_assignment.sql`
234. `20261025010000_d5o_phase2htd_connected_service_capability_boundary.sql`
235. `20261027085730_d5o_operate_acceptance_one_time_guard.sql`
236. `20261027190000_d5o_field_fact_latest_permit_order.sql`

**Stop immediately** for unknown project identity; ledger drift; unexplained source SQL difference; duplicate migration version; unknown owner/grant/RLS change; object collision; unvalidated historical data transformation; missing Auth or Storage dependency; failed pin/event/receipt/audit comparison; permit ambiguity; unverified private bytes; failed synthetic interruption/retry; or missing coordinated recovery checkpoint. The RC5 evidence does not clear any of these stops for production.
