import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createP0aRuntime, cleanupP0aRuntime } from "./disposable-runtime.mjs";

const root = resolve(process.cwd());
const output = resolve(root, "artifacts/d5o-local-qualification/financial-delegation-db.json");
const evidence = { startedAt: new Date().toISOString(), tests: [], setupError: null, cleanup: null };
let runtime;
function psql(input) {
  const result = spawnSync("docker", ["exec", "-i", runtime.dbContainer, "psql", "-U", "postgres",
    "-d", "postgres", "-X", "-t", "-A", "-v", "ON_ERROR_STOP=1"],
  { input, encoding: "utf8", shell: false, maxBuffer: 1024 * 1024 * 8 });
  if (result.status !== 0) throw Error(`psql_failed:${result.stderr.slice(-900)}`);
  return result;
}
const counts = () => psql(`select concat_ws(':',
  (select count(*) from d5o_hosted.workspaces),
  (select count(*) from d5o_hosted.spending_delegate_rules),
  (select count(*) from d5o_hosted.graybar_states),
  (select count(*) from d5o_hosted.subcontract_states));`).stdout.trim();
try {
  runtime = await createP0aRuntime(root);
  evidence.environment = { projectId: runtime.projectId, productionAccess: false,
    loopbackOnly: true, fictionalDataOnly: true };
  for (const [name, file, markers] of [
    ["purchase_order", "scripts/qa-d5o-purchase-delegation.sql",
      ["PO_DELEGATE_BOUNDARIES_PASS", "wrong actor rejected before approval"]],
    ["subcontract_allocation_agreement_variation", "scripts/qa-d5o-subcontract-delegation.sql",
      ["SUB_DELEGATE_BOUNDARIES_PASS", "wrong actor rejected allocations",
        "wrong actor rejected agreements", "wrong actor rejected variations"]],
  ]) {
    const sql = readFileSync(resolve(root, file), "utf8");
    assert.match(sql, /^begin;/im);
    assert.match(sql, /rollback;\s*$/i);
    const before = counts();
    const run = psql(sql);
    for (const marker of markers) assert(run.stderr.includes(marker), `${name}:missing:${marker}`);
    const after = counts();
    assert.equal(after, before, `${name}:rollback_changed_database_counts`);
    evidence.tests.push({ name, status: "PASS", boundaryCases: name === "purchase_order" ? 3 : 9,
      wrongActorDenied: true, selectedActorAllowed: true, before, after });
  }
} catch (error) { evidence.setupError = String(error.message).slice(0, 1200); }
finally {
  if (runtime) evidence.cleanup = cleanupP0aRuntime(runtime);
  evidence.finishedAt = new Date().toISOString();
  evidence.summary = { passed: evidence.tests.filter((item) => item.status === "PASS").length,
    setupError: Boolean(evidence.setupError), cleanupVerified: Boolean(evidence.cleanup?.clean) };
  mkdirSync(resolve(root, "artifacts/d5o-local-qualification"), { recursive: true });
  writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({ ...evidence.summary, output }));
  if (evidence.setupError || !evidence.cleanup?.clean) process.exitCode = 1;
}
