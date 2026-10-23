# D5O presentation pass — isolated fictional pilot

This pass follows the [surface audit](../architecture/d5o-work-surface-visual-audit-20261015.md) and Shawn's October 15 feedback. It changes presentation and draft-form affordances, not decision authority. The preview uses fictional Rybex records and an isolated local database. No Rybex-user usability session was performed.

## Shared treatment

### October 16 correction to the reported visual pass

Shawn supplied screenshots from `ef3ad32` and reported that the update appeared to have failed. These are actual supplied observations, not a fictional walkthrough. They demonstrate that the claim of a single effective task width below was too broad: `enterprise.css` still imposed an 850px task frame and a 680px form limit, conflicting with the shared visual module. The focused Define handoff also retained a two-column container after its unrelated first column was removed, leaving its sole form at half width.

Application correction `89d43dd7648988b694cc12ad32714f955ec24803` removes those legacy width caps, makes the focused handoff use one full-width section with deliberate receiver/brief fields, places prior qualification attribution in an expandable history, and separates actionable and waiting worklist tabs. The worklist now gives more width to the selected task, uses readable task/category/job rows, and explains why an asset identity is required. It changes presentation only; business commands, evidence and decisions are unchanged. TypeScript, scoped ESLint and the production build passed. Further browser results are recorded below when observed; these checks do not establish user acceptance of the visual design.

Final tested application: `3e962ba37d44349926a2ed320b24fee7d07a9d63`. Local production-mode preview: `http://127.0.0.1:61654/work?workspace=rybex&view=my-work`, displaying `3e962ba37d44`. Follow-up commits align the asset task and focused record header, put the receiving brief before secondary history, and correct a demonstrated Define record-selection defect. A requested job without an accepted Discover handoff previously fell back to the first eligible job while the sidebar retained the requested job. It now keeps the requested identity and displays its missing prerequisite, with a link to that same job in Discover. No command authority or decision state was changed.

Observed final-build checks:

- Fictional PM signs in, opens Prepare Define handoff from My Work for `rybex-2fad0999a8f24514a7188e98f0720149`, source revision 4, and returns through Back to My work. At a 1904px viewport the task is 1560px wide and its form 1428px, with the form and primary action visible in the first screen. The 390px viewport has a 390px document width.
- Waiting shows its six waiting rows and no Identify supported asset action. Action needed and Waiting remain separate views; selection continues to open the original exact task link.
- Opening Define for `rybex-00c5155b86fb47b5be2a98d1b2c3f268` on the final production build shows “Define is not ready for this work” and keeps the original job title. It no longer shows the unrelated approved North Campus definition.
- The preceding `27d346b` render sweep covered My Work, Work hub, Portfolio, decisions, crew, execution, handoff, Discover, Define, Develop, Work Record and Operate at 1440px, plus six 390px views. No document overflow or application-error screen was observed. That sweep exposed the Define substitution above; it is not counted as a passed record-integrity check. PM attempts at restricted People/configuration views redirected to My Work. Mistyped `evidence`/`insight` URLs also redirected and are not evidence of those surfaces; the correct routes are `library`/`insights`.
- Scoped ESLint and production build (including TypeScript) passed after the final source correction. These are presentation/navigation checks, not repeated business-command qualification or real-user usability evidence.
- On final build `3e962ba`, separate fictional accounts rendered administrator People, Evidence library, Insights, configuration, operating model and Start Work; Finance My Work/Develop; Operations My Work/Operate; and worker assigned schedule. All eleven renders fit 1440px. The library showed its empty-state presentation; this does not qualify private-file retrieval. The worker check here was desktop rendering, not a new field-report journey.

During verification, local Docker lost its VM connection and could not restart because of stale zero-byte IPC sockets. The socket-only runtime directories were preserved under backup names; the Docker WSL engine was restarted without deleting or restoring database volumes or private objects. Local database/Auth recovered, and final authenticated checks above ran after recovery. No shared database, production membership, deployment or alias was changed.

The sidebar now leads with My Work, Work hub and Portfolio. Work phases appear with the selected Work Record; tools/registers and administration are separate disclosures. A single content frame, task width, heading scale, field height, button treatment, focus outline and responsive gutter apply across the platform. The focused task frame puts outcome, exact scope, blockers, controls and next owner in a consistent order. The back link always returns to My Work.

The Discover intake shows editable draft fields in two columns. Define investigation makes draft project/site facts editable in place; submitted or approved revisions show their values as read-only and direct correction through the governed path. Prefilled fictional values are draft inputs, not an approval. Worker field reporting shares the control/type scale and has direct links to instructions, work, photos and reports.

## Surface coverage

| Surface group | Presentation change or review | Browser inspection |
| --- | --- | --- |
| Sign-in/account and global shell | Shared brand, compact navigation, account access and role-scoped menu retained; administration separated from daily work. | PM and worker authenticated; admin, Finance and Operations route access checked. |
| My Work and focused tasks | Consistent split worklist; Discover intake and shared task frame show outcome/scope before controls. | PM desktop and phone; exact Discover task at 1440px. |
| Work hub, Portfolio, Decision queue | Shared page width and type; Work hub no longer leads with an account email; Portfolio opens to its register; decision counts no longer call prerequisite rows ready for review. | PM desktop. |
| Discover, Define, Develop/Commercial | Compact phase/record header; Discover pipeline and forms aligned; Define duplicate header removed and draft investigation editable. A selected record that lacks an approved Define basis now states that blocker above the Develop pipeline and links to Define. | PM desktop/phone Discover and Define; Develop selected-record state and Work Record Commercial inspected. |
| Design, Deploy, Operate/support, Finance | Shared phase frame; raw package ID removed from visible Deploy heading; Operate's phone view leads with its action queue instead of four duplicate metric cards. Retained commercial/support decisions remain in their existing components. | Selected Work Record tabs at 1440px; PM, Operations and Finance routes inspected; Operate queue rechecked at 390px. |
| Crew schedule and People & Capacity | Same page frame, type, fields and buttons as the other planning surfaces. | Admin desktop and PM crew view. |
| Execution and handoff registers | Full-width current-fact rows and the existing scoped handoff summary inspected under shared type/spacing. | PM desktop. |
| Evidence library and Work Record Evidence | Retained-file rows have consistent actions; an empty record offers the input directly instead of four zero counters. | PM desktop; empty Evidence record verified. |
| Insights, configuration, administration and reference | Common content width/type; empty lifecycle insight column suppressed. | PM/admin desktop routes inspected. |
| Worker schedule and field reporting | Phone-oriented sans-serif cards/controls, visible safety/instructions and direct section navigation. | Worker 390px phone view. |

The sampled desktop views had no document-level horizontal overflow at 1440px. Sampled Discover, Define, Start Work, My Work, worker schedule and field report fit a 390px viewport without document-level horizontal overflow. The worker's section navigation intentionally scrolls within its own row. Screenshots and local credentials remain outside Git.

## Technical qualification and limits

TypeScript, scoped ESLint and production-mode build run against the allowlisted disposable database. Browser inspection verifies render, navigation and responsive layout; it does not establish that business commands changed or that a real user can complete every workflow. Existing command and role checks remain server-owned. The preview is synthetic and cannot establish real customer authority, production readiness or Rybex-user usability.

Remaining product concerns for user review: several full-record phase views still contain dense historical context below the initial decision; some legacy reference/administration surfaces retain specialized layouts; the worker schedule uses a separate shell; and the presentation still needs observation with actual PM, field and Operations participants. These are not silently counted as usability passes.
