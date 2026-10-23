# D5O shared layout review — 22 October 2026

## Scope and comparison

The unchanged production-source baseline for these captures is `0273a658bf112b165031090c6caa2300f94bcbdb`. Both builds used the normal authenticated `/work` route, an isolated local Supabase target at `127.0.0.1:59641`, and fictional Rybex Work CW165. Captures are Chrome browser emulation at normal zoom, from production builds. They are not physical iPhone or iPad checks.

The baseline record header measured **x=102–1874** at 1900 CSS px, while the phase body measured **x=208–1768**. The corrected build measures **x=208–1768** for both on Define, Develop, Design, Deploy, and Operate. The header and body stayed within 2 CSS px at 360, 390, 430, 630, 768, 820, 1024, 1180, 1440, and 1900 CSS px.

| Phase | Before, desktop 1900 | After, desktop 1900 | After, phone 390 |
| --- | --- | --- | --- |
| Define | [Before](screenshots/define-before-desktop-1900.png) | [After](screenshots/define-after-desktop-1900.png) | [Phone](screenshots/define-after-phone-390.png) |
| Develop | [Before](screenshots/develop-before-desktop-1900.png) | [After](screenshots/develop-after-desktop-1900.png) | [Phone](screenshots/develop-after-phone-390.png) |
| Design | [Before](screenshots/design-before-desktop-1900.png) | [After](screenshots/design-after-desktop-1900.png) | [Phone](screenshots/design-after-phone-390.png) |
| Deploy | [Before](screenshots/deploy-before-desktop-1900.png) | [After](screenshots/deploy-after-desktop-1900.png) | [Phone](screenshots/deploy-after-phone-390.png) |
| Operate | [Before](screenshots/operate-before-desktop-1900.png) | [After](screenshots/operate-after-desktop-1900.png) | [Phone](screenshots/operate-after-phone-390.png) |

Additional comparisons: [Develop register before](screenshots/develop-pipeline-390-before.png) and [after](screenshots/develop-pipeline-390.png); [Deploy menu before](screenshots/deploy-390-before.png) and [after](screenshots/deploy-after-phone-390.png). Tablet examples: [Design portrait, 820 px](screenshots/design-820.png) and [Develop landscape, 1180 px](screenshots/develop-1180.png). Related screens: [Opportunity Workspace phone](screenshots/opportunity-workspace-390.png), [Work details phone](screenshots/work-details-open-390.png), [Work details desktop](screenshots/work-details-open-1900.png), [Procurement phone](screenshots/procurement-390.png), and [editable quote lines](screenshots/procurement-quote-lines-390.png).

## Page and component matrix

| Surface | Corrected or inspected | Narrow layout result |
| --- | --- | --- |
| My Work, Work records, five selected-record phase routes | Shared `.d5o-task-main` content frame; record header and full phase workspace aligned | No document overflow; selected Work retained |
| Discover pipeline and Opportunity Workspace | Existing separate destinations retained; clip rule removed from CRM page | Opportunity list and workspace reflow; Work context remains distinct |
| Define, all five internal sections | Same destinations through labelled selector when content width is limited | No sideways section navigation; status and selector precede detailed baseline |
| Develop pipeline, board, planning, estimate and offer areas | Existing table rows become labelled records; board and step controls reflow; nested planning menu uses selector | Identity, status, owner, commercial basis and next action visible vertically |
| Design queue and six record sections | Existing package and section controls retained | Labelled section selector and package context; no record-level Pipeline |
| Deploy, all five internal sections | Labelled section selector, vertical package controls, wrapped actions | Selector appears before status metrics; no sideways package navigation |
| Operate, all eight internal sections | Labelled section selector | Selector appears before metrics; no sideways section navigation |
| Resources, schedules, Insights, Library, administration, supporting Work details | Opened at all audited widths; four details groups inspected | No detected document or non-native embedded horizontal overflow |
| Procurement, subcontract, and labor support routes | Existing destinations and commands retained; procurement steps share one destination list | Labelled procurement selector; editable quote and BOM rows stack with all fields and actions |

The connected automated audit visited **288 rendered states** across those widths, including every available internal selector destination on the fictional record, the Opportunity Workspace, `/work/my-schedule`, `/work/admin`, all four Work details groups, and all nine procurement steps. It found **zero** document-wide overflows, **zero** non-native embedded horizontal overflow regions, **zero** header/body alignment mismatches, and **zero** business-command requests from navigation. Native input and select controls may report an internal scroll width for long values; these are not operational content regions. In a 390 × 500 Chrome viewport, the Start work submit control remained visible and hit-testable after scrolling; this is browser emulation, not a native keyboard check.

This audit does not prove every rare, unpopulated register row or every browser keyboard behavior. Physical devices and a native mobile keyboard were not used. The screenshots and measurements establish connected local browser-emulated review, not hosted or production acceptance.

## Checks and outstanding verifier defect

`npm run typecheck`, `npm run lint`, `npm run build`, `npm audit --omit=dev` (zero findings), `npm run demo:check`, `npm run app-shell:verify`, `npm run mobile-shell:verify`, `npm run rbac:verify`, and `npm run security:verify` pass. The existing connected Design, Opportunity, and Work details browser regressions pass, including fictional worker denial, unsaved input behavior, Back/refresh, and zero command requests.

The optional aggregate `npm run verify` advances through build, audit, demo, workflow actions, and workflow completion, then stops in `billing-v2:verify-ui`: it reads missing `docs/billing-v2-guided-ui-replacement-report.md`. The unchanged baseline `0273a65` also contains the read and does not contain that document. This is a pre-existing Billing V2 evidence gap outside the responsive-layout change; no dummy document or verifier suppression was added.
