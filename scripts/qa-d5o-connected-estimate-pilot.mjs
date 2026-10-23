import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const credentialPath = process.env.D5O_PILOT_CREDENTIALS_FILE;
if (process.env.D5O_ISOLATED_PILOT !== "1" || url !== "http://127.0.0.1:56321"
  || !anonKey || !credentialPath) throw new Error("disposable_pilot_only");

const users = JSON.parse(readFileSync(credentialPath, "utf8")).users;
const pilotId = "rybex-a8fd95e7e20d4bb3881c3549459c99e0";
const session = async (email) => {
  const identity = users.find((item) => item.email === email);
  if (!identity) throw new Error(`missing_pilot_identity:${email}`);
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: identity.password });
  if (error) throw new Error(`pilot_sign_in_failed:${email}:${error.message}`);
  return client;
};
const run = async (client, name, args) => {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(`${name}:${error.code}:${error.message}`);
  return data;
};
const current = async (client) => {
  const result = await run(client, "d5o_hosted_prototype_read_v1", {
    p_workspace_key: "rybex", p_state_key: "work"
  });
  return { revision: result.revision,
    work: result.state.records.find((item) => item.id === pilotId) };
};

const pm = await session("d5o-pilot-pm@example.test");
const reviewer = await session("d5o-pilot-operations@example.test");
const before = await current(pm);
if (!before.work?.canonicalWorkId || before.work.develop?.review?.status !== "Approved")
  throw new Error("approved_solution_required");
if (before.work.discovery?.estimate?.authorityRevision) {
  console.log(JSON.stringify({ status: "already_present",
    estimate: before.work.discovery.estimate.status,
    revision: before.work.discovery.estimate.revision }));
  process.exit(0);
}
const input = {
  currency: "USD", workType: before.work.type, customer: before.work.customer,
  region: before.work.site, pricedAt: "2026-10-09",
  lines: [{ id: "labor-paths", scopeRef: "dual-corridor-solution",
    category: "labor", description: "Fiber installation and testing",
    quantity: "1000", unit: "hour", rateId: "fiber-tech-hour",
    source: "Isolated pilot labor catalog",
    assumption: "Separate north and south route effort" }],
  discountPercent: 0,
  riskBasis: "Pilot policy contingency; customer windows remain assumptions",
  estimateMaturity: "Budgetary", definitionRevision: before.work.definition.revision,
  solutionRevision: before.work.develop.revision
};
const base = { p_workspace_key: "rybex", p_presentation_id: pilotId,
  p_expected_source_revision: before.revision, p_estimate_revision: 1 };
const saved = await run(pm, "d5o_hosted_estimate_command_v1", {
  ...base, p_action: "save-detailed-estimate", p_input: input,
  p_due_date: null, p_reason: null,
  p_command_id: "connected-pilot-estimate-save-v1", p_expected_decision_revision: 0
});
const draft = saved.state.records.find((item) => item.id === pilotId).discovery.estimate;
if (draft.status !== "Draft" || draft.detailed.evaluation.includedCostMinor !== 9181250
  || draft.detailed.evaluation.proposedPriceMinor !== 13116072)
  throw new Error("estimate_arithmetic_mismatch");
await run(pm, "d5o_hosted_estimate_command_v1", {
  ...base, p_action: "submit-pricing", p_input: null,
  p_due_date: "2026-10-20", p_reason: null,
  p_command_id: "connected-pilot-estimate-submit-v1", p_expected_decision_revision: 1
});
await run(reviewer, "d5o_hosted_estimate_command_v1", {
  ...base, p_action: "approve-pricing", p_input: null, p_due_date: null,
  p_reason: "Pilot price reviewed against published labor rate and margin policy",
  p_command_id: "connected-pilot-estimate-approve-v1", p_expected_decision_revision: 2
});
const finalPm = await current(pm);
const finalReviewer = await current(reviewer);
const result = finalPm.work.discovery.estimate;
if (result.status !== "Approved" || result.authorityRevision !== 3
  || finalReviewer.work.discovery.estimate.status !== "Approved"
  || result.review.submittedByActorId === result.review.actorId)
  throw new Error("pricing_review_not_independent_or_persistent");
console.log(JSON.stringify({ status: "approved", revision: result.revision,
  policy: `${result.detailed.evaluation.policyId} v${result.detailed.evaluation.policyVersion}`,
  includedCostMinor: result.detailed.evaluation.includedCostMinor,
  proposedPriceMinor: result.detailed.evaluation.proposedPriceMinor,
  distinctAuthenticatedActors: true, sourceRevision: finalPm.revision }));
