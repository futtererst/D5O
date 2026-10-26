# D5O RC0 source reconciliation

## Git boundary

- Released GitHub `origin/main`: `4cf881b506def45564040d767292c5c8c4ecbe48`, refreshed 2026-10-26. The primary checkout's local `main` is `f202cc10` and is 523 commits behind `origin/main`; it is not the release base.
- The primary checkout is on `feature/billing-v2-guided-ui-replacement` at `ef5cfe85` with extensive unrelated tracked and untracked changes. It was not edited.
- The local Phase 1–2H-U sequence is linear from `7b8a629d` through `9a0886990bc8d1d2cb4e3a28cbc73672501b7240`. Its merge base with released main is `9b50a3fb0c96ea772203602a80b6ef572032557f`; main has 30 distinct commits and the development tip has 23. No newer 2H-UC commit was found. The 2H-U, 2H-TE, and Phase 1 source worktrees inspected were clean.
- The remote Phase 2E branch ends at `8d536b4c`. Later phases were local only. Other remote feature branches are predecessors or unrelated Billing/navigation work, not successors to 2H-U.
- Integration branch: `codex/d5o-rc0-integration` in `C:\Users\futte\Projects\Rybex 2 RC0`, created from `origin/main`. Application merge commit `3710ecace04e54769b5761da83f12594562e95b3` has main and 2H-U as its two parents. The 2H-U tree was three-way merged as a single lineage, preserving its ancestry and all released main changes. No historical branch was merged independently.

## Capability inventory

The source column identifies the first authoritative phase commit; later fixes in the linear lineage through `9a088699` are included. `M` means released main already has a pilot/hosted equivalent. The exact file and migration sets are in the merge diff and [checksum manifest](D5O_RC0_MIGRATION_CHECKSUMS.json). Historical evidence named below resides in `docs/architecture/` and `docs/architecture/evidence/`.

| Capability | Source | Released equivalent; implementation and dependency | Qualification evidence; remaining gap | Reconciliation |
| --- | --- | --- | --- | --- |
| Tenant provisioning, template activation | `b4a4e5c4` | M: hosted Rybex onboarding. `app/api/d5o-platform/`, `lib/d5o/admin/platform-provisioning.ts`; Phase 2B migrations after Phase 2A identity. | Phase 2B 18/18 historical; integrated two-tenant browser 47/47. | Merge feature on main; retain released Auth invitation safeguards. |
| Organization, people, invitations, memberships | `791cf6b1`, `b4a4e5c4` | M: pilot member access. `app/api/d5o-hosted/org-*`, `components/d5o/admin/OrgAdminPanel.tsx`; Phase 2A/B migrations. | Integrated organization 11/11 and connected browser 47/47; live delivery remains a production gate. | Released `MemberAccessPanel` and invitation policy kept; tenant admin routes added. |
| Role authorization and vendor separation | `7b8a629d`, `791cf6b1` | M: hosted actor and RLS model. Platform and tenant command RPCs; Phase 1/2A migrations. | P0-A 16/16 historical; integrated browser and direct RPC denials passed. | Main Auth session bridge retained. |
| Configuration templates, publication, rollback, pins | `7b8a629d`, `b4a4e5c4`, `224c9b62` | M: hosted published configuration. Admin editor, configuration RPCs; Phase 2B–D migrations. | Phase 2D 27/27 historical; integrated publication/browser and seeded historical pin upgrade passed. | Forward SQL overrides retained in timestamp order; no second engine. |
| Tenant policies, entitlements, suspension | `6524c7aa`, `224c9b62` | M: Rybex pilot controls. Platform controls and capability RPCs; Phase 2C/D migrations. | Phase 2C 23/23 and D 27/27 historical; integrated browser and integrity suspension/entitlement checks passed. | Main user interface and new tenant controls combined. |
| Service approval and job creation | `448c00be`, `82d9b1c4`, `7f5a5cd0` | M: connected service prototype. Approval/job RPCs and routes; Phase 1B, 2H-T/TD migrations. | Integrated TD 60/60 and connected browser 47/47 passed. | Strongest TD authorization guards retained. |
| Tenant-neutral Work and six-phase projection | `f2cf3a12` | M: pilot Work and six-phase ordering. `app/api/d5o-hosted/customer-work`, Work pages, phase status migration. | Integrated 48/48 replay and browser 47/47 passed. | Customer Work routes coexist with pilot pages. |
| Define browser actions and My Work | `f53aa891`, `484beebc` | M: hosted Define commands. Customer Work component, shared task projection. | Integrated connected browser 47/47 and task checks passed. | Shared Work Action path retained. |
| Design browser actions and evidence | `d1537c20`, `c45f8f0a` | M: hosted Design commands. Customer Design route/components, evidence boundary. | Integrated connected browser 47/47 and cross-tenant mutation denial passed. | Shared task/action and evidence paths retained. |
| Develop readiness and worker authorization | `c45f8f0a`, `82d9b1c4` | M: released Develop route. Customer Develop routes and components; Phase 2H-S/T migrations. | Integrated connected browser 47/47 passed. | Released route context and navigation retained. |
| Deploy field execution, evidence, acceptance | `9a088699` | M: pilot Deploy commands. Worker/manager adapters, customer field/deploy pages; no new 2H-U migration. | Integrated browser 47/47 and finite integrity matrix 8/8 passed. | Existing field and acceptance RPCs remain authoritative. |
| My Work reconciliation | `484beebc`, `88381435`, `7f5a5cd0` | M: legacy My Work outside hosted gate. Customer task projection and connected service adapters. | 2H-TC 52/52 historical; integrated browser, service and integrity task checks passed. | Shared tasks retained; legacy route left intact. |
| Evidence authorization and audit | `7b8a629d`, `c45f8f0a`, `9a088699` | M: private hosted evidence/audit. Evidence routes, storage policies, command audit tables. | Integrated browser, TD 60/60 and Deploy integrity 8/8 passed; historical private object provenance remains a staging gate. | No evidence store replacement. |

## Conflict decisions

The three-way merge had two textual conflicts. `app/work/admin/[[...section]]/page.tsx` combines released invitation policy with tenant authorization, capability navigation, and tenant labels. `components/d5o/platform/MemberAccessPanel.tsx` keeps the released form and provider uncertainty handling because the development side had an older copy of that shared pilot component. No database migration file conflicted. The integrated TypeScript, ESLint, build, migration, and browser results are recorded separately.
