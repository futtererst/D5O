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
const [pm, operations, finance] = await Promise.all([
  login("pm"), login("operations"), login("finance")
]);
const id = "rybex-a8fd95e7e20d4bb3881c3549459c99e0";
const read = async () => {
  const { data, error } = await pm.rpc("d5o_hosted_prototype_read_v1", {
    p_workspace_key: "rybex", p_state_key: "work"
  });
  if (error) throw error;
  return { source: data, work: data.state.records.find((item) => item.id === id) };
};
const send = async (client, action, input, commandId) => {
  const { source, work } = await read();
  return client.rpc("d5o_hosted_operate_command_v1", {
    p_workspace_key: "rybex",p_presentation_id: id,p_action: action,
    p_input: input,p_command_id: commandId,
    p_expected_source_revision: source.revision,
    p_expected_deploy_revision: work.deploy.authorityRevision,
    p_expected_operate_revision: work.operate?.authorityRevision ?? 0
  });
};
const success = ({ error }, label) => { if (error) throw new Error(`${label}:${error.code}:${error.message}`); };
let current = (await read()).work;
if (!current.operate?.source) success(await send(operations, "receive-handoff", {
  workAcceptanceId: current.deploy.workAcceptance.id,
  workAcceptanceRevision: current.deploy.workAcceptance.revision,
  note: "Operations receives exact accepted two-package pilot turnover"
}, "connected-operate-source-receipt-v1"), "operate_receipt");
current = (await read()).work;
if (!current.operate.assets.length) success(await send(pm, "add-asset", {
  name: "Synthetic DC3 monitoring fiber route",kind: "Fiber infrastructure",
  location: "DC3 hall B, monitoring route",externalId: "SYNTH-DC3-FIBER-01",
  owner: "Pilot Operations Receiver",documentation: "Two accepted package turnover manifests"
}, "connected-operate-add-asset-v1"), "asset");
current = (await read()).work;
if (!current.operate.support) success(await send(operations, "accept-support", {
  customerContact: "Synthetic Client Representative",
  escalation: "Pilot operations escalation queue",
  intakeRoute: "Pilot service request work surface",
  warrantyDisposition: "Explicit limited warranty recorded separately",
  serviceDisposition: "Service agreement requires separate approval",
  documentation: "Reviewed two exact accepted package turnover manifests",
  residualOwner: "Pilot Operations Receiver"
}, "connected-operate-support-owner-v1"), "support_owner");
current = (await read()).work;
if (!current.operate.activation) {
  const wrong = await send(pm, "activate", { note: "Project manager cannot activate support" },
    "connected-operate-pm-activation-denied-v1");
  if (!wrong.error || wrong.error.code !== "23514") throw new Error("pm_activation_not_denied");
  success(await send(operations, "activate", {
    note: "Support intake, ownership, documents and asset checked"
  }, "connected-operate-activation-v1"), "activation");
}
current = (await read()).work;
if (current.operate.finance.status !== "Pending") throw new Error("finance_was_auto_closed");
const assetId = current.operate.assets[0].id;
if (!current.operate.agreements.length) success(await send(pm, "add-agreement", {
  assetId,name: "Synthetic DC3 monitoring service agreement",
  kind: "Service agreement",effectiveFrom: "2026-01-01",effectiveTo: "2027-12-31",
  serviceCategories: ["Monitoring fault"],laborCovered: true,
  partsCovered: false,travelCovered: false,
  includes: "Remote diagnosis and routine monitoring labor",
  excludes: "Parts and travel require separate authorization",
  responseHours: 4,calendar: "Business hours",
  source: "SYNTHETIC-PILOT-SERVICE-AGREEMENT-NOT-REAL"
}, "connected-operate-agreement-draft-v1"), "agreement_draft");
current = (await read()).work;
const agreement = current.operate.agreements[0];
if (agreement.status === "Draft") success(await send(operations, "approve-agreement", {
  agreementId: agreement.id,note: "Independent review of synthetic structured service terms"
}, "connected-operate-agreement-approve-v1"), "agreement_approval");
current = (await read()).work;
if (!current.operate.requests.length) success(await send(pm, "open-request", {
  assetId,title: "Synthetic monitoring route fault",
  description: "Intermittent monitoring continuity needs an inspected service visit",
  impact: "High",contact: "Synthetic Client Representative",owner: "Pilot Operations Receiver"
}, "connected-operate-request-open-v1"), "request_open");
current = (await read()).work;
const request = current.operate.requests[0];
if (request.status === "New") success(await send(operations, "triage-request", {
  requestId: request.id,serviceCategory: "Monitoring fault",owner: "Pilot Operations Receiver"
}, "connected-operate-request-triage-v1"), "request_triage");
current = (await read()).work;
if (!current.operate.requests[0].responseDueAt
  || current.operate.requests[0].coverage !== "Partially covered")
  throw new Error("structured_coverage_or_sla_missing");
if (current.operate.finance.status !== "Pending") throw new Error("finance_closed_by_activation");
success(await send(finance, "update-finance", {
  status: "In review",note: "Finance independently reviews pilot closeout obligations"
}, "connected-operate-finance-review-v1"), "finance_review");
const final = (await read()).work;
if (final.operate.finance.status !== "In review"
  || final.operate.activation.status !== "Active") throw new Error("finance_and_support_not_separate");
console.log(JSON.stringify({ status: "asset_linked_request_and_finance_role",
  support: "Active", finance: "In review", coverage: "Partially covered",
  responseDue: "Recorded", serviceJob: "not_yet_generated" }));
