import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(file, imports = {}) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, structuredClone, require: (name) => imports[name] }, { filename: file });
  return exports;
}

const designPolicy = load("../components/d5o/platform/design-policy.ts");
const deployPolicy = load("../components/d5o/platform/deploy-policy.ts");
const operatePolicy = load("../components/d5o/platform/operate-policy.ts");
const base = load("../components/d5o/platform/phase-configuration.ts", { "./design-policy": designPolicy, "./deploy-policy": deployPolicy, "./operate-policy": operatePolicy });
const contract = load("../components/d5o/platform/published-phase-configuration.ts", { "./phase-configuration": base, "./design-policy": designPolicy, "./deploy-policy": deployPolicy, "./operate-policy": operatePolicy });
const original = contract.defaultPhaseContract("rybex");
assert.deepEqual(Array.from(contract.validatePublishedPhaseContract(original, "rybex")), []);
assert.ok(original.workTypes.every((item) => item.designControls?.requiredReviews.includes("Safety")), "new contracts include Design safety control");
assert.ok(original.workTypes.every((item) => item.operateControls?.requireExplicitCoverageDisposition), "new contracts include explicit Operate coverage disposition");
const invalidOperate = structuredClone(original);
invalidOperate.workTypes[0].operateControls.maxMaintenanceFrequencyDays = 0;
assert.ok(contract.validatePublishedPhaseContract(invalidOperate, "rybex").length, "invalid maintenance policy cannot publish");
const invalidDesign = structuredClone(original);
invalidDesign.workTypes[0].designControls.requiredReviews = ["Delivery"];
assert.ok(contract.validatePublishedPhaseContract(invalidDesign, "rybex").length, "Design cannot publish without Engineering and Safety review");
assert.ok(contract.validatePublishedPhaseContract(original, "rotork").length, "workspace-specific Work Types cannot cross tenants");
const rotork = contract.defaultPhaseContract("rotork");
for (const tenant of [original, rotork]) {
  const phases = tenant.workTypes[0].phases;
  assert.deepEqual(phases.find((phase) => phase.key === "develop").components.find((item) => item.key === "solution_options").fields.map((item) => item.key), ["option", "benefit", "constraint", "owner"]);
  assert.deepEqual(phases.find((phase) => phase.key === "design").components.find((item) => item.key === "verification_plan").fields.map((item) => item.key), ["package", "method", "proof", "authority"]);
  assert.deepEqual(phases.find((phase) => phase.key === "operate").components.find((item) => item.key === "handoff").fields.map((item) => item.key), ["obligation", "recipient", "dueDate"]);
}
const rybexConfig = original.workTypes[0];
const rotorkConfig = rotork.workTypes[0];
const checkMessages = (work, config, stage, right) => Array.from(base.evaluateDecisionGuard(work, config, stage, right), (item) => item.message);
assert.equal(checkMessages({}, rybexConfig, "Plan", "confirm-plan").length, 3, "an empty Rybex plan is not decision-ready");
assert.deepEqual(Array.from(base.decisionCheckResults({}, rybexConfig, "Plan", "confirm-plan"), (item) => item.met), [false, false, false], "the Overview shows the same three unmet checks");
assert.deepEqual(Array.from(base.decisionCheckResults({}, rybexConfig, "Plan", "confirm-plan"), (item) => base.decisionCheckPhase(item.check)), ["develop", "design", "design"], "phase surfaces group the same configured Plan checks without tenant branching");
const solution = { option: "Controlled alternative", benefit: "Reduced rework", constraint: "Survey needed", owner: "Delivery lead" };
const plan = { package: "wp-1", method: "Inspection", proof: "Signed result", authority: "Quality lead" };
const rybexWork = { phaseRegisters: { "develop.solution_options": [solution], "design.verification_plan": [plan] }, packages: [{ id: "wp-1", installed: 0, tested: 0, accepted: 0 }] };
assert.deepEqual(checkMessages(rybexWork, rybexConfig, "Plan", "confirm-plan"), [], "linked phase inputs clear the configured decision checks");
assert.deepEqual(Array.from(base.decisionCheckResults(rybexWork, rybexConfig, "Plan", "confirm-plan"), (item) => item.met), [true, true, true], "the Overview marks exactly the checks that cleared the decision");
assert.equal(checkMessages({ ...rybexWork, packages: [{ id: "wp-2", installed: 0, tested: 0, accepted: 0 }] }, rybexConfig, "Plan", "confirm-plan").length, 1, "a typed or stale package reference cannot clear the gate");
assert.equal(checkMessages({ ...rybexWork, packages: [{ id: "wp-1", installed: undefined, tested: 0, accepted: 0 }] }, rybexConfig, "Execution", "record-execution").length, 3, "missing package facts cannot clear an execution check");
assert.equal(checkMessages({ ...rybexWork, evidence: [{ kind: "Test result", state: "rejected" }] }, rybexConfig, "Quality verification", "verify-quality").length, 1, "rejected proof is not reviewed proof");
assert.equal(checkMessages({}, rotorkConfig, "Assessment", "complete-assessment").length, 1, "Rotork assessment is governed by the same evaluator");
assert.equal(base.decisionCheckPhase(rotorkConfig.decisionGuards.find((item) => item.right === "record-pilot-complete").checks.find((item) => item.op === "reviewed_evidence")), "deploy", "pilot proof remains actionable from the Deploy controls");
assert.deepEqual(checkMessages({ phaseRegisters: { "develop.solution_options": [solution] } }, rotorkConfig, "Assessment", "complete-assessment"), []);
const relabelled = structuredClone(rybexConfig);
relabelled.phases.find((phase) => phase.key === "develop").label = "Solution design";
assert.deepEqual(checkMessages(rybexWork, relabelled, "Plan", "confirm-plan"), [], "presentation labels do not alter decision authority");
const revisedChecks = structuredClone(original);
revisedChecks.workTypes[0].decisionGuards[0].checks.pop();
assert.deepEqual(Array.from(contract.validatePublishedPhaseContract(revisedChecks, "rybex")), [], "a new version may change configured checks without invalidating the old version");
const malformedChecks = structuredClone(original);
malformedChecks.workTypes[0].decisionGuards[0].checks[0].op = "skip_all";
assert.ok(contract.validatePublishedPhaseContract(malformedChecks, "rybex").length, "unsupported decision checks fail validation");
const historicalFormOnly = structuredClone(original);
delete historicalFormOnly.workTypes[0].decisionGuards;
assert.deepEqual(Array.from(contract.validatePublishedPhaseContract(historicalFormOnly, "rybex")), [], "older pinned form-only versions remain readable");
const duplicateSchedule = structuredClone(original);
duplicateSchedule.workTypes[0].phases.find((phase) => phase.key === "deploy").components.find((item) => item.key === "schedule").fields = [{ key: "crew", label: "Crew", kind: "text", required: true }];
assert.ok(contract.validatePublishedPhaseContract(duplicateSchedule, "rybex").length, "published forms cannot duplicate the existing shared schedule");

