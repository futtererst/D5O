# Phase 2H release-blocker register

| Issue | Impact | Required owner/dependency | Verification | Release consequence |
| --- | --- | --- | --- | --- |
| Customer action controls incomplete | No complete browser-driven six-phase journey | Work UI / hosted command integration | Two full multi-actor browser journeys | Blocks Phase 2H local qualification |
| Field-worker My Work not connected to tenant-neutral Work | Assigned execution cannot complete through this route | Workforce/Work UI owner | Field-resource sign-in, assigned task, evidence and completion | Blocks Phase 2H local qualification |
| New Define adapter security matrix incomplete | Revoked, suspended, forged, stale and concurrent HTTP edge cases unqualified | Security QA | Direct API and unchanged-state tests beyond the passed wrong-role/cross-tenant checks | Blocks Phase 2H local qualification |
| Later-phase UI action evidence absent | Cannot claim Design through Operate browser execution | Browser QA | Actual multi-actor command clicks, response, reload and audit for each phase | Blocks Phase 2H local qualification |
| Approved staging migration/recovery absent | Phase 2G projection not promotion-qualified | Staging owner | Migration, replay and recovery rehearsal | Blocks production promotion |
| Sealed M1 and historical connected fixtures unavailable | Original historical pilot claims unreproduced | Fixture owner | Recover provenance or bounded replacement assertions | Blocks broad historical claim |
| Live invitation delivery unverified | Commercial onboarding incomplete | Approved recipient | Receipt and acceptance | Blocks commercial release |
| Production readiness failures | Billing, field issue, closeout and scanner gates remain | Separate readiness owners | Resolve each independently | Blocks production promotion |
