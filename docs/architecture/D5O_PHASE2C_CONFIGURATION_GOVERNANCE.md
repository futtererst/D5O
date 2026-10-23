# Phase 2C configuration governance

The existing customer configuration command retains draft, validated candidate, published and superseded versions, optimistic revision, active-version conflict, idempotent receipt, reason and audit. Phase 2C extends its `save-policy` validation for the typed Discover intake rule. The customer editor compares active and draft, and can compare the draft with the most recent superseded version.

Restore copies a prior published version's manifest, Work Types, creation rights and routes into a **new draft**. The draft remains based on the currently active version for stale-default protection. The administrator must validate, publish and explicitly activate it with a reason. No historical version is mutated or deleted; work pins remain unchanged. The restore source is constrained to the same tenant.

The review displays supported changed settings and existing Work count pinned to the active version. It states that changes apply to new Work. It does not estimate operational impact beyond these known facts. Separate approval of sensitive configuration is not present in the current authority model and is deferred rather than simulated.

Audit remains in `configuration_admin_events` and `platform_events`; no parallel audit store was added. The source migration is `20261023151000_d5o_phase2c_discover_policy.sql`. Published versions remain protected by the inherited immutability constraints and command state checks.
