import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();

const componentFiles = [
  "components/d5o/simplified/ModuleStageHeader.tsx",
  "components/d5o/simplified/NextActionPanel.tsx",
  "components/d5o/simplified/GateReadinessPanel.tsx",
  "components/d5o/simplified/EvidenceRequiredPanel.tsx",
  "components/d5o/simplified/ActiveRisksPanel.tsx",
  "components/d5o/simplified/ProgressiveDetailsSection.tsx",
  "components/d5o/simplified/PageOperatingLayout.tsx",
  "components/d5o/end-user/ActionWorkspaceLayout.tsx",
  "components/d5o/end-user/CollapsedDetails.tsx"
];

const utilityFiles = [
  "lib/d5o/simplification/page-summary.ts",
  "lib/d5o/simplification/derive-next-actions.ts",
  "lib/d5o/simplification/derive-page-readiness.ts"
];

const pageMap = {
  "app/command-center/page.tsx": "command-center",
  "app/pipeline/page.tsx": "pipeline",
  "app/projects/page.tsx": "projects",
  "app/mobilization/page.tsx": "mobilization",
  "app/field-execution/page.tsx": "field-execution",
  "app/rfis-submittals/page.tsx": "rfis-submittals",
  "app/changes/page.tsx": "changes",
  "app/billing/page.tsx": "billing",
  "app/safety/page.tsx": "safety",
  "app/quality/page.tsx": "quality",
  "app/closeout/page.tsx": "closeout",
  "app/reports/page.tsx": "reports"
};

// These pages now use task-first layouts instead of the original summary wrapper.
// Keep their action and progressive-detail contracts in the repository-wide gate.
const currentPageContracts = {
  "app/command-center/page.tsx": ["command-center-c-plus-action-queue", "command-center-visual-triage", "CollapsedDetails"],
  "app/pipeline/page.tsx": ["pipeline-experience", "pipeline-queue-panel", "rankOpportunities"],
  "app/field-execution/page.tsx": ["active-workbench-page", "PageHeader", "CollapsedDetails"],
  "app/rfis-submittals/page.tsx": ["downstream-record-page", "PageHeader", "CollapsedDetails"],
  "app/changes/page.tsx": ["downstream-record-page", "PageHeader", "CollapsedDetails"],
  "app/billing/page.tsx": ["active-workbench-page", "BillingV2GuidedWorkflow", "CollapsedDetails"],
  "app/closeout/page.tsx": ["active-workbench-page", "PageHeader", "CollapsedDetails"]
};

const failures = [];

for (const file of [...componentFiles, ...utilityFiles, "docs/page-simplification-system.md"]) {
  if (!existsSync(resolve(root, file))) {
    failures.push(`Missing simplification asset: ${file}`);
  }
}

for (const [file, pageId] of Object.entries(pageMap)) {
  const absolute = resolve(root, file);
  if (!existsSync(absolute)) {
    failures.push(`Missing major page: ${file}`);
    continue;
  }

  const source = readFileSync(absolute, "utf8");
  const currentContract = currentPageContracts[file];
  if (currentContract) {
    for (const marker of currentContract) {
      if (!source.includes(marker)) failures.push(`${file} missing current action-first or supporting-detail contract: ${marker}.`);
    }
    continue;
  }
  if (!source.includes("PageOperatingLayout") && !source.includes("ActionWorkspaceLayout")) {
    failures.push(`${file} does not use PageOperatingLayout or ActionWorkspaceLayout.`);
  }
  if (!source.includes(`getPageOperatingSummary("${pageId}")`) && !source.includes(`getEndUserWorkspaceSummary("${pageId}")`)) {
    failures.push(`${file} does not request the correct page operating or end-user summary.`);
  }
}

const layoutFile = resolve(root, "components/d5o/simplified/PageOperatingLayout.tsx");
if (existsSync(layoutFile)) {
  const layoutSource = readFileSync(layoutFile, "utf8");
  for (const phrase of ["ModuleStageHeader", "NextActionPanel", "GateReadinessPanel", "EvidenceRequiredPanel", "ActiveRisksPanel", "details"]) {
    if (!layoutSource.includes(phrase)) {
      failures.push(`PageOperatingLayout missing section/component: ${phrase}`);
    }
  }
}

const docs = [
  "docs/page-simplification-system.md",
  "docs/developer-notes.md",
  "docs/demo-readiness.md",
  "docs/pilot-readiness-scorecard.md",
  "docs/controlled-pilot-launch-plan.md"
]
  .filter((file) => existsSync(resolve(root, file)))
  .map((file) => readFileSync(resolve(root, file), "utf8"))
  .join("\n")
  .toLowerCase();

for (const phrase of ["stage / module header", "next required actions", "evidence required", "active risks", "progressive disclosure"]) {
  if (!docs.includes(phrase)) {
    failures.push(`Simplification docs missing concept: ${phrase}`);
  }
}

if (failures.length > 0) {
  console.error("Page simplification verification failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Page simplification verification passed.");
