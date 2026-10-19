# Dedicated administrator backend — local qualification checkpoint

**Scope:** Synthetic D5O workspace administration on `codex/d5o-enterprise-readiness`. This is a local implementation checkpoint, not a hosted release or participant acceptance.

**Source basis:** Release worktree `C:\dev\Codex\.codex\worktrees\d5o-production-release\Rybex 2`; starting HEAD `bbec8b7139885183478a770de44c6b0947433af8`; previously displayed hosted application `320a02bb419a`. The unrelated `supabase/.temp/cli-latest` change and historical untracked artifacts were retained. Final candidate commit and displayed build remain open.

## Implemented candidate

- Dedicated `/work/admin` shell with Overview, Users & access, Workforce, Configuration, Authority and rates, and Audit direct routes. The old `/admin` demo/reset surface remains quarantined. Hosted proxy allowance is limited to the new route and existing D5O APIs. The server page and each new API verify active workspace administrator membership.
- Searchable, bounded membership directory and detail view showing Auth confirmation, workspace access, roster binding, future assignment count and retained history. Existing confirmed-account assignment, role change, suspension and restoration use a reasoned wrapper around the original typed commands. Administrator succession is separate and cannot demote an existing administrator. Invite/recovery requests use server-side Supabase Auth APIs, retain provider-accepted versus delivered status, and require a configured approved synthetic recipient domain; no email was sent in this checkpoint.
- Unified workforce administration reuses the authoritative roster command. It adds person detail, assignment/availability context and a governed wrong-binding correction that blocks forthcoming assignments, preserves earlier account/report attribution and retains an explicit correction event.
- Tenant-scoped paginated audit over retained membership, workforce, binding, configuration, delegation, rate and identity events. Earlier events with no retained reason are labeled accordingly; the view does not manufacture history.
- Admin identity-change boundary clears the view and rechecks server authorization on same-tab sign-out or account switch. New and rehomed forms retain command identity and input across uncertain responses and reconcile the original receipt before same-ID retry. Browser-local appearance settings remain labeled as local. Hosted Work Type creation/retirement and the phase-policy editor remain outside this slice.

## Focused evidence and limits

| Check | Observation | Evidence type |
|---|---|---|
| TypeScript and scoped lint | Passed after the Admin shell, form and receipt-handling changes. | Local static checks |
| Production build | Passed after correcting Auth-client creation during `/auth/set-password` prerender. The last build preceded the final rail and shared-form edits; final build still required. | Local build |
| SQL grammar | File 157 parsed as 36 statements. | Local parser |
| Isolated migration compatibility | Files 155–157 executed in order inside a rolled-back transaction; then applied transactionally to the named zero-Work clone, moving its ledger 154 → 157. | Disposable database command |
| Admin directory/audit/receipt | Executed under an active synthetic admin inside a rolled-back transaction; each returned its expected JSON structure. | Disposable database command |
| Authenticated browser and write commands | **Open.** No ordinary-user Admin shell, role, binding, stale/replay or mobile result has been recorded. | Unqualified |
| Full curated replay and populated compatibility | **Open** for this 157-file candidate. Prior 156-file evidence remains historical. | Unqualified |
| Hosted migration, PR push, deployment | **Not performed.** Hosted remains on the previously displayed build. | Unchanged |

The named disposable database and Auth containers were reported healthy by `docker ps`, but direct PostgreSQL connections then alternated between success and 5–12-second timeouts. Supabase CLI subsequently reported that database unhealthy. A single targeted restart of `supabase_db_d5o-beta-admin-final154-20261019` returned Docker Engine HTTP 500. No global restart, pruning, volume deletion or unrelated container change was attempted. The clone's committed 157-entry ledger must be rechecked before resuming; an HTTP 200 application shell is insufficient.

## Safe resumption and release gate

1. Restore the named isolated clone's DB/Auth responsiveness without resetting its volume; obtain repeated authenticated reads and a supported fictional write. Verify its 157-entry ledger and zero-Work starting identity.
2. Run an ordinary synthetic Admin/PM/worker browser journey: route and API denial, directory assignment/suspension/restoration, roster creation/binding/correction, audit reload, two-admin stale change, same-tab switch and lost-response reconciliation. Inspect desktop and 390 px layout. Keep invitation delivery explicitly unqualified until an approved recipient domain/mailbox exists.
3. Replay the exact final 157-file curated sequence on a separate empty target and check populated-copy compatibility. Rebuild the exact final source, then record its displayed build.
4. Only after those gates, retain a coherent hosted checkpoint, review the focused diff, push/update draft PR #2, apply the verified forward migration and deploy the matching source. Verify the essential Admin and worker journeys through ordinary hosted sessions. Preserve branch protection and do not merge automatically.

No production policy values, real employee accounts, external messages or financial commitments were introduced by this local checkpoint.
