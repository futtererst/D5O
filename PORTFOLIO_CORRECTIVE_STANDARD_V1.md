# Portfolio corrective action standard v1

Identifier: `portfolio-corrective-v1`. Effective 2026-10-30. This standard adds
requirements and outcome checks to the existing JARVIS task, evidence, approval,
execution and audit records. `AUTONOMOUS_DEVELOPMENT_POLICY_V1.md` continues to
govern worker isolation and authorization. Historical records retain their
original meaning.

## Planning record

Each new corrective plan identifies the approved requirement and current project
state by stable references, a verified project-to-repository mapping, exact Git
origin and base commit, and the version and digest of the root `AGENTS.md`.
Record the observed failure separately from a cause assessment (`unknown`,
`suspected`, or `confirmed`), its confidence and supporting project-scoped
evidence. A confirmed cause requires evidence; a hypothesis is not a fact.
Unknown causes allow a diagnostic task with at most three attempts.

Record the action, correction target when applicable, measurable acceptance
criteria, expected recurrence prevention, and authorization class. A substantive
failure, repeated blocker, security issue or release problem also records impact
and a concrete resume condition. Small investigations can use a short action and
one criterion. Source observations can be reused when their scope, content and
age remain valid; repeated ingestion with a changed payload is rejected.

The default evidence age is 30 days and a plan may narrow or extend it to at
most 90 days when the source remains valid. Task dependencies must be completed before dependent work is queued or claimed.
External prerequisites use project-scoped `prerequisite.ready` evidence keyed by
an exact source reference. Missing prerequisites suspend only tasks that name
them. Protected operations still require their separate owner approval.

## Dispatch and retry

At queue and claim, recheck repository identity, base commit, instructions,
dependencies, external prerequisites, and the existing exact-action approval.
The trusted runner must additionally satisfy `autonomous-development-v1` and
its independent isolation gate. An approval or this standard never substitutes
for a qualified runner.

Record a fingerprint of dependency and relevant evidence state when a task
blocks or fails. A retry needs a changed dependency or new scoped diagnostic
evidence, remains within its attempt bound, and needs a valid approval. Do not
repeat the same blocked task with unchanged inputs. Keep the isolation
investigation as its own dependency until qualified.

## Completion and learning

Completion requires project-scoped evidence for every acceptance criterion and
an explicit check of the requested outcome. A worker exit code, test pass, or
completion claim alone is insufficient. An investigation may complete without a
file change when its finding and unchanged state are evidenced. Record a
recurrence-prevention action in the plan and retain outcome evidence and lessons
in existing memory and audit records. Where later evidence disproves a cause,
create a new assessment; do not rewrite an append-only record.

Adoption requires each repository to merge or otherwise accept a compatible
root `AGENTS.md` integration. A prepared branch or PR is pending, not adopted.

