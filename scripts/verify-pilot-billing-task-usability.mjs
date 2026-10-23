import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const failures = [];

const requiredFiles = [
  "components/d5o/workflow-completion/GuidedCompletionFlow.tsx",
  "components/d5o/workflow-completion/WorkflowCompletionPanel.tsx",
  "components/d5o/billing-v2/BillingV2GuidedWorkflow.tsx",
  "components/d5o/billing-v2/BillingV2WorkflowClient.tsx",
  "components/d5o/billing-v2/BillingV2ProcessRail.tsx",
  "components/d5o/billing-v2/BillingV2ActiveStepWorkspace.tsx",
  "components/d5o/billing-v2/BillingV2ReadinessContextPanel.tsx",
  "lib/d5o/workflow-completion/editable-field-contracts.ts",
  "components/d5o/end-user/FocusedTaskPanel.tsx",
  "docs/manual-pilot-failure-billing-task.md",
  "scripts/qa-pilot-mode.mjs",
  "scripts/qa-workflow-completion.mjs"
];

for (const file of requiredFiles) {
  if (!existsSync(resolve(root, file))) {
    failures.push(`Missing required file: ${file}`);
  }
}

const guided = read("components/d5o/workflow-completion/GuidedCompletionFlow.tsx");
const billingV2Ui = [
  "components/d5o/billing-v2/BillingV2GuidedWorkflow.tsx",
  "components/d5o/billing-v2/BillingV2WorkflowClient.tsx",
  "components/d5o/billing-v2/BillingV2ProcessRail.tsx",
  "components/d5o/billing-v2/BillingV2ActiveStepWorkspace.tsx",
  "components/d5o/billing-v2/BillingV2ReadinessContextPanel.tsx",
  "components/d5o/billing-v2/BillingV2StepUnderstandBlocker.tsx",
  "components/d5o/billing-v2/BillingV2StepBuildPackage.tsx",
  "components/d5o/billing-v2/BillingV2StepAddProof.tsx",
  "components/d5o/billing-v2/BillingV2StepCommercialReview.tsx",
  "components/d5o/billing-v2/BillingV2StepReviewDecision.tsx",
  "components/d5o/billing-v2/BillingV2StepClearBlocker.tsx",
  "components/d5o/billing-v2/BillingV2StepOutcomeRecord.tsx"
].map(read).join("\n");

for (const phrase of [
  "billing-v2-guided-workflow",
  "billing-v2-process-rail",
  "billing-v2-active-step",
  "billing-v2-context-panel",
  "Document the package details",
  "billingPackage.payApplicationLabel",
  "blockedAmount",
  "Commercial Review",
  "billing-v2-outcome-record",
  "billing-v2-step-outcome",
  "return-to-pilot-mode"
]) {
  if (!billingV2Ui.includes(phrase)) {
    failures.push(`Billing v2 guided UI missing visible phrase or selector: ${phrase}`);
  }
}

if (!guided.includes("field-issue-escalation") || !guided.includes("closeout-requirement-final-billing-release")) {
  failures.push("GuidedCompletionFlow must remain available for Field and Closeout completion workflows.");
}

const fieldContracts = read("lib/d5o/workflow-completion/editable-field-contracts.ts");
for (const phrase of [
  "Backup note",
  "Evidence reference",
  "Resolution note",
  "backup-note-input",
  "billing-evidence-reference-input",
  "billing-resolution-note-input",
  "save-backup-note",
  "save-billing-evidence-reference",
  "save-billing-resolution-note"
]) {
  if (!fieldContracts.includes(phrase)) {
    failures.push(`Billing editable field contract missing: ${phrase}`);
  }
}

const registry = read("lib/d5o/workflow-completion/workflow-completion-registry.ts");
for (const phrase of [
  "billing-backup-cash-recovery",
  "Mark backup attached",
  "Send to review",
  "Resolve billing blocker",
  "mark-backup-attached",
  "send-to-review",
  "resolve-billing-blocker"
]) {
  if (!registry.includes(phrase)) {
    failures.push(`Billing completion registry missing guided task contract phrase: ${phrase}`);
  }
}

const panel = read("components/d5o/workflow-completion/WorkflowCompletionPanel.tsx");
if (!panel.includes("GuidedCompletionFlow")) {
  failures.push("WorkflowCompletionPanel must render GuidedCompletionFlow.");
}
if (!panel.includes("resetWorkflow")) {
  failures.push("WorkflowCompletionPanel must expose provider reset for completed pilot task clarity.");
}

const focusedTask = read("components/d5o/end-user/FocusedTaskPanel.tsx");
if (!focusedTask.includes("return-to-pilot-mode") || !focusedTask.includes('href="/pilot?refresh=completion"')) {
  failures.push("FocusedTaskPanel must retain its Pilot Mode return route.");
}

const billingPage = read("app/billing/page.tsx");
if (!billingPage.includes("Approval and history") || !billingPage.includes("Resolved billing package:")) {
  failures.push("Billing must retain the approval and historical package record.");
}

const pilotQa = read("scripts/qa-pilot-mode.mjs");
for (const phrase of [
  "runBillingManualFailureRegression",
  "billing-v2-guided-workflow",
  "billing-v2-process-rail",
  "billing-v2-backup-summary-input",
  "billing-v2-add-reference",
  "billing-v2-send-review",
  "billing-v2-review-note-input",
  "billing-v2-clear-blocker",
  "billing-v2-step-outcome",
  "resolved"
]) {
  if (!pilotQa.includes(phrase)) {
    failures.push(`pilot-mode QA missing manual failure regression phrase: ${phrase}`);
  }
}

const billingQa = read("scripts/qa-billing-v2-workflow.mjs");
for (const phrase of ["assertSingleActiveStep", "billing-v2-backup-summary-input", "billing-v2-add-reference-", "billing-v2-approve-review", "billing-v2-clear-blocker", "openBillingSupportingRecords", "Resolved billing package:"]) {
  if (!billingQa.includes(phrase)) failures.push(`Billing v2 browser QA missing guided journey or history check: ${phrase}`);
}

const workflowQa = read("scripts/qa-workflow-completion.mjs");
if (!workflowQa.includes("Guided Billing v2 workflow visible")) {
  failures.push("workflow-completion QA must assert Billing v2 guided workflow visibility.");
}

const docs = read("docs/manual-pilot-failure-billing-task.md");
for (const phrase of ["observed failure", "root cause", "fix applied", "before", "after"]) {
  if (!docs.toLowerCase().includes(phrase)) {
    failures.push(`Manual failure doc missing section: ${phrase}`);
  }
}

if (failures.length > 0) {
  console.error("Pilot billing task usability verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Pilot billing task usability verification passed.");

function read(file) {
  const filePath = resolve(root, file);
  return existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
}
