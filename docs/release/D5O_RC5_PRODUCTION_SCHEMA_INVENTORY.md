# RC5 production schema inventory

Captured 2026-10-27 from read-only Supabase project metadata and bounded PostgreSQL catalog SELECTs. Project `fcawktdjoxvahhgvkebx` is named D5O, region `us-east-2`, database host `db.fcawktdjoxvahhgvkebx.supabase.co`, database `postgres`, PostgreSQL 17.6 (provider build 17.6.1.127). No business rows or private object bytes were read.

The exact catalog observations are in [evidence](evidence/): `D5O_RC5_PRODUCTION_LEDGER.json`, `RELATIONS`, `COLUMNS`, `CONSTRAINTS`, `INDEXES`, `TRIGGERS`, `POLICIES`, and `FUNCTIONS` (all prefixed `D5O_RC5_PRODUCTION_`). These retain object names and definitions for review, not protected tenant records. The snapshot is a point in time and must be refreshed at an authorized cutover.

| Schema | Tables | Ownership boundary |
| --- | ---: | --- |
| `d5o_hosted` | 149 | D5O application objects |
| `public` | 100 | Mixed legacy application tables and D5O RPC functions; classify object by object |
| `auth` | 27 | Supabase managed, with D5O membership dependencies |
| `storage` | 8 | Supabase managed, with D5O private evidence associations |
| `realtime`, `supabase_migrations`, `vault` | 3, 2, 1 | Provider managed |

All 149 `d5o_hosted` and 100 `public` tables have RLS enabled. Eleven Auth tables do not, under provider ownership. There are four explicit D5O policies in `pg_policies`; no Storage policies were observed. Catalog inventory includes 1,387 constraints, 543 indexes, 124 noninternal triggers, and 277 functions across the four primary schemas. Of those functions, 161 `public` and 80 `d5o_hosted` are SECURITY DEFINER. No `public` SECURITY DEFINER function in this capture grants effective EXECUTE to `anon`; individual owner, search path and `authenticated` grants are in the function snapshot. The field-fact RPC is owned by `postgres`, SECURITY DEFINER with empty search path, executable by `authenticated` and not `anon`.

Installed extensions relevant to review include `pgcrypto` and `uuid-ossp` in `extensions`, `pg_stat_statements` in `extensions`, and `supabase_vault` in `vault`. Extension availability does not prove source migration compatibility.

The current field-fact RPC chooses permits by `p->>'at' desc`. The frozen RC5 correction chooses the last appended permit by JSON array ordinality. A timestamp tie can therefore select an earlier Held permit today. The correction preserves the RPC signature and grant, but its compatibility with actual historical permit arrays remains unproved. `d5o_hosted.connected_phase_status` and `d5o_hosted.connected_phase_projection_v1` are absent. The RC1 observation that the inspected Billing V2/field persistence tables are absent remains material; object-by-object source effects require a protected-copy test.

Auth user relationships, tenant configuration pins, event history, receipts, audit rows, and private evidence objects are intentionally **UNKNOWN at the data level**. Catalog metadata cannot establish their historical values or integrity. No production DDL, DML, mutating RPC, ledger write, Auth change or Storage change was performed.
