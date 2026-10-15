import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

// Exercise the actual projection without starting a database. Its three
// read-only dependencies are supplied from the explicit fictional fixture.
const require = createRequire(import.meta.url);
const source = readFileSync(resolve("lib/d5o/hosted/support-role-actions.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022
} }).outputText;
const loadedModule = { exports: {} };
const dependencies = {
  "@/components/d5o/platform/deploy-model": { currentWorkAcceptanceScope: () => true },
  "@/components/d5o/platform/support-documentation": {
    supportDocumentationPositions: (work) => work.fixturePositions
  },
  "./asset-identity": { externalAssetIdentityCounts: () => new Map() }
};
new Function("require", "module", "exports", compiled)(
  (name) => dependencies[name] ?? require(name), loadedModule, loadedModule.exports);
const { supportRoleActions } = loadedModule.exports;
const north = "turnover-north", south = "turnover-south";
const first = "fictional-supervisor-1", second = "fictional-supervisor-2";
const work = {
  id: "rybex-fictional-work", workspace: "rybex", canonicalWorkId: "fictional-canonical",
  title: "Fictional controls delivery", customer: "Fictional Customer", site: "Fictional Site",
  packages: [{ id: "package-north", name: "North controls" }, { id: "package-south", name: "South controls" }],
  deploy: { authorityRevision: 8, workAcceptance: { id: "acceptance", revision: 2, receipt: "Accepted" } },
  operate: { authorityRevision: 12, source: { kind: "accepted-delivery" }, support: { owner: "Operations" }, assets: [],
    supportDocumentAssignments: [
      { turnoverId: north, actorId: first, status: "Assigned" },
      { turnoverId: south, actorId: second, status: "Assigned" }
    ] },
  fixturePositions: [
    { turnoverId: north, turnoverRevision: 2, packageId: "package-north", kind: "as-built", status: "Outstanding" },
    { turnoverId: south, turnoverRevision: 3, packageId: "package-south", kind: "inspection", status: "Returned" }
  ]
};
const actions = (actor, role = "field_supervisor") => supportRoleActions([work], actor, role);
const assert = (condition, label) => { if (!condition) throw new Error(label); };
assert(actions(first).length === 1 && actions(first)[0].packageName === "North controls" &&
  actions(first)[0].position === "preparation", "first_supplier_exact_task");
assert(actions(second).length === 1 && actions(second)[0].packageName === "South controls" &&
  actions(second)[0].decisionRevision === 3, "second_supplier_exact_task");
assert(actions("unassigned").length === 0, "unassigned_supplier_not_queued");
work.operate.supportDocumentAssignments.push({ turnoverId: south, actorId: second, status: "Revoked" });
assert(actions(second).length === 0, "revoked_supplier_not_queued");
work.fixturePositions[0].status = "Submitted";
work.fixturePositions[0].current = { id: "retained-pdf" };
assert(actions(first).length === 0, "submitted_document_not_supply_task");
const review = actions("independent-operations", "operations_leader")
  .find((item) => item.kind === "review-document" && item.turnoverId === north);
assert(review?.decisionId === "retained-pdf", "independent_review_task_preserved");
console.log(JSON.stringify({ result: "support_supplier_queue_projection_pass",
  exactAssigned: 2, unassigned: 0, revoked: 0, independentReview: true }));
