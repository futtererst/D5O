import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const root = process.cwd();
const failures = [];
const repositoryWide = process.argv.includes("--repository-wide");

const requiredFiles = [
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
  "components/d5o/billing-v2/BillingV2StepOutcomeRecord.tsx",
  "scripts/qa-billing-v2-workflow.mjs",
  "docs/billing-v2-guided-ui-replacement-report.md"
];

for (const file of requiredFiles) {
  if (!existsSync(join(root, file))) failures.push(`Missing required Billing v2 UI file: ${file}`);
}

const billingPage = read("app/billing/page.tsx");
if (!billingPage.includes("BillingV2GuidedWorkflow")) {
  failures.push("app/billing/page.tsx must render BillingV2GuidedWorkflow for the focused route.");
}
if (!billingPage.includes('aria-label="Billing active workflow mode"')) {
  failures.push("app/billing/page.tsx must present Billing v2 as the active Billing workflow.");
}

const workflowClient = read("components/d5o/billing-v2/BillingV2WorkflowClient.tsx");
const source = allBillingUiSource();
for (const selector of [
  "billing-v2-guided-workflow",
  "billing-v2-process-rail",
  "billing-v2-active-step",
  "billing-v2-context-panel",
  "billing-v2-step-understand",
  "billing-v2-step-build-package",
  "billing-v2-step-add-proof",
  "billing-v2-step-review",
  "billing-v2-step-review-decision",
  "billing-v2-step-clear-blocker",
  "billing-v2-step-outcome"
]) {
  if (!source.includes(selector)) {
    failures.push(`Missing Billing v2 guided QA selector: ${selector}`);
  }
}

if (!workflowClient.includes("evaluateBillingPackageReadiness") || !workflowClient.includes("clearBillingBlocker")) {
  failures.push("Billing v2 UI must dispatch domain commands and render domain readiness.");
}
if (workflowClient.includes("Math.random") || workflowClient.includes("Date.now")) {
  failures.push("Billing v2 UI must not use Math.random or Date.now for SSR-visible behavior.");
}
if (workflowClient.includes("localStorage")) {
  failures.push("Billing v2 Phase 1B guided UI must not add localStorage behavior.");
}

const qa = read("scripts/qa-billing-v2-workflow.mjs");
for (const required of [
  'getByRole("link", { name: "Recover blocked billing" })',
  "billing-v2-active-step",
  "billing-v2-step-add-proof",
  "billing-v2-evidence-card-",
  "billing-v2-add-reference-",
  "assertSingleActiveStep",
  "billing-v2-review-note-input",
  "billing-v2-resolution-note-input",
  "billing-v2-step-outcome",
  "Billing blocker cleared",
  "PA-001",
  "Ready for commercial review"
]) {
  if (!qa.includes(required)) {
    failures.push(`Billing v2 QA must cover guided interaction guardrail: ${required}`);
  }
}

const docs = [
  read("docs/developer-notes.md"),
  read("docs/demo-readiness.md"),
  read("README.md"),
  read("docs/billing-v2-guided-ui-replacement-report.md")
].join("\n").toLowerCase();
for (const required of [
  "guided workflow replacement implemented",
  "local/demo only",
  "manual acceptance still required",
  "field and closeout not refactored"
]) {
  if (!docs.includes(required)) failures.push(`Documentation missing Billing v2 guided UI note: ${required}`);
}

const changedFiles = repositoryWide ? [] : gitChangedFiles();
for (const file of changedFiles) {
  if (
    file.startsWith("app/field-execution/") ||
    file.startsWith("app/closeout/") ||
    file.startsWith("components/d5o/field") ||
    file.startsWith("components/d5o/closeout") ||
    file.startsWith("lib/d5o/field") ||
    file.startsWith("lib/d5o/closeout") ||
    file.startsWith("supabase/") ||
    file.includes("/auth/") ||
    file.includes("rls")
  ) {
    failures.push(`Out-of-scope file changed for Billing v2 UI pass: ${file}`);
  }
}

if (failures.length > 0) {
  console.error("Billing v2 UI verifier failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Billing v2 UI verifier passed: guided components, focused route, QA coverage, docs, and scope boundaries are present.");

function read(file) {
  if (!existsSync(join(root, file))) {
    if (!requiredFiles.includes(file)) failures.push(`Missing Billing v2 UI verification input: ${file}`);
    return "";
  }
  return readFileSync(join(root, file), "utf8");
}

function allBillingUiSource() {
  return requiredFiles
    .filter((file) => file.startsWith("components/d5o/billing-v2/") && existsSync(join(root, file)))
    .map((file) => read(file))
    .join("\n");
}

function gitChangedFiles() {
  try {
    const output = execSync("git diff --name-only HEAD --", { cwd: root, encoding: "utf8" });
    return output.split(/\r?\n/).filter(Boolean).map((file) => file.replaceAll("\\", "/"));
  } catch {
    return [];
  }
}
