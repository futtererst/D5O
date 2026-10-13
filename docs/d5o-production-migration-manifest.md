# D5O production migration manifest (12 October 2026)

Target: shared Supabase project `fcawktdjoxvahhgvkebx`. This is a read-only reconciliation and proposed order; no shared migration has been applied by this release-candidate work.

The 12 already-recorded D5O/worker migrations have SQL definitions identical to the candidate files after newline normalization. Eight early releases carry Supabase-assigned versions instead of the local filename versions:

| Recorded version | Recorded name | Candidate version |
|---|---|---|
| 20261007013631 | d5o_hosted_workspace_authority | 20261007013134 |
| 20261007014024 | d5o_hosted_workspace_invoker_hardening | 20261007013707 |
| 20261007015048 | d5o_hosted_work_identity | 20261007020600 |
| 20261007015356 | d5o_hosted_create_work_authority | 20261007022200 |
| 20261007020854 | d5o_hosted_configuration_manifest | 20261007031000 |
| 20261007021942 | d5o_hosted_synthetic_prototype_state | 20261007040000 |
| 20261007025942 | d5o_hosted_prototype_nested_scope | 20261007050000 |
| 20261007225404 | d5o_hosted_worker_boundary | 20261007225404 |
| 20261008182443 | d5o_hosted_command_writer | 20261008182443 |
| 20261008185604 | d5o_hosted_worker_provisioning | 20261008185604 |
| 20261008190351 | d5o_secret_key_role_compatibility | 20261008190351 |
| 20261008200840 | restrict_worker_work_access | 20261008200840 |

The worker-excluding policies `d5o_hosted_work_member_read` and `d5o_hosted_work_event_member_read` also match the live read-only inspection. Do not rewrite the eight applied history versions. A raw version-only `supabase db push` is unsafe until the release operator explicitly reconciles those mappings; it would treat their local versions as unapplied.

## Outstanding files, in required order (66)

1. `20261008183310_d5o_prototype_authoritative_writes.sql`
2. `20261008203000_d5o_reject_imported_commercial_decisions.sql`
3. `20261008214425_hosted_pilot_role_assignments.sql`
4. `20261008221100_d5o_guard_pilot_position.sql`
5. `20261008230000_d5o_connected_work_identity.sql`
6. `20261008231000_d5o_connected_define_commands.sql`
7. `20261008232000_d5o_connected_discover_commands.sql`
8. `20261008233000_d5o_connected_draft_projection.sql`
9. `20261008234000_d5o_connected_solution_decision_lock.sql`
10. `20261008235000_d5o_connected_solution_commands.sql`
11. `20261008235500_d5o_connected_pricing_policy_commands.sql`
12. `20261008240000_d5o_connected_estimate_commands.sql`
13. `20261008241000_d5o_connected_offer_review.sql`
14. `20261008242000_d5o_connected_customer_decisions.sql`
15. `20261008243000_d5o_connected_design_handoff.sql`
16. `20261008244000_d5o_connected_package_creation.sql`
17. `20261008244500_d5o_connected_package_projection.sql`
18. `20261008245000_d5o_connected_design_drafts.sql`
19. `20261008245100_d5o_connected_design_reviews.sql`
20. `20261008245150_d5o_connected_design_demand.sql`
21. `20261008245200_d5o_connected_design_release.sql`
22. `20261008245300_d5o_connected_crew_publication.sql`
23. `20261008245400_d5o_connected_field_start.sql`
24. `20261008245450_d5o_connected_deploy_draft_rebase.sql`
25. `20261008245500_d5o_connected_field_facts.sql`
26. `20261008245600_d5o_connected_field_evidence.sql`
27. `20261008245650_d5o_connected_worker_projection.sql`
28. `20261008245700_d5o_connected_acceptance.sql`
29. `20261008245800_d5o_connected_operate_state.sql`
30. `20261008245850_d5o_connected_operate_commands.sql`
31. `20261008245900_d5o_connected_operate_draft_rebase.sql`
32. `20261008250000_d5o_connected_service_job_command.sql`
33. `20261008250100_d5o_connected_asset_acceptance.sql`
34. `20261008250200_d5o_connected_service_projection.sql`
35. `20261008250300_d5o_connected_service_draft_rebase.sql`
36. `20261009094046_d5o_connected_service_basis.sql`
37. `20261009094248_d5o_connected_service_basis_projection.sql`
38. `20261009095342_d5o_connected_service_package.sql`
39. `20261009095658_d5o_connected_design_source_adapter.sql`
40. `20261009101200_d5o_connected_service_field_source.sql`
41. `20261009102800_d5o_connected_worker_schedule_read.sql`
42. `20261009104500_d5o_connected_service_return.sql`
43. `20261009110500_d5o_connected_service_pricing.sql`
44. `20261009112000_d5o_connected_partial_service_source.sql`
45. `20261009123000_d5o_customer_decision_evidence.sql`
46. `20261009124000_d5o_empty_package_draft_compatibility.sql`
47. `20261009125000_d5o_pursuit_correction_after_source_change.sql`
48. `20261009181045_d5o_post_acceptance_scope_integrity.sql`
49. `20261009214103_d5o_connected_workforce.sql`
50. `20261009220510_d5o_connected_field_changes.sql`
51. `20261009221159_d5o_connected_job_finance.sql`
52. `20261009232739_d5o_connected_design_field_change.sql`
53. `20261009234405_d5o_current_release_field_start.sql`
54. `20261010011108_d5o_connected_billing_integrity.sql`
55. `20261010100022_d5o_post_closeout_receivable.sql`
56. `20261010130807_connected_service_financial_disposition.sql`
57. `20261010150000_connected_service_billing_terms.sql`
58. `20261010170000_connected_service_action_queue.sql`
59. `20261010180000_connected_service_invoice.sql`
60. `20261010190000_connected_service_actual_cost.sql`
61. `20261010200000_d5o_completion_reassessment.sql`
62. `20261010210000_d5o_support_document_obligations.sql`
63. `20261011162940_optimize_connected_draft_projection.sql`
64. `20261012110000_d5o_design_draft_required_arrays.sql`
65. `20261012120000_d5o_draft_booking_before_release.sql`
66. `20261012123000_d5o_design_handoff_clarification.sql`

