import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const root = process.cwd();
const failures = [];

const commandCenter = readFile("app/command-center/page.tsx");
assert(commandCenter.includes("command-center-c-plus-action-queue"), "Command Center should expose the C+ ranked action queue surface.");
assert(commandCenter.includes("command-center-rank-1-action"), "Command Center should keep one dominant rank-1 action in overview mode.");

const activePages = [
  {
    route: "/billing",
    file: "app/billing/page.tsx",
    workflow: "BillingV2GuidedWorkflow",
    purpose: "Recover blocked cash",
    forbidden: ["ActionCockpit", "ActionWorkspaceLayout", "FocusedTaskPanel"]
  },
  {
    route: "/field-execution",
    file: "app/field-execution/page.tsx",
    workflow: "FieldIssueEscalationWorkflowClient",
    purpose: "Turn a field issue into the right RFI or change path",
    forbidden: ["ActionCockpit", "ActionWorkspaceLayout", "FocusedTaskPanel"]
  },
  {
    route: "/closeout",
    file: "app/closeout/page.tsx",
    workflow: "CloseoutFinalBillingWorkflowClient",
    purpose: "Release final billing and retainage",
    forbidden: ["ActionCockpit", "ActionWorkspaceLayout", "FocusedTaskPanel"]
  }
];

for (const page of activePages) {
  assertFile(page.file);
  const content = readFile(page.file);
  const rendered = renderedBody(content);
  assert(content.includes(page.purpose), `${page.route} must state the active workflow page purpose.`);
  assert(rendered.includes("active-workflow-mode"), `${page.route} must expose active workflow mode.`);
  assert(rendered.includes(page.workflow), `${page.route} must render the active workflow.`);
  assert(before(rendered, page.workflow, "CollapsedDetails"), `${page.route} must render the workflow before supporting details.`);
  for (const forbidden of page.forbidden) {
    assert(!rendered.includes(forbidden), `${page.route} must not render duplicate primary-action system ${forbidden} above the active workflow.`);
  }
}

for (const overview of [
  { route: "/rfis-submittals", file: "app/rfis-submittals/page.tsx", marker: "downstream-rfi-record" },
  { route: "/changes", file: "app/changes/page.tsx", marker: "downstream-change-record" }
]) {
  const content = readFile(overview.file);
  const rendered = renderedBody(content);
  assert(rendered.includes(overview.marker), `${overview.route} must expose the downstream record overview.`);
  assert(before(rendered, overview.marker, "CollapsedDetails"), `${overview.route} must put downstream record view before supporting details.`);
  assert(!rendered.includes("ActionWorkspaceLayout"), `${overview.route} should not add a cockpit above the downstream record view.`);
}

const nav = readFile("components/layout/PrimaryNav.tsx");
assert(nav.includes("Other modules"), "PrimaryNav must label contained secondary modules as Other modules.");
assert(nav.includes("nav-link-contained"), "PrimaryNav must visually demote Other modules.");
// Execute the shared destination model: links are no longer declared in the visual component.
const modules = evaluateTypeScript("lib/d5o/modules.ts");
const model = evaluateTypeScript("components/layout/primary-nav-model.ts", {
  "@/lib/d5o/demo-user": { demoUser: { name: "Test", title: "Test" }, getDemoAccessibleModules: () => modules.primaryNavItems.map((item) => ({ ...item, canAccess: true })) },
  "@/lib/d5o/modules": modules,
  "@/lib/d5o/rbac": { canAccessModule: () => true }
});
const coreHrefs = ["/command-center", "/field-execution", "/rfis-submittals", "/changes", "/billing", "/closeout"];
const grouped = model.getPrimaryNavGroups(model.getPrimaryNavItems(undefined), false);
for (const href of coreHrefs) {
  assert(grouped.coreItems.some((item) => item.href === href), `PrimaryNav must keep core operating path visible: ${href}.`);
}
assert(grouped.otherItems.length > 0, "Secondary modules must remain reachable outside the core operating path.");

const css = readFile("app/globals.css");
for (const className of [".active-workflow-mode", ".nav-group-label", ".nav-link-contained"]) {
  assert(css.includes(className), `Shell CSS missing ${className}.`);
}

for (const file of [
  "app/layout.tsx",
  "components/layout/PrimaryNav.tsx",
  "app/billing/page.tsx",
  "app/field-execution/page.tsx",
  "app/closeout/page.tsx",
  "app/rfis-submittals/page.tsx",
  "app/changes/page.tsx"
]) {
  const visibleText = readFile(file)
    .split("\n")
    .filter((line) => !/^\s*import\b/.test(line))
    .filter((line) => !/from\s+["']/.test(line))
    .filter((line) => !/className=/.test(line))
    .filter((line) => !/data-qa=/.test(line))
    .filter((line) => !/\.slice\(/.test(line))
    .join("\n");
  for (const term of ["seed", "slice", "adapter", "registry", "QA", "workflow engine", "local store"]) {
    assert(!visibleText.includes(term), `${file} should not expose internal architecture language: ${term}.`);
  }
}

if (failures.length > 0) {
  console.error("App shell journey containment verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("App shell journey containment checks passed.");
console.log(JSON.stringify({
  overviewMode: ["/command-center", "/rfis-submittals", "/changes"],
  activeWorkflowMode: activePages.map((page) => page.route),
  commandCenterOverview: "ranked action queue, with cockpit removed from the first-screen journey",
  sidebar: "core operating path visible, other modules contained",
  humanReviewStillRequired: true
}, null, 2));

function readFile(filePath) {
  return readFileSync(join(root, filePath), "utf8");
}

function assertFile(filePath) {
  assert(existsSync(join(root, filePath)), `${filePath} must exist.`);
}

function renderedBody(content) {
  const bodyStart = content.indexOf("return (");
  return bodyStart >= 0 ? content.slice(bodyStart) : content;
}

function before(content, first, second) {
  const firstIndex = content.indexOf(first);
  const secondIndex = content.indexOf(second);
  return firstIndex >= 0 && secondIndex >= 0 && firstIndex < secondIndex;
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function evaluateTypeScript(path, dependencies = {}) {
  const output = ts.transpileModule(readFile(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function("exports", "require", output)(exports, (name) => {
    if (!(name in dependencies)) throw new Error(`Unexpected verification dependency: ${name}`);
    return dependencies[name];
  });
  return exports;
}
