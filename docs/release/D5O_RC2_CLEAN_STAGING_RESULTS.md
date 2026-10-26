# D5O RC2 Track A — clean hosted staging

**Result: BLOCKED BY AUTHORIZATION; source compatibility blocker identified.** No hosted staging project was provisioned, migrated or deployed. No staging browser journey or hosted two-tenant security test was run. RC0's local disposable suite results (11/11, 60/60, 48/48, 47/47 and 8/8 as summarized in [RC1](D5O_RC1_RELEASE_DECISION.md)) are prior integration evidence, not hosted staging acceptance.

Read-only account discovery on 2026-10-26 found no independent D5O Supabase project or D5O Vercel staging target. Exact staging database, Auth, Storage, deployment and build identities remain unknown; see [identity record](D5O_RC2_ENVIRONMENT_IDENTITY.json). No secret values were read into this report.

## Demonstrated source incompatibility

At RC0 source SHA `3710ecace04e54769b5761da83f12594562e95b3`, `lib/d5o/auth/hosted-target.ts` accepts hosted `production` commands only when the Supabase origin is the hardcoded **production** project `fcawktdjoxvahhgvkebx`. Its `rehearsal` branch accepts only listed loopback origins. A newly isolated hosted Supabase URL therefore makes `d5oCommandRuntime()` null, so protected D5O commands cannot operate. `lib/d5o/scheduling/request-origin.ts` also grants HTTPS scheduling origins only to `production`. This is a code-level reason that the exact unchanged RC0 SHA cannot complete the required hosted Work journey. Using the production Supabase project to satisfy the guard would violate isolation.

The required narrow correction is a staging runtime bound to one explicitly approved staging project ref, with fail-closed checks for runtime mode, deployment project, production denylist, HTTPS origin, and no broad invitation delivery. Review the patch and its authorization tests before assigning a new application SHA. The baseline remains RC0; the deployed qualified SHA must then be recorded accurately. This is infrastructure compatibility, not a new business feature. Do not silently label a changed build as exact RC0 SHA.

The existing connected-journey runner starts its own disposable Supabase and injects local fixture SQL and clock overrides. It cannot simply be pointed at hosted staging. Reuse its browser assertions with a staging-safe fixture setup after authorization, and record which actions were actually executed in the browser versus RPC setup.

## Pending acceptance matrix

| Check | Status | Required evidence |
| --- | --- | --- |
| Isolated database/Auth/Storage and Vercel IDs | BLOCKED | Approved distinct IDs and verified bindings |
| 234-file install and ledger | BLOCKED | New-project ledger, hashes and RLS/grant probes |
| Application build, health and readiness | BLOCKED | Exact corrected SHA, deployment ID and target attestation |
| Two fictional tenants, administration and connected Work | BLOCKED | Authenticated hosted browser traces and business records |
| API, RPC and private Storage tenant denials | BLOCKED | Negative tests on hosted staging identities |
| Invitation delivery | BLOCKED | Approved synthetic mailbox/sink and exact recipient allowlist |

No browser evidence, migration application, synthetic accounts, hosted writes or cleanup of hosted resources occurred in RC2.
