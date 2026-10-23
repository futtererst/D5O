# Phase 2H My Work integration

`GET /api/d5o-hosted/customer-work` now returns a role-specific task projection beside connected Work summaries. Each item shows the Work title, customer, phase and due date when the hosted role queue provides one. Define review and handoff tasks derive from the authoritative `definition` decision projection. Existing `d5o_hosted_role_actions_v1` contributes other tenant-scoped review responsibilities. No task table or independent completion flag was introduced.

Define tasks disappear when the authoritative decision changes. A submitter does not see independent review tasks; an actor who completed one review does not see the other; the handoff sender does not see the receipt task; an accepted handoff disappears. The Work detail response supplies the same actor-specific Define actions to control visible buttons. The two-tenant browser test signs each actor into the workspace, opens the assigned My Work link, executes the decision, then checks task removal. The RPC remains the final authority after any race, revocation or stale browser state.

Role-action RPC items currently open the Work record for context and are labelled **View context**. Their action forms are not yet wired on the tenant-neutral route and must not be represented as executable tasks. This is an explicit product gap, including assignment-aware field-worker My Work.
