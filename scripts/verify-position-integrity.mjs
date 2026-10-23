import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

class PrototypeWorkError extends Error {
  constructor(code, status, message) { super(message); this.code = code; this.status = status; }
}
const source = readFileSync("lib/d5o/prototype-work/position-integrity.ts", "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports = {};
vm.runInNewContext(compiled, { exports, require: () => ({ PrototypeWorkError }) });
const guard = exports.assertSnapshotPositionIntegrity;
const before = { id: "rybex-pilot", workspace: "rybex", stage: "Plan", status: "moving", progress: 8,
  phaseConfigurationVersionId: "published-1", nextAction: "Survey site", title: "Data hall upgrade" };
const unchanged = structuredClone(before);
unchanged.title = "Data hall infrastructure upgrade";
guard([before], [unchanged]);
for (const change of [
  { stage: "Accepted and handed over" }, { status: "complete" }, { progress: 100 },
  { phaseConfigurationVersionId: "other-policy" }, { prototypeDecisionRights: ["approve"] },
  { heldFrom: "Quality verification" }, { workspace: "rotork" }
]) {
  assert.throws(() => guard([before], [{ ...before, ...change }]), (error) => error.code === "protected_position_changed");
}
assert.throws(() => guard([before], []), (error) => error.code === "work_deletion_requires_command");
const created = { id: "rybex-new", workspace: "rybex", stage: "Plan", status: "moving", progress: 8, phaseConfigurationVersionId: "published-1" };
assert.throws(() => guard([before], [before, created]), (error) => error.code === "unregistered_work_import");
guard([before], [before, created], [created]);
assert.throws(() => guard([before], [before, { ...created, stage: "Client Accepted" }], [created]), (error) => error.code === "unregistered_work_import");
assert.throws(() => guard([before], [before, { ...created, deploy: { workAcceptance: {} } }], [created]), (error) => error.code === "protected_work_import");
console.log("Generic snapshot editing preserves drafts and rejects position, pin and deletion changes.");
