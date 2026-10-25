import assert from "node:assert/strict";
import { serviceTasks } from "../../lib/d5o/hosted/customer-work-tasks.ts";

// Focused reproduction of the Phase 2H-TB My Work gap. The browser suite
// separately verifies that these server-derived entries open real controls.
const workId = "synthetic-work";
const requestId = "synthetic-request";
const actor = { pm: "pm-user", ops: "ops-user", admin: "admin-user" };
const base = {
  id: workId, operate: { activation: { status: "Active" },
    agreements: [], requests: [], jobs: [] }
};
const tasks = (work, role, approval = {}, actorId = actor[role]) =>
  serviceTasks([work], role, { [`${workId}:${requestId}`]: approval }, actorId)
    .map((item) => ({ action: item.action, status: item.status }));
const has = (items, action) => items.some((item) => item.action === action);
const cases = [];
function check(name, test) {
  test(); cases.push({ name, status: "PASS" });
}
check("project manager can open a service request", () => {
  assert(has(tasks(base, "project_manager", {}, actor.pm), "open-request"));
});
const coverage = { ...base, operate: { ...base.operate,
  agreements: [{ id: "agreement-1", name: "Synthetic coverage", status: "Draft",
    createdByActorId: actor.pm }] } };
check("independent Operations receives draft coverage review", () => {
  assert(has(tasks(coverage, "operations_leader", {}, actor.ops), "approve-agreement"));
});
check("coverage creator cannot review their own agreement", () => {
  assert(!has(tasks(coverage, "project_manager", {}, actor.pm), "approve-agreement"));
});
const request = { id: requestId, title: "Synthetic request", status: "New", coverage: "Awaiting" };
const withRequest = { ...base, operate: { ...base.operate, requests: [request] } };
check("Operations receives triage responsibility", () => {
  assert(has(tasks(withRequest, "operations_leader", {}, actor.ops), "triage-request"));
});
const triaged = { ...withRequest, operate: { ...withRequest.operate, requests: [
  { ...request, status: "Triaged", coverage: "Partially covered" }] } };
check("project manager prepares estimate", () => {
  assert(has(tasks(triaged, "project_manager", {}, actor.pm), "prepare-estimate"));
});
const pricing = { ...triaged, operate: { ...triaged.operate, requests: [
  { ...triaged.operate.requests[0], serviceEstimate: { status: "Pricing review", revision: 1 } }] } };
check("Operations reviews pricing", () => {
  assert(has(tasks(pricing, "operations_leader", {}, actor.ops), "approve-pricing"));
});
const priced = { ...pricing, operate: { ...pricing.operate, requests: [
  { ...pricing.operate.requests[0], serviceEstimate: { status: "Approved", revision: 1 } }] } };
check("strict tenant requests and independently decides approval", () => {
  assert(has(tasks(priced, "project_manager", { canRequest: true }, actor.pm), "request-approval"));
  assert(has(tasks(priced, "admin", { canDecide: true }, actor.admin), "decide-approval"));
});
check("authorized Operations receives customer authorization; optional tenant has no threshold task", () => {
  assert(has(tasks(priced, "operations_leader", { canAuthorize: true }, actor.ops), "authorize-service"));
  assert(!has(tasks(priced, "project_manager", { canCreateJob: false }, actor.pm), "request-approval"));
});
const authorized = { ...priced, operate: { ...priced.operate, requests: [
  { ...priced.operate.requests[0], serviceAuthorization: { estimateRevision: 1 } }] } };
check("project manager gets one job task and it resolves after creation", () => {
  assert(has(tasks(authorized, "project_manager", { canCreateJob: true }, actor.pm), "create-job"));
  const completed = { ...authorized, operate: { ...authorized.operate,
    jobs: [{ requestId, status: "Generated" }] } };
  assert(!has(tasks(completed, "project_manager", { canCreateJob: true }, actor.pm), "create-job"));
});
console.log(JSON.stringify({ passed: cases.length, failed: 0, cases }));
