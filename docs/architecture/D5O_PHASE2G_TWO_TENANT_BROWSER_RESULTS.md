# Phase 2G two-tenant browser results

Machine-readable run: `evidence/phase2g-two-tenant-results.json`. Disposable project `d5o-p0a-2b2d2819-871`, loopback-only, 2026-10-23 UTC. Its 48 checks passed, 0 failed, and teardown reported no residual containers or project directory.

| Evidence | Rybex Test A | Independent Enterprise Test B |
| --- | --- | --- |
| Work | `ce4638eb-8b9d-49d1-bf7c-16972c51a2f2` | `c1fcd3c3-0b51-4760-b4d8-bbfac046e296` |
| Early solution | Develop preparation, Design ready | Develop preparation, Design ready |
| Final persisted phase | Operate active; first five complete | Operate active; first five complete |
| Projection revision | 22 | 20 |
| Replay | Matched | Matched |
| Support / financial | Active / Pending | Active / Pending |
| Foreign phase RPC | `phase_status_forbidden` | `phase_status_forbidden` |
| Foreign customer Work API | GET 403, POST 403 | GET 403, POST 403 |
| Authenticated browser | Workspace chooser, Work detail, reload, mobile view, new Work creation | Workspace chooser, Work detail, reload, mobile view, new Work creation |

These connected business transitions were performed through the existing Phase 2F authenticated command fixture. The browser created one additional connected Work per tenant and opened its persisted Discover status, but did **not** submit the remaining phase transitions. This result does not meet the Phase 2G full-browser acceptance criterion.
