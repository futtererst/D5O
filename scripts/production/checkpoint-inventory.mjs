// Read-only, paginated production Storage metadata inventory. Prints hashes only.
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const uriFile = process.argv[2];
if (!uriFile) throw Error("restricted URI file required");
const path = realpathSync(uriFile);
const lines = readFileSync(path, "utf8").trim().split(/\r?\n/);
if (lines.length !== 1) throw Error("one PostgreSQL URI required");
const url = new URL(lines[0]);
if (!url.hostname.endsWith(".pooler.supabase.com") || url.port !== "5432" ||
    decodeURIComponent(url.username) !== "postgres.fcawktdjoxvahhgvkebx" ||
    url.pathname !== "/postgres" || url.searchParams.get("sslmode") !== "require" || !url.password)
  throw Error("unexpected production database target");
const mount = `type=bind,source=${path},target=/run/secret/postgres-url.txt,readonly`;
function query(sql) {
  const command = `uri="$(cat /run/secret/postgres-url.txt)"; export PGOPTIONS='-c default_transaction_read_only=on'; psql "$uri" -q -X -v ON_ERROR_STOP=1 -At -c "${sql}"`;
  const r = spawnSync("docker", ["run", "--rm", "--pull=never", "--read-only", "--tmpfs", "/tmp",
    "--network", "bridge", "--mount", mount, "postgres:17-alpine", "sh", "-eu", "-c", command],
  { encoding: "utf8", maxBuffer: 4 * 1024 * 1024, timeout: 30000 });
  if (r.status !== 0) throw Error("read-only paginated inventory query failed");
  return r.stdout.trim();
}
const expectedCount = Number(query("select count(*) from storage.objects"));
if (query("select current_database()") !== "postgres") throw Error("unexpected PostgreSQL database");
const ledger = query("select row_to_json(t)::text from (select version,name,statements from supabase_migrations.schema_migrations order by version) t");
const expectedLedger = JSON.parse(readFileSync(resolve(import.meta.dirname,
  "../../docs/release/evidence/D5O_RC9_START_FINGERPRINT.json"), "utf8")).fingerprints_sha256.ledger;
if (sha256(ledger) !== expectedLedger) throw Error("approved starting ledger fingerprint mismatch");
const providerSecretRows = Number(query("select (select count(*) from auth.instances)+(select count(*) from auth.custom_oauth_providers)+(select count(*) from auth.saml_providers)+(select count(*) from auth.oauth_clients)+(select count(*) from auth.scim_tokens)"));
if (providerSecretRows !== 0) throw Error("provider-managed configuration requires separate approved recovery handling");
if (!Number.isSafeInteger(expectedCount) || expectedCount < 0 || expectedCount > 100000)
  throw Error("Storage inventory outside bounded range");
const hasher = createHash("sha256");
const identities = new Set();
let count = 0;
for (let offset = 0; offset < expectedCount; offset += 100) {
  const sql = `select row_to_json(t)::text from (select id,bucket_id,name,version,metadata,updated_at from storage.objects order by bucket_id,name,id limit 100 offset ${offset}) t`;
  const rows = query(sql).split(/\r?\n/).filter(Boolean).map(JSON.parse);
  if (!rows.length || rows.length > 100) throw Error("incomplete Storage inventory page");
  for (const row of rows) {
    const identity = `${row.id}\0${row.bucket_id}\0${row.name}`;
    if (identities.has(identity)) throw Error("duplicate Storage object identity across pages");
    identities.add(identity);
    hasher.update(JSON.stringify(row) + "\n");
    count++;
  }
}
if (count !== expectedCount || Number(query("select count(*) from storage.objects")) !== count)
  throw Error("Storage inventory changed during pagination");
console.log(JSON.stringify({ projectRef: "fcawktdjoxvahhgvkebx", objectCount: count,
  inventorySha256: hasher.digest("hex"), ledgerRows: ledger.split(/\r?\n/).filter(Boolean).length,
  approvedLedgerFingerprintMatched: true, pageSize: 100, complete: true }));

function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
