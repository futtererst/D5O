# P1-01B.2 Configurability Guardrail Precheck

Date: July 6, 2026

Source checklist: `docs/architecture/d5o-configurability-guardrail-checklist.md`

## Scope Classification

P1-01B.2 Bid Submission / Pursuit Outcome is authorized as a Rybex Data Center Infrastructure Template Pack reference workflow. It is not universal D5O platform-core behavior.

Reusable platform-core patterns in this slice are limited to:

- server-authoritative commands,
- state transitions,
- record-scoped authority,
- tenant/workspace isolation,
- audit/history,
- idempotency,
- optimistic concurrency,
- deterministic review fixtures,
- evidence-gated decision posture,
- explicit downstream handoff boundary.

## Guardrail Assessment

| Guardrail | Classification | Assessment |
| --- | --- | --- |
| Platform-core or template-pack behavior | Rybex Template Pack reference behavior with reusable core patterns | The gate is Rybex-specific, but command/audit/isolation/concurrency patterns should be reusable by future template packs. |
| Owning template pack named | Rybex Template Pack reference behavior | Owning template is the Rybex Data Center Infrastructure Template Pack. |
| Rybex, Rotork, Generic D5O reuse without branching code | Future configuration candidate | The current implementation is bounded Rybex reference behavior; future Configuration Foundation must externalize terminology, gates, actions, evidence, and roles. |
| Terminology tenant-configurable | Temporarily hard-coded assumption | Bid, proposal package, customer/GC, BAFO, estimator, and pursuit terms are Rybex reference terminology. Future template configuration should own terminology. |
| D5O phases configurable | Not applicable | This slice operates inside the Discover phase; no phase engine is implemented. |
| Gates configurable | Future configuration candidate | Bid Submission / Pursuit Outcome is hard-coded as a Rybex reference gate for now. |
| Gate questions configurable | Future configuration candidate | Current questions are Rybex reference copy: what was submitted, who approved, evidence, outcome, and next state. |
| Gate decisions and thresholds configurable | Future configuration candidate | Current transitions and terminal states are bounded to the approved P1-01B.2 authority. |
| Roles configurable | Future configuration candidate | Current roles use existing RybexOS workspace/record-scoped role model. |
| Permissions and decision rights configurable | Platform-core behavior plus future configuration candidate | The authority pattern is core; specific rights should become template configuration later. |
| Artifacts/evidence configurable | Future configuration candidate | Current evidence requirements are represented through Rybex reference fields and copy. Future artifact registry should configure evidence by phase, class, and workstream. |
| KPIs/financial formulas configurable | Rybex Template Pack reference behavior | Price, schedule commitment, estimate version, and validity are Rybex reference fields, not universal formulas. |
| Work classes configurable | Not applicable | No new work-class engine is implemented. |
| Workstreams/service lanes configurable | Not applicable | No service-lane engine is implemented. |
| Handoffs configurable | Future configuration candidate | Selected / intent-to-award is a handoff-only state. Future packs should configure downstream gates. |
| Governance forums/cadence configurable | Not applicable | No governance cadence engine is implemented. |
| Dashboards role-based/configuration-driven | Not applicable | No dashboard expansion is included. |
| Optional modules controlled by configuration | Not applicable | No optional module system is implemented. |
| Assumes historical data | No-baseline mode | The slice does not require historical baselines. |
| Supports no-baseline mode | Platform-core behavior | Startup/no-history operation is preserved. |
| Mature-enterprise historical-baseline mode | Future configuration candidate | Historical benchmark usage is not required in this slice. |
| Rybex-only assumptions | Rybex Template Pack reference behavior | Commercial bid/proposal terminology and data-center infrastructure assumptions are Rybex-specific and documented. |
| Rotork-only assumptions | Not applicable | No Rotork runtime behavior is implemented. |
| Rybex behavior documented as template-pack assumption | Rybex Template Pack reference behavior | Documented in implementation mapping and candidate report. |
| Rotork behavior documented as template-pack assumption | Not applicable | No Rotork behavior is included. |
| Hard-coding justified and documented | Temporarily hard-coded assumption | Hard-coded terms/actions are acceptable only as a bounded reference workflow until Configuration Foundation exists. |
| Hard-coded assumption tracked for future configuration | Future configuration candidate | Terminology, role rights, evidence, gates, actions, financial fields, and handoffs should become configuration candidates. |
| Audit/history preserved | Platform-core behavior | Bid-submission events plus audit/domain events preserve history. |
| Gate decisions auditable | Platform-core behavior | RPC-created event records are auditable. |
| Configuration changes auditable | Not applicable | No configuration engine exists in this slice. |
| Tenant/workspace isolation preserved | Platform-core behavior | Migration/RLS/RPC patterns remain workspace-scoped. |
| Role and decision-right checks preserved | Platform-core behavior | Record-scoped authority is required; admin alone does not grant mutation. |
| Evidence/artifact custody preserved | Future configuration candidate | Current evidence is field-based; first-class artifact registry linkage remains future work. |
| Frontline view simplified | Not applicable | This is a commercial gate, not frontline execution. |
| Executive view decision-oriented | Rybex Template Pack reference behavior | The surface exposes state, allowed actions, blocked posture, and next state rather than generic dashboards. |
| Gate review shows relevant questions/evidence/actions | Rybex Template Pack reference behavior | The UI focuses on package, approval, evidence, outcome, and handoff boundary. |
| Configuration-owner experience explicit | Not applicable | Configuration Studio is not implemented. |
| Avoid demo readiness claims | Platform governance | Demo readiness remains No-Go. |
| Avoid production readiness claims | Platform governance | Production readiness remains No-Go. |
| Avoid unauthorized P1-01B.2 implementation | Platform governance | Human owner has now explicitly authorized P1-01B.2 implementation only. |
| Avoid authorizing P1-01B.3 | Platform governance | P1-01B.3 remains unauthorized. |
| Preserve P1-01A/P1-01B.1 artifacts | Platform governance | Accepted baselines are not overwritten. |

## Rybex-Specific Assumptions

- Bid/proposal package terminology.
- Customer/GC submission context.
- BAFO/revision language.
- Estimator input and approved estimate version.
- Pricing validity and schedule commitment.
- Lost / not selected and withdrawn/no-submit terminal outcomes.
- Selected / intent-to-award as a handoff-only candidate for a future award-validation gate.

These are Rybex Data Center Infrastructure Template Pack assumptions and must not be promoted silently to universal platform-core behavior.

## Rotork Compatibility Risk

Rotork likely needs signal-led intake, installed-base/service-package terminology, lifecycle-service lanes, service signals, recurring service attachment, and field-service outcome models. P1-01B.2 must not block those future patterns. The current risk is acceptable only because this slice is explicitly documented as Rybex Template Pack reference behavior.

## Future Configuration Candidates

- Gate names and sequence.
- Action labels and permitted transitions.
- Role-to-action rights.
- Evidence/artifact requirements by state/action.
- Financial terms and formula fields.
- Handoff destinations and downstream gate eligibility.
- State labels, state copy, and next-state copy.
- Template-pack-specific terminal/reopen rules.

## Precheck Result

Proceed with bounded implementation as a Rybex Template Pack reference workflow.

Do not implement Configuration Studio, runtime template-pack loading, Rotork functionality, P1-01B.3, award validation, project readiness, mobilization, demo readiness, or production readiness.
