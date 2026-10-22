# D5O administrator onboarding correction — 22 October 2026

## Source and scope

The tested application source is `4d670d24fc56056d7e0ae95ebd907c0121550a3c` on draft PR #4. Commits `383509a2` and `4d670d24` change the existing administrator invitation route, its environment-specific delivery policy, and the Users & access forms. No database migration, role rule, account auto-membership, or Auth provider integration was added. The prior shared-layout and Administration commits on this PR remain separate release scope.

## Reproduced causes

- The deployed route checked the exact test-recipient list before asking the existing identity-intent command whether an email was necessary. An already-confirmed account could receive `approved_test_mailbox_required` although the intended next step was an explicit workspace membership decision.
- The deployed **Assign existing account** control did render a form, but it appeared below the directory search without moving focus, marking the opener expanded, or putting the result beside the form. The adjacent Invitation history made the assignment journey easy to miss. The correction places the form before search/history, focuses its heading, labels the target workspace, and retains input on rejection.
- An Auth-only registration does not create a Rybex membership and is intentionally absent from the workspace member directory. The administrator must assign a confirmed account separately. Invitation history now distinguishes provider acceptance, recipient setup, readiness for assignment, and active membership.

Automatic approval review rejected submitting a fictional invitation from the production browser because it could trigger a real provider email. No production invitation or real-recipient resend was attempted. The restriction was reproduced through the normal authenticated isolated route, with HTTP 409 and `approved_test_mailbox_required`; the user's screenshot supplies the corresponding deployed message.

## Connected isolated qualification

The existing local stack was verified as `http://127.0.0.1:59641` (Supabase API), `http://127.0.0.1:59644` (Mailpit), and normal authenticated application `http://127.0.0.1:61664/work/admin/users?workspace=rybex`. All accounts and addresses used were fictional. Passwords, provider links and keys remain in ignored local files.

| Journey | Observed result |
| --- | --- |
| Auth-only confirmed account | Absent from filtered workspace directory; normal Work route initially showed access pending. Admin assignment returned HTTP 200 `assigned`; direct membership link worked; recipient refresh opened My Work. |
| Confirmed account through Invite | HTTP 200 `existing_confirmed`; assignment form opened with the exact email; Mailpit count unchanged. |
| New account invitation | Admin form focus moved to its heading; provider returned HTTP 200 `provider_accepted`; exactly one email appeared in controlled Mailpit. The UI did not claim delivery or membership. |
| Recipient setup and membership | Recipient followed the actual captured Auth link, set a password, and `/api/d5o-hosted/invitation-setup` returned 200. Invitation history showed `setup_completed` and no membership. A separate admin assignment returned 200 `assigned`; history then showed active membership and the recipient opened normal My Work. |
| Restricted test recipient | Non-allowlisted fictional request returned HTTP 409 `approved_test_mailbox_required` with no provider email. The form retained the recipient. |
| Missing and unconfirmed Auth account | A missing account returned HTTP 409 `confirmed_member_missing` through the authenticated endpoint. An unconfirmed account returned the same 409 through the form, which retained its input. |
| Already active account | With the current directory loaded, assignment returned HTTP 200 `already_assigned`; no second membership was created. An early submit before directory load exposed a stale-version rejection, prompting the final form-state correction. |
| Replay and authorization | Replaying the exact invitation command returned the retained `setup_completed` outcome with Mailpit count unchanged. Non-admin identity access returned 403; wrong-workspace identity access returned 400. |

The production-mode build from `4d670d24` used the same isolated target for read-only visual capture at `http://127.0.0.1:61667/work/admin/users?workspace=rybex`. At 390 and 1440 CSS px, document width equalled viewport width, both forms fit their frames, the checkbox was 20×20 px, and the browser reported no JavaScript page errors. These are browser-emulated captures, not physical-device acceptance:

- [Phone invitation](phone-invite.png) and [phone assignment](phone-assign.png)
- [Desktop invitation](desktop-invite.png) and [desktop assignment](desktop-assign.png)

## Checks and release boundary

TypeScript, scoped ESLint, production build, production dependency audit (zero findings), demo readiness, app shell, RBAC, and security verifiers passed. The aggregate `npm run verify` progressed through those gates but stopped on the pre-existing missing `docs/billing-v2-guided-ui-replacement-report.md` required by `billing-v2:verify-ui`. That document is outside this D5O change; the aggregate gate remains red.

Production was not changed. At inspection, the public alias resolved to Vercel deployment `dpl_CdZ5UUNKx7VBuVM8Ca4tQGy5Zn66`, and an ordinary signed-in page displayed build label `0273a658bf11`. The deployment's Git source metadata is absent, so that label is not independent proof of the uploaded source. PR #4 includes prior navigation and layout commits and must not be promoted wholesale as a bounded onboarding fix. The available Preview configuration points to the production Supabase project, while the owner declined an additional paid isolated hosted target. No hosted fictional qualification or production invitation delivery is claimed.

The production project has configured custom SMTP according to the retained 22 October administration record, but no external recipient delivery was observed in this task. `D5O_INVITATION_DELIVERY_POLICY=administrator_approved` is an explicit production-only opt-in; that variable is currently absent from the production Vercel environment. Before activation, verify the exact deployed source and SMTP setting, provide a separated hosted target or approved equivalent review method, clear the aggregate release gate, and conduct one approved controlled external-mailbox test. No real recipient should be used to reproduce the UI restriction.
