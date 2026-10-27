// Validate a user-provided production PostgreSQL URI without printing it.
// This script executes one SELECT in a read-only PostgreSQL session.
import { readFileSync, realpathSync } from "node:fs";
import { dirname, basename } from "node:path";
import { spawnSync } from "node:child_process";

const file = process.argv[2];
if (!file) throw Error("provide the local URI file path");
const resolved = realpathSync(file);
const lines = readFileSync(resolved, "utf8").trim().split(/\r?\n/);
if (lines.length !== 1) throw Error("URI file must contain exactly one line");
const url = new URL(lines[0]);
if (!["postgres:", "postgresql:"].includes(url.protocol)) throw Error("invalid PostgreSQL scheme");
if (url.pathname !== "/postgres") throw Error("unexpected database name");
if (!["require", "verify-full"].includes(url.searchParams.get("sslmode")))
  throw Error("SSL mode must be require or verify-full");
const ref = "fcawktdjoxvahhgvkebx";
let mode;
if (url.hostname === `db.${ref}.supabase.co` && (url.port || "5432") === "5432"
    && decodeURIComponent(url.username) === "postgres") mode = "direct";
else if (url.hostname.endsWith(".pooler.supabase.com") && (url.port || "5432") === "5432"
    && decodeURIComponent(url.username) === `postgres.${ref}`) mode = "session-pooler";
else throw Error("URI host, port, or username does not match the authorized D5O project");
if (!url.password || url.password.includes("YOUR-PASSWORD")) throw Error("database password missing");

const mount = `type=bind,source=${resolved},target=/run/secret/postgres-url.txt,readonly`;
const sql = "select current_database(), current_user, current_setting('server_version_num'), current_setting('default_transaction_read_only'), (select count(*) from supabase_migrations.schema_migrations), (select max(version) from supabase_migrations.schema_migrations)";
const shell = `export PGOPTIONS='-c default_transaction_read_only=on'; uri="$(cat /run/secret/postgres-url.txt)"; psql "$uri" -X -v ON_ERROR_STOP=1 -At -F '|' -c "${sql}"`;
const run = spawnSync("docker", ["run", "--rm", "--pull=never", "--read-only", "--tmpfs", "/tmp",
  "--network", "bridge", "--mount", mount, "postgres:17-alpine", "sh", "-eu", "-c", shell],
  { encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 30000 });
if (run.status !== 0) {
  const stderr = String(run.stderr || "").toLowerCase();
  const cause = /password authentication failed/.test(stderr) ? "AUTHENTICATION" :
    /network is unreachable|no route to host|cannot assign requested address/.test(stderr) ? "NETWORK_ROUTE" :
    /could not translate host name|name or service not known/.test(stderr) ? "DNS" :
    /connection timed out|timeout expired/.test(stderr) ? "TIMEOUT" :
    /certificate|ssl/.test(stderr) ? "TLS" : "OTHER";
  throw Error(`read_only_connection_failed:exit=${run.status},mode=${mode},cause=${cause}`);
}
const fields = run.stdout.trim().split("|");
if (fields.length !== 6 || fields[0] !== "postgres" || fields[3] !== "on"
    || fields[4] !== "177" || fields[5] !== "20261021123923")
  throw Error("production identity or read-only boundary mismatch");
console.log(JSON.stringify({ validated: true, mode, database: fields[0], databaseRole: fields[1],
  postgresVersionNum: fields[2], transactionReadOnly: fields[3], ledgerRows: Number(fields[4]),
  lastMigrationVersion: fields[5], credentialFileName: basename(resolved),
  credentialDirectory: dirname(resolved) }));
