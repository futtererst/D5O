import assert from "node:assert/strict";
import { buildCustomerDefineDraft, defineDraftFields, parseDefineDraft } from "../../lib/d5o/hosted/customer-define-draft.ts";

const fields = Object.fromEntries(defineDraftFields.map((field) => [field, `${field} value`]));
const parsed = parseDefineDraft(fields);
assert(parsed);
assert.equal(parseDefineDraft({ ...fields, status: "Approved" }), null);
assert.equal(parseDefineDraft({ ...fields, outcome: 15 }), null);
assert.equal(parseDefineDraft({ ...fields, outcome: "x".repeat(2001) }), null);
const draft = buildCustomerDefineDraft(parsed, "Project owner");
assert.equal(draft.status, "Draft");
assert.equal(draft.revision, 1);
assert.equal(draft.scopeControl.requirements[0].id, draft.registers.scope_items[0].requirementId);
assert.equal(draft.registers.scope_items[0].id, draft.registers.acceptance_criteria[0].scopeId);
assert.equal("decisions" in draft, false);
const existing = buildCustomerDefineDraft(parsed, "Project owner", {
  revision: 2, project: { requiredDate: "2026-12-01" },
  findings: [{ id: "stable-finding" }, { id: "other-finding", detail: "Keep this" }],
  scopeControl: { requirements: [{ id: "stable-requirement" }, { id: "other-requirement" }] },
  registers: { scope_items: [{ id: "stable-scope" }, { id: "other-scope" }],
    acceptance_criteria: [{ id: "stable-acceptance" }, { id: "other-acceptance" }] }
});
assert.equal(existing.project.requiredDate, "2026-12-01");
assert.deepEqual(existing.findings.map((item) => item.id), ["stable-finding", "other-finding"]);
assert.equal(existing.scopeControl.requirements[1].id, "other-requirement");
assert.equal(existing.registers.scope_items[0].id, "stable-scope");
assert.equal(existing.registers.acceptance_criteria[1].id, "other-acceptance");
console.log(JSON.stringify({ suite: "phase2h-define-draft", passed: 13 }));
