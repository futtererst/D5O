import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const file = process.env.D5O_PILOT_CREDENTIALS_FILE;
if (process.env.D5O_ISOLATED_PILOT !== "1" || url !== "http://127.0.0.1:56321" || !key || !file)
  throw new Error("disposable_pilot_only");
const users = JSON.parse(readFileSync(file, "utf8")).users;
const login = async (name) => {
  const user = users.find((item) => item.key === name);
  const client = createClient(url, key, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error) throw error;
  return client;
};
const [pm, operations, worker] = await Promise.all([login("pm"), login("operations"), login("worker")]);
const parentId = "rybex-a8fd95e7e20d4bb3881c3549459c99e0";
const read = async (keyName = "work") => {
  const { data, error } = await pm.rpc("d5o_hosted_prototype_read_v1", {
    p_workspace_key: "rybex", p_state_key: keyName
  });
  if (error) throw error;
  return data;
};
const basis = async () => {
  const [work, catalog] = await Promise.all([read(), read("catalog")]);
  return { work, catalog, parent: work.state.records.find((item) => item.id === parentId) };
};
const operate = async (client, action, input, commandId) => {
  const { work, parent } = await basis();
  return client.rpc("d5o_hosted_operate_command_v1", {
    p_workspace_key: "rybex", p_presentation_id: parentId, p_action: action,
    p_input: input, p_command_id: commandId,
    p_expected_source_revision: work.revision,
    p_expected_deploy_revision: parent.deploy.authorityRevision,
    p_expected_operate_revision: parent.operate.authorityRevision
  });
};
const expectSuccess = (result, label) => {
  if (result.error) throw new Error(`${label}:${result.error.code}:${result.error.message}`);
  return result.data;
};
const create = async (client, request, commandId, override = {}) => {
  const { work, catalog, parent } = await basis();
  return client.rpc("d5o_hosted_service_job_command_v1", {
    p_workspace_key: "rybex", p_parent_presentation_id: parentId,
    p_request_id: request.id, p_due_date: "2026-10-30",
    p_owner: "Pilot service project manager", p_command_id: commandId,
    p_expected_work_revision: work.revision,
    p_expected_catalog_revision: catalog.revision,
    p_expected_operate_revision: parent.operate.authorityRevision,
    ...override
  });
};
const first = (await basis()).parent;
const partial = first.operate.requests.find((item) => item.coverage === "Partially covered");
if (!partial) throw new Error("partial_coverage_case_missing");
const held = await create(pm, partial, "connected-service-partial-held-v1");
if (held.error?.code !== "23514" || !held.error.message.includes("authoritative_service_pricing_required"))
  throw new Error(`partial_service_was_not_held:${held.error?.message ?? "accepted"}`);
