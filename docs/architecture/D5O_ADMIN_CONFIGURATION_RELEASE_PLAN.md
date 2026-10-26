# Administration configuration release plan

## Phase 1B continuation

The local Phase 1B branch prepares the connected authorization/job database guard and passes its focused A/B command suite. Release remains on hold pending the historical M1 regressions, full pilot browser journey, staging migration/rollback review and production authorization. See [Phase 1B release recommendation](D5O_PHASE1B_RELEASE_RECOMMENDATION.md). The production readiness settings below remain separate and unchanged.

No production deployment, hosted migration, push or merge is authorized in this package. The local migration is forward-only and retains existing hosted versions and work pins.

Before release, qualify the service approval command as a mandatory boundary in the connected service workflow; verify no downstream transition bypasses pending or rejected decisions. The disposable two-tenant suite and authenticated desktop/mobile capture are complete. Run the remaining Rybex/Rotork configuration and six-phase regressions. Resolve the missing historical `RUN-MANIFEST.json` through isolated test setup, without committing credentials or generated state.

Production rollout also depends on controlled provisioning of vendor administrator identities, migration lineage review, the existing four readiness blockers (`billing_persistence`, `field_issue_persistence`, `closeout_persistence`, `scanner_mode`), and an independently qualified onboarding gate before removing any pilot restriction. Those settings must be addressed in a separate approved package.

Rollback of application code may hide the new editor and decision endpoint. The migration retains policy versions, approval requests, receipts and events. A policy rollback is an auditable new draft and activation; historical Work remains pinned. Do not delete or edit published history.
