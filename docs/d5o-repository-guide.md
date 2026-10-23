# D5O repository guide

The normal hosted D5O application is `/work?workspace=rybex`. It requires ordinary authentication, workspace membership, the configured hosted target, and persisted Work. The `/command-center`, `/pilot`, and older `/admin` demo routes described later in the README are legacy seed/demo surfaces. Do not switch hosted D5O to seed mode or use the interface-preview route as connected acceptance.

## Entry points

- **Product direction:** [D5O True Workflow Management Development Package](d5o-true-workflow-management-development-package.md) is the existing business-process development package. It calls itself a standards artifact, not an implementation or release acceptance. The former README link to `rybexos-master-build-plan.md` has no file or Git history in this repository. No substitute master plan is asserted here.
- **Hosted setup and target separation:** [D5O hosted cutover](d5o-hosted-cutover.md) records the authenticated target model and isolated local rehearsal. Use current environment identity and guard checks before writes; historical addresses and checkpoints in that document are not a current target by themselves.
- **Repository verification:** `npm run verify` is the aggregate gate; `npm run app-shell:verify` and `npm run mobile-shell:verify` cover the adaptive shell. Focused connected checks supplement these commands.
- **Release workflow and provenance:** [Shared layout release](evidence/d5o-shared-layout-release-20261022.md), [Administration/onboarding release](evidence/d5o-admin-onboarding-release-20261022.md), and [Develop context review](evidence/d5o-develop-context-release-20261022.md) record clean tracked-source staging, target-origin and build-identity checks, authenticated read-only review on production-backed staging, and separate production promotion. [Deployment readiness](deployment-readiness.md) is the older seed/demo checklist; it does not authorize a hosted D5O release by itself.

## Branch lineage and reconciliation

`main` (`f202cc1`) is an ancestor of the shared-layout line; it has no separate commits past their merge base. The shared-layout branch is 500 commits ahead of `main` and contains the released responsive layout and repository verification repairs along with earlier enterprise work. The Administration/onboarding branch descends from that line (seven additional commits) and contains the later deployed admin and onboarding work. Draft PR #7 (`codex/d5o-develop-context-correction`) descends from Administration/onboarding with bounded Develop correction and evidence commits; it must be reviewed against that production successor. Broader draft PRs and the dirty main checkout are separate and are not implicitly included in this bounded candidate.

Reconcile in that order: verify the deployed source and shared-layout ancestry, review the Administration/onboarding changes already released, then review PR #7's bounded Develop correction. Compare each branch's diff against its direct parent before any merge. Qualify any future divergence on `main` and the broader draft changes separately. This guide does not merge, close, or rewrite any branch.
