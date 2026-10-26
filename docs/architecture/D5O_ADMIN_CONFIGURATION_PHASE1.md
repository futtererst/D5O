# D5O administration and configuration: Phase 1

## Phase 1B follow-up (local branch)

The connected service bypass described below was corrected in the local Phase 1B branch. Same-signature database wrappers now require the hosted policy decision before connected customer authorization and job creation, including the older service-role related-work job path. The approved request is bound to request cycle, scope, estimate revision, amount, currency and the parent Work's version pin. The original Work-level approval command and ledger remain in use. See [Phase 1B enforcement](D5O_PHASE1B_APPROVAL_ENFORCEMENT.md) and [connected results](D5O_PHASE1B_TWO_TENANT_RESULTS.md). This follow-up does not retroactively change the Phase 1 result or qualify the full pilot journey; Phase 1B remains PARTIAL while the historical M1 regressions and browser journey are blocked.

## Implementation boundary

The hosted `d5o_hosted.configuration_versions` lineage is the source for new service-work policy. The existing customer configuration console edits a draft through `d5o_hosted_configuration_admin_command_v1`; publication validates and freezes the candidate, and activation changes the default for future Work. Work records retain their exact version pin. The older `config_*` tables and browser prototype remain historical compatibility paths. No rows were migrated or deleted in this package.

The configuration editor now supports a typed USD service-work threshold, `greater_than` comparison, an `admin` or `operations_leader` authority, and fail-closed behavior if that authority is unavailable. The existing work type and handoff editors, draft revision checks, reasons, receipts and audit remain in place. The new policy cannot alter the six phases, membership authority, RLS or vendor safety boundaries.

`d5o_hosted_service_approval_command_v1` evaluates a hosted service Work Record against its pinned version, writes one request with the threshold snapshot, and records an immutable decision event and idempotent receipt. A required approval starts pending; an independent member with the configured role may approve or reject it. A request in another currency fails. The command is exposed through `/api/d5o-hosted/service-approval` with the same authenticated hosted context and isolated pilot gate as other hosted commands.

## Deliberate limits

This command is a bounded service approval decision. The existing connected service workflow has not yet been changed to require a successful decision before every downstream transition. Thus the current package cannot claim end-to-end approval bypass prevention. Published legacy versions without `serviceWorkApproval` fail closed when this command is called; prior work without a policy is not silently repinned. The production Rybex/Rotork allowlists stay intact. `enterprise_test` reaches only the customer configuration and approval endpoints in the disposable local pilot runtime.

Platform administration now has a separate read-only `/platform-admin` tenant directory and tenant detail. A private `platform_administrators` identity table gates its directory RPC. The directory exposes workspace status and the published hosted version and service threshold; it cannot edit customer data, provision tenants or impersonate users. Vendor identities must be provisioned through a separately controlled process. Billing, support and monitoring remain unavailable because their authoritative services do not exist in this baseline.

## UI direction

The existing administration shell supplies persistent workspace context, section navigation and responsive layout. The configuration page now shows the active service threshold, a draft editor, before/after comparison and version events with actor, timestamp and reason. [Microsoft Entra's admin center](https://learn.microsoft.com/en-gb/entra/fundamentals/entra-admin-center) informed the persistent left navigation and tenant overview; [Atlassian Administration's audit guidance](https://support.atlassian.com/security-and-access-policies/docs/accessing-audit-log-activities/) informed keeping configuration actions and audit history visible in the same administrative journey. No external assets were copied.

The six-phase operating order remains Discover → Define → Design → Develop → Deploy → Operate. The underlying legacy phase contract still contains a different presentation array order; this package does not migrate historical contracts or phase state.
