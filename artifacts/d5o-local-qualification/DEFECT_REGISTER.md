# Local qualification defect and gap register

The original recovery register remains at `artifacts/d5o-quality-recovery-20261029/DEFECT_REGISTER.md`. This addendum records new findings and unresolved scope precisely.

| ID | Severity/class | Root cause and impact | Disposition and evidence |
| --- | --- | --- | --- |
| LQ-01 | Medium / test maintenance | Five Configuration Foundation assertions referred to absent historical fixtures and a superseded release statement, preventing a meaningful regression result. | Fixed: exact historical fixtures and hash validation, current approved decision assertions. Static suite passed. |
| LQ-02 | Medium / local environment | Docker default network pool exhaustion prevented disposable database qualification. | Fixed: bounded explicit private-subnet fallback for this exact error; loopback check preserved; fresh/upgrade DB suite passed. |
| LQ-03 | Low / test assertion | PostgreSQL boolean text expected `f` rather than `false`; two new financial cases failed before verifying their outcomes. | Fixed in test only; fresh 20/20 authenticated service run passed. |
| LQ-04 | High / qualification gap | Cumulative and concurrent financial commitment authority, full canonical PO/subcontract/labor boundary writes, and every configured category are not proven. Unauthorized commitments could exceed policy without this evidence. | Open. Focused service and delegate cases passed; broader persisted financial matrix required before local PASS. |
| LQ-05 | Medium / qualification gap | Full tablet, keyboard/accessibility, and explicit refresh/logout/new-session acceptance for every six-phase screen remains unexecuted. | Open. 62-case desktop/mobile browser journey passed; do not generalize to all devices and sessions. |
| LQ-06 | High / hosted evidence blocker | GREEN PostgreSQL access and matched database/Auth/Storage checkpoint unavailable to this task. Hosted recovery and deployed candidate equivalence cannot be proven locally. | Open. Local logical restore passed; execute GREEN runbook with authorized operator. |
| LQ-07 | Medium / dependency risk | Four High npm advisories remain in Prisma 6 development tooling; supported npm fix requires Prisma 7 major upgrade. CLI is reachable during local/CI Prisma commands. | Open risk, no production dependency advisories. Plan supported tested upgrade and restrict untrusted schema/config input in CI. |

No Critical application defect was observed in the exercised candidate. Absence of a verified defect is not proof that untested controls work.
