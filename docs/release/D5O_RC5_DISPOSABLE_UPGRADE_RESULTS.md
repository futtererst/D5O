# RC5 disposable upgrade results

## Test 1: clean installation

**PASS for clean installation only.** The frozen 236 executable files were installed in an isolated loopback Supabase fixture. The ledger contained 236 entries with final version `20261027190000`; 167 `d5o_hosted` tables were present and all 167 had RLS enabled. The field-fact RPC was SECURITY DEFINER, executable by `authenticated`, not executable by `anon`. The fixture and network were removed with no residual containers. Exact machine result: [clean install](evidence/D5O_RC5_CLEAN_INSTALL_RESULTS.json). This test does not model the 177-entry hosted ledger or tenant history.

## Test 2: source-based partial upgrade

The defensible local starting point is the retained 211-file source chain. It is **not** a faithful reconstruction of production: production has legacy `001`–`010`, 19 version remaps, 58 unresolved SQL differences and 44 earlier source files without hosted counterparts. **PASS as a source-only partial upgrade:** all 25 later versions applied in order; the synthetic tenant marker, Work pin, event and receipt were preserved. The function grant/RLS boundary passed. A deliberately failing migration was rejected and rolled back: its test table and ledger row were absent. The fixture and network were removed with no residual containers. Exact machine result: [partial upgrade](evidence/D5O_RC5_PARTIAL_UPGRADE_RESULTS.json).

This partial test cannot qualify historical hosted data, Auth relationships, private bytes, permit arrays or recovery. It does not prove repeat execution of all migrations is idempotent; only the interrupted transaction rollback was exercised. The RC4-B.1 focused two-tenant permit test remains prior local functional evidence; production historical permit arrays were not read or replayed here. No provider ledger entry is manufactured in this test.
