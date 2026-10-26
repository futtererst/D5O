# D5O RC0 staging and recovery plan

No hosted database, staging deployment, production configuration, branch, or remote ref was changed for RC0. The local disposable stack is the only database target used.

## Promotion sequence for a separate decision

1. Review the local integration commit, [source reconciliation](D5O_RC0_SOURCE_RECONCILIATION.md), [migration manifest](D5O_RC0_MIGRATION_MANIFEST.md), and [test results](D5O_RC0_INTEGRATION_TEST_RESULTS.md). Confirm all release gates that remain open have passing evidence.
2. Obtain an approved isolated staging project and a non-production data copy with provenance. Read its `supabase_migrations.schema_migrations` ledger and compare every released version and SHA-256 to the manifest. Investigate drift before any write.
3. Snapshot the staging database and Auth/Storage dependencies. Restore the snapshot into a second isolated project and prove restore. Record the restore point, owner, duration, and application commit.
4. Apply exactly manifest orders 212–234 to the copied staging state, in listed order. Do not edit the 211 released migration files or execute the duplicate `0016...-ShawnT13.sql`. Verify business-record counts, Work and configuration pins, evidence object references, RLS, grants, command receipts, and representative historical reads before and after.
5. Deploy the exact RC0 application commit to isolated staging with its SHA as `D5O_SOURCE_SHA`. Exercise two fictional tenants, hosted Auth, six-phase Work, connected service, Deploy and My Work. Keep invitation delivery restricted to approved test recipients.
6. Re-run the finite Deploy integrity matrix and integrated regression suite against that deployed commit. Record browser captures and machine results with build SHA, database migration ledger, and tenant IDs. Decide staging acceptance separately from production promotion.
7. Only after approval, push the reviewed local branch (`git push -u origin codex/d5o-rc0-integration`) and create a review PR against `main`. Merge/deploy/apply hosted migrations require another explicit release decision.

The exact Git review sequence, when authorized, is:

```powershell
git fetch origin --prune
git status --short --branch
git log --oneline --decorate origin/main..codex/d5o-rc0-integration
git diff --stat origin/main...codex/d5o-rc0-integration
git push -u origin codex/d5o-rc0-integration
gh pr create --base main --head codex/d5o-rc0-integration --title "D5O RC0 integration candidate" --body-file docs/release/D5O_RC0_RELEASE_DECISION.md
```

The staging migration operator should use the checksum JSON to construct the exact 23-file execution list only after comparing the copied project's migration ledger. The local verification command is `node scripts/p0a/run-rc0-upgrade-smoke.mjs`; it targets an isolated local stack and is safe to repeat. Hosted staging commands depend on the approved project reference and verified connection string, which are intentionally absent here.

## Recovery

- Stop new command traffic before migration or application rollback. Retain audit, receipt, and evidence records.
- A code-only failure can roll the application back to the last released SHA if the forward schema remains compatible. This compatibility must be tested in staging, not assumed.
- A schema/data failure needs the verified pre-migration database snapshot restored as a unit with corresponding Auth/Storage dependencies and the released application build. The 23 SQL files are forward migrations; reverse SQL is not supplied. A restore can lose post-snapshot writes, so the write freeze and reconciliation ledger are part of the promotion plan.
- Do not silently replay accepted protected commands. Use their retained command IDs, receipts, and audit events to reconcile uncertain outcomes after recovery.

## Production blockers held separately

Staging restore proof, live invitation delivery, historical sealed M1 fixture provenance, original connected-pilot provenance, general-customer routing, historical phase-projection data, and the production readiness scanner/persistence configuration remain independent production gates. Local RC0 compilation or synthetic two-tenant success does not close them.
