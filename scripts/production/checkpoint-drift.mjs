#!/usr/bin/env node
// Read-only fingerprint gate between a D5O checkpoint and migration start.
// Digests are safe to retain; no rows, credentials or object bytes are printed.
import { readFileSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";

const [mode, uriFile, baselineFile] = process.argv.slice(2);
if (!["snapshot", "compare"].includes(mode) || !uriFile || (mode === "compare" && !baselineFile))
  throw Error("usage: checkpoint-drift.mjs snapshot|compare <restricted-uri-file> [baseline-json]");
const uriPath = realpathSync(uriFile);
const uri = new URL(readFileSync(uriPath, "utf8").trim());
if (!uri.hostname.endsWith(".pooler.supabase.com") || uri.port !== "5432" ||
    decodeURIComponent(uri.username) !== "postgres.fcawktdjoxvahhgvkebx" ||
    uri.pathname !== "/postgres" || uri.searchParams.get("sslmode") !== "require" || !uri.password)
  throw Error("unexpected production database identity");

const tables = [
  ["auth_users", "auth.users", "id"],
  ["auth_identities", "auth.identities", "id"],
  ["auth_sessions", "auth.sessions", "id"],
  ["auth_refresh_tokens", "auth.refresh_tokens", "id"],
  ["storage_metadata", "storage.objects", "id"],
  ["work_events", "d5o_hosted.work_events", "id"],
  ["command_receipts", "d5o_hosted.work_command_receipts", "workspace_id,command_id"],
  ["migration_ledger", "supabase_migrations.schema_migrations", "version"]
];
const selects = tables.map(([name, table, key]) => `select '${name}' as category,
  count(*)::bigint as rows,
  encode(sha256(convert_to(coalesce(string_agg(
    encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'), '|'
    order by ${key}), ''),'UTF8')),'hex') as digest from ${table} t`);
const sql = `begin transaction read only; select json_object_agg(category,
  json_build_object('rows',rows,'sha256',digest))::text from (${selects.join(" union all ")}) q; commit;`;
const mount = `type=bind,source=${uriPath},target=/run/secret/postgres-url.txt,readonly`;
const shell = "uri=\"$(cat /run/secret/postgres-url.txt)\"; export PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=30000'; psql \"$uri\" -q -X -v ON_ERROR_STOP=1 -At -c \"$1\"";
const result = spawnSync("docker", ["run", "--rm", "--pull=never", "--read-only", "--tmpfs", "/tmp",
  "--network", "bridge", "--mount", mount, "postgres:17-alpine", "sh", "-eu", "-c", shell, "sh", sql],
  { encoding: "utf8", timeout: 60000, maxBuffer: 1024 * 1024, windowsHide: true });
if (result.status !== 0) throw Error("read-only checkpoint drift query failed");
const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
if (lines.length !== 1) throw Error("unexpected checkpoint drift response");
const categories = JSON.parse(lines[0]);
if (tables.some(([name]) => !Number.isSafeInteger(categories[name]?.rows) ||
  !/^[a-f0-9]{64}$/.test(categories[name]?.sha256))) throw Error("incomplete checkpoint drift fingerprint");
const current = { format: "d5o-checkpoint-drift-v1", projectRef: "fcawktdjoxvahhgvkebx", categories };
if (mode === "snapshot") {
  console.log(JSON.stringify(current));
} else {
  const baseline = JSON.parse(readFileSync(realpathSync(baselineFile), "utf8"));
  if (baseline.format !== current.format || baseline.projectRef !== current.projectRef ||
      tables.some(([name]) => !baseline.categories?.[name])) throw Error("invalid baseline identity or categories");
  const changed = tables.map(([name]) => name).filter((name) =>
    baseline.categories[name].rows !== categories[name].rows ||
    baseline.categories[name].sha256 !== categories[name].sha256);
  const status = changed.length ? "DRIFT_STOP" : "UNCHANGED";
  console.log(JSON.stringify({ status, projectRef: current.projectRef, changedCategories: changed,
    credentialOrIdentityDrift: changed.some((name) => name === "auth_users" || name === "auth_identities"),
    storageMetadataDrift: changed.includes("storage_metadata"),
    sessionDrift: changed.some((name) => name === "auth_sessions" || name === "auth_refresh_tokens"),
    note: "Metadata/row check only; private-object bytes require the existing encrypted inventory verifier." }));
  if (changed.length) process.exitCode = 2;
}
