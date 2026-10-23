import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const config = { version: "clarity-v1", workTypeKey: "technical-delivery",
  phases: [{ key: "define", components: [{ key: "commercial_source", rules: [] }] }] };
const errors = {};
vm.runInNewContext(ts.transpileModule(readFileSync("lib/d5o/prototype-work/store-error.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, { exports: errors });
const module = {};
const deps = {
  "@/components/d5o/platform/define-readiness": { assessDefine: () => ({ status: "Ready for review", next: null }) },
  "@/components/d5o/platform/phase-configuration": { evaluateRule: () => true },
  "@/components/d5o/platform/published-phase-configuration": { resolvePublishedPhaseConfiguration: () => config },
  "./store-error": errors
};
vm.runInNewContext(ts.transpileModule(readFileSync("lib/d5o/prototype-work/define-command.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, { exports: module, require: (name) => deps[name] ?? assert.fail(`Unexpected dependency: ${name}`), structuredClone, Date, Set, Map });
const { applyDefineCommand, assertSnapshotDefineIntegrity } = module;
const actor = {
  owner: { id: "owner", membershipId: "m-owner", name: "Owner", role: "project_manager" },
  commercial: { id: "commercial", membershipId: "m-commercial", name: "Commercial", role: "billing_commercial_lead" },
  delivery: { id: "delivery", membershipId: "m-delivery", name: "Delivery", role: "operations_leader" },
  receiver: { id: "receiver", membershipId: "m-receiver", name: "Receiver", role: "project_manager" }
};
const inventory = { status: "ready" };
const base = { id: "rybex-work-1", workspace: "rybex", type: "Technical delivery", phaseConfigurationVersionId: "pin-v1",
  nextAction: "Define scope", history: [], discovery: { estimate: { revision: 1 }, proposal: {} },
  definition: { revision: 1, status: "Draft", outcome: "Accepted fiber route", excludedScope: "No active switching",
    deliveryApproach: "Install and certify", registers: {}, history: [] } };
let work = structuredClone(base), sequence = 0;
const send = (action, who) => {
  const command = { action, workId: work.id, expectedRevision: ++sequence, commandId: `define-${sequence}`,
    reason: "Reviewed exact source and customer scope" };
  work = applyDefineCommand(work, command, who, inventory);
  return command;
};
const submitted = send("submit", actor.owner);
assert.equal(work.definition.status, "In review");
assert.equal(applyDefineCommand(work, submitted, actor.owner, inventory), work, "A matching retry is idempotent");
assert.throws(() => applyDefineCommand(work, submitted, actor.receiver, inventory), (error) => error.code === "command_reuse_conflict");
assert.throws(() => assertSnapshotDefineIntegrity([work], [{ ...work, definition: { ...work.definition, outcome: "Silently changed scope" } }]),
  (error) => error.code === "protected_definition_changed", "A submitted revision is immutable through draft save");
assert.throws(() => applyDefineCommand(work, { ...submitted, commandId: "owner-review", action: "approve-review", role: "commercial" }, actor.owner, inventory),
  (error) => error.code === "define_review_role_denied");
work = applyDefineCommand(work, { action: "approve-review", role: "commercial", reason: "Commercial scope and basis checked",
  workId: work.id, expectedRevision: 2, commandId: "commercial-review" }, actor.commercial, inventory);
assert.equal(work.definition.status, "In review");
work = applyDefineCommand(work, { action: "approve-review", role: "delivery", reason: "Delivery scope and interfaces checked",
  workId: work.id, expectedRevision: 3, commandId: "delivery-review" }, actor.delivery, inventory);
assert.equal(work.definition.status, "Approved");
assert.equal(work.definition.approvedBaselines[0].revision, 1);
send("submit-handoff", actor.owner);
assert.equal(work.definition.developHandoff.status, "submitted");
assert.throws(() => applyDefineCommand(work, { action: "accept-handoff", reason: "I receive this exact scope",
  workId: work.id, expectedRevision: 5, commandId: "self-receipt" }, actor.owner, inventory),
  (error) => error.code === "define_separation_required");
send("accept-handoff", actor.receiver);
assert.equal(work.definition.developHandoff.status, "accepted");
assert.equal(work.definition.developHandoff.receivedByMembershipId, actor.receiver.membershipId);
assert.throws(() => assertSnapshotDefineIntegrity([work], [{ ...work, definition: { ...work.definition, status: "Draft" } }]),
  (error) => error.code === "protected_definition_changed");
console.log("Define command authority, revision, receipt, replay and snapshot controls passed.");
