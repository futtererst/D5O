# RC17 provisioning restrictions

Candidate application `ef9bf423680c94fbbb41c4d9b7a5a5070ce6a10c`, `app/` tree `84f2081b3b6266abf7d89906b04f816622838f2c`. No source change was made.

| Boundary | Observation and source | Classification |
| --- | --- | --- |
| `GET/POST /api/d5o-platform/provisioning` | RC16's production-mode build gave a genuine fictional session plain-text HTTP 503. `proxy.ts` allows `/platform-admin` and `/api/d5o-hosted/*`, but rejects `/api/d5o-platform/*` before the handler. The route normally calls vendor-only `d5o_platform_provision_v1`, whose own checks include an active platform administrator, template, unique tenant key and receipt. The 503 is independent of vendor authority. | **ACTUAL CUSTOMER-ONBOARDING DEFECT if new-customer provisioning is in this hosted release.** The shared-Auth surface guard itself is intentional. |
| Fictional workspace `POST /api/d5o-hosted/prototype-design-command` and `/purchase-authority` | RC16 received HTTP 400 `invalid_target`. These pilot specialist routes accept only `rybex`/`rotork`; the separate `customer-design-action` and `customer-develop-action` routes use membership-backed `customerWorkScope`. | **INTENTIONAL AND CORRECT** for pilot endpoints. This is validation, not cross-tenant denial proof. |
| New-customer navigation | `app/work/page.tsx` links a non-pilot member to `/work/customer/[workspace]` or `/assignments`. The hosted proxy also rejects these pages with 503. | **ACTUAL CUSTOMER-ONBOARDING DEFECT if new-customer Work is in release scope.** Source-path evidence; no RC17 live customer journey was executed. |
| Fictional commercial command | RC16 received 400 `invalid_command` before workspace authorization. | **UNRESOLVED** as a workspace probe; no denial inference. |

The platform UI advertises “Create customer” and calls the blocked provisioning route (`PlatformProvisioningPanel.tsx`). The documented Phase 2B contract requires that route for vendor provisioning, followed by exact-recipient acceptance, customer readiness and separate vendor activation. Thus the unchanged hosted build cannot execute that supported contract for a new customer. It may still be appropriate for the restricted existing pilot. No guard was changed in RC17.

**Owner decision required:** Is this release restricted to existing `rybex`/`rotork` pilot tenants, or does it include new-customer onboarding? If the latter, approve a narrowly reviewed hosted routing change first. It must retain the shared-Auth legacy denylist, vendor-only RPC authority, tenant membership checks and customer page isolation. Actual deployment bindings remain unverified. [RC16 HTTP evidence](evidence/D5O_RC16_APP_AUTH_BOUNDARY.json) · [Phase 2B contract](../architecture/D5O_PHASE2B_PROVISIONING_ARCHITECTURE.md).
