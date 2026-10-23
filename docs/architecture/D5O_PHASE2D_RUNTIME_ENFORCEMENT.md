# Phase 2D runtime enforcement

| Policy | Authoritative entry point | Protected action | Record checked |
| --- | --- | --- | --- |
| Define risk narrative | `d5o_hosted_define_command_v1` | Submit and approve review | The current connected Work definition, including its controlled draft projection |
| Develop option evidence | `d5o_hosted_solution_command_v1` | Submit and approve solution | The selected viable option in the connected Work Develop plan |
| Design method of procedure | `d5o_hosted_design_release_command_v1` | Release package | The exact current Design package's method field |
| Deploy reviewed evidence | `d5o_hosted_field_fact_command_v1` | Review completion | Reviewed evidence bound to the package and accepted release |
| Operate documentation review | `d5o_hosted_operate_command_v1` | Accept support | Recorded review in the support acceptance input |

The corresponding existing API dispatchers are `/api/d5o-hosted/prototype-define-command`, `prototype-commercial-command`, `prototype-design-command`, `prototype-deploy-command` (and `worker-deploy`), and `prototype-operate-command`. These remain pilot-scoped. No alternate browser-side rule or new general-customer route was added.

The Define and Develop additions wrap existing authenticated security-definer RPCs. The earlier functions are renamed and their direct execution revoked. The wrappers lock the Work record, verify current membership, resolve the pinned published or superseded tenant version and source digest, enforce the additional requirement, and delegate to the preserved business command in the same database transaction. The preserved command still checks role, revision, source state, idempotency receipt, phase prerequisites, and writes the decision event. Existing receipt replay delegates to that command so a successful command remains idempotent even if later draft source fields change.

The Design, Deploy, and Operate controls already had bounded database consumers. Phase 2D exposes their exact supported values through the hosted draft command and the phase-specific administration interface. Changing the active tenant configuration never repins old Work or mutates historical events. Direct browser or RPC calls meet the same server checks; browser visibility is informational.

The remaining six-phase routing for commercially provisioned customers is not qualified by these command guards. The connected pilot's other source, review, and acceptance prerequisites remain necessary. Full end-to-end progression and the complete historical pilot journey require their own test fixture and staging qualification.