At the earlier invoice checkpoint, a fresh disposable Supabase instance replayed **71 hosted candidate files in filename order**, including the service-invoice migration. Relative to the prior 12-file shared read-only mapping, **59 files are outstanding**. The active fictional service pilot was incrementally patched; it is not evidence of full ordered replay. Shared-project definitions and migration history must be rechecked at cutover. Disposable replay does not establish shared-project compatibility or authorization to apply migrations. The deployment cutover must compare names, normalized SQL, policy definitions and migration history again immediately before any shared write.

The 10 October partially covered service pilot added no migration file. Its older disposable target at `127.0.0.1:56321` needed the already-listed candidate definitions `20261009232739`, `20261009234405`, and `20261009104500` applied locally before the browser journey. This does not establish application of any file to shared persistence. See [isolated service-return evidence](./evidence/d5o-partial-service-return-20261010.md).

The later service-financial-disposition command adds three private Finance tables and authenticated typed read/decision RPCs. It was applied to the same fictional local pilot for the Finance demonstration and replayed with the full ordered candidate sequence on a separate clean disposable target. See [service-finance qualification](./evidence/d5o-service-finance-20261010.md).

The subsequent `20261010150000_connected_service_billing_terms.sql` adds a separate, versioned customer-terms decision and private-document source binding. It replaces the condition-text inference in the existing Finance RPC and retains the prior Hold as history. The 69-file ordered sequence replayed once after this final migration change on the disposable `d5o-preclosure-20261010` target. See [explicit billing-terms evidence](./evidence/d5o-service-billing-terms-20261010.md).

The `20261010170000_connected_service_action_queue.sql` migration projects current service pricing, customer authorization, billing-terms and Finance decisions from committed Operate and Finance sources for authenticated members. Closed operational requests retain separate financial follow-up. A fresh disposable local Supabase project replayed all 70 candidate files in order; the new RPC is executable by `authenticated` and denied to `anon`. The source fixture was separately patched for the browser journey. See [service-action queue qualification](./evidence/d5o-service-action-queue-20261010.md).

