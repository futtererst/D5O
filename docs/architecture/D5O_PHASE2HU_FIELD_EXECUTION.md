# Phase 2H-U field execution

The assigned field worker opens `/work/customer/[workspace]/assignments`, acknowledges the current published booking, and follows **Open field execution** to `/work/customer/[workspace]/field`. The server rechecks the authenticated field-worker membership, worker binding, current publication and exact booking before rendering an assignment-scoped Work projection. The page shows the accepted release snapshot, field-start permit, scope, location, method, safety/access controls, verification requirements and assigned shift.

The existing `CrewFieldWork` control submits factual report drafts, report submission and inspections through `/api/d5o-hosted/worker-deploy?workspace=…`. Canonical Work calls `d5o_hosted_field_fact_command_v1`; the adapter rejects tenant-neutral Work without a canonical identity and never falls back to the prototype writer. The hosted command owns the tenant, actor, assignment, current start authorization, configuration pin, revision, idempotency receipt and audit checks. Field workers cannot make independent report, inspection, completion or customer acceptance decisions.

The Rybex pilot retains its original route and default adapter target. Provisioned tenants use the validated workspace parameter and `connectedWork` capability check. The Rotork pilot remains on its established route. Manager reviews and acceptance use the existing `/api/d5o-hosted/prototype-deploy-command` adapter with `customerWorkScope` for provisioned tenants; canonical Work requires an authoritative hosted RPC. The customer Work detail and server-derived My Work queue link to that adapter. A completed decision removes its exact responsibility on refresh.

Private Storage keys preserve the historical prototype layout (`workId/evidenceId`) for noncanonical pilot Work. Canonical connected Work uses the hosted tenant and hashed Work path required by `d5o_hosted_field_evidence_command_v1`. Reads choose the layout from the Work record rather than silently moving older objects. The final TypeScript, lint and production build passed after this compatibility correction; the original sealed pilot fixture remains a separate regression dependency.

The connected-service child job and parent Work package remain separate business objects. The field page executes the accepted parent package with its booking and field-start permit; it does not infer execution authority from a child service job.

Validation and browser evidence are recorded in `D5O_PHASE2HU_TWO_TENANT_BROWSER_RESULTS.md` and `D5O_PHASE2HU_SECURITY_AND_REGRESSION.md`.
