# Phase 2B two-tenant results

The executable fixture is `scripts/p0a/run-phase2b-onboarding.mjs`; machine-readable evidence is [phase2b-two-tenant-results.json](evidence/phase2b-two-tenant-results.json). It creates a loopback-only disposable Supabase/Postgres environment, four synthetic Auth users and one explicit vendor authority fixture. All customer workspaces, configurations, invitations, memberships, readiness and activation are created through the same application RPCs. The only direct SQL setup is the vendor authority fixture; SQL is also used for inspection and deliberate fault injection. Cleanup tears down the disposable environment and records its result.

| Customer | Applied template | Published tenant policy | USD 15,000 server decision |
| --- | --- | --- | --- |
| Rybex Test | Service Operations | USD 10,000, `greater_than`, block if authority unavailable | Additional approval required; pending |
| Independent Enterprise Test | Service Operations | USD 25,000, same semantics | No threshold approval required |

The tenant thresholds are published separately by their own administrators through `d5o_hosted_configuration_admin_command_v1`. They are not provisioning defaults and require no application change between evaluations. Work records use independent tenant configuration versions. Vendor creation, exact-recipient invitation acceptance, activation, configuration denial across tenants, and audit rows are checked by the script. The browser evidence uses real authenticated sessions. Exact current pass/fail counts and IDs are in the JSON, which takes precedence over this narrative.

Final isolated execution: **18 passed, 0 failed, cleanup verified**. The same harness also tested concurrent identical provisioning, failed provider outcome with recovery, expired and revoked offers, immutable and retired templates, duplicate activation, suspended membership, and the authenticated browser onboarding sequence. The isolated demonstration does not prove external email delivery, staging migration, production readiness, or the full six-phase pilot journey.
