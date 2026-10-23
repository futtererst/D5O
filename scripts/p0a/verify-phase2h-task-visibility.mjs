import assert from "node:assert/strict";
import { defineTasks } from "../../lib/d5o/hosted/customer-work-tasks.ts";

const base = { id: "work-a", definition: { status: "In review", authorityRevision: 1,
  reviews: { commercial: "Pending", delivery: "Pending" },
  decisions: [{ action: "submit", actorId: "submitter" }] } };
assert.equal(defineTasks([base], "admin", "submitter").length, 0,
  "a submitter must not receive either independent review");
assert.deepEqual(defineTasks([base], "billing_commercial_lead", "finance")
  .map((task) => task.reviewRole), ["commercial"]);
assert.deepEqual(defineTasks([base], "operations_leader", "ops")
  .map((task) => task.reviewRole), ["delivery"]);
assert.equal(defineTasks([base], "field_worker", "field").length, 0);
const commercialReviewed = structuredClone(base);
commercialReviewed.definition.decisions.push({ action: "approve-review", reviewRole: "commercial", actorId: "reviewer" });
assert.equal(defineTasks([commercialReviewed], "admin", "reviewer")
  .some((task) => task.reviewRole === "delivery"), false,
  "a reviewer must not receive the other independent review");
const approved = { id: "work-a", definition: { status: "Approved", authorityRevision: 3,
  developHandoff: { status: "submitted", submittedByActorId: "sender" } } };
assert.equal(defineTasks([approved], "project_manager", "sender").length, 0);
assert.equal(defineTasks([approved], "operations_leader", "receiver")[0]?.action, "accept-handoff");
approved.definition.developHandoff.status = "accepted";
assert.equal(defineTasks([approved], "operations_leader", "receiver").length, 0,
  "a completed handoff must leave the current task queue");
console.log(JSON.stringify({ suite: "phase2h-task-visibility", passed: 8 }));
