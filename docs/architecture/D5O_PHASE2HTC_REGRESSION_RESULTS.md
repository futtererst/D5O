# Phase 2H-TC regression results

## Passed

- Deterministic disposable calendar/triage suite: **13/13**, cleanup verified. [Results](evidence/phase2htc-calendar-results.json).
- Clean two-tenant authenticated Work and connected-service journey: **52/52**, cleanup verified. Includes provisioning, configuration, six-phase Work, My Work service tasks, A approval, both jobs, cross-tenant adapter probes and phase projection replay. [Results](evidence/phase2htc-two-tenant-results.json).
- Phase 1B approval/job integrity rerun: **14/14**, cleanup verified. Includes changed amount and scope, cross-request approval, revoked approval authority, historical pin and legacy entry denial. [Results](evidence/phase2htc-approval-integrity-results.json).
- Inherited Gate A rerun: **42/42**, cleanup verified. This includes suspended/removed membership, stale field-worker sessions, disabled Design flag/tenant and Develop API/RPC feature boundaries. These are adjacent controls; they do not replace missing service-adapter variants. [Results](evidence/phase2htc-inherited-gate-a-results.json).
- Focused service task derivation: **9/9**. TypeScript, ESLint and production build exit 0. The static published-phase contract check also passes its Rybex/Rotork decisions, pins and protected-rule assertions. [Static results](evidence/phase2htc-static-results.json).

## Failed then corrected

- The initial independent coverage-review task assertion failed because the server task derivation omitted Draft agreements. The smallest correction emits an Operations review task for a Draft agreement created by another actor. Focused and browser regressions now pass.
- A new wrong-role approval probe was first placed after the decision, producing `pending_approval_required`; moved to the pending state so it reaches the actual role check (`42501`). No business command changed.
- An inherited browser check waited for a transient success message after a 201 response and route transition. It now verifies the persisted Work read. A separate intermittent task-route render timeout is handled by one read-only reload after confirming the authoritative task detail API returns 200. Both failed retries are retained as [creation-status failure](evidence/phase2htc-browser-retry-failure.json) and [task-route failure](evidence/phase2htc-my-work-route-retry-failure.json).
- The first sandboxed production build failed because Turbopack could not create a Windows junction (error 5). The identical local build passed with filesystem permission. This was an execution-environment failure, not an application compilation failure.

## Not fully executed

The exact service-adapter tests for suspended/removed members and tenant, disabled entitlement/flag, currency change, deleted or wrong-child evidence, concurrent pending approval/authorization, and duplicate pricing/customer evidence remain incomplete. The full named historical Rybex/Rotork suite and sealed M1/connected pilot fixtures were not reproduced. These are listed individually in the [closure register](evidence/phase2htc-closure-register.json); a passing integrated journey does not substitute for them. Production staging, live commercial invitation delivery and readiness checks remain separate promotion requirements.
