# Configured phase handoffs — isolated qualification

Application source: `8d1e56bc3c2df7116ca73a271f12ddaca658cc72` (displayed `Build 8d1e56bc3c2d`). Branch: `codex/d5o-enterprise-readiness`. All records and users below are fictional. Preview: `http://127.0.0.1:61656/work?workspace=rybex&view=my-work`. Database: disposable local target `http://127.0.0.1:58221`; shared and production persistence were unchanged.

The handoff destination is an administrator-managed receiving **role**, pinned to the Work configuration version. Submitters provide scope and reasons, not a receiving person. At submission, a typed command checks that an active, independent member of that role exists. The subsequent receiver still makes an independent, authenticated acceptance or return decision. Existing named handoffs remain readable and retain their original receiver and decision history. The Deploy-to-Operate receipt remains restricted to the Operations leader by the existing policy.

## Observed browser and API behavior

- PM `d5o-pilot-pm@example.test` began in My Work and opened **Prepare Define handoff** for `rybex-2fad0999a8f24514a7188e98f0720149`. The task showed a brief input and no receiver input. The authenticated submit returned HTTP 200; the committed handoff became `submitted` with `receiverRole=operations_leader`, no `receiverActorId`, and revision 1.
- A separate `operations_leader` account found **Receive Define handoff** in My Work, opened the same Work Record, entered a receiving reason and accepted it. The committed handoff became `accepted`. These are fictional qualification decisions, not real customer authority.
- The admin configuration page displayed **Who receives each handoff** and current Discover→Define and Design→Deploy roles as `operations_leader`. The PM's configuration request returned HTTP 403 `admin_membership_required`. On the disposable target, an admin save returned revision 2; identical replay returned revision 2; conflicting command reuse returned HTTP 409 `command_reuse_conflict`; a separate stale revision returned HTTP 409 `stale_handoff_route`.
- The first PM submit on this port returned HTTP 403 `invalid_origin`. The narrow local rehearsal-origin allowlist was updated for the verified `58221` target and `61656` browser pair. No authority rule or general host allowance was changed.

## Command and migration checks

Three forward migrations add the version-scoped route table, admin-only route command with event and replay receipts, and explicit admin-route precedence over manifest defaults. The typed Discover, Design and turnover commands reject caller-supplied receiving names, record the configured role on new decisions and enforce that role at receipt. Previous decisions retain their stored destinations.

The three migrations were applied only to the disposable target after its identity was checked. TypeScript, focused ESLint and the production-mode build passed. The browser positively exercised Discover→Define; Design→Deploy and Deploy→Operate routing was checked through migration review and build, not a new end-to-end browser replay. The previous untracked `output/images/` remains untouched.

This correction addresses handoff destination ownership. It does not establish that every other work form has been redesigned or that fictional pilot users establish production usability.
