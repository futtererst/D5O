# D5O administration/configuration Phase 1 test results

## Result: PARTIAL

The final focused disposable run passed **18/18** checks with no setup error and verified cleanup. See [sanitized two-tenant results](evidence/phase1-two-tenant-results.json). It applied the committed local migration set to a unique loopback Supabase project, used separate fictional Auth administrators and vendor identity, and stopped and removed the project, network and containers. No production migration, data or deployment changed.

| Proof | Observed result |
| --- | --- |
| Rybex Test published policy | USD 10,000.00; new service Work pinned its hosted version |
| Independent Enterprise Test published policy | USD 25,000.00; new service Work pinned its separate hosted version |
| Equivalent USD 15,000 service request | A server command returned `approvalRequired: true`, `status: pending` for Rybex; `approvalRequired: false`, `status: not_required` for Enterprise |
| Independent authority | Rybex operations leader approved the pending request; two versioned decision events persisted |
| Authorization | Non-admin publish, cross-tenant read and decision, wrong-role approval, unsupported currency and suspended membership all denied |
| Version lifecycle | Both administrators drafted, edited, validated and activated; old versions remained; stale command denied; A rollback and B browser-change rollback used new audited versions |
| Browser | B administrator created a draft, edited its threshold, validated and activated through the actual Configuration page; a follow-on new version restored USD 25,000 |
| Platform boundary | Vendor-only tenant directory returned A and B; tenant administrator and outsider were denied |
| Work type | B display-name change published without repinning its historical Work |

The latest run's UI captures are [Rybex desktop](evidence/phase1-admin-ui/a-1440.png), [Rybex phone](evidence/phase1-admin-ui/a-390.png), [Enterprise desktop](evidence/phase1-admin-ui/b-1440.png), [Enterprise phone](evidence/phase1-admin-ui/b-390.png), [Enterprise draft](evidence/phase1-admin-ui/tenant-b-draft-1440.png), [platform directory](evidence/phase1-admin-ui/platform-directory-1440.png) and [platform tenant detail](evidence/phase1-admin-ui/platform-tenant-detail-1440.png). These came from authenticated Next.js sessions in the disposable environment, not mockups. The development overlay is visible in some captures; no production UI session was run. The local preview URL was ephemeral and is no longer live because fixture cleanup is required.

## Other verification

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run build`: passed; the optimized build includes `/platform-admin`, `/platform-admin/tenants/[workspace]` and `/api/d5o-hosted/service-approval`.
- Reused P0-A disposable runtime suite: **16/16 passed**, no setup error, cleanup verified. See [Phase 1 P0-A results](evidence/phase1-p0a-runtime-results.json). The suite preserved production pilot route restrictions while allowing only the independent configuration page in the disposable local runtime.
- `node scripts/qa-published-phase-contract.mjs`: passed Rybex/Rotork contract, pin and isolation checks.
- `node scripts/qa-phase-configuration.mjs`: passed four work-type packs and six-phase contract checks.
- `node scripts/p0a/verify-readiness-scanner.mjs` and `node scripts/verify-production-config.mjs`: passed local checks.
- The read-only production `/api/readiness` probe on 2026-10-23 returned HTTP 503 with exactly `billing_persistence`, `field_issue_persistence`, `closeout_persistence` and `scanner_mode`; `/api/health` returned 200. No new production issue code appeared. The new code is not deployed, so this probe is a baseline comparison, not a release validation.
- The legacy `qa-configuration-publication.mjs`, `qa-configuration-admin-api.mjs` and `qa-phase-contract-activation.mjs` were attempted. All stopped before assertions because `scripts/m1/implementation-context.mjs` requires the untracked `RUN-MANIFEST.json` for a fixed 2026 M1 project and checks its original worktree, ownership hash and live Docker resources. That project is not running. Copying a stale manifest from another worktree would fail its identity checks; this fixture must be regenerated through the old M1 provision process in its intended isolated target. These three tests are **BLOCKED**, not passed.

## Qualification limit

The new service decision command is authoritative for its own request and approval record, but the existing connected service authorization and service-job commands do not yet require that record. A caller can still use that older route without entering the new approval command. The connected six-phase journey, full privileged RPC inventory, all Rybex/Rotork production pilot regressions, vendor administrator provisioning and end-to-end production readiness are unqualified. Therefore this package is **PARTIAL**, not Phase 1 QUALIFIED.
