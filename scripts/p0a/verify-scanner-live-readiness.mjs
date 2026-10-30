import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(readFileSync("lib/d5o/security/production-readiness.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const base = { ok: true, scope: "d5o_hosted", runtimeMode: "production", authMode: "supabase",
  dataSource: "database", billingPersistence: "unresolved", fieldIssuePersistence: "unresolved",
  closeoutPersistence: "unresolved", evidenceMode: "database", scannerMode: "local_service", issues: [] };

async function check(fetchImpl, scope = "d5o_hosted") {
  const exports = {};
  vm.runInNewContext(source, { exports, require: (name) => {
    if (name === "server-only") return {};
    if (name === "./production-config") return { getProductionReadiness: () => ({ ...base, scope }) };
    throw new Error(`unexpected_import:${name}`);
  }, process: { env: { RYBEXOS_SCANNER_URL: "https://scanner.example.invalid",
    RYBEXOS_SCANNER_TOKEN: "synthetic-test-token" } }, fetch: fetchImpl, AbortSignal, Error });
  return exports.summarizeProductionReadiness();
}

const healthy = await check(async (url, options) => {
  assert.equal(url, "https://scanner.example.invalid/health");
  assert.equal(options.headers.authorization, "Bearer synthetic-test-token");
  return { ok: true, json: async () => ({ status: "ready" }) };
});
assert.equal(healthy.ok, true);
assert.equal((await check(async () => ({ ok: false }))).ok, false);
assert((await check(async () => ({ ok: false }))).issueCodes.includes("scanner_unavailable"));
assert.equal((await check(async () => { throw new Error("outage"); })).ok, false);
assert.equal((await check(async () => ({ ok: true, json: async () => ({ status: "unknown" }) }))).ok, false);
assert.equal((await check(() => { throw new Error("legacy must not probe"); }, "legacy_production")).ok, true);
console.log("PASS: hosted readiness probes authenticated scanner health and fails closed on outage");
