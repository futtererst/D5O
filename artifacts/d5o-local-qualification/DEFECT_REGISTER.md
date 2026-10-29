# Local qualification defect and gap register

## GREEN launch findings, 2026-10-29

| ID | Severity | Reproduction and cause | Correction / current verification |
| --- | --- | --- | --- |
| GR-01 | Medium | Hosted customer-offer submission accepted free text in the UI, while the authoritative command accepts four exact method values. A reasonable custom entry failed with `submission input invalid`. | Changed the input to the four approved choices in `1dad064`; Preview build is ready. Browser regression on the new build remains. |
| GR-02 | Medium | A new Design document displayed a custody outage because the expected 404 for a draft without a PDF was treated as a service error. | Treat only that 404 as an empty receipt in `1dad064`; Preview build is ready. Browser regression remains. |
| GR-03 | High | An optional but saved crew demand was omitted from the accepted Design release snapshot. The hosted Develop scheduler then showed no capability and could not book a crew. | Forward SQL fix in `1dad064` applied to GREEN ledger `20261029230000`; exact existing fictional release is still missing its historical snapshot. No silent repair or audit rewrite was made. |
| GR-04 | High | Hosted Design accepted `Day shift` as demand text, but field-start authority requires a 24-hour `HH:mm-HH:mm` interval. This can strand an accepted release. | UI and database demand/release validation prepared; migration dry-run passed. Commit, GREEN migration and hosted regression remain. |
| GR-05 | High | Customer-tenant Administration had no Workforce page and the roster API was pilot-only, so a qualified bound crew could not be configured for the six-phase hosted journey. | Tenant-scoped API, admin page and roster UI prepared under explicit owner authorization; cross-tenant/wrong-role tests and GREEN deployment remain. |
| GR-06 | Critical release gate | Hosted private evidence uploads do not call a malware scanner. GREEN Preview was explicitly authorized for fictional unscanned files; production would otherwise report readiness as green. | Production readiness now blocks hosted promotion while scanning is unimplemented; Preview remains visibly warned. Verified by scanner readiness test. A scanner integration and operating endpoint remain required. |

The earlier local qualification entries below remain historical; their closed/open dispositions at the top of the file supersede older baseline rows.

Current disposition after the final local pass is recorded below. The original entries remain as the `e275da6a` baseline, and the [final assessment](../d5o-final-local-qualification/ASSESSMENT.md) has machine evidence.

| ID | Severity/class | Final disposition |
| --- | --- | --- |
| LQ-04 | High / financial qualification gap | **Closed for implemented commands:** 20/20 tenant-specific service thresholds and 8/8 canonical financial cases passed, including cross-family concurrent PO/variation parent-cap race, persisted totals, replay, denial, and delegate UI approval. Approved-PO revision is not exposed by the current API and remains a scope decision, FLQ-01. |
| LQ-05 | Medium / browser qualification gap | **Closed for tested UI:** 66/66 two-tenant journey, six phases at 900 px, touch and keyboard navigation, logout/fresh sign-in, and bounded labor persistence. Natural JWT expiry over elapsed token lifetime remains FLQ-02. |
| LQ-06 | High / hosted blocker | **Open:** matched GREEN PostgreSQL/Auth/Storage restore, hosted migrations, two-tenant acceptance and rollback remain external. |
| LQ-07 | Medium / dependency risk | **Closed locally:** supported Prisma 7.10.1 upgrade passed CLI validate/generate, typecheck and build; full npm audit has zero advisories. |
| FLQ-01 | Scope / unclassified until requirement decision | No approved-PO revision action exists in the current Graybar route/RPC. Draft cancel, replay and replacement passed. Determine whether a post-approval PO revision is approved current-release scope; if so, it requires implementation and regression before local PASS. |
| FLQ-02 | Medium / evidence gap | **Closed locally:** production Auth proxy with a supported five-minute JWT refreshed protected `/work` after 311 seconds; clearing session cookies denied navigation. 3/3 disposable browser checks passed. Hosted inactivity/time-box policy remains a GREEN configuration check. |
| FLQ-03 | Medium / test assertion | New tablet and logout checks assumed an Account menu on Customer Work and allowed an absolute sign-in return URL. Root cause: the page's actual path is Switch organization → Sign out and the route accepts internal paths. Corrected in `6046dae` and `b4b137c`; final 66/66 passed without product change. |
| FLQ-04 | Low / evidence hygiene | Routine browser, service, recovery, and finance outputs previously targeted tracked paths or changed `next-env.d.ts`. Redirected to ignored `.tmp/d5o-evidence`, added generated-file restoration, manually retained five curated evidence files; final worktree clean after runs. Two archived duplicate files were preserved after automatic approval review rejected their deletion. |
| FLQ-05 | Medium / local infrastructure | Docker engine returned API 500 during an extended run's teardown; restart and exact disposable-stack cleanup restored service. Independent final 66/66 browser and 8/8 finance runs had clean disposal. The earlier transient browser 401's cause was not isolated, so no product correction is claimed. |

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