const old = structuredClone(original);
old.workTypes[0].phases[1].components.find((item) => item.key === "scope_items").fields[0].label = "Rybex deliverable";
const current = structuredClone(original);
current.workTypes[0].phases[1].components.find((item) => item.key === "scope_items").fields[0].label = "Current deliverable";
assert.deepEqual(Array.from(contract.validatePublishedPhaseContract(old, "rybex")), []);
assert.deepEqual(Array.from(contract.validatePublishedPhaseContract(current, "rybex")), []);
const manifest = (phaseContract) => ({
  workTypes: phaseContract.workTypes.map((item) => ({ key: item.workTypeKey, status: "active" })),
  d5oPresentation: { phaseContract },
});
const inventory = { status: "ready", activeVersionId: "version-2", versions: [
  { id: "version-1", status: "superseded", config_manifest_json: manifest(old) },
  { id: "version-2", status: "published", config_manifest_json: manifest(current) },
] };
const pinned = { type: "Technical delivery", phaseConfigurationVersionId: "version-1" };
const fromOld = contract.resolvePublishedPhaseConfiguration(inventory, "rybex", pinned.type, pinned);
assert.equal(fromOld.version, "version-1");
assert.equal(fromOld.phases[1].components.find((item) => item.key === "scope_items").fields[0].label, "Rybex deliverable");
assert.equal(contract.resolvePublishedPhaseConfiguration(inventory, "rybex", pinned.type).version, "version-2");
assert.equal(contract.activePhaseConfigurationVersion(inventory, "rybex", pinned.type), "version-2");
assert.equal(contract.publishedWorkTypePinIsValid(inventory, "rybex", pinned.type, "version-2", true), true);
assert.equal(contract.publishedWorkTypePinIsValid(inventory, "rybex", pinned.type, "version-1", true), false, "new shared work rejects a stale default");
assert.equal(contract.publishedWorkTypePinIsValid(inventory, "rybex", pinned.type, "version-1", false), true, "existing pinned work retains a superseded version");
assert.equal(contract.publishedWorkTypePinIsValid(inventory, "rybex", "Unsupported work", "version-2", true), false);
assert.equal(contract.publishedWorkTypePinIsValid(inventory, "rotork", pinned.type, "version-2", true), false);
assert.equal(contract.resolvePublishedPhaseConfiguration(inventory, "rybex", pinned.type, { type: pinned.type }).version, "prototype-v1", "unbound legacy work stays on its reference contract");
assert.equal(contract.resolvePublishedPhaseConfiguration(inventory, "rybex", pinned.type, { ...pinned, phaseConfigurationVersionId: "missing" }), null, "unavailable pin fails closed");

const customized = structuredClone(original);
const scope = customized.workTypes[0].phases[1].components.find((item) => item.key === "scope_items");
scope.fields.find((item) => item.key === "owner").required = false;
scope.rules[0].fields = ["deliverable", "boundary"];
assert.deepEqual(Array.from(contract.validatePublishedPhaseContract(customized, "rybex")), []);
assert.equal(base.evaluateRule({ definition: { registers: { scope_items: [{ deliverable: "Fiber", boundary: "Rack A", owner: "" }] } } }, scope.rules[0]), true);
scope.rules[0].fields = ["deliverable"];
assert.ok(contract.validatePublishedPhaseContract(customized, "rybex").length, "required field and rule list must stay aligned");
const unsafe = { schemaVersion: 1, workTypes: structuredClone(base.prototypePhaseConfigurationCatalog.rybex) };
unsafe.workTypes[0].phases[1].components.find((item) => item.key === "commercial_source").rules[0].value = "Draft";
assert.ok(contract.validatePublishedPhaseContract(unsafe, "rybex").length, "protected commercial rule cannot be weakened");
assert.equal(contract.phaseContractFromManifest(manifest(unsafe), "rybex"), null);
console.log("Published phase contract: tenant isolation, version pinning, legacy preservation, configured Rybex/Rotork decision checks, label invariance, protected rules, malformed version fail-closed PASS");
