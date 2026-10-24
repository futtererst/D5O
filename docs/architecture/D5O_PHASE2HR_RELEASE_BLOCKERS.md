# Phase 2H-R release blocker register

| Item | Impact | Required verification | Release consequence |
| --- | --- | --- | --- |
| New Design adapter security matrix incomplete | Direct cross-tenant, forged Work, wrong-role/reviewer, evidence, stale, suspended/removed membership, disabled flag, tenant suspension, and duplicate release/receipt checks pass. Invalid PDF reference, concurrent different decisions, and direct disabled-feature Design RPC are not fully exercised. | Execute those remaining requests with actual identities; verify unchanged hosted state and exact HTTP/RPC results. | Blocks Phase 2H-R local qualification and production promotion. |
| General-customer Design PDF access outside isolated runtime | Current evidence route retains pilot or exact local-isolation guard. | Stage membership-backed customer upload/read/download authorization with cross-tenant and storage tests. | Blocks production use of this tenant-neutral Design flow. |
| Develop, Deploy and Operate employee actions | Hosted commands exist, but customer browser execution is incomplete. | Integrate each phase through the bounded action pattern and run two-tenant browser decisions. | Blocks complete customer six-phase UI claim. |
| Approved staging migration and recovery | Disposable migrations do not establish deployment rollback behavior. | Approved staging rehearsal. | Blocks production promotion. |
| Live commercial invitation delivery | Synthetic invitation acceptance does not prove external email delivery. | Approved recipient journey. | Blocks commercial onboarding claim. |
| Sealed historical M1 fixture and full historical pilot | Original provenance remains unavailable. | Restore fixture or report replacement coverage distinctly. | Blocks historical regression claim. |
| Authenticated Operate UI and general-customer routing | Connected backend support activation alone is insufficient. | Actual browser journey and API/RPC authorization evidence. | Blocks full six-phase customer qualification. |
| Production readiness failures | `billing_persistence`, `field_issue_persistence`, `closeout_persistence`, `scanner_mode` remain separate. | Qualify each readiness change independently. | Blocks production readiness. |

No production setting, hosted migration, deployment, push or merge is performed by this package.
