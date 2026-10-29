import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), "utf8");
const transactionsSource = read("lib/d5o/workflow/transactions.ts");
const actionSource = read("app/actions/workflow-transactions.ts");
const routeSource = read("app/api/workflow-transactions/route.ts");
const panelSource = read("components/d5o/workflow/WorkflowTransactionPanel.tsx");
const verifierSource = read("scripts/verify-workflow-actions.mjs");

assert.equal(existsSync(resolve(root, "components/d5o/workflow/WorkflowTransactionRuntime.tsx")), false, "Prohibited inline-script fallback must be absent.");
assert.ok(panelSource.includes("/api/workflow-transactions"), "Canonical React panel must call the server-owned endpoint.");
assert.ok(routeSource.includes("commitWorkflowTransaction"), "Endpoint must delegate to the canonical server action.");
assert.doesNotMatch(routeSource, /request\.(?:runtime|store|adapter)/, "Browser input must not select runtime authority.");
assert.ok(actionSource.includes("if (isProductionRuntime())"), "Generic production workflow actions must fail closed.");
assert.ok(read("lib/d5o/data/workflow-transaction-writes.ts").includes("if (isProductionRuntime())"), "Generic database persistence must independently reject production writes.");
assert.ok(actionSource.includes("isWorkflowTransactionType"), "Server action must reject missing or invalid transaction authority.");
assert.ok(actionSource.includes("getWorkflowTransactionDefinition"), "Server action must enforce workflow-to-transaction authority.");
assert.ok(actionSource.includes("runtime authority is missing or invalid"), "Invalid authority must return a controlled result.");
assert.ok(verifierSource.includes("Legacy WorkflowTransactionRuntime script fallback should not be present."), "The substantive legacy-fallback assertion must remain intact.");

const compiled = ts.transpileModule(transactionsSource, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 }
}).outputText;
const runtime = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

assert.equal(runtime.isWorkflowTransactionType("resolve_workflow_action"), true, "A canonical transaction type must be accepted.");
assert.equal(runtime.isWorkflowTransactionType("WorkflowTransactionRuntime"), false, "The obsolete runtime token must be rejected.");
assert.equal(runtime.isWorkflowTransactionType("browser-selected-runtime"), false, "Browser-supplied runtime names must be rejected.");
assert.equal(runtime.getWorkflowTransactionDefinition("approve_go_no_go", "pursuit_control")?.type, "approve_go_no_go", "A valid configured workflow action must resolve.");
assert.equal(runtime.getWorkflowTransactionDefinition("approve_go_no_go", "billing_cash_control"), undefined, "A valid action on an unauthorized workflow mapping must fail closed.");
assert.equal(runtime.getWorkflowTransactionDefinition(undefined, "pursuit_control"), undefined, "Missing runtime authority must fail closed.");

console.log("Workflow runtime authority focused verification passed.");
