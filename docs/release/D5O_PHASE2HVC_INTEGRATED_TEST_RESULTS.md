# Phase 2H-VC integrated local test results

Candidate application `d4fb1da3db046a981942f1f85bf0bad7a96eef54`; disposable local Supabase only. Machine evidence lives under [evidence](evidence/).

| Check | Result | Evidence |
| --- | --- | --- |
| Operate finite integrity and inherited tenant/security regression | PASS, 50/50 | [JSON](evidence/D5O_PHASE2HVC_OPERATE_INTEGRITY.json) |
| Fresh authenticated two-tenant Operate browser regression | PASS, 49/49 | [JSON](evidence/D5O_PHASE2HVC_FINAL_BROWSER.json), [screenshots](evidence/phase2hvc-final-browser/) |
| Connected-service approval/job regression | PASS, 14/14 | [JSON](evidence/D5O_PHASE2HVC_CONNECTED_SERVICE_REGRESSION.json) |
| RC0-to-235 forward migration, pinned Work and record preservation | PASS | [JSON](evidence/D5O_PHASE2HVC_UPGRADE_SMOKE.json) |
| RC0 checksum reconciliation and new migration order | PASS, 235 executable files | [JSON](evidence/D5O_PHASE2HVC_MIGRATION_CHECKSUMS.json) |
| TypeScript, ESLint, production build | PASS | Local commands: `npm run typecheck`, `npm run lint`, `npm run build` |

The upgrade rehearsal began from the 234-migration RC0 disposable schema, applied only `20261027085730`, and preserved synthetic tenant, membership, published configuration, Work pin, event and command receipt. RLS remained enabled for Operate state and decision evidence. The public RPC is SECURITY DEFINER with empty search path; authenticated can execute, anonymous/service cannot; the private prior function is not executable by authenticated. All three disposable Supabase projects stopped with no residual containers or project directories.

The combined runner covers tenant provisioning, independent USD 10,000/USD 25,000 configuration, Work creation, Define/Design/Develop prerequisites, field execution, acceptance, Operate, My Work, phase replay, cross-tenant denials, document bytes and independent Finance follow-up. Some pre-Operate decisions are runner RPC fixtures. A continuous fully browser-driven six-phase journey was **not** claimed. Historic production data and hosted ledger compatibility were **not** tested in this local package.

Failed/retried runs are listed in the closure report; final runs have zero failed assertions. No case remains blocked within Gate A. Hosted historical upgrade, private object recovery and production readiness remain blocked by the separately documented RC2 staging authorization and hosted-ledger issues.
