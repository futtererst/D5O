# RC4-B.1 Scope integrity and concurrency

The final [machine run](evidence/D5O_RC4B1_INTEGRITY.json) passed 47/47 in an isolated disposable Supabase fixture, with two fictional tenants, independent actors, pinned configurations, actual browser decisions and clean teardown. Application correction: `9c0be3569fb88bf21ba8ced24a58a8804cbeda47`.

| Case | Actual outcome | Protected-state check |
| --- | --- | --- |
| Foreign tenant Scope review | `42501 field_change_scope_denied` for both tenants | No change to revision, events, receipts or pin |
| Submitted actor self-review / wrong role | `42501 independent_change_review_required` | Unchanged |
| Wrong Design package | `23514 accepted_release_required` | Unchanged |
| Stale Scope revision | `23505 stale_field_change` | Unchanged |
| Forged customer document | `23514 exact_customer_evidence_required` | Unchanged |
| Missing customer document | `42501 customer_change_source_required` | Unchanged |
| Tenant B using Tenant A's Work document | `23514 exact_customer_evidence_required` | Unchanged |
| Deleted registered private object | `23514 customer_evidence_bytes_changed` for both tenants | Unchanged; synthetic negative object was removed |
| Resolution without revised accepted Design | `23514 revised_design_receipt_required` | Unchanged |
| Completed Scope proposal or Design task URL replay | `23505 stale_field_change` or visible stale-task alert | No obsolete browser decision available |
| Unknown, foreign or draft configuration substitution | `22023 configuration_unavailable`; forged API override `400` | Original Work pin retained |

For a Scope change at Tenant A completion, a signed-in Finance actor's membership was suspended, then removed while its session remained open. Direct RPC returned `42501 field_change_scope_denied`; the open browser session's command returned HTTP `403 connected_work_unavailable`. Suspending the tenant also produced RPC `42501`. Tenant and membership were restored only as needed for the disposable test; the terminal removal was not used for a positive business decision. Deploy business state, audit/receipt counts and configuration pin remained unchanged.

Two distinct `submit-review` commands were sent genuinely concurrently at the same initial revision and before any receipt. One succeeded; the other returned `23505 stale_field_change`. Exact replay of the winner succeeded without another decision, while reuse of its command ID with conflicting input returned `23505 command_reuse_conflict`. Both tenants also exercised the existing exact/conflicting resolution replay path; exact HTTP replay returned `200`, conflicting reuse returned `409`, and state, events, receipts and pin were unchanged. The browser Scope review remained independent from its submitter.

The field-change command has no client configuration-version parameter. The applicable invariant is ownership of the Work's pinned published version, which was checked through invalid pin substitution and final pin comparisons. The old held permits remained historical. The final revised-release assertion found no duplicate completion or acceptance decision and `phaseReplayMatches=true` for each tenant.

One earlier continuation run failed at field-report submission (`409 current_start_and_author_required`) because timestamp-tied permits selected the old held entry; see [preserved failure](evidence/D5O_RC4B1_PERMIT_FAILURE.json). The forward correction and final run resolve that defect. A separate retry timed out in inherited Design browser navigation and initially left a disposable project; its exact project `d5o-p0a-b52f1dfa-87e`, directory and loopback network were inspected and removed. It is a **retried fixture failure**, not a business denial. The final run reports `cleanup.clean=true` with no residual containers.
