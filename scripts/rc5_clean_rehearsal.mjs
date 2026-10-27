import { writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createP0aRuntime, cleanupP0aRuntime } from "./p0a/disposable-runtime.mjs";

const result = { test: "clean-236-install", sourceCommit: "dcb72a3868e48d536449e109872403974b79fa1b", startedAt: new Date().toISOString() };
let runtime;
try {
  runtime = await createP0aRuntime(process.cwd());
  result.projectId = runtime.projectId;
  const query = (sql) => {
    const p = spawnSync("docker", ["exec", runtime.dbContainer, "psql", "-U", "postgres", "-d", "postgres", "-At", "-c", sql], { encoding: "utf8", maxBuffer: 1024 * 1024 * 10 });
    if (p.status !== 0) throw new Error(`query_failed:${p.stderr || p.stdout}`);
    return p.stdout.trim();
  };
  result.ledgerCount = Number(query("select count(*) from supabase_migrations.schema_migrations"));
  result.lastVersion = query("select max(version) from supabase_migrations.schema_migrations");
  result.d5oTableCount = Number(query("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='d5o_hosted' and c.relkind in ('r','p')"));
  result.d5oRlsTableCount = Number(query("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='d5o_hosted' and c.relkind in ('r','p') and c.relrowsecurity"));
  result.fieldFactSecurityDefiner = query("select p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='d5o_hosted_field_fact_command_v1' limit 1");
  result.fieldFactAuthenticatedExecute = query("select has_function_privilege('authenticated',p.oid,'EXECUTE') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='d5o_hosted_field_fact_command_v1' limit 1");
  result.fieldFactAnonExecute = query("select has_function_privilege('anon',p.oid,'EXECUTE') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='d5o_hosted_field_fact_command_v1' limit 1");
  result.passed = result.ledgerCount === 236 && result.lastVersion === "20261027190000" && result.fieldFactSecurityDefiner === "t" && result.fieldFactAuthenticatedExecute === "t" && result.fieldFactAnonExecute === "f";
} catch (error) {
  result.error = error.message;
  result.passed = false;
} finally {
  if (runtime) result.cleanup = cleanupP0aRuntime(runtime);
  result.finishedAt = new Date().toISOString();
  writeFileSync("docs/release/evidence/D5O_RC5_CLEAN_INSTALL_RESULTS.json", JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result));
}
if (!result.passed || !result.cleanup?.clean) process.exitCode = 1;
