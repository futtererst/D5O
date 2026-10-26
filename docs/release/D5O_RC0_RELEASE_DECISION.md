# D5O RC0 release decision

**Verdict: INTEGRATION QUALIFIED. Production promotion remains blocked.**

The exact application commit is `3710ecace04e54769b5761da83f12594562e95b3` on `codex/d5o-rc0-integration`. Its parents are released `origin/main` `4cf881b506def45564040d767292c5c8c4ecbe48` and the linear local Phase 1–2H-U tip `9a0886990bc8d1d2cb4e3a28cbc73672501b7240`. A separate local commit records RC0 qualification scripts, manifests and evidence; no product or migration SQL correction was needed after the application merge.

## Integration gates

- The source inventory accounts for intended Phase 1–2H-U capabilities and preserves the released pilot, hosted Auth, Work Action path, independent approvals, six-phase order and configuration pins.
- TypeScript, ESLint, production build, repository verifier, published phase contract and scanner invariant passed on the combined tree.
- All 234 executable migrations applied to a clean disposable stack. A forward upgrade from the 211 released-main migrations applied the 23 local migrations to seeded tenant, published configuration, pinned Work, event and command receipt records; all seeded records survived and the stack was cleaned.
- Integrated tenant organization 11/11, connected service security 60/60, tenant-neutral Work/phase replay 48/48, exact-application-SHA Deploy browser 47/47, and Deploy integrity 8/8 passed. Each successful disposable run verified teardown.
- The integrity matrix exercised concurrent completion and evidence review, suspended/removed worker sessions, wrong Work/package and forged/deleted evidence, concurrent scoped and whole-Work acceptance, and exact/conflicting command replay. No critical authorization or evidence-integrity bypass was demonstrated.

See [machine results](D5O_RC0_INTEGRATION_RESULTS.json), [test detail](D5O_RC0_INTEGRATION_TEST_RESULTS.md), and the [migration manifest](D5O_RC0_MIGRATION_MANIFEST.md).

## Failed attempts and limits

The legacy configuration-foundation static verifier still fails five historical documentation assertions; its migration, schema, RLS and effective-resolution checks pass. One concurrently launched Phase 2G run failed because two Next development servers used the same checkout; an isolated rerun passed 48/48. The first integrity probe omitted a required `turnoverId` and the protected RPC rejected the request; the corrected probe passed. These attempts are retained in the machine record.

The forward upgrade used fictional seed records. It is not a staging restore or proof about every historical private evidence object. An approved staging data copy and hosted migration ledger were not available for comparison.

## Production gates

Production promotion remains separately blocked on an approved staging restore and recovery exercise, read-only hosted migration-ledger comparison, live invitation delivery, historical fixture and evidence provenance, general-customer routing, historical phase-projection data and final production readiness review. No remote push, merge to main, hosted migration, deployment or production mutation was performed.

## Next highest-value package: staging release qualification

Use the existing RC0 application and qualification commits. Obtain an approved isolated staging environment and suitable non-production data copy, inspect its migration ledger read-only, run the ordered manifest and recovery exercise only on disposable or explicitly authorized staging resources, and verify historical records, private evidence references, configuration pins and phase projection. Rerun the integrated browser and security smoke checks against that candidate. Resolve only demonstrated incompatibilities; update the release decision with separate staging and production gates. Do not start Operate employee feature work, push, merge, apply hosted production migrations or deploy to production without explicit authorization.
