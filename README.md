# RybexOS

## Current D5O and legacy demo guidance

Start with [the repository guide](docs/d5o-repository-guide.md) for the authenticated hosted D5O route, isolated local setup, verification, release evidence, and existing product-plan material. The previously cited `docs/rybexos-master-build-plan.md` is absent from this repository and its history; the guide identifies the available product-plan material without replacing or changing it.

The remainder of this README describes the older seed/demo RybexOS routes. Its defaults and demo checklist do not describe the hosted `/work` application's authenticated persistence or release gate.

RybexOS is a seed-backed prototype for running subcontracted infrastructure
work through the Rybex D5O operating model. It is designed for Rybex
Infrastructure Group and demonstrates how pursuit, contract baseline,
mobilization, field execution, commercial control, billing, safety, quality,
closeout, and optimization can operate as one disciplined system.

## D5O Operating Model

- D1 Discover: qualify opportunities before estimating resources are committed.
- D2 Define: lock scope, contract, budget, schedule, and commercial baseline.
- D3 Design / Prepare: confirm mobilization and field-start readiness.
- D4 Deliver: control daily field work, production, issues, safety, quality, RFIs, changes, and billing support.
- D5 Document / Close: assemble acceptance, final billing, retainage, and archive evidence.
- O Optimize: turn completed work into lessons learned, production rates, and future pursuit intelligence.

## Current Runtime Mode

The app currently runs in seed-backed demo mode by default.

```env
RYBEXOS_DATA_SOURCE=seed
```

Persistence schema files exist and a narrow workflow transaction write pilot is
available only when explicitly enabled. A narrow evidence upload pilot can also
be enabled locally for private Supabase Storage testing. The current demo does
not require Supabase, Postgres, auth, RLS, Storage, or database environment
variables.

Supabase read-only pilot mode and the workflow transaction write pilot can be
enabled locally with `.env.local`, but seed/local mode remains the default for
demos and verification.

The Workflow Completion Engine also has an opt-in Supabase persistence bridge:

```env
RYBEXOS_WORKFLOW_COMPLETION_STORE=database
```

Use it only with `RYBEXOS_DATA_SOURCE=database` and local Supabase server-side
keys. Local completion remains the default, and the database completion bridge is
not production-ready.

## Implemented Modules

- Command Center
- Pipeline / Opportunity Intake
- Projects / D2 Contract Baseline
- Mobilization / D3 Field Readiness
- Field Execution / Daily Reports
- RFIs & Submittals
- Change Control
- Billing / Pay Application Support
- Safety
- Quality
- Closeout / Acceptance Package
- Optimize / Lessons Learned
- Admin / System Readiness

## Quick Start

```powershell
npm install
npm run dev
```

Open:

