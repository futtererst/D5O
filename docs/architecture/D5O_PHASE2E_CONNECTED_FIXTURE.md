# Phase 2E connected fixture

Run `node scripts/p0a/run-phase2e-connected-journey.mjs` from the repository root with local Docker and Playwright available. The script creates an isolated loopback Supabase project via `disposable-runtime.mjs`, applies local migrations, starts a local Next.js server, signs in distinct fictional vendor/customer/finance/operations actors, and provisions two tenants through `d5o_platform_provision_v1`. All business advances use authenticated RPCs or the authenticated evidence-upload API. Direct SQL is limited to disposable vendor authority, a synthetic invitation-expiry negative case, and evidence reads. It does not seed business progression.

Tenant A publishes USD 10,000 and required Phase 2D controls; Tenant B publishes USD 25,000 and optional controls. Both receive independent Work and configuration version pins. The fixture uses fake `example.test` recipients and a minimal synthetic PDF. It neither contacts real customers nor uses production data.

The Design PDF upload route gains a **development-only** local-customer path. It requires `D5O_COMMAND_RUNTIME=pilot`, `NODE_ENV=development`, an exact `D5O_ISOLATED_APP_ORIGIN` on `127.0.0.1`, normal same-origin POST checks, authenticated tenant membership, and the existing service-only registration RPC. Production's Rybex/Rotork route allowlist remains intact.

Results: `evidence/phase2e-connected-journey-results.json`. Screenshots: `evidence/phase2e-browser/`. The harness always runs `cleanupP0aRuntime` in `finally` and records `cleanupVerified`. A failure is reported, not converted into a pass.
