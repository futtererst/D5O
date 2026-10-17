# Capability Maturity Map

Update: Auth/RBAC has moved from architecture-only to foundation enforcement
for workflow transaction writes. The capability is not enterprise-ready because
production login, Supabase session resolution, RLS, invitations, and external
users are not implemented.

Evidence/attachments update: evidence is now modeled, derived, displayed, and
locally actionable in demo state. A narrow private Supabase Storage upload pilot
exists for workflow evidence requirements, but production file access, RLS,
signed URLs, malware scanning, and retention governance remain pending.

Notifications update: in-app notification and escalation derivation is now
implemented in local/demo mode. External delivery, persistence, preferences,
delivery logs, and scheduling are not production-ready.

Pilot readiness update: an executive production readiness gap review and
controlled pilot launch package now exists. The maturity posture is controlled
internal pilot candidate, not production-ready.

Maturity scale:

- Not started
- Prototype
- Architecture ready
- Partially implemented
- Operational MVP
- Enterprise ready

## Summary

RybexOS is currently a credible seed-backed operating-system prototype. It has strong domain coverage, workflow language, visual QA infrastructure, repository planning, persistence scaffolding, and demo readiness. It is not production-ready because core operating records are not persisted, authentication is not real, permissions are not enforced, workflow transactions do not write durable status changes, and attachments/documents are not live.

| Capability Group | Current Maturity | Evidence From Current App | Gap To Enterprise Grade | Recommended Next Step |
| --- | --- | --- | --- | --- |
| Controlled work and economic authority (D5O R1) | Partially implemented in isolated prototype | Approved Define/ROM and a separately approved Design-only window govern internal Design commitments. A distinct independent Work cap and contained Graybar purchasing allocation now govern exact approved PO reservations; Finance commitment and incurred posting link to that reservation without releasing consumed budget. Fictional browser and boundary qualification: [Design](./evidence/d5o-design-spend-authority-20261017.md), [purchasing](./evidence/d5o-purchasing-economic-authority-20261017.md), [subcontract](./evidence/d5o-subcontract-commercial-20261017.md). | Legacy approved POs remain held for governed transition before new spending. Production funding/credit and delegation thresholds are unconfigured. A bounded fictional fixed-price off-site subcontract commitment, variation, independently accepted service, supplier invoice and incurred-cost bridge are now separately governed; field-labor authority preparation and independent approval, explicit booking person-hours, and draft/replay guards are implemented; positive governed publication and reviewed actual-cost reconciliation remain unqualified pending a legitimate current field window. See [labor authority qualification](./evidence/d5o-field-labor-economic-authority-20261017.md). Live Graybar is unconfigured. | Qualify positive field publication, reviewed actual overrun and Finance reconciliation; name production rate, funding and delegation owners. Do not label all R1 complete. |
| Persistence and data platform | Architecture ready | Seed-backed data providers, repository contracts, Phase 1/2 SQL scaffolds, data-source selector. | No runtime DB adapter, no persisted writes, no status/audit persistence. | Implement narrow workflow transaction MVP, then persist selected D1/D2 transactions behind fallback. |
| Authentication, RBAC, and security | Architecture ready | RBAC model, demo user context, workflow transaction permission checks, RLS helper scaffold, security readiness diagnostics. | No production login, no Supabase session resolver, no broad RLS enforcement, and no active storage policies. | Review the RLS/security scaffold, then implement Supabase Auth/session resolution before enabling policies. |
| Workflow transactions | Prototype | Workflow derivation, workflow components, guided workflow outcome panels. | Actions do not mutate records or create durable gate/status movement. | Build seed-backed/local Workflow Transactions MVP. |
| Approvals and decision rights | Prototype | Gate logic exists for D2/D3/D4/D5 and go/no-go; approval concepts modeled. | No approval matrix, delegation, audit comments, durable approval history. | Design approval transaction records as part of Workflow Transactions MVP. |
| Document and attachment management | Partially implemented | Attachment schema, entity attachment strategy, evidence model, local evidence actions, private Supabase Storage upload pilot, and storage policy scaffold comments. | No production RLS, active storage policies, signed URLs, preview/download, malware scanning, versioning workflow, retention, or package assembly. | Review the Storage security scaffold, then harden file access before production evidence use. |
| Notifications and escalation engine | Prototype | Workflow derivation identifies due, overdue, blocked, cash-risk, closeout-risk actions. | No delivery channel, subscription model, or escalation scheduler. | Build after workflow transactions produce durable action states. |
| Master data management | Prototype | Typed config/seed data for service lines, project types, crews, vendors, contacts in records. | No editable canonical master data or duplicate prevention. | Add after persistence/RBAC so records have stable ownership and governance. |
| Financial controls (D5O R3) | Partially qualified isolated prototype | Canonical job Finance distinguishes committed and incurred material/subcontract costs, customer billing, payments and receivables. Governed field-labor publication reservation and reviewed-report posting are implemented, with current reservation and actual-cost projections. | Positive labor publication, actual-hours overrun and reviewed-cost reconciliation have not yet been observed in a valid field window. Complete cost-source coverage, remaining forecast, production rates and accounting/payroll integrations are unresolved; final margin must remain provisional. | Qualify the field-labor actual-cost journey, then determine named owners and source requirements for cost completeness and forecast. |
| Schedule/resource controls | Prototype | D2 schedule baseline, mobilization dates, work package dates, production status. | No lookahead, crew/resource assignment engine, constraints log, or recovery plan workflow. | Defer until D3/D4 transactions are persisted. |
| Procurement/material control | Isolated connected prototype | The canonical D5O Hall D pilot retains a reviewed Graybar-shaped quote, requirement assessments, sourced ROM, approved Design BOM, authorized PO, local test submission, partial receipts, matched supplier invoice and reconciled material costs. | Live Graybar/AI are unconfigured. Same-Work field installation, customer acceptance and installed-equipment Operate return remain unverified until the published 26/27 October crew windows. No live order or payment occurred. | Complete the time-bound field and Operate return on Hall D; separately qualify supplier access and production controls before release. |
| Role-based workspaces | Prototype | Demo role context and broad module navigation. | No role-specific dashboards, real access trimming, or field-mode workspace. | Implement after RBAC enforcement and workflow ownership exist. |
| Reporting and operating review packs | Prototype | Command Center, module dashboards, Optimize, visual capture, demo docs. | Reports are page views, not persisted scheduled packs or exportable review packages. | Add after durable transactions and reporting tables/views. |
| External collaboration and integrations | Not started | Integration strategy documented only. | No email/PDF exports, Procore/Autodesk, accounting, identity, DocuSign, or notification integrations. | Defer until internal workflows are stable. |
| Production operations | Prototype | Verification scripts, route smoke checks, demo packaging, visual QA capture. | No deployment pipeline, environment separation, monitoring, backups, incident response, or production security review. | Add before any live-data pilot. |

## Maturity Interpretation

Architecture-ready capabilities have enough design and scaffolding to begin implementation. They are not safe for production use.

Prototype capabilities demonstrate the intended operating behavior with seed data and deterministic logic. They need transactions, persistence, auth, audit, and validation before real use.

Operational MVP means a limited internal user group can safely use the capability for real work with fallback, audit, and support.

Enterprise ready means the capability supports live operations with security, scale, monitoring, backup, reporting, and documented support procedures.

## Current Enterprise Gap

The highest-value gap is not visual polish or module coverage. The highest-value gap is durable workflow movement:

Signal -> Decision -> Action -> Evidence -> Gate Movement.

The product now communicates that pattern. The next step is making a limited set of those movements executable.
