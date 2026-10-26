# Phase 2B provisioning architecture

Phase 2B extends the existing `d5o_hosted.workspaces`, `configuration_tenants` / `configuration_versions`, Phase 2A membership and invitation ledger, and `platform_administrators`. It introduces no second tenant, identity, or runtime configuration authority. Existing pilot workspaces have no `tenant_provisioning` row and retain their existing route gates.

## Command boundary

`POST /api/d5o-platform/provisioning` forwards the authenticated vendor session to `d5o_platform_provision_v1`. The security-definer RPC checks `auth.uid()`, the active `platform_administrators` row, input validity, a published and valid template version, and unique tenant key. Advisory transaction locks and the global `platform_command_receipts` table make request IDs idempotent; a changed payload with the same ID fails. The database transaction creates the workspace, hosted configuration tenant, tenant-owned published version, initial invitation ledger entry, provisioning state, and audit event together. It never creates a customer membership before recipient acceptance.

An approved test-recipient address can then be passed to existing Supabase Auth invite delivery. The service-role-only `d5o_platform_invitation_finish_v1` records provider outcome. Auth/email is outside the SQL transaction; a rejected or uncertain outcome changes the lifecycle to `failed`. Vendor recovery revokes the former offer and issues one replacement, with its own receipt and audit event. Existing confirmed Auth users receive a tenant-bound offer without a new email. Mailbox delivery is not inferred from a provider response.

The recipient accepts through `d5o_platform_initial_admin_accept_v1`. It binds Auth user ID, confirmed email, workspace, current invitation ID, vendor-created offer, and expiry before granting the existing hosted `admin` membership. The ordinary Phase 2A invitation command still cannot assign `admin`. Repeated acceptance reports a replay without another grant.

`d5o_hosted_onboarding_read_v1` computes required setup from the actual organization profile, active hosted configuration and approval policy, and initial administrator membership. The customer administrator confirms readiness through a revision-checked, audited command. A vendor separately activates through `d5o_platform_activate_v1`, which rechecks the current organization, active configuration, initial administrator membership, failure state, and revision. A trigger prevents Work insertion for any provisioned tenant until activation. This trigger has no effect on the existing pilots.

## Data and recovery

`tenant_provisioning` records template lineage, tenant configuration version, initial administrator offer, lifecycle, revision, actor, and failure. `platform_events` and `platform_command_receipts` retain actor, reason, outcome, and idempotency evidence. Four sequential migrations add the model and commands. All new tables are in the hosted schema with RLS enabled and no direct customer grants. RPCs use explicit grants and empty `search_path`.

Database creation is one transaction, so failures before commit leave no partial tenant. External invitation failures preserve the committed tenant in a non-active state for vendor recovery. A replacement invitation never changes the tenant-owned configuration. Historical template and tenant configuration versions are retained.

## Deployment and rollback

The migrations were applied only to disposable local PostgreSQL during qualification. Staging needs an approved migration rehearsal with existing row/constraint audits, command grants, tenant creation, provider-failure recovery, and forward recovery. No destructive rollback is safe after a tenant has been provisioned: retain rows and apply a corrective forward migration. Before first use, a staging-only rollback may remove the four migrations in reverse dependency order after verifying no `tenant_provisioning` or template usage rows exist. Production migration and deployment are outside this package.

General commercial routing, external mail delivery, and complete six-phase workflow qualification remain release gates. The Work creation gate covers the authoritative hosted Work path tested here; other business entry points require separate route qualification before commercial promotion.
