import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(file, imports, env) {
  const source = readFileSync(file, "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: (name) => {
    if (!(name in imports)) throw new Error(`unexpected_import:${name}`);
    return imports[name];
  }, process: { env }, Date, Error }, { filename: file });
  return exports;
}

const imports = {
  "server-only": {},
  "../billing-v2/persistence-mode": { getBillingV2PersistenceMode: () => "database" },
  "../closeout-final-billing/persistence-mode": { getCloseoutFinalBillingPersistenceMode: () => "database" },
  "../data/data-source": { getDataSourceMode: () => "database" },
  "../evidence/evidence-store": { getEvidenceStoreMode: () => "database" },
  "../field-issue-escalation/persistence-mode": { getFieldIssuePersistenceMode: () => "database" },
  "../auth/auth-mode": { getAuthMode: () => "supabase" },
  "./runtime-mode": { getRuntimeMode: () => "production" },
  "../auth/runtime-identity": { resolveD5OCommandRuntime: (env) => env.D5O_COMMAND_RUNTIME === "production" && env.NEXT_PUBLIC_SUPABASE_URL === "https://fcawktdjoxvahhgvkebx.supabase.co" ? "production" : null },
};
const base = { NEXT_PUBLIC_SUPABASE_URL: "https://synthetic.invalid",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "synthetic", SUPABASE_SECRET_KEY: "synthetic" };
for (const mode of ["external", "unavailable", "disabled", undefined]) {
  const env = { ...base, RYBEXOS_SCANNER_MODE: mode };
  const readiness = load("lib/d5o/security/production-config.ts", imports, env).getProductionReadiness();
  assert.equal(readiness.ok, false);
  assert(readiness.issues.some((issue) => issue.code === "scanner_mode"), `${mode}:missing_scanner_blocker`);
}
const missingUrl = load("lib/d5o/security/production-config.ts", imports,
  { ...base, RYBEXOS_SCANNER_MODE: "local_service" }).getProductionReadiness();
assert.equal(missingUrl.ok, false);
assert(missingUrl.issues.some((issue) => issue.code === "scanner_url"));
const configured = load("lib/d5o/security/production-config.ts", imports,
  { ...base, RYBEXOS_SCANNER_MODE: "local_service", RYBEXOS_SCANNER_URL: "http://127.0.0.1:9999" }).getProductionReadiness();
assert.equal(configured.ok, true);
const hosted = { ...base, NEXT_PUBLIC_SUPABASE_URL: "https://fcawktdjoxvahhgvkebx.supabase.co",
  D5O_HOSTED_ENABLED: "1", D5O_COMMAND_RUNTIME: "production", RYBEXOS_SCANNER_MODE: "disabled" };
const hostedImports = { ...imports,
  "../billing-v2/persistence-mode": { getBillingV2PersistenceMode: () => "local" },
  "../field-issue-escalation/persistence-mode": { getFieldIssuePersistenceMode: () => "local" },
  "../closeout-final-billing/persistence-mode": { getCloseoutFinalBillingPersistenceMode: () => "local" },
};
const hostedReady = load("lib/d5o/security/production-config.ts", hostedImports, hosted).getProductionReadiness();
assert.equal(hostedReady.ok, true);
assert.equal(hostedReady.scope, "d5o_hosted");
assert(hostedReady.issues.some((issue) => issue.code === "scanner_disabled" && issue.severity === "warning"));
assert(hostedReady.issues.some((issue) => issue.code === "legacy_billing_unavailable" && issue.severity === "warning"));
for (const env of [
  { ...hosted, RYBEXOS_SCANNER_MODE: "local_service", RYBEXOS_SCANNER_URL: "https://scanner.invalid" },
  { ...hosted, D5O_COMMAND_RUNTIME: "rehearsal" },
  { ...hosted, NEXT_PUBLIC_SUPABASE_URL: "https://wrong.invalid" },
]) {
  const result = load("lib/d5o/security/production-config.ts", hostedImports, env).getProductionReadiness();
  assert.equal(result.ok, false, "hosted scanner or target mismatch must block readiness");
}
console.log("PASS: legacy scanner requirement remains; hosted D5O reports approved disabled mode and rejects wrong bindings");
