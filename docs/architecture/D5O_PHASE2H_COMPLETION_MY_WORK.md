# Phase 2H completion My Work

`GET /api/d5o-hosted/customer-work` resolves the actor's active membership and tenant before reading the hosted Work state. Its task list combines existing role actions with decision-specific tasks derived from the same Work record. The task is a projection; only the hosted business command changes Work.

The Define draft task appears after an accepted Discover handoff for an administrator, project manager or operations leader. It links to the exact Work record. Saving the bounded draft uses the actor's authenticated session and an expected revision. Submission uses the existing Define command. Independent commercial and delivery review tasks remain assigned to eligible actors who did not submit or make the conflicting review decision. Accepted handoff removes the old task.

An awaiting Design release receipt appears only to an eligible administrator, operations leader or project manager other than the release issuer. The task carries the release and package identity, then calls `d5o_hosted_design_release_command_v1` for an independent receipt decision. The database still checks the actor, revision and release state. Accepted releases disappear from the actionable queue.

Existing role-action rows marked `view_only` are still context links. They are not claimed as executable tasks. Workforce, field and support responsibilities still need browser controls before the full My Work acceptance criterion can pass.