let state = (await basis()).parent.operate;
let asset = state.assets.find((item) => item.externalId === "SYNTH-DC3-COVERED-02");
if (!asset) {
  expectSuccess(await operate(pm, "add-asset", {
    name: "Synthetic DC3 supported monitoring panel", kind: "Monitoring panel",
    location: "DC3 hall B, service cabinet", externalId: "SYNTH-DC3-COVERED-02",
    owner: "Pilot Operations Receiver", documentation: "Accepted synthetic turnover source"
  }, "connected-service-covered-asset-v1"), "covered_asset");
  state = (await basis()).parent.operate;
  asset = state.assets.find((item) => item.externalId === "SYNTH-DC3-COVERED-02");
}
let agreement = state.agreements.find((item) => item.name === "Synthetic covered monitoring visit terms");
if (!agreement) {
  expectSuccess(await operate(pm, "add-agreement", {
    assetId: asset.id, name: "Synthetic covered monitoring visit terms",
    kind: "Service agreement", effectiveFrom: "2026-01-01", effectiveTo: "2027-12-31",
    serviceCategories: ["Monitoring inspection"], laborCovered: true,
    partsCovered: true, travelCovered: true,
    includes: "Synthetic inspection labor, parts and travel",
    excludes: "Unrelated expansion work",
    responseHours: 4, calendar: "Business hours",
    source: "SYNTHETIC-PILOT-COVERED-TERMS-NOT-REAL"
  }, "connected-service-covered-agreement-v1"), "covered_agreement");
  state = (await basis()).parent.operate;
  agreement = state.agreements.find((item) => item.name === "Synthetic covered monitoring visit terms");
}
if (agreement.status === "Draft") expectSuccess(await operate(operations, "approve-agreement", {
  agreementId: agreement.id, note: "Independent review of synthetic full service coverage"
}, "connected-service-covered-agreement-approval-v1"), "covered_agreement_approval");
state = (await basis()).parent.operate;
asset = state.assets.find((item) => item.id === asset.id);
if (asset.status === "Pending") {
  const current = await basis();
  const accepted = await operations.rpc("d5o_hosted_accept_supported_asset_v1", {
    p_workspace_key: "rybex", p_parent_presentation_id: parentId,
    p_asset_id: asset.id,
    p_documentation_source: "SYNTHETIC-PILOT-ACCEPTED-TURNOVER-SOURCE",
    p_reason: "Operations reviewed the new asset identity and support documentation",
    p_command_id: "connected-service-covered-asset-accept-v1",
    p_expected_source_revision: current.work.revision,
    p_expected_operate_revision: current.parent.operate.authorityRevision
  });
  expectSuccess(accepted, "asset_support_acceptance");
  state = (await basis()).parent.operate;
}
let request = state.requests.find((item) => item.title === "Synthetic covered monitoring inspection");
if (!request) {
  expectSuccess(await operate(pm, "open-request", {
    assetId: asset.id, title: "Synthetic covered monitoring inspection",
    description: "Inspect a later monitoring fault under the recorded pilot service terms",
    impact: "Standard", contact: "Synthetic Client Representative",
    owner: "Pilot Operations Receiver"
  }, "connected-service-covered-request-v1"), "covered_request");
  state = (await basis()).parent.operate;
  request = state.requests.find((item) => item.title === "Synthetic covered monitoring inspection");
}
if (request.status === "New") {
  expectSuccess(await operate(operations, "triage-request", {
    requestId: request.id, serviceCategory: "Monitoring inspection",
    owner: "Pilot Operations Receiver"
  }, "connected-service-covered-triage-v1"), "covered_triage");
  state = (await basis()).parent.operate;
  request = state.requests.find((item) => item.id === request.id);
}
if (request.coverage !== "Covered") throw new Error("covered_coverage_not_recorded");
let job = state.jobs.find((item) => item.requestId === request.id);
if (!job) {
  const before = await basis();
  const wrongRole = await create(worker, request, "connected-service-worker-denied-v1");
  if (wrongRole.error?.code !== "42501") throw new Error("worker_creation_not_denied");
  const stale = await create(pm, request, "connected-service-stale-denied-v1", {
    p_expected_operate_revision: before.parent.operate.authorityRevision - 1
  });
  if (stale.error?.code !== "23505") throw new Error("stale_creation_not_denied");
  const created = expectSuccess(await create(pm, request, "connected-service-covered-job-v1"), "service_job");
  const replay = expectSuccess(await create(pm, request, "connected-service-covered-job-v1", {
    p_expected_work_revision: -1
  }), "service_job_replay");
  if (replay.workId !== created.workId || replay.jobId !== created.jobId)
    throw new Error("service_job_replay_not_stable");
  const conflicting = await create(pm, request, "connected-service-covered-job-v1", {
    p_owner: "Different intended owner"
  });
  if (conflicting.error?.code !== "23505") throw new Error("conflicting_replay_not_denied");
  job = (await basis()).parent.operate.jobs.find((item) => item.id === created.jobId);
}
const final = await basis();
const child = final.work.state.records.find((item) => item.id === job.workId);
const catalogChild = final.catalog.state.records.find((item) => item.id === job.workId);
if (!child || !catalogChild || child.canonicalWorkId !== catalogChild.canonicalWorkId
  || child.serviceSource?.requestId !== request.id || child.serviceSource?.parentWorkId !== parentId
  || child.design?.releases?.length || child.deploy?.permits?.length)
  throw new Error("service_work_identity_or_authority_invalid");
const forged = await pm.rpc("d5o_hosted_prototype_save_v1", {
  p_workspace_key: "rybex", p_state_key: "work", p_expected_revision: final.work.revision,
  p_state: { ...final.work.state, records: final.work.state.records.map((item) =>
    item.id === child.id ? { ...item, stage: "Operate", status: "complete" } : item) }
});
if (forged.error?.code !== "42501") throw new Error("service_snapshot_bypass_not_denied");
const packageForged = await pm.rpc("d5o_hosted_prototype_save_v1", {
  p_workspace_key: "rybex", p_state_key: "work", p_expected_revision: final.work.revision,
  p_state: { ...final.work.state, records: final.work.state.records.map((item) =>
    item.id === parentId ? { ...item, packages: item.packages.map((entry, index) =>
      index === 0 ? { ...entry, installed: 999 } : entry) } : item) }
});
if (packageForged.error?.code !== "42501") throw new Error("existing_package_guard_regressed");
const draft = expectSuccess(await pm.rpc("d5o_hosted_prototype_save_v1", {
  p_workspace_key: "rybex", p_state_key: "work", p_expected_revision: final.work.revision,
  p_state: { ...final.work.state, revision: final.work.revision + 1 }
}), "ordinary_draft_after_service_creation");
if (!draft.state.records.some((item) => item.id === child.id && item.serviceSource?.requestId === request.id))
  throw new Error("service_projection_lost_on_draft_save");
console.log(JSON.stringify({ status: "covered_service_job_created",
  canonicalWorkId: child.canonicalWorkId, presentationId: child.id,
  parentWorkId: parentId, jobId: job.id,
  partialPricing: "held", workerCreation: "denied", stale: "denied",
  replay: "stable", conflict: "denied", genericBypass: "denied",
  packageBypass: "denied",
  draftCorrection: "preserved", fieldStart: "not authorized" }));
