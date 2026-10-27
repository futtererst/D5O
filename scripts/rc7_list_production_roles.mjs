// Read role names only, in a read-only session. Never print connection URI.
import { readFileSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
const file = realpathSync(process.argv[2]);
const url = new URL(readFileSync(file, "utf8").trim());
if (url.hostname !== "aws-1-us-east-2.pooler.supabase.com" ||
    decodeURIComponent(url.username) !== "postgres.fcawktdjoxvahhgvkebx" ||
    url.pathname !== "/postgres" || url.searchParams.get("sslmode") !== "require")
  throw Error("unexpected production endpoint");
const sql = "begin transaction read only; select rolname from pg_roles where rolname !~ '^pg_' order by rolname; commit;";
const shell = `export PGOPTIONS='-c default_transaction_read_only=on'; uri="$(cat /run/secret/postgres-url.txt)"; psql "$uri" -q -X -v ON_ERROR_STOP=1 -At -c "${sql}"`;
const run = spawnSync("docker", ["run", "--rm", "--pull=never", "--read-only", "--tmpfs", "/tmp",
  "--network", "bridge", "--mount", `type=bind,source=${file},target=/run/secret/postgres-url.txt,readonly`,
  "postgres:17-alpine", "sh", "-eu", "-c", shell], { encoding: "utf8", timeout: 30000 });
if (run.status !== 0) throw Error("production role catalog query failed");
console.log(JSON.stringify(run.stdout.trim().split(/\r?\n/).filter(Boolean)));
