# Phase 2C administration UI acceptance

The customer Configuration page retains the existing tenant context and draft/publication controls. It now shows the active Discover intake requirement, a draft checkbox backed by the hosted `save-policy` action, active-versus-draft changes, comparison with the most recent superseded version, and “restore as a new draft” for a prior published version. Save, validate, publish and activate remain separate governed actions. The version history and audit reasons remain visible.

The vendor tenant detail page shows entitlement, rollout flag and effective Connected Work availability as separate values. Reasoned vendor actions grant or remove the entitlement, enable or disable the flag, suspend operations and reactivate an eligible tenant. Confirmation names the affected tenant and explains the operational consequence. Existing pilot detail pages do not expose lifecycle controls.

The page and API both rely on server authority. The customer cannot call vendor commands through a forged request; the connected Work API checks capability and the database command repeats the check. The UI does not claim that a feature flag grants role permissions.

Available customer administrators see “Start connected Work” in the administration navigation. The narrow page loads tenant capability and active published Work Types, submits a complete Discover intake through `/api/d5o-hosted/connected-work`, and shows the created Work identity. An unentitled tenant sees an unavailable state and its direct POST is denied. This page does not claim to replace the full six-phase business workspace.

Authenticated screenshots and browser action results are recorded in `evidence/phase2c-admin-ui/` and `evidence/phase2c-two-tenant-results.json`. These paths are populated by `scripts/p0a/run-phase2c-enterprise-admin.mjs`; the results document records the final pass/fail state.
