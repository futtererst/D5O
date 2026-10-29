import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const failures = [];

const requiredFiles = [
  "components/d5o/workflow/WorkflowActionCard.tsx",
  "components/d5o/workflow/WorkflowTransactionPanel.tsx",
  "components/d5o/workflow/WorkflowTransactionModal.tsx",
  "lib/d5o/workflow/transactions.ts",
  "lib/d5o/workflow/apply-transaction.ts",
  "app/actions/workflow-transactions.ts",
  "app/api/workflow-transactions/route.ts"
];

for (const file of requiredFiles) {
  if (!existsSync(resolve(root, file))) {
    failures.push(`Missing workflow action file: ${file}`);
  }
}

function source(file) {
  const path = resolve(root, file);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

const transactionsSource = source("lib/d5o/workflow/transactions.ts");
const applySource = source("lib/d5o/workflow/apply-transaction.ts");
const cardSource = source("components/d5o/workflow/WorkflowActionCard.tsx");
const panelSource = source("components/d5o/workflow/WorkflowTransactionPanel.tsx");
const modalSource = source("components/d5o/workflow/WorkflowTransactionModal.tsx");
const actionSource = source("app/actions/workflow-transactions.ts");
const routeSource = source("app/api/workflow-transactions/route.ts");
const legacyRuntimePath = resolve(root, "components/d5o/workflow/WorkflowTransactionRuntime.tsx");

const expectedMappings = {
  pursuit_control: ["approve_go_no_go", "hold_go_no_go", "resolve_workflow_action"],
  contract_baseline: ["approve_d2_gate", "hold_d2_gate", "resolve_workflow_action"],
  mobilization_readiness: ["approve_d3_field_start", "hold_d3_field_start", "resolve_workflow_action"],
  field_execution: ["submit_daily_report", "create_rfi_from_signal", "create_change_event_from_signal", "resolve_workflow_action"],
  information_control: ["create_change_event_from_signal", "resolve_workflow_action"],
  change_recovery: ["resolve_workflow_action"],
  billing_cash_control: ["resolve_workflow_action"],
  safety_control: ["resolve_workflow_action"],
  quality_control: ["resolve_workflow_action"],
  closeout_acceptance: ["resolve_workflow_action"],
  optimize_learning: ["resolve_workflow_action"]
};

for (const [workflowType, transactionTypes] of Object.entries(expectedMappings)) {
  if (!transactionsSource.includes(`"${workflowType}"`)) {
    failures.push(`Workflow type is not present in transaction definitions: ${workflowType}`);
  }

  for (const transactionType of transactionTypes) {
    if (!transactionsSource.includes(`${transactionType}:`) && !transactionsSource.includes(`"${transactionType}"`)) {
      failures.push(`Transaction mapping is missing: ${workflowType} -> ${transactionType}`);
    }
  }
}

if (!transactionsSource.includes("getWorkflowTransactionDefinitions")) {
  failures.push("Transaction definitions cannot be discovered by workflow cards.");
}

if (!cardSource.includes("WorkflowTransactionPanel")) {
  failures.push("WorkflowActionCard does not render the transaction panel.");
}

if (!panelSource.includes("/api/workflow-transactions")) {
  failures.push("WorkflowTransactionPanel does not call the workflow transaction endpoint.");
}

if (existsSync(legacyRuntimePath)) {
  failures.push("Legacy WorkflowTransactionRuntime script fallback should not be present.");
}

if (!transactionsSource.includes("isWorkflowTransactionType") || !transactionsSource.includes("getWorkflowTransactionDefinition")) {
  failures.push("Workflow transaction definitions do not expose canonical runtime-authority validation.");
}

if (!actionSource.includes("runtime authority is missing or invalid") || !actionSource.includes("not configured for this workflow type")) {
  failures.push("Workflow transaction server action does not fail closed for missing, invalid, or mismatched authority.");
}

if (!actionSource.includes("if (isProductionRuntime())")) {
  failures.push("Generic workflow transaction action must reject production writes.");
}

if (!routeSource.includes("commitWorkflowTransaction") || /request\.(?:runtime|store|adapter)/.test(routeSource)) {
  failures.push("Workflow transaction route does not preserve server-owned runtime authority.");
}

if (!panelSource.includes("store.applyTransaction") || !panelSource.includes("store.markWorkflowActionResolved")) {
  failures.push("WorkflowTransactionPanel does not update local transaction overlay state.");
}

if (!panelSource.includes("No action available")) {
  failures.push("WorkflowTransactionPanel does not explain unavailable actions.");
}

if (!modalSource.includes("onConfirm({ notes, decisionReason, owner, evidenceConfirmed })")) {
  failures.push("WorkflowTransactionModal does not submit required MVP fields.");
}

if (applySource.includes("At least one evidence item must be confirmed")) {
  failures.push("Local transaction validation still blocks actions when evidence upload/checkoff is pending.");
}

if (!applySource.includes("currentStatus: \"resolved\"") || !applySource.includes("resolutionState: \"resolved\"")) {
  failures.push("Local transaction application does not produce a resolved workflow state.");
}

if (failures.length > 0) {
  console.error("Workflow action verification failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Workflow action verification passed: mappings, modal wiring, and local overlay behavior are present.");
