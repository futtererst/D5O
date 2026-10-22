import fs from "node:fs";
import Module from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const loaded = new Map();

function loadTypescript(relativePath) {
  const filename = path.resolve(root, relativePath);
  if (loaded.has(filename)) return loaded.get(filename).exports;
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const loadedModule = new Module(filename);
  loadedModule.filename = filename;
  loadedModule.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded.set(filename, loadedModule);
  const nativeRequire = loadedModule.require.bind(loadedModule);
  loadedModule.require = (specifier) => specifier.startsWith(".")
    ? loadTypescript(path.relative(root, path.resolve(path.dirname(filename), `${specifier}.ts`)))
    : nativeRequire(specifier);
  loadedModule._compile(compiled, filename);
  return loadedModule.exports;
}

const { allRybexPermissions, hasPermission, normalizeWorkspaceRole } = loadTypescript("lib/d5o/rbac.ts");
const { workflowTransactionPermissionRules, checkWorkflowTransactionPermission } =
  loadTypescript("lib/d5o/auth/workflow-transaction-permissions.ts");
const failures = [];
const expectedTransactions = [
  "approve_go_no_go", "hold_go_no_go", "approve_d2_gate", "hold_d2_gate",
  "approve_d3_field_start", "hold_d3_field_start", "submit_daily_report",
  "create_rfi_from_signal", "create_change_event_from_signal", "resolve_workflow_action"
];

for (const type of expectedTransactions) {
  const rule = workflowTransactionPermissionRules.find((item) => item.transactionType === type);
  if (!rule || rule.requiredPermissions.length === 0) {
    failures.push(`Missing permission rule for workflow transaction: ${type}`);
    continue;
  }
  for (const permission of rule.requiredPermissions) {
    if (!allRybexPermissions.includes(permission)) failures.push(`Unknown mapped permission: ${permission}`);
  }
}

for (const [role, permission, expected] of [
  ["operations_leader", "approve_go_no_go", true],
  ["operations_leader", "approve_d2_gate", true],
  ["operations_leader", "approve_d3_gate", true],
  ["operations_leader", "edit_changes", true],
  ["operations_leader", "edit_rfis_submittals", true],
  ["field_supervisor", "submit_daily_report", true],
  ["estimator", "approve_d2_gate", false],
  ["finance_admin", "edit_safety", false],
  ["read_only_auditor", "edit_changes", false]
]) {
  if (hasPermission(role, permission) !== expected) failures.push(`${role} permission ${permission} should be ${expected}.`);
}

if (normalizeWorkspaceRole("finance_admin") !== "billing_commercial_lead") {
  failures.push("Legacy finance role no longer maps to its canonical billing role.");
}
for (const [role, type, workflow, expected] of [
  ["operations_leader", "approve_go_no_go", "pursuit_control", true],
  ["estimator", "approve_go_no_go", "pursuit_control", false],
  ["field_supervisor", "submit_daily_report", "field_execution", true],
  ["finance_admin", "submit_daily_report", "field_execution", false],
  ["field_supervisor", "create_rfi_from_signal", "information_control", true],
  ["read_only_auditor", "create_change_event_from_signal", "change_recovery", false]
]) {
  if (checkWorkflowTransactionPermission(role, type, workflow).allowed !== expected) {
    failures.push(`${role} transaction ${type} should be ${expected ? "allowed" : "denied"}.`);
  }
}

if (failures.length) {
  console.error("RBAC verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("RBAC verification passed: live role inheritance, mappings, and allow/deny scenarios.");
