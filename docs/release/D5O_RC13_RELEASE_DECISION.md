# RC13 release decision

**RC13-A follow-up:** [current lifecycle and evidence qualification](D5O_RC13A_RELEASE_DECISION.md) supersedes the unexecuted upload and customer-decision-download observations below. The accepted evidence contract remains unchanged.

**Overall NO-GO for production promotion.** The historical migration upgrade, genuine local Auth, scoped design-document download and protected historical integrity passed their tested boundaries. The owner has accepted server-mediated private-evidence access as the intended contract. The frozen application has a demonstrated connected-work selector defect; a narrow local correction passed HTTP regression but changes the application SHA. The complete historical lifecycle, hosted bindings and coordinated production recovery are outstanding. Production migration and deployment remain unauthorized.

| Gate | RC13 result |
| --- | --- |
| Evidence access contract | **ACCEPTED:** owner accepted server-mediated access in the RC13 follow-up. Direct user Storage denial remains the RC12 observed result and is consistent with this contract; positive upload and customer-decision download remain unexecuted. |
| Genuine local Auth | **PASS:** fictional GoTrue v2.195.0 sessions against the upgraded copy. Checkpoint-instant Auth provider ledger remains unavailable; 82 production versions were read-only copied as in RC12. |
| Full historical application lifecycle | **PARTIAL:** Work creation, evidence, Define draft and connected creation tested; mandatory later commands unexecuted. |
| Business-command authorization | **PARTIAL:** focused tenant, role, revocation, stale-state and replay controls passed; complete command matrix unexecuted. |
| Private evidence access | **PARTIAL:** positive authorized app download and negative controls passed; direct user Storage has no SELECT policy; positive upload/customer-decision route unexecuted. |
| Historical data preservation | **PASS within captured original-field scope:** original keys and nested Work entries preserved, 23 byte hashes match; full-row differences classified. |
| Local recovery | **PASS within local scope:** both checkpoints restored and injected DDL failure rolled back; atomic production recovery unqualified. |
| Actual hosted environment binding | **BLOCKED:** RC12 read-only metadata found a production deployment SHA different from the frozen application, and effective secret acceptance was not established. |

**Stop conditions for any later cutover:** any mandatory historical lifecycle command unexecuted or failed; connected-work correction unreviewed; privilege or tenant isolation weakening; changed original historical fields or object bytes; source/ledger/bridge mismatch; missing application/environment binding proof; no consistent database and object checkpoint with write quiescence; or failed recovery verification. Formal product-owner acceptance of the delivery-change versus post-handover connected-service contract remains **DECISION REQUIRED**.

No production write, migration, Auth/Storage change, deployment, project creation, purchase, push or merge occurred. The encrypted protected checkpoint remains under its existing access and retention controls.
