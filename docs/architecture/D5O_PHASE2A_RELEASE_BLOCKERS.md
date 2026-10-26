# Phase 2A and inherited release blocker register

| Issue | Impact | Owner or dependency | Verification requirement | Release consequence |
| --- | --- | --- | --- | --- |
| Pilot email recipient allowlist and unverified external delivery | General customer invitations cannot be claimed live | Auth/email operations and controlled onboarding package | Delivery to approved staging domains, bounce/failure handling, invitation link and acceptance | Blocks commercial onboarding; local confirmed-user acceptance can still qualify |
| Phase 2A hosted migration and rollback untested in staging | Existing hosted rows or grants may differ from disposable fixture | Database release owner | Staging migration, backfill/constraint audit and forward rollback migration rehearsal | Blocks production deployment |
| Phase 1B sealed M1 `RUN-MANIFEST.json` missing | Three historic configuration regressions stop before assertions | Original M1 fixture provenance or test-infrastructure owner | Rebuild owned fixture or port assertions to documented disposable setup | Inherited release blocker |
| Historic connected pilot environment absent | Older job/basis tests cannot run | Pilot fixture owner | Run both scripts with their isolated project and credentials | Inherited release blocker |
| Full Discover → Operate journey absent | Complete workflow compatibility not demonstrated | Pilot journey fixture owner | Execute full supported six-phase journey | Inherited release blocker |
| Phase 1B Operate UI browser session absent | New approval statuses not visually verified | Pilot browser fixture owner | Authenticated Operate screenshot and action test | Inherited release blocker |
| Existing production readiness failures | `billing_persistence`, `field_issue_persistence`, `closeout_persistence`, `scanner_mode` | Separate production-readiness package | Fix and rerun readiness on intended release | Separate production blocker |

No blocker was hidden or treated as a passed test. Phase 2A local qualification and overall production release readiness are separate decisions.
