# D5O repository guide

The normal hosted D5O application is `/work?workspace=rybex`. It requires ordinary authentication, workspace membership, the configured hosted target, and persisted Work. The `/command-center`, `/pilot`, and older `/admin` demo routes described later in the README are legacy seed/demo surfaces. Do not switch hosted D5O to seed mode or use the interface-preview route as connected acceptance.

## Entry points

- **Product direction:** [D5O True Workflow Management Development Package](d5o-true-workflow-management-development-package.md) is the existing business-process development package. It calls itself a standards artifact, not an implementation or release acceptance. The former README link to `rybexos-master-build-plan.md` has no file or Git history in this repository. No substitute master plan is asserted here.
- **Hosted setup and target separation:** [D5O hosted cutover](d5o-hosted-cutover.md) records the authenticated target model and isolated local rehearsal. Use current environment identity and guard checks before writes; historical addresses and checkpoints in that document are not a current target by themselves.
- **Repository verification:** `npm run verify` is the aggregate gate; `npm run app-shell:verify` and `npm run mobile-shell:verify` cover the adaptive shell. Focused connected checks supplement these commands.
- **Release workflow and provenance:** [Shared layout release](evidence/d5o-shared-layout-release-20261022.md), [Administration/onboarding release](evidence/d5o-admin-onboarding-release-20261022.md), and [Develop context review](evidence/d5o-develop-context-release-20261022.md) record clean tracked-source staging, target-origin and build-identity checks, authenticated read-only review on production-backed staging, and separate production promotion. [Deployment readiness](deployment-readiness.md) is the older seed/demo checklist; it does not authorize a hosted D5O release by itself.

## Branch lineage and reconciliation

The released lineage was reconciled into `main` on 23 October 2026. Its integration map is:

| Slice | Direct parent | Released treatment | Main merge |
| --- | --- | --- | --- |
| Hosted D5O baseline and accepted navigation, PR #2 | `main` at `6bb850e7` | Ancestor of the released application; includes hosted authentication, persistence, permissions, schema, and accepted navigation | `c8331bd49a6279659d819d93733688999b7b59e8` |
| Shared layout and repository verification, PR #5 | PR #2 head `7206ea0f` | Released responsive layout and required verifier repairs | `f1912a5afc1c7944428f2fb38edd537bd18861b9` |
| Administration and onboarding, PR #6 | PR #5 head `41000189` | Released admin presentation, existing-account assignment, and guarded invitation handling | `040309b73863f57e30b9b9448dd45c5cf8820e5f` |
| Develop context, PR #7 | PR #6 head `1737d220` | Released pipeline/workspace/task routing; evidence head `0636e9645c4a4e28500591af10c001df81dfbd70` | `ede75bc86c30085757eb759917a5af3938a1d061` |

At the end of PR #7, `main` was `ede75bc86c30085757eb759917a5af3938a1d061`. Its complete tree matched PR #7's evidence head. The only differences from deployed application source `64487f8ec34da78325b0d87958ba5e29c46dd5fc` were this guide, the Develop release record, and evidence screenshots; executable code, configuration, lockfile, and migrations matched exactly. The clean combined candidate passed `npm run verify`, `npm run app-shell:verify`, and `npm run mobile-shell:verify` on 23 October. Earlier connected and browser-emulated acceptance applies because the application tree is unchanged. Physical devices and native keyboards remain untested.

The older broader PR #4 diverged at `9b50a3fb` and was closed as superseded: PR #6 contains the later qualified versions of its Administration/onboarding behavior; PR #4's older code and historical screenshot assets were not merged. PR #3 is a separate unqualified guided-navigation prototype and remains open for its own decision. No remote branch was deleted or rewritten.

Start new application work from current `main`. The D5O production alias still serves deployment `dpl_DYXNRK2PyF4UUUKqpPqNHVYhVKXm`, built from application source `64487f8ec34da78325b0d87958ba5e29c46dd5fc`. Rollback deployment: `dpl_7GSMMMpV8Y8swA4e6MK1Efgxhcnz`. The Vercel project had no Git repository link or production branch at reconciliation, so merging these PRs did not create or assign a deployment. Any future deployment of a `main` commit is a separate release decision.
