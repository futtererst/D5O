# Compact rail and task inbox — isolated visual qualification

The approved A+D concept is implemented as a shared D5O shell, not a new business workflow. The persistent sidebar is a compact, labeled icon rail for role-available areas. Browse opens the existing full navigation on demand. My Work retains its server-filtered action/waiting list and task pane; an exact focused task retains a searchable inbox beside its work canvas. The old role and phase navigation remains available in Browse, and an administrator's settings control remains role-scoped. The field-worker landing remains the separate crew schedule route.

The task inbox reads `/api/d5o-hosted/prototype-search` as the signed-in user and uses the same canonical task projection and exact links as My Work. It does not grant decision authority. It distinguishes action from waiting, keeps the exact current task selected, and refreshes on return to the window or by explicit control. A full-record link and task-specific supporting context remain available through the existing focused surfaces. No database migration or business-command change is involved.

## Technical observations

- Disposable local production-mode preview: `http://127.0.0.1:61656/work?workspace=rybex&view=my-work`, backed only by loopback Supabase `127.0.0.1:58221`.
- Fictional PM browser: My Work displayed six action items. Selecting “Prepare definition” opened its exact revision 1 link with a retained task inbox. The matching inbox row carried `aria-current=page` and its existing blocker/next-role detail remained visible.
- The full Browse drawer opened over the compact rail without replacing the selected task. At 390px viewport, the task and inbox stacked without horizontal document overflow. The mobile rail was corrected after inspection so Browse is not pushed below the header.
- Separate fictional PM, Operations, Finance and administrator sessions exposed different role-available rail entries; only the administrator had the Administration control. Worker access uses its separate schedule landing and was not qualified by this shell check.
- TypeScript, scoped ESLint and the production-mode build passed before the final mobile CSS correction; the final build and visual recheck are recorded in the PR once complete. These are technical observations, not Rybex-user usability findings.

This slice changes navigation and task presentation only. Detailed Define, Commercial and other phase forms still contain their existing sections and require separate usability evaluation against the concept; the mockup must not be mistaken for implemented business-form simplification.
