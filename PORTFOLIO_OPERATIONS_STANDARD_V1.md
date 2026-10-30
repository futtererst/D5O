# Portfolio operations standard v1

Identifier: `portfolio-operations-v1`. Effective 2026-10-30. This extends
`portfolio-corrective-v1` and `autonomous-development-v1`; their repository,
dependency, approval, isolation, evidence, outcome and audit gates still apply.
It does not authorize cleanup, billing changes, new polling, or deployment.

## Scope and record

Assess AI usage and credits; Vercel, GitHub and Supabase cost and resource
hygiene; Docker Desktop health, capacity, readiness and safe cleanup; local disk
availability, growth and safe reclamation; and supporting services established
by inspected project dependencies. A discovered name or dependency is an
inventory lead. Create a verified resource mapping only after confirming the
project owner, exact resource, purpose and environment with project-scoped
`resource.ownership` evidence. Repository identity alone does not prove live
service ownership.

For each resource retain purpose, owner, environment, importance, health,
usage, cost and timestamp; explicitly mark missing, inaccessible and not
applicable telemetry. Record retention, protected or unique data, proposed
action, expected benefit, approval class, outcome verification, and retirement
or recheck condition. Use append-only `resource.assessment` evidence and the
existing idempotent task/plan and audit ledger. Reassess with a new revision;
do not rewrite observations. A stale assessment requires a recheck before a
maintenance proposal. Planning never grants execution authority.

Observed numbers need a scoped source, unit and timestamp. Zero is an observed
value, never a replacement for missing telemetry. Label estimates. Compare
matching resources, units and periods; distinguish a measured change from
attributed realized savings. Require independently verified outcome evidence
for a savings claim, and identify overlapping service charges before totaling
benefits. Do not infer account access or billing visibility from a repository.

## AI efficiency

Bind each dispatch to the verified repository, requirement, outcome criteria,
model configuration, context and execution limits. Choose a model using
demonstrated adequacy for the task and available configuration; do not assume
unobserved prices or credit balances. Reuse fresh scoped evidence. The existing
idempotency key, task lease, dependency fingerprint and bounded retry gate
prevent duplicate dispatch and unchanged retry loops; a failed modifying run
needs a new bounded plan. Record provider-reported usage only when telemetry is
available, and relate it to independently verified outcomes. Missing usage or
credits stay unknown; no synthetic estimate becomes a consumption claim.

## Service and capacity checks

Use provider project identity, current health/limits, workload and owner
constraints to set per-resource thresholds and check frequency. Manual is the
default. A configured interval requires a documented threshold basis and
bounded interval. Prefer provider events and existing audit evidence over
expensive polling; defer maintenance during active work. Check Docker daemon
readiness, container/image/build-cache/volume ownership and local disk free
space and growth before proposing reclamation. A client context without daemon
access is inaccessible telemetry, not healthy or empty capacity.

Review GitHub workflow/artifact/branch retention, Vercel deployments/builds/
storage/functions, Supabase project/branch/storage/backup retention, and other
verified service dependencies. Preserve production, staging, recovery,
rehearsal, protected databases, credentials, and unique data unless exact
ownership, recovery and authorization permit a bounded action. No blanket
Docker prune, Git clean, volume/branch deletion or broad filesystem deletion.
For a reversible cleanup, record the bounded target, expected benefit and
rollback route, execute only under existing approval, then verify service
health and before/after usage. An old name, idle snapshot or apparent duplicate
does not establish dispensability.

## Completion

An opportunity may close as an investigation with no change when the finding
and current state are evidenced. An executed maintenance task completes only
when the requested operational outcome, service health, retained data and any
claimed benefit are independently checked. Report inaccessible and pending
resources separately from inspected ones. Portfolio-wide adoption requires
project-specific acceptance; existing corrective PRs remain pending until
accepted on their default branches.
