# Phase 2D administration UI acceptance

The customer Configuration Center keeps the existing tenant context, draft publication flow, active version, version history, audit activity, service approval editor, work types and receiving roles. Phase 2D adds phase navigation and plain-language controls for Define risk, Develop selected-solution evidence, Design method of procedure, Deploy reviewed completion evidence, and Operate documentation review. Each draft control shows current and active values, explains the business command affected, and offers Save and Cancel. The existing reason, expected revision, validation, review and activation actions remain authoritative.

The chosen Design, Deploy and Operate control is scoped to the selected Work Type. Define and Develop are tenant-version-wide in this slice. Historical Work remains pinned, and phase navigation is available at desktop and mobile widths. The selected policies do not expose unrestricted JSON editing or hidden browser-only approval.

Acceptance evidence must include an authenticated customer session on `/work/admin/configuration?workspace=tenant_a_test`, a visible draft, a policy save, validation, activation, version history, and screenshots of desktop and mobile. Screenshot files from the disposable browser session are retained under `docs/architecture/evidence/phase2d-admin-ui/`. The local preview port is ephemeral and is not a deployed URL.

The UI provides policy administration, not the complete six-phase business experience. End-user forms for satisfying the new risk and solution evidence requirements remain part of the existing connected pilot path and require full journey qualification before commercial release.
