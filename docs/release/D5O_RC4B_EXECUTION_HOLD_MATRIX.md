# RC4-B execution hold matrix

**Result: PARTIAL.** The local two-tenant run proved a causal field-start hold and its controlled release. It did not establish otherwise eligible completion, turnover, or customer acceptance while the commercial change was open. [Machine result](evidence/D5O_RC4B_EXECUTION_HOLDS.json) records command IDs, responses, revisions, event and receipt counts, evidence counts, configuration pins, and projection snapshots.

Application: `96f1b7bccec690c1dec26cf66a55e9526f1619f9`. Both tenants had accepted Design, approved economic and labor authority, qualified published and acknowledged crew, a current schedule, and a browser-issued `Authorized` field permit **before** the Scope change. Operations then held each permit through the Deploy browser. The unchanged-state checks below used the same Work and package.

| Scope state | Tenant A field-start command | Tenant B field-start command | Result |
| --- | --- | --- | --- |
| Proposed, after independent issue assessment | `resume` | `resume` | Both `23514 open_field_change_blocks_start` |
| Independent internal review complete | `resume` | `resume` | Both `23514 open_field_change_blocks_start` |
| Customer authorization recorded | `resume` | `resume` | Both `23514 open_field_change_blocks_start` |
| Revised Design independently accepted; Scope unresolved | `authorize-start` | `authorize-start` | Both `23514 open_field_change_blocks_start` |

All eight rejected commands left the Deploy state and revision, Deploy event and command-receipt counts, configuration pin, and phase projection unchanged. The phase replay matched at every checkpoint. The rejected attempts were direct authenticated RPC security probes; the Scope proposal, reviews, evidence upload, Design revision and receipt, resolution, and successful reauthorization were browser actions.

The guard in `20261009220510_d5o_connected_field_changes.sql` also covers completion and acceptance writes. Those branches were **not** counted as passed: this run did not first create otherwise eligible report, inspection, evidence-review, turnover, and customer-acceptance inputs before attempting each protected command. A missing ordinary prerequisite would not prove a Scope hold. A separate disposable continuation must establish those inputs and capture the authoritative `open_field_change_blocks_completion` response and unchanged state at each applicable boundary.

The original RC4-A preflight and this run are separate. The final RC4-B run passed 40/40 gates, zero failed gates, and verified disposable cleanup. Two earlier RC4-B retries stopped on browser recorder issues: an incorrect response-listener route, then a disabled resume control after a held permit. Neither was counted as an authorization denial.
