import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createP0aRuntime, cleanupP0aRuntime } from "./p0a/disposable-runtime.mjs";

const root = resolve(process.cwd());
const manifestBytes = readFileSync(resolve(root, "docs/release/D5O_RC0_MIGRATION_CHECKSUMS.json"));
const manifest = JSON.parse(manifestBytes);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
if (manifest.migrations.length !== 234 || manifest.migrations.some((entry) =>
  sha256(readFileSync(resolve(root, "supabase/migrations", entry.filename))) !== entry.sha256))
  throw new Error("rc0_manifest_checksum_mismatch");

const result = {
  format: "d5o-rc2d-local-free-schema-size-v1",
  sourceCommit: "8e1ff9a20fc252800dfa798b613225db0b034d97",
  migrationManifestSha256: sha256(manifestBytes),
  migrationCount: manifest.migrations.length,
  environment: "disposable loopback-only Supabase; synthetic; no hosted resource",
  database: null,
  cleanup: null,
  error: null
};
let runtime;
try {
  runtime = await createP0aRuntime(root);
  if (!runtime.bindings.containers.every((item) => item.bindings.every((entry) => entry.hostIp === "127.0.0.1")))
    throw new Error("non_loopback_binding");
  const sql = `select json_build_object(
    'postgresVersion', current_setting('server_version'),
    'databaseBytes', pg_database_size(current_database()),
    'hostedRelationBytes', coalesce((select sum(pg_total_relation_size(c.oid)) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='d5o_hosted' and c.relkind in ('r','p','m')),0),
    'hostedTableCount', (select count(*) from information_schema.tables where table_schema='d5o_hosted' and table_type='BASE TABLE'),
    'hostedFunctionCount', (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='d5o_hosted'),
    'appliedMigrationCount', (select count(*) from supabase_migrations.schema_migrations)
  );`;
  const output = execFileSync("docker", ["exec", "-i", runtime.dbContainer, "psql", "-U", "postgres", "-d", "postgres", "-X", "-t", "-A", "-v", "ON_ERROR_STOP=1"],
    { input: sql, encoding: "utf8" }).trim();
  result.database = JSON.parse(output.split(/\r?\n/).at(-1));
  result.disposableProjectId = runtime.projectId;
} catch (error) {
  result.error = String(error.message).slice(0, 1200);
  process.exitCode = 1;
} finally {
  if (runtime) {
    try { result.cleanup = cleanupP0aRuntime(runtime); }
    catch (error) { result.cleanup = { clean: false, error: String(error.message).slice(0, 1200) }; }
  }
  if (!result.cleanup?.clean) process.exitCode = 1;
  const path = resolve(root, "docs/release/D5O_RC2D_LOCAL_SCHEMA_SIZE.json");
  writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ database: result.database, cleanup: result.cleanup, error: result.error })}\n`);
}
