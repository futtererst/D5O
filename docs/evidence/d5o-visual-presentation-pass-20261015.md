# D5O presentation pass — isolated fictional pilot

This pass follows the [surface audit](../architecture/d5o-work-surface-visual-audit-20261015.md) and Shawn's October 15 feedback. It changes presentation and draft-form affordances, not decision authority. The preview uses fictional Rybex records and an isolated local database. No Rybex-user usability session was performed.

## Shared treatment

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
