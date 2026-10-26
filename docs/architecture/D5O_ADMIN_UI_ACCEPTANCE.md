# Administration UI acceptance

## Implemented

- Customer administration retains the existing responsive side navigation, mobile dialog, workspace context and functional users, workforce, configuration, authority and audit sections for the Rybex pilot.
- The configuration editor displays active version, work type and route summaries, a USD service threshold, a required change reason, draft editing, comparison, validate/publish, activate and version history with audit actor and reason.
- The independent fictional tenant can reach its configuration page in the disposable pilot runtime. Other hosted pilot routes remain restricted.
- Vendor administrators have a separate read-only tenant directory with search and tenant detail, backed by a vendor-only database RPC. Unsupported platform operations are explicitly labelled unavailable.
- Forms use labelled controls, native keyboard behavior, explicit submit buttons, pending/retry status and server error messages. A work type retirement asks for confirmation.

## Connected browser evidence

The disposable two-tenant run authenticated both customer administrators and a separate vendor administrator. It captured desktop and phone configuration pages, the B draft editor, platform directory and platform tenant detail in `docs/architecture/evidence/phase1-admin-ui/`. The B administrator used the actual UI to create a draft, change the threshold, validate and activate it. These captures are generated application sessions; the URL is no longer live because fixture cleanup completed.

## Acceptance still required

- Keyboard and screen-reader review of the new history list and form error placement.
- Controlled vendor administrator provisioning and audited support workflows.
- Full organization profile, integration status and configuration routing parity for a commercial second tenant.

Earlier connected layout captures are in `docs/evidence/d5o-admin-layout-20261022/screenshots/`. They predate this policy editor and are separate from the Phase 1 captures above.
