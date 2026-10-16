# Hosted handoff administration — isolated qualification

Application source: `63644174477c734144d2adbd5e4278feae2e4373`. Target: disposable local Supabase `http://127.0.0.1:58221`; preview `http://127.0.0.1:61656/work?workspace=rybex&view=configuration`. Fictional pilot accounts only. This supersedes the immediate published-route editor described in `d5o-configured-handoff-routing-20261016.md`; its earlier events remain history.

The hosted canonical Work configuration is separate from the older M1 publication lineage. The earlier admin screen edited a route child of an already published hosted version. Forward migration `20261016130000_versioned_hosted_handoff_routes.sql` freezes published route children, revokes the immediate editor and supplies authenticated admin-only create-draft, save-route, validate/publish-candidate and activate commands. A draft copies the complete hosted Work Type/create-rights/manifest basis and the active routes. Activation supersedes the old default; existing Work, child visits and submitted handoffs retain their pinned version and destination. The administrator view shows each effective route, active member count and the currently active Work Types. It does not grant a decision right.

## Observed browser journey

An authenticated fictional administrator began on Workspace configuration. Active v1 showed all three receiving roles and their eligible-member counts. Through the interface the administrator created v2 as a draft, changed Design→Deploy from `operations_leader` to `admin`, saved the draft, validated/published it, and activated it. Before activation, v1 remained the active default. After reload, the screen showed Active v2 and its new Design receiving role. Discover→Define and Deploy→Operate retained their Operations roles. The prior fictional Discover→Define handoff remained `accepted` with `receiverRole=operations_leader`, pinned to superseded v1. The helper resolves v1 Design to `operations_leader` and v2 Design to `admin`; no old decision was rewritten.

## Focused API/database checks

- A PM GET and POST to the admin route each returned HTTP 403 `admin_membership_required`; an administrator's cross-workspace GET returned HTTP 403 `workspace_forbidden`.
- Identical replay of the original create-draft command returned its original draft receipt (HTTP 200). Conflicting replay returned HTTP 409 `command_reuse_conflict`. A fresh command against superseded v1 returned HTTP 409 `stale_handoff_configuration`.
- A rollback-only direct update of the published v2 route raised `published_configuration_immutable`; the retained role stayed `admin`. The retired immediate RPC returned `permission denied` under `authenticated`. Rejected probes added no configuration events, receipts or drafts; the completed lifecycle has four events and four receipts.
- The forward migration was applied to the verified disposable database only. This is incremental migration compatibility on that target, not a fresh full-sequence replay.

The final source passed TypeScript, scoped ESLint and production-mode build. Browser actions and database probes are technical qualification, not observed Rybex-user usability. Pricing administration and other phase policies remain separate controls; this slice does not claim all platform configuration has been unified or production release readiness.
