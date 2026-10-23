import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(file, dependencies = {}) {
  const compiled = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: (key) => dependencies[key], Date, Intl }, { filename: file });
  return exports;
}

const policy = load("components/d5o/platform/deploy-policy.ts");
const { assessDeployReadiness } = load("components/d5o/platform/deploy-model.ts", { "./deploy-policy": policy });
const packageId = "fixture-package", releaseId = "fixture-release";
const detail = { packageId, revision: 2, predecessorIds: [], materialLines: [], materialStatus: "Not required", access: "Authorized", permit: "Not required", safetyControls: "Synthetic isolation controls", method: "Synthetic issued method", crewDemandRequired: true };
const work = { id: "fixture-work", workspace: "rybex", blockers: [], packages: [{ id: packageId }], phaseConfigurationVersionId: "pin-25", design: { packages: [detail], releases: [{ id: releaseId, packageId, packageRevision: 2, configurationVersionId: "pin-25", status: "Accepted", snapshot: detail, crewDemandSnapshot: { minimumPeople: 1, requiredSlots: [{ date: "2026-10-20", shift: "00:00–01:00" }] } }] } };
const booking = { id: "fixture-booking", workId: work.id, packageId, date: "2026-10-20", shift: "00:00–01:00", people: ["Fictional Worker"] };
const schedule = { assignments: [booking], publications: [{ id: "fixture-publication", assignments: [booking] }], receipts: [{ publicationId: "fixture-publication", assignmentId: booking.id, recipient: "Fictional Worker", response: "acknowledged" }] };
const pinned = { ...policy.defaultDeployControlPolicy("technical-delivery"), fieldStartLeadMinutes: 25, requirePhysicalMaterials: false };
const before = assessDeployReadiness(work, packageId, schedule, pinned, "America/New_York", new Date("2026-10-20T03:10:00Z"));
assert.equal(before.findings.filter((item) => item.severity === "blocker").map((item) => item.key).join(","), "shift-time");
assert.match(before.findings.find((item) => item.key === "shift-time").nextAction, /25 minutes/);
const inside = assessDeployReadiness(work, packageId, schedule, pinned, "America/New_York", new Date("2026-10-20T03:35:00Z"));
assert.equal(inside.findings.some((item) => item.key === "shift-time"), false);
assert.equal(inside.recommendation, "Ready for authorized start");
console.log("Pinned 25-minute Deploy display boundary passed.");
