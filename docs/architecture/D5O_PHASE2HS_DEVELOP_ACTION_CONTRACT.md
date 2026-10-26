# Phase 2H-S Develop action contract

The customer Work page and My Work list retain the Phase 2H-R shared action pattern: an actionable task links to the current Work projection; a typed tenant-neutral route invokes an existing hosted command with authenticated identity, Work/package identity, command UUID, and expected revision; successful decisions refresh the same Work and task projection. No separate task-completion table or workforce identity was added.

| Responsibility | Actor | Existing authority | Customer adapter and control |
| --- | --- | --- | --- |
| Early solution selection | Project manager before Design | `d5o_hosted_solution_command_v1` | Preparation history; existing connected journey, not a second post-Design decision. |
| Review qualified workforce | Operations | `d5o_hosted_workforce_read_v1` | `customer-develop-action` GET and Develop readiness list. Profiles are existing tenant workforce records. |
| Prepare and approve economic/labor limits | Work creator project manager, then independent tenant administrator | `d5o_purchase_authority_command_v1`, `d5o_labor_authority_command_v1` | `customer-develop-authority` GET/POST and task-linked forms. Source digest and authority revisions are compared by the hosted commands. |
| Select and book resource | Operations or project manager | `d5o_hosted_crew_command_v1` `save-booking` | `customer-develop-action` POST. Accepted package, dated demand, qualification, binding, availability and capacity are checked by hosted functions. |
| Publish crew week | Operations or project manager | Same command, `publish-week` | Same adapter, with schedule revision and command UUID. |
| Acknowledge assignment | Exact bound field worker | Same command, `respond-booking` | Assignment-scoped customer employee page. The server reads only the authenticated worker's publications; the RPC verifies the binding. |
| Authorize field start | Operations leader | `d5o_hosted_field_start_command_v1` | Same Develop adapter. It binds accepted release, published/acknowledged shift, commercial authorities, configuration pin, Work, schedule and Deploy revisions. |
| Connected service approval and executable service job | Authorized service actor and independent approver | Phase 1B `d5o_hosted_connected_service_approval_command_v1` and `d5o_hosted_service_job_command_v1` | Existing connected-service path. These are distinct child service-request records and are not fabricated for the base six-phase Work fixture. Phase 1B regression remains required. |

The local capability migrations guard Design, scheduling, workforce and field-start state mutations so a direct RPC cannot bypass a disabled tenant `connected_work` rollout. Existing pilot workspaces retain their prior route restrictions. The overnight eligibility migration aligns crew publication with the existing field-start command's valid cross-midnight shift interpretation and checks next-day unavailability and weekly capacity. No hosted migration was applied.

The user-facing phase contract remains Discover → Define → Design → Develop → Deploy → Operate. Early solution approval is preparation. Develop completion comes from the persisted, replayable field-start event; it cannot be inferred from a booking or acknowledgment alone.
