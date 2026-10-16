# D5O workforce and availability qualification — 16 October 2026

Fictional accounts and local disposable Supabase only. No shared or production persistence, real account invitation, external notification, deployment, or Rybex-user usability assessment occurred.

## Supported role/action contract

| Action | Active workspace admin | Project manager | Operations leader | Field supervisor | Bound worker |
|---|---|---|---|---|---|
| View workforce and planning | Yes | Yes | Yes | Yes | Own schedule only |
| Create/edit/deactivate person; qualifications/capacity | Yes | No | No | No | No |
| Bind existing confirmed account | Yes | No | No | No | No |
| Record/clear full-day scheduling unavailability | Yes | No | No | No | No |
| Save/amend booking; publish week | Yes | Yes | Yes | No | No |
| Respond to own published booking | No | No | No | No | Yes |

The roster person is a stable scheduling identity. Its display name is presentation only. A confirmed sign-in account, active field-worker membership, and active binding are separate prerequisites for a worker-visible booking. Roster creation does not provision an account or send an invitation. Package equipment/tools remain Design requirements, not reserved inventory.

## Observed local browser journey

- Administrator opened **People & capacity → Manage people**, created fictional person `FICTIONAL Roster Tech Oct16` (profile `f9cdfc90-3e10-4baa-a360-222c2faea4f6`), saved Network cabling and Fiber installation qualifications and 32 weekly hours, then bound an existing confirmed local fictional account. Reload retained the stable profile, qualifications, capacity and binding. The PM's separate session saw planning data without binding email or admin controls.
- The PM saved booking `crew-rybex-13` for the qualified, bound person on the accepted source package `wp-f3549ff7cf3e43e7a30e2e37d059619f`, dated 19 October 2026, then published week revision 34 (`bf187513-c78b-4150-a167-4110277bd274`). The worker's separate signed-in session showed only their booking, accepted it, and retained “Accepted by you” after reload. Booking and response did not authorize field execution.
- The admin recorded Nate Walker's full-day unavailability for 19 October (`62374e39-f802-4ebc-b9bd-40a139c50327`) in the UI. The previously published booking remained intact, while the PM saw a precise conflict and scheduler resolution action. A separately signed-in supervisor could inspect plan details but had no scheduling or unavailability action.
- The admin-only operational note was redacted to “Unavailable” in the PM schedule projection. This is full-day planning in the Rybex `America/New_York` calendar; leave approval, payroll, medical detail and partial-day absence remain outside this slice.

## Focused boundary evidence

- Typed unavailability: identical command replay returned the original receipt/revision; conflicting reuse returned `command_reuse_conflict`; stale revision returned `stale_schedule`; PM returned `admin_availability_required`; other tenant returned `workspace_forbidden`. The old generic `save-availability` route returned `typed_schedule_command_required`. Rejected commands left the schedule revision unchanged.
- Local DB grants: `authenticated` has EXECUTE on the new availability command, does **not** have EXECUTE on the renamed internal crew helper, and does **not** have table UPDATE on `d5o_hosted.connected_crew_profiles` (`t/f/f` in that order).
- The initial new migration applied transactionally to the populated disposable pilot. Final function definitions were updated transactionally there. The fresh ordered replay result, typecheck/lint/build, tested application commit and displayed preview build are recorded below after final qualification.

## Remaining bounded limits

- Account creation/invitation is external to workforce administration; the pilot used a confirmed fictional local Auth account. Binding changes obey existing historic attribution restrictions and do not transfer old reports or private evidence.
- Availability is a full-day scheduling marker. Existing published assignments are flagged for an authorized amendment and renewed worker response; they are not moved automatically.
- No central equipment inventory or reservation capability is implied by package equipment fields.

## Final build and reload

- Tested application commit: `27e161614cc818eaac19649b64f4e562a2aa08ca`; production-mode isolated preview: `http://127.0.0.1:61643/work?workspace=rybex` displaying `Build 27e161614cc8`.
- Scoped ESLint, `tsc --noEmit`, and `npm run build` passed after the final display-name correction.
- Separate authenticated admin and PM browser reloads both showed the fictional technician by committed **display name** in People & capacity. Only the admin saw **Manage people**. The worker's separate reload retained **Accepted by you** on their own booking. These final-build reload checks were read-only; the creation, binding, booking, publication, worker response and unavailability decisions were performed through authenticated UI sessions on the preceding same migration/runtime build before the display-name correction.
- The local pilot's workforce revision was 10 and schedule revision 37 after these read-only checks. No later source edit changed the business-command contracts.