The `20261010180000_connected_service_invoice.sql` migration adds a private, request-cycle-scoped USD fixed-fee invoice and receivable ledger, typed authenticated draft/review/issue/payment commands, replay receipts and role-queue positions. It does not alter the parent customer-job Finance ledger. The final 71-file sequence replayed from an empty disposable local database; the active fictional fixture was patched separately. See [service invoice evidence](./evidence/d5o-service-invoice-20261010.md).

The `20261010190000_connected_service_actual_cost.sql` migration adds a private append-only cost ledger for the exact completed service cycle, linked reversal/replacement corrections, authenticated Finance commands, replay receipts, an honest economics read model and a separate cost action queue that retains invoice collection. The final **72-file** candidate sequence replayed in filename order in a fresh disposable local database; **12 mapped files remain already recorded on shared and 60 candidate files remain outstanding**. The active fictional fixture and a separate disposable database-only probe were patched locally. No shared migration was applied. See [sourced service-cost evidence](./evidence/d5o-service-cost-20261010.md).

The `20261010200000_d5o_completion_reassessment.sql` migration retains a prior reviewed completion, permits a new independent review of changed report/inspection facts only before turnover, binds new turnovers to the exact completion ID, and freezes completion after turnover or whole-work acceptance. The current **73-file** candidate sequence replayed in filename order on disposable local `d5o-delivery-replay-20261010`; 73 migration versions were recorded. Relative to the 12 read-only mapped shared entries, **61 files are outstanding**. No shared migration was applied. See [delivery role-queue qualification](./evidence/d5o-delivery-role-queue-20261010.md).

The current support-document follow-through adds one forward migration. It separates support-acceptance authority rejection from profile validation and binds retained private PDFs to exact accepted turnover obligations with independent review, current-source checks, audit events and replay receipts. The current candidate is **74 migration files**: 12 previously mapped shared files and **62 outstanding**. A fresh disposable local replay applied all 74 in filename order and confirmed the authenticated support-document command grant; the active fictional browser target was incrementally patched. This does not authorize shared-project migration or cutover. See [support follow-through evidence](./evidence/d5o-delivery-role-queue-20261010.md).

The 11 October Discover draft-save correction adds `20261011162940_optimize_connected_draft_projection.sql`. It caches each unchanged authoritative phase projection once per draft-save call while retaining each submitted record's protected-field comparison. The current candidate is **75 ordered files**, including the 12 shared-history mappings above and **63 outstanding** files. The 75-file sequence was replayed from a reset local disposable database in both observation targets before their verified fixture/data and private-byte restoration; both recorded version `20261011162940`. This is not an application or migration cutover to shared Supabase. See [focused task and draft-save qualification](./evidence/d5o-role-task-presentation-20261011.md).

At the prior 12 October checkpoint, the package-draft and Design handoff corrections brought the candidate to **77 ordered hosted files**, including 12 previously mapped shared-history entries and **65 outstanding**. A separate disposable return fixture and a second fresh local project replayed the 77-file candidate sequence in order; the mutable service and changed-job clones were restored independently. The clarification command retains returned revision history and requires a PM correction before independent Operations acceptance. These local replays do not establish shared-project compatibility or authorize migration there. See [current walkthrough status](./evidence/d5o-synthetic-walkthrough-20261011/current-status-20261012.json).

The draft-booking correction adds file 65 above, yielding **78 ordered hosted files**: 12 read-only mapped shared-history entries and **66 outstanding**. It permits qualified, current-demand draft bookings before Design release while keeping week publication release-gated. The changed function applied successfully on the disposable 61648 pilot and its authenticated browser checks passed. **A fresh 78-file ordered replay has not been completed** because the local Docker address pool is exhausted and preserved checkpoint/recovery networks remain in use. The prior 77-file fresh replay does not qualify this new file. Do not apply it to shared persistence without a complete disposable replay and coordinated cutover authorization. See [current walkthrough](./evidence/d5o-synthetic-walkthrough-20261011/walkthrough.md).
