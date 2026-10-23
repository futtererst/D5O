# Phase 2B release-blocker register

| Issue | Impact | Owner or dependency | Verification requirement | Release consequence |
| --- | --- | --- | --- | --- |
| Phase 2B migration and forward recovery not rehearsed in approved staging | Existing hosted data/grants may differ from disposable fixtures | Database release owner / staging environment | Apply four migrations, audit existing tenants and grants, test provisioning, failure recovery and rollback/forward fix | Blocks production deployment |
| External initial administrator mail journey unverified | A provider response does not prove delivery or recipient completion | Auth/email owner and approved test recipient | Approved mailbox delivery, link, password setup, acceptance, expiry and bounce test | Blocks general commercial onboarding |
| General-customer business routes beyond hosted Work not qualified | A provisioned tenant may lack a complete supported business journey | Workflow owner | Inventory route guards and run authenticated six-phase journey for a provisioned tenant | Blocks commercial activation claim |
| Phase 1B sealed M1 `RUN-MANIFEST.json` missing | Three historical regressions stop before assertions | M1 fixture owner | Restore owned sealed fixture or port assertions to disposable setup | Inherited release blocker |
| Historical connected pilot environment absent | Older job/basis suites cannot run | Pilot fixture owner | Run with owned isolated project and credentials | Inherited release blocker |
| Phase 1B Operate UI browser session absent | New approval statuses not visually qualified | Pilot browser fixture owner | Authenticated Operate action and screenshot | Inherited release blocker |
| Production readiness failures | `billing_persistence`, `field_issue_persistence`, `closeout_persistence`, `scanner_mode` | Separate readiness package | Repair and rerun intended production-readiness check | Separate production blocker |

Blocked items are not counted as passing tests. The disposable fixtures do not alter production or the hosted database.
