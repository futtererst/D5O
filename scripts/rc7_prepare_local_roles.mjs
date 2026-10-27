// Prepare only the offline restore container with non-login role placeholders.
import { spawnSync } from "node:child_process";
const container = process.env.D5O_RC7_CONTAINER || "d5o-rc7-historical-db";
if (!["d5o-rc7-historical-db", "d5o-rc7-recovery-db"].includes(container))
  throw Error("unexpected local restore container");
const check = spawnSync("docker", ["inspect", container], { encoding: "utf8" });
if (check.status !== 0) throw Error("local restore container missing");
const target = JSON.parse(check.stdout)[0];
if (target.HostConfig.NetworkMode !== "none" || Object.keys(target.HostConfig.PortBindings ?? {}).length)
  throw Error("restore target has network access");
const roles = ["cli_login_postgres", "d5o_backup_20261021_6a1fbb38aa", "dashboard_user",
  "pgbouncer", "supabase_etl_admin", "supabase_privileged_role", "supabase_read_only_user",
  "supabase_realtime_admin", "supabase_replication_admin"];
const sql = `do $$ begin ${roles.map((role) => `if not exists (select 1 from pg_roles where rolname='${role}') then create role "${role}" nologin; end if;`).join(" ")} end $$;`;
const run = spawnSync("docker", ["exec", container, "psql", "-U", "supabase_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8" });
if (run.status !== 0) throw Error("local role preparation failed: " + run.stderr.slice(0, 500));
console.log(JSON.stringify({ isolatedContainer: container, rolesPrepared: roles.length }));
