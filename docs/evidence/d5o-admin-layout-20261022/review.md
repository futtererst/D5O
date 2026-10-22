# D5O Administration layout review — 22 October 2026

## Source and preview

The corrected portal was built from application commit `bdd17ed48020e47163212beb5abbaa0010eb8410` with the isolated local D5O Auth/Database target at `127.0.0.1:59641`. The production-mode, normal authenticated application is running at `http://127.0.0.1:61667/work/admin?workspace=rybex`. This is a local connected preview, not a Vercel deployment. The browser captures use Playwright/Chrome emulation, normal sign-in, and fictional accounts. No physical device or native mobile keyboard was tested.

## Presentation evidence

Matching [desktop Overview before](screenshots/overview-before-1900.png) / [after](screenshots/overview-1900.png) and [phone Overview before](screenshots/overview-before-390.png) / [after](screenshots/overview-390.png) show the sidebar aligned to the left edge, compact navigation and cards, and a usable phone hierarchy. [Phone Administration menu](screenshots/menu-open-390.png) shows all six destinations and Return to Work. [Tablet portrait](screenshots/overview-820.png) and [landscape](screenshots/overview-1180.png) show the responsive transition.

| Page | Desktop 1900 px | Phone 390 px | Connected checks |
| --- | --- | --- | --- |
| Overview | [Capture](screenshots/overview-1900.png) | [Capture](screenshots/overview-390.png) | Live account/workforce/configuration counts and recent retained audit entries displayed. |
| Users & access | [Capture](screenshots/users-1900.png) | [Capture](screenshots/users-390.png), [detail](screenshots/users-detail-390.png) | Search, detail, filtered Back/refresh, direct detail with unrelated filter, and unsaved invitation form retained. |
| Workforce | [Capture](screenshots/workforce-1900.png) | [Capture](screenshots/workforce-390.png), [detail](screenshots/workforce-detail-390.png) | Roster and selected-person forms remain reachable. |
| Configuration | [Capture](screenshots/configuration-1900.png) | [Capture](screenshots/configuration-390.png) | Active configuration displayed; no publish action issued. |
| Authority and rates | [Capture](screenshots/authority-1900.png) | [Capture](screenshots/authority-390.png) | Existing delegation and rate controls displayed; no change submitted. |
| Audit | [Capture](screenshots/audit-1900.png) | [Capture](screenshots/audit-390.png) | Retained events visible; filter survived refresh. |

Authenticated browser audit covered each section at 360, 390, 630, 768, 820, 1180, 1440, and 1900 CSS pixels. It found no document or embedded horizontal overflow and no clipped interactive control. The phone menu rendered modally with an inert background, Escape dismissal, focus return, and preserved unsaved text. PM and worker direct requests to `/work/admin/users` returned 404. The navigation sweep recorded no administrative POST, PUT, PATCH, or DELETE request. These are read-only layout and route checks; they do not qualify mutating administrative commands or native keyboard behavior.

## Checks and release limit

`npm run typecheck`, `npm run lint`, production `npm run build`, `npm audit --omit=dev` (zero vulnerabilities), `npm run demo:check`, `npm run app-shell:verify`, `npm run mobile-shell:verify`, `npm run rbac:verify`, and `npm run security:verify` passed. The aggregate `npm run verify` passed its earlier stages but stopped at `billing-v2:verify-ui`: `docs/billing-v2-guided-ui-replacement-report.md` is absent in this D5O worktree. The report belongs to separate, uncommitted Billing V2 work in the main checkout and was not copied into this candidate. The documented pre-deploy gate therefore remains incomplete. This admin commit must not be presented as production released.

The layout change affects administration presentation and client-side URL restoration only. It does not alter Auth, membership decisions, configuration publish rules, audit persistence, or database schema. A UI-only rollback is to restore the prior application deployment after confirming no concurrent incompatible release; retained administrative state stays in the existing target.