- [Command Center](http://127.0.0.1:3000/command-center)
- [Pilot Mode](http://127.0.0.1:3000/pilot)
- [Admin / System Readiness](http://127.0.0.1:3000/admin)

Pilot Mode is a guided internal operating slice for the three verified workflow completion proofs. It is not production readiness.

## Verification

Core checks:

```powershell
npm run typecheck
npm run lint
npm run build
npm audit --omit=dev
```

Demo readiness check:

```powershell
npm run demo:check
npm run workflow:verify-actions
npm run rbac:verify
npm run evidence:verify
npm run notifications:verify
npm run security:verify
```

Optional Supabase Storage evidence upload pilot check:

```powershell
npm run evidence:verify-upload
```

This requires local Supabase env vars and `RYBEXOS_EVIDENCE_STORE=database`.
It performs a dry run unless `RYBEXOS_ALLOW_EVIDENCE_UPLOAD_TEST=1` is set.

Optional workflow completion database pilot check:

```powershell
npm run workflow-completion:verify-db
```

This requires `RYBEXOS_DATA_SOURCE=database`,
`RYBEXOS_WORKFLOW_COMPLETION_STORE=database`, Supabase URL/read key, and a
server-side secret key. It does not enable RLS or production completion
persistence.

Full verification, including a temporary local dev server and route smoke checks:

```powershell
npm run verify
```

If a dev server is already running on `http://127.0.0.1:3000`, route smoke checks
can be run separately:

```powershell
npm run smoke:routes
```

## Local Visual QA

Playwright is installed as a dev-only dependency for local screenshot capture.
Install the Chromium browser binary once:

```powershell
npx playwright install chromium
```

Then run:

```powershell
npm run dev
npm run visual:capture
```

The app must already be running at `http://127.0.0.1:3000`, unless `BASE_URL` is
provided. Screenshots and the manifest are written to:

- `visual-qa-output/desktop/`
- `visual-qa-output/tablet/`
- `visual-qa-output/mobile/`
- `visual-qa-output/manifest.json`

Playwright is used only for local visual QA. It is not part of product runtime,
database runtime, auth, or deployment behavior.

## Demo Route

Historical demo docs remain in the repository for context. They do not establish hosted D5O readiness; see [the repository guide](docs/d5o-repository-guide.md).

Start the executive demo at:

- `/command-center`

The supporting demo docs live in:

- `docs/demo-readiness.md`
- `docs/demo-script.md`
- `docs/demo-click-path.md`
- `docs/demo-cheat-sheet.md`
- `docs/ceo-demo-path.md`

## Packaging

Create a safe shareable folder bundle:

```powershell
npm run demo:package
```

The bundle is written to:

- `package-output/rybexos-demo-package`

The package excludes local dependencies, build output, `.env` files, and obvious
local-only folders.

## Persistence Status

Persistence is scaffolded with one narrow write pilot:

- Phase 1 core schema: `supabase/migrations/0001_core_foundation.sql`
- Phase 2 D1/D2 schema: `supabase/migrations/0002_d1_d2_pipeline_projects.sql`
- Phase 3 workflow transactions schema: `supabase/migrations/0003_workflow_transactions.sql`
- Phase 4 workflow transaction write pilot: `docs/persistence-phase-4-workflow-transaction-writes.md`
- Optional local pilot seed: `supabase/seed/phase2_d1_d2_demo_seed.sql`

Database runtime is not enabled by default. Only workflow transaction actions
can write when `RYBEXOS_DATA_SOURCE=database` and
`RYBEXOS_WORKFLOW_TRANSACTION_STORE=database` are both set. No routes require
database variables in seed mode.

Auth mode is also demo by default:

```env
RYBEXOS_AUTH_MODE=demo
```

The Auth/RBAC foundation now enforces workflow transaction permissions before a
local transaction is accepted or a database pilot write is attempted. Production
login, Supabase session resolution, and active RLS are not enabled.

Local database pilot variables belong only in `.env.local`:

```env
RYBEXOS_DATA_SOURCE=database
RYBEXOS_WORKFLOW_TRANSACTION_STORE=local
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
```

To test workflow transaction writes locally, set:

```env
RYBEXOS_DATA_SOURCE=database
RYBEXOS_WORKFLOW_TRANSACTION_STORE=database
```

Then run:

```powershell
npm run db:verify-workflow-transactions
```

To test the evidence upload pilot locally, create the private
`rybexos-evidence` bucket using:

- `supabase/storage/rybexos-evidence-bucket.sql`

Then set:

```env
RYBEXOS_DATA_SOURCE=database
RYBEXOS_EVIDENCE_STORE=database
```

Run:

```powershell
npm run evidence:verify-upload
```

For an actual tiny verification upload/write, also set:

```env
RYBEXOS_ALLOW_EVIDENCE_UPLOAD_TEST=1
```

Production file management is not enabled. Signed URLs, RLS-backed file access,
malware scanning, retention automation, external sharing, and full document
workflow remain future work.

## RLS + Storage Security Status

Security scaffolding exists, but production security is not enabled.

- RLS scaffold migration: `supabase/migrations/0004_rls_security_scaffold.sql`
- Security design doc: `docs/rls-storage-security-foundation.md`
- Security verification: `npm run security:verify`
- Optional Supabase inspection: `npm run db:inspect-security`

The RLS migration defines helper functions and policy-family examples. It does
not blindly enable RLS across all tables. Storage policy examples are comments
only, and the evidence bucket remains private.

Supabase keys used during development are local/private only and must be rotated
before public deployment. Do not commit `.env.local`, screenshots, logs, or demo
packages containing key values.

Stripe is not part of RybexOS. Do not add Stripe keys, scripts, docs, or code to
this project.

## Enterprise OS Roadmap Status

RybexOS is currently a credible operating-system prototype, not a production
system. The full D5O lifecycle, shared workflow layer, visual QA tooling,
demo packaging, persistence scaffolding, RBAC architecture, and audit
architecture are in place.

The enterprise roadmap package defines the path from prototype to operational
platform:

- `docs/enterprise-os-backlog.md`
- `docs/capability-maturity-map.md`
- `docs/production-roadmap.md`
- `docs/enterprise-dependency-map.md`
- `docs/recommended-next-implementation.md`
- `docs/workflow-transaction-design.md`

Recommended next implementation:

- Review the workflow transaction write pilot results.
- Add production Supabase auth/session resolution and RLS before production workflow persistence.
- Review and test the RLS/storage scaffold before enabling table policies.
- Keep broad module record writes out of scope until workflow persistence is proven.

## Historical Controlled Pilot Readiness

Historical controlled pilot documents exist, but current product authority is
governed by `docs/rybexos-master-build-plan.md`. The current status is:

- Demo ready: no.
- Controlled pilot candidate: not currently authorized by the master build plan.
- Production ready: no.

Historical pilot readiness documents:

- `docs/production-readiness-gap-review.md`
- `docs/pilot-readiness-scorecard.md`
- `docs/controlled-pilot-launch-plan.md`
- `docs/pilot-user-test-scripts.md`
- `docs/pilot-risk-register.md`

Pilot verification:

```powershell
npm run pilot:verify
```

The recommended controlled pilot is limited to 1-2 internal projects, limited
internal users, no external GC/client access, in-app notifications only, and no
sensitive production documents unless storage/RLS security is explicitly
approved.

Do not claim production readiness until persistence, auth/RBAC enforcement,
audit persistence, file storage, workflow transactions, monitoring, and backup
procedures are implemented and reviewed.

## Pilot Slice Acceptance Gate

The guided Pilot Mode slice is locked to exactly three human-executable
workflows:

- Billing Backup Blocker -> Cash Recovery.
- Field Issue -> RFI / Change Escalation.
- Closeout Requirement -> Acceptance / Final Billing Release.

Run the production-build-safe acceptance gate before demo or pilot review:

```powershell
npm run pilot:acceptance
```

For the visual companion review, run:

```powershell
npm run pilot:acceptance-visual
```

The local dev runtime caveat remains documented because this Windows environment
has shown unreliable client handler binding during headless inspection. The
acceptance gate uses the production build server. Local/demo remains the
default, the DB bridge is opt-in, and the status is Controlled internal pilot
candidate — not production ready.

The Pilot workflows also produce business outcome records at completion. These
records show the business process completed, business object moved, saved
inputs, evidence/document references, linked outputs, business impact,
remaining blockers, next business step, and historical record label. Outcome
records are local/demo by default; database pilot metadata is opt-in and not
production ready.

## Do Not Do Yet

- Do not enable database mode for demos unless a specific pilot check requires it.
- Do not expose `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY` to client-side code.
- Do not remove seed mode.
- Do not add production auth or RLS without the planned security pass.
- Do not treat the evidence upload pilot as production document management.
- Do not add Stripe.

## Known Limitation

The in-app browser visual QA connector has repeatedly failed in this Windows
sandbox with `windows sandbox failed: spawn setup refresh`. Treat this as a tool
environment limitation, not an app failure. Use `npm run visual:capture` or the
manual fallback in `docs/local-visual-qa-runbook.md`.

## D5O True Workflow Management Package

`docs/d5o-true-workflow-management-development-package.md` defines the D5O True Workflow Management Development Package. `docs/billing-v2-enterprise-workflow-implementation-spec.md` defines the Billing v2 Enterprise Workflow Implementation Specification.

This is specification only. No implementation occurred: no UI behavior, workflow runtime, routes, persistence, auth, RLS, Pilot Mode behavior, Field/Closeout workflows, or production readiness status changed because of this package. The next step is manual review of the Billing v2 implementation spec before code is written.

Verify the package with:

```powershell
npm run d5o-workflow-package:verify
```

## Billing v2 Implementation Readiness Review

Billing v2 implementation readiness review completed at `docs/billing-v2-implementation-readiness-review.md`. The future implementation build plan, data model mapping, and QA acceptance plan are at `docs/billing-v2-implementation-build-plan.md`, `docs/billing-v2-data-model-mapping.md`, and `docs/billing-v2-qa-acceptance-plan.md`.

No implementation occurred in this readiness pass. No UI/runtime/persistence/auth/RLS/Pilot Mode behavior changed, and Billing v2 is not implemented. The next step is to resolve the Ready with conditions items and approve the build plan before code is written.

Verify the readiness package with:

```powershell
npm run billing-v2:verify-readiness
```

## Billing v2 Engineering Readiness Guardrails

Billing v2 engineering readiness guardrails now exist:

- ADRs for local/demo reference-first behavior, domain state machine, commercial review simulation, evidence reference model, and Pilot integration boundary.
- State transition matrix.
- Domain command contract.
- UI wireframe spec.
- Domain test plan.
- Phase 1A implementation prompt saved for future use.

No implementation occurred in this guardrail pass. No UI/runtime/persistence/auth/RLS/Pilot Mode behavior changed, and Billing v2 is not implemented. The next build step is manual review followed by the domain-only Phase 1A implementation pass.

Verify the engineering-readiness package with:

```powershell
npm run billing-v2:verify-engineering-readiness
```

## Billing v2 Phase 1A Domain Layer

Billing v2 Phase 1A domain layer now exists as domain-only code. It adds the BillingBackupPackage model, deterministic demo state, state machine commands, guards, readiness logic, structured evidence references, commercial review task/decision logic, blocker-clearance rules, outcome record generation, historical record generation, and domain QA.

No Billing v2 UI behavior changed. No routes, `app/billing/page.tsx`, Pilot Mode behavior, persistence, auth, RLS, Field workflow, or Closeout workflow changed.

Run:

```powershell
npm run billing-v2:qa-domain
npm run billing-v2:verify-domain
```

## Billing v2 Phase 1A Domain Review

Billing v2 Phase 1A domain review and hardening are documented in:

- `docs/billing-v2-phase-1a-domain-review.md`
- `docs/billing-v2-phase-1a-domain-implementation-report.md`

The domain review recommendation is Accepted for Phase 1B UI. Billing v2 remains domain-only at this point: UI is not implemented, routes are unchanged, `app/billing/page.tsx` is unchanged, Pilot Mode is unchanged, and no persistence/auth/RLS/Field/Closeout behavior changed.

## Billing v2 Interaction Design Reset

Billing v2 Phase 1B UI attempt failed manual review. The rejected UI felt like forms and buttons, was visually cluttered, and did not clearly guide the user through the business process.

The interaction design reset package defines the replacement direction:

- `docs/billing-v2-ui-failure-review.md`
- `docs/billing-v2-guided-workflow-interaction-design.md`
- `docs/billing-v2-step-by-step-storyboard.md`
- `docs/billing-v2-replacement-ui-implementation-plan.md`

No replacement UI implementation occurred in this pass. Billing v2 domain layer remains the accepted foundation.

Run:

```powershell
npm run billing-v2:verify-interaction-design
```

## Billing v2 Guided UI Replacement

Billing v2 guided workflow replacement implemented for the existing focused Billing route. The experience now uses a process rail, one active step workspace, and a readiness/context panel instead of the rejected stacked forms/buttons UI.

Billing v2 remains local/demo only. No production upload, persistence, auth, RLS, Supabase schema, production pay app submission, external GC submission, Field refactor, or Closeout refactor was added. Field and Closeout not refactored. Manual acceptance still required.

Run:

```powershell
npm run billing-v2:qa
npm run billing-v2:verify-ui
```
