# Phase 1B release recommendation

No production migration, deployment, data, readiness setting, push or merge was performed. Phase 1B must remain **PARTIAL** until every connected command and affected pilot journey is exercised in a production-like isolated fixture, the three project-bound M1 configuration regressions run, and the changed Operate UI is captured and checked in an actual authenticated browser session. A local build and focused command tests do not qualify the full platform.

## Package blockers

1. The historical M1 regression scripts read a missing `RUN-MANIFEST.json` before any assertion. `scripts/m1/implementation-context.mjs` binds it to a fixed 2026 project, original worktree, ownership hash and live Docker resources. The repository has no self-contained generator for that sealed starting manifest. The old provisioning script requires it as an input. A copied or invented manifest would fail the ownership check and would not restore the original state. Rebuild an owned M1 fixture from the original sealed provenance, or port those assertions to a newly specified disposable fixture as a separate test-infrastructure change.
2. The full supported Discover → Define → Design → Develop → Deploy → Operate pilot journey and connected browser Operate panel have not been run against this branch. The old journey script also depends on the M1 artifacts and fixed browser endpoint.
3. Before deployment, review the forward migration's approval-table primary-key change, existing row backfill, wrapper grants and migration lineage against the target hosted database. Test the follow-on rollback migration in staging. No hosted migration is authorized by this package.

The older production readiness failures (`billing_persistence`, `field_issue_persistence`, `closeout_persistence`, `scanner_mode`) remain separate. Vendor provisioning, unrestricted tenant onboarding, SSO, SCIM, billing and commercial multi-tenant qualification are outside this package.

## Next administration package — ready-to-execute prompt

> **D5O Administration Phase 2: Organization and People Foundation**
>
> Use the committed Phase 1B branch as the baseline after its release blockers are resolved. Inspect Git state and preserve unrelated work in a dedicated branch/worktree. Implement tenant-owned organization profile, business units, locations and teams backed by authoritative hosted tables and commands. Extend the existing customer administration shell with functional list, detail, create, edit and safe-retire experiences. Add user invitations, membership status and role assignment through bounded server commands with active tenant resolution, idempotency, audit and revocation enforcement. Reuse the existing hosted membership and configuration model; do not build SSO, SCIM or billing. Keep vendor and tenant authority distinct. Prepare a read-only vendor provisioning template and an explicit plan for controlled tenant provisioning and configuration templates; implement provisioning only if an authoritative backend and isolated qualification harness are available. Test two tenant administrators, a non-admin, a revoked member and a vendor identity across API and direct RPC boundaries. Verify organization changes are tenant-isolated and do not alter Work's pinned configuration. Run applicable Rybex/Rotork regressions, record blocked tests precisely, clean synthetic fixtures, update architecture/permission/release documents, commit locally, and stop before production migration, push, merge or deployment. Report QUALIFIED only for demonstrated capabilities.

Do not execute this next package as part of Phase 1B.
