# Phase 2G release-blocker register

| Issue | Impact | Required owner/dependency | Verification | Release consequence |
| --- | --- | --- | --- | --- |
| Customer Work action forms incomplete | No UI-driven six-phase journey | Work UI and command integration | Two authenticated tenant journeys | Blocks Phase 2G qualification |
| New-route security matrix incomplete | Possible untested role/lifecycle edge | Security/QA | Direct API/RPC and unchanged-state tests | Blocks Phase 2G qualification |
| Per-Work assignment visibility not independently qualified | Tenant members may inherit broad existing Work reads | Work authorization owner | Define and test business-role and assignment visibility | Blocks general-customer rollout |
| Historical projection staging replay absent | Unknown old-Work interpretation | Approved staging clone | Compare persisted/replayed historical evidence | Blocks migration promotion |
| Sealed M1 and historical connected fixture missing | Original pilot claims unreproduced | Historical fixture owner | Recover original provenance or document replacement coverage | Blocks broad pilot claim |
| Live invitation email unverified | Commercial onboarding incomplete | Approved external recipient | End-to-end receipt/acceptance | Blocks commercial release |
| Production readiness failures | Billing, field issue, closeout and scanner gates remain | Separate readiness owners | Resolve each independently | Blocks production promotion |
