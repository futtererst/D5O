# D5O Administration and onboarding release — 22 October 2026

## Source and deployment

The bounded application source is `612eba2aac9fc02ea1bc3323f9aee6ed86228813` on `codex/d5o-admin-onboarding-release`, based on the previously deployed shared-layout line. The sequence keeps Administration presentation (`b657e8a`), onboarding (`9909ed8`, `7b1c982`), and the exact isolated local origin pairing (`612eba2`) in separate commits. It does not include the broader diverged draft PR #4.

Clean tracked source was staged as Vercel deployment `dpl_izquWJBaq4BCeqHGFnM3L6Z8xELx`. The stage health endpoint returned 200 and identified `https://fcawktdjoxvahhgvkebx.supabase.co`. An ordinary authenticated Admin session opened Overview, Users & access, Workforce, Configuration, Authority and rates, and Audit on the staged deployment. Users & access exposed the distinct Assign existing account form with its heading focused. At 390 CSS px, the administration menu, directory, and assignment form fit without document overflow. The hosted review was read-only because the stage used the production-backed target.

That **same deployment** was promoted to `https://d5o-system-of-work.vercel.app`. `vercel inspect` resolved the alias to `dpl_izquWJBaq4BCeqHGFnM3L6Z8xELx`, READY and production-targeted. The alias health endpoint returned 200 with the same Supabase origin. An authenticated production reload showed Build `612eba2aac9f` on Administration Overview, and Users & access loaded its directory. No schema, hosted environment, membership, invitation, or business-command write was made during hosted review or promotion. The prior production deployment for rollback is `dpl_EvBtaV3vJigEuDkYgfdRkaDBMRPP`; reassign the alias to that deployment if this presentation/application release must be rolled back.

Draft PR #6 (`https://github.com/futtererst/rybex/pull/6`) tracks the bounded source. PR #4 remains draft and unmerged. This evidence commit follows the deployed application source and was not part of the deployed archive.

## Verification and release-check dependency

`npm run verify` passed after the final executable change. It included TypeScript, lint, production build, zero-finding dependency audit, the substantive Billing V2 UI report check, RBAC/security checks, and 28/28 route smoke checks. The authentic Billing report and small verifier correction were committed and deployed in the earlier shared-layout release, so this branch inherits them without copying unrelated uncommitted checkout work. `docs/deployment-readiness.md` is a legacy seed/demo checklist; its repository-wide aggregate gate was honored, but seed mode and scaffolded persistence are not substituted for hosted D5O Auth and persistence.

The broader Administration layout audit was connected locally before this bounded release. This pass repeated the affected hosted navigation and phone checks, not every previous visual case. Browser emulation is not physical-device or native-keyboard verification.

## Connected isolated user-access qualification

The isolated local target was verified as `127.0.0.1:59641` with controlled Mailpit at `127.0.0.1:59644`. Only fictional accounts were used. A fresh confirmed Auth account without Rybex membership was absent from the workspace directory and saw access pending. An Admin opened the distinct assignment form, selected a role, submitted a reason, received `assigned`, and the resulting membership was visible through its directory link. The recipient then opened Rybex My Work. Assignment required no invitation email; repeating it returned `already_assigned`.

A separate new fictional invitation returned `provider_accepted` and generated exactly one controlled Mailpit message. Exact command replay did not generate another message. The recipient followed the captured Auth link, completed password setup, retained Rybex invitation context, and still saw access pending. A separate Admin membership decision returned `assigned`; the recipient then opened My Work. Unconfirmed and missing accounts returned `confirmed_member_missing`; non-allowlisted invitation returned `approved_test_mailbox_required` while retaining form input. Non-admin and wrong-workspace requests were denied. No real recipient was messaged. A deliberately induced provider-uncertain outcome was not run; provider acceptance is not proof of external delivery.

## Outstanding external email dependency

Production currently has no `D5O_INVITATION_DELIVERY_POLICY` opt-in, so new invitations outside the configured test recipient remain intentionally restricted. Existing confirmed-account assignment is available without outbound email because the confirmed-account decision precedes that restriction. The retained backend record says project-specific custom SMTP is configured but external delivery to an unused approved mailbox has not been observed. The smallest remaining step is an owner-approved unused controlled mailbox, one ordinary invitation/recipient completion check, and then an explicit decision to set `D5O_INVITATION_DELIVERY_POLICY=administrator_approved`. Neither this release nor the isolated Mailpit result establishes production external-mail delivery.
