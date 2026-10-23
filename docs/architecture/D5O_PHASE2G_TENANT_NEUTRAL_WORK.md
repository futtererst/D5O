# Phase 2G tenant-neutral Work boundary

Baseline: Phase 2F `dae8e1fa975bc47ef6d1180b512399683e3c9613`.

`/work` continues to dispatch Rybex and Rotork to the existing pilot platform. The new route explicitly rejects those two pilot keys. Other hosted memberships link to `/work/customer/[workspace]`. The customer page and `/api/d5o-hosted/customer-work` resolve the signed-in user through `hostedPrototypeContext`, verify active workspace membership and the `connectedWork` entitlement and flag, and read the hosted Work projection. Field workers remain on their assignment-scoped schedule. The server passes the authenticated user's token to existing business RPCs; it does not use a service role for customer decisions.

The new route has a six-phase read view and a bounded Operate handoff/activation control. Connected Work creation links back to this route. The POST adapter accepts only those two actions for the existing Operate RPC, verifies the Work belongs to the selected workspace and the actor is an Operations leader, supplies workspace, Work and command IDs server-side, and relies on the RPC for revision, policy, and evidence checks. Cross-tenant API reads and writes returned HTTP 403 in the disposable browser test.

**Boundary:** This is a partial Work interface. Define, Design, Develop, Deploy and most Operate decision forms are still in the pilot UI or command harness, so two complete UI-driven journeys have not been shown. The new route must not replace the pilot UI until those controls are connected and browser-qualified. No pilot allowlist was removed.

No live preview is retained: the qualification server used a loopback port and stopped during fixture cleanup.
