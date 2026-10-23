# Phase 2C release-blocker register

| Issue | Impact | Owner or dependency | Verification required | Release consequence |
| --- | --- | --- | --- | --- |
| Phase 2C migrations have no approved staging rehearsal | Existing hosted grants, trigger ordering and tenant data may differ from disposable fixtures | Database release owner and approved staging copy | Apply migrations, test existing pilot preservation, tenant suspension, feature controls, backup and forward recovery | Blocks production promotion |
| General-customer six-phase business route is still pilot-scoped | Provisioned tenants have a narrow connected Work start page, but not a qualified full browser business journey | Workflow routing owner | Qualify all subsequent phases through membership-backed routes without removing pilot allowlists | Blocks general commercial activation |
| Live initial administrator email journey unverified | Invitation record and provider response do not prove mailbox delivery | Auth/email owner and approved recipient | Controlled delivery, acceptance, expiry and bounce exercise | Blocks commercial onboarding |
| Historical sealed M1 `RUN-MANIFEST.json` absent | Three legacy regressions stop before assertions | M1 fixture owner | Restore sealed fixture in an approved isolated test environment | Inherited release blocker |
| Historical connected pilot environment absent | Older connected job/basis suites cannot run | Pilot fixture owner | Run with the owned isolated project and credentials | Inherited release blocker |
| Full six-phase journey and Operate browser session absent | End-to-end pilot flow remains unqualified | Pilot workflow owner | Execute authenticated six-phase journey and Operate actions | Inherited release blocker |
| Production readiness failures remain | `billing_persistence`, `field_issue_persistence`, `closeout_persistence`, `scanner_mode` | Separate readiness package | Fix and rerun intended production readiness checks | Separate production blocker |

Blocked tests are not counted as passes. No Phase 2C test changes production or hosted state.
