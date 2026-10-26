# Phase 2F browser acceptance

The disposable fixture starts the real Next.js application with loopback Supabase Auth and Storage. It signs in each fictional tenant administrator and captures the authenticated Configuration Center and connected Work entry pages in `evidence/phase2f-browser/`. The same session visits `/work?workspace=tenant_a_test` and `/work?workspace=tenant_b_test`; both currently show **Workspace unavailable** because the full Work page intentionally retains the Rybex/Rotork pilot allowlist. This is recorded as a real browser gate, not as a successful Deploy/Operate UI journey.

The script also posts the Design PDF through the authenticated application evidence route. Business transitions from scheduling through Operate are tested through real authenticated RPCs against the same disposable database. Those RPC results cannot substitute for the required browser interactions with workforce, field evidence, customer acceptance and support panels. A membership-backed general-customer route must be separately qualified without removing pilot safeguards before Phase 2F can be locally qualified.

Screenshots in this directory are generated from actual application sessions, not mockups. The local server is stopped after the fixture and has no durable preview URL. The original Phase 2E screenshots are historical evidence and are not overwritten by this fixture.
