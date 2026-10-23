import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (process.env.D5O_ISOLATED_PILOT !== "1" || url !== "http://127.0.0.1:56321"
  || !key || !process.env.D5O_PILOT_CREDENTIALS_FILE) throw new Error("disposable_pilot_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
async function login(role) {
  const user = users.find((item) => item.key === role);
  const client = createClient(url, key, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error) throw error;
  return client;
}
const [pm, operations, worker] = await Promise.all([login("pm"), login("operations"), login("worker")]);
const parentId = "rybex-a8fd95e7e20d4bb3881c3549459c99e0";
const partialId = "rybex-a11c09e603a248359205ec84f0af4ae8";
const coveredId = "rybex-d910a2a58a9c46038fb459436e1839c3";
async function read() {
  const { data, error } = await pm.rpc("d5o_hosted_prototype_read_v1", {
    p_workspace_key: "rybex", p_state_key: "work"
  });
  if (error) throw error;
  const parent = data.state.records.find((record) => record.id === parentId);
  const partial = data.state.records.find((record) => record.id === partialId);
  const covered = data.state.records.find((record) => record.id === coveredId);
  return { data, parent, partial, covered };
}
const before = await read();
const request = before.parent.operate.requests.find((item) => item.id === "abe94af3-bdc5-435b-b6ad-ca810293988e");
assert.equal(request.coverage, "Partially covered");
assert.equal(request.serviceEstimate.status, "Approved");
assert.equal(request.serviceAuthorization.estimateRevision, request.serviceEstimate.revision);
assert.equal(before.partial.serviceExecutionBasis.status, "accepted");
assert.equal(before.partial.serviceExecutionBasis.brief.source.pricing.customerAuthorizationSource,
  request.serviceAuthorization.source);
const coveredRequest = before.parent.operate.requests.find((item) => item.id === "c5b73624-539f-4ef3-8874-60b1e9313a79");
const job = before.parent.operate.jobs.find((item) => item.id === coveredRequest.currentCycleJobIds[0]);
assert.equal(coveredRequest.status, "Closed");
assert.equal(job.status, "Completed");
assert.ok(job.evidence.length > 0);
assert.equal(before.covered.deploy.workAcceptance.receipt, "Accepted");
assert.ok(before.covered.deploy.inspections.some((item) => item.result === "Fail"));
assert.ok(before.covered.deploy.inspections.some((item) => item.result === "Pass" && item.status === "Verified"));
const asset = before.parent.operate.assets.find((item) => item.id === coveredRequest.assetId);
assert.ok(asset.history.some((item) => item.source === coveredId && item.reports?.length));
assert.equal(before.parent.operate.finance.status, "Closed");

const command = {
  p_workspace_key: "rybex", p_presentation_id: partialId,
  p_action: "accept-service-basis", p_input: { reason: "This actor may not independently approve their own basis." },
  p_command_id: crypto.randomUUID(), p_expected_work_revision: before.data.revision,
  p_expected_operate_revision: before.parent.operate.authorityRevision,
  p_expected_decision_revision: before.partial.serviceExecutionBasis.authorityRevision
};
async function denied(client, name, args, codes) {
  const { error } = await client.rpc(name, args);
  assert.ok(error, `${name} unexpectedly succeeded`);
  assert.ok(codes.includes(error.code), `${name}: ${error.code} ${error.message}`);
}
await denied(pm, "d5o_hosted_service_basis_command_v1", command, ["42501"]);
await denied(worker, "d5o_hosted_service_basis_command_v1", {
  ...command, p_action: "revise-service-basis", p_command_id: crypto.randomUUID()
}, ["42501", "23514"]);
await denied(pm, "d5o_hosted_service_basis_command_v1", {
  ...command, p_action: "revise-service-basis", p_command_id: crypto.randomUUID(),
  p_expected_work_revision: before.data.revision - 1
}, ["23505"]);
await denied(pm, "d5o_hosted_service_basis_command_v1", {
  ...command, p_workspace_key: "rotork", p_command_id: crypto.randomUUID()
}, ["42501"]);

const altered = structuredClone(before.data.state);
const alteredParent = altered.records.find((record) => record.id === parentId);
alteredParent.operate.requests.find((item) => item.id === request.id).coverage = "Covered";
await denied(pm, "d5o_hosted_prototype_save_v1", {
  p_workspace_key: "rybex", p_state_key: "work",
  p_expected_revision: before.data.revision, p_state: altered
}, ["23514", "42501", "22023"]);

const receiptId = before.parent.operate.events.find((event) => event.action === "save-service-estimate"
  && event.detail === request.id)?.commandId;
assert.ok(receiptId);
await denied(pm, "d5o_hosted_service_pricing_command_v1", {
  p_workspace_key: "rybex", p_parent_presentation_id: parentId,
  p_request_id: request.id, p_action: "save-service-estimate",
  p_input: { pricingInput: { lines: [] } }, p_command_id: receiptId,
  p_expected_work_revision: before.data.revision,
  p_expected_operate_revision: before.parent.operate.authorityRevision
}, ["23505"]);
const after = await read();
assert.equal(after.data.revision, before.data.revision);
assert.equal(after.parent.operate.authorityRevision, before.parent.operate.authorityRevision);
assert.equal(after.partial.serviceExecutionBasis.authorityRevision,
  before.partial.serviceExecutionBasis.authorityRevision);
console.log(JSON.stringify({ status: "service_basis_integrity_passed", checks: 15 }));
