import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID, webcrypto } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { createClient } from "@supabase/supabase-js";

const output = process.argv[2];
assert(output && process.env.D5O_ISOLATED_PILOT === "1", "An isolated pilot output directory and flag are required.");
assert(["http://127.0.0.1:56321", "http://127.0.0.1:56621"].includes(process.env.NEXT_PUBLIC_SUPABASE_URL), "Refusing a non-isolated Supabase target.");
assert(process.env.SUPABASE_SECRET_KEY, "The isolated local service credential is required.");
const credentialsPath = path.join(output, "pilot-credentials.json");
const sqlPath = path.join(output, "pilot-seed.sql");
assert(!existsSync(credentialsPath) && !existsSync(sqlPath), "Pilot seed output already exists; preserve its users and credentials.");

const cache = new Map();
function load(file) {
  const absolute = path.resolve(file);
  if (cache.has(absolute)) return cache.get(absolute);
  const source = readFileSync(absolute, "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022
  } }).outputText;
  const exports = {};
  cache.set(absolute, exports);
  const require = (key) => {
    assert(key.startsWith("./"), `Unexpected module: ${key}`);
    return load(path.resolve(path.dirname(absolute), `${key}.ts`));
  };
  vm.runInNewContext(compiled, { exports, require, structuredClone, Date, Set, Map, crypto: webcrypto, Intl }, { filename: absolute });
  return exports;
}
const contract = load("components/d5o/platform/published-phase-configuration.ts").defaultPhaseContract("rybex");
const manifest = { d5oPresentation: { schemaVersion: 1, changeReason: "Isolated authenticated pilot", phaseContract: contract },
  workTypes: contract.workTypes.map((item) => ({ key: item.workTypeKey, label: item.workTypeLabel })) };
const digest = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});
const roles = [
  ["admin", "admin", "Pilot System Administrator"],
  ["pm", "project_manager", "Pilot Project Manager"],
  ["commercial", "billing_commercial_lead", "Pilot Commercial Lead"],
  ["operations", "operations_leader", "Pilot Operations Receiver"],
  ["supervisor", "field_supervisor", "Pilot Field Supervisor"],
  ["quality", "operations_leader", "Pilot Quality Reviewer"],
  ["finance", "billing_commercial_lead", "Pilot Finance Lead"],
  ["executive", "read_only_auditor", "Pilot Auditor"],
  ["worker", "field_worker", "Nate Walker"]
];
const credentials = [];
for (const [key, role, name] of roles) {
  const email = `d5o-pilot-${key}@example.test`;
  const password = randomBytes(18).toString("base64url");
  const { data, error } = await supabase.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { display_name: name }
  });
  if (error || !data.user) throw new Error(`Pilot Auth user ${key} could not be created: ${error?.message ?? "unknown error"}`);
  credentials.push({ key, role, name, email, password, userId: data.user.id });
}
const workspaceId = randomUUID(), tenantId = randomUUID(), versionId = randomUUID();
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const lines = [
  "begin;",
  `insert into d5o_hosted.workspaces(id,workspace_key,display_name) values ('${workspaceId}','rybex','Rybex Isolated Pilot');`,
  ...credentials.map((item) => `insert into d5o_hosted.memberships(workspace_id,actor_user_id,role) values ('${workspaceId}','${item.userId}',${quote(item.role)});`),
  `insert into d5o_hosted.crew_bindings(workspace_id,actor_user_id,person) values ('${workspaceId}','${credentials.find((item) => item.key === "worker").userId}','Nate Walker');`,
  `insert into d5o_hosted.configuration_tenants(id,workspace_id,status) values ('${tenantId}','${workspaceId}','active');`,
  `insert into d5o_hosted.configuration_versions(id,tenant_id,version_number,status,source_sha256,manifest_json,effective_from) values ('${versionId}','${tenantId}',1,'draft','${digest}',${quote(JSON.stringify(manifest))}::jsonb,now()-interval '1 day');`,
  ...contract.workTypes.map((item) => `insert into d5o_hosted.configuration_work_types(configuration_version_id,work_type_key,display_name,status) values ('${versionId}',${quote(item.workTypeKey)},${quote(item.workTypeLabel)},'active');`),
  ...contract.workTypes.flatMap((item) => ["admin", "project_manager", "business_development_lead", "operations_leader"].map((role) =>
    `insert into d5o_hosted.configuration_create_rights(configuration_version_id,work_type_key,workspace_role) values ('${versionId}',${quote(item.workTypeKey)},${quote(role)});`)),
  `update d5o_hosted.configuration_versions set status='published' where id='${versionId}';`,
  "commit;"
];
writeFileSync(credentialsPath, JSON.stringify({ workspaceId, tenantId, versionId, users: credentials }, null, 2), { flag: "wx", mode: 0o600 });
writeFileSync(sqlPath, lines.join("\n") + "\n", { flag: "wx", mode: 0o600 });
console.log(`Prepared ${credentials.length} distinct local pilot users and a published Rybex configuration. SQL: ${sqlPath}`);
