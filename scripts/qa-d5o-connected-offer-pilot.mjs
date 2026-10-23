import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const credentials = process.env.D5O_PILOT_CREDENTIALS_FILE;
if (process.env.D5O_ISOLATED_PILOT !== "1" || url !== "http://127.0.0.1:56321"
  || !anonKey || !credentials) throw new Error("disposable_pilot_only");
const users = JSON.parse(readFileSync(credentials, "utf8")).users;
const id = "rybex-a8fd95e7e20d4bb3881c3549459c99e0";
const signIn = async (email) => {
  const identity = users.find((item) => item.email === email);
  if (!identity) throw new Error(`missing_pilot_identity:${email}`);
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: identity.password });
  if (error) throw new Error(`sign_in_failed:${email}:${error.message}`);
  return client;
};
const rpc = async (client, name, args) => {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(`${name}:${error.code}:${error.message}`);
  return data;
};
const read = (client) => rpc(client, "d5o_hosted_prototype_read_v1",
  { p_workspace_key: "rybex", p_state_key: "work" });
const record = (result) => result.state.records.find((item) => item.id === id);
const pm = await signIn("d5o-pilot-pm@example.test");
const reviewer = await signIn("d5o-pilot-operations@example.test");
let current = await read(pm);
let work = record(current);
if (!work?.canonicalWorkId || work.discovery?.estimate?.status !== "Approved")
  throw new Error("approved_estimate_required");
if (work.discovery.proposal.authorityRevision) {
  console.log(JSON.stringify({ status: "already_present",
    offer: work.discovery.proposal.status,
    revision: work.discovery.proposal.package?.revision }));
  process.exit(0);
}
const estimate = work.discovery.estimate;
const offer = {
  revision: 1, estimateRevision: estimate.revision,
  scope: "Install north and south data hall fiber paths and verify both paths.",
  assumptions: "Customer confirms outage and access windows.",
  exclusions: "Active network equipment and live configuration changes.",
  commercialTerms: "Synthetic training offer; no external commitment.",
  sellPrice: estimate.sellPrice, preparedAt: new Date().toISOString(),
  definitionSource: estimate.definitionSource,
  pricingBasis: {
    policyId: estimate.detailed.evaluation.policyId,
    policyVersion: estimate.detailed.evaluation.policyVersion,
    solutionRevision: estimate.detailed.input.solutionRevision,
    currency: estimate.detailed.input.currency,
    includedCostMinor: estimate.detailed.evaluation.includedCostMinor,
    priceMinor: estimate.detailed.evaluation.proposedPriceMinor
  }
};
const nextState = structuredClone(current.state);
const nextWork = record({ state: nextState });
nextWork.discovery.proposal = {
  ...nextWork.discovery.proposal, status: "Draft", package: offer,
  packageHistory: [offer]
};
current = await rpc(pm, "d5o_hosted_prototype_save_v1", {
  p_workspace_key: "rybex", p_state_key: "work",
  p_expected_revision: current.revision, p_state: nextState
});
if (record(current).discovery.proposal.status !== "Draft")
  throw new Error("offer_draft_not_persisted");
const base = { p_workspace_key: "rybex", p_presentation_id: id,
  p_expected_source_revision: current.revision, p_offer_revision: 1 };
const submitted = await rpc(pm, "d5o_hosted_offer_review_command_v1", {
  ...base, p_action: "submit-proposal", p_due_date: "2026-10-22",
  p_reason: null, p_command_id: "connected-pilot-offer-submit-v1",
  p_expected_decision_revision: 0
});
if (record(submitted).discovery.proposal.status !== "Internal review")
  throw new Error("offer_review_not_opened");
const denied = await pm.rpc("d5o_hosted_offer_review_command_v1", {
  ...base, p_action: "approve-proposal", p_due_date: null,
  p_reason: "Attempted self approval must be rejected",
  p_command_id: "connected-pilot-offer-self-review-denied-v1",
  p_expected_decision_revision: 1
});
if (!denied.error || denied.error.code !== "42501")
  throw new Error("offer_self_review_not_rejected");
const decided = await rpc(reviewer, "d5o_hosted_offer_review_command_v1", {
  ...base, p_action: "approve-proposal", p_due_date: null,
  p_reason: "Reviewed the exact submitted scope, price and pinned policy basis",
  p_command_id: "connected-pilot-offer-approve-v1",
  p_expected_decision_revision: 1
});
const replay = await rpc(reviewer, "d5o_hosted_offer_review_command_v1", {
  ...base, p_action: "approve-proposal", p_due_date: null,
  p_reason: "Reviewed the exact submitted scope, price and pinned policy basis",
  p_command_id: "connected-pilot-offer-approve-v1",
  p_expected_decision_revision: 1
});
const finalPm = await read(pm);
const finalReviewer = await read(reviewer);
const decision = record(finalPm).discovery.proposal;
if (decision.status !== "Approved" || decision.authorityRevision !== 2
  || record(finalReviewer).discovery.proposal.status !== "Approved"
  || record(replay).discovery.proposal.status !== "Approved"
  || record(decided).discovery.proposal.review.submittedByActorId ===
     record(decided).discovery.proposal.review.actorId)
  throw new Error("offer_review_not_independent_or_persistent");
console.log(JSON.stringify({ status: "Approved", offerRevision: 1,
  estimateRevision: estimate.revision,
  currency: offer.pricingBasis.currency,
  priceMinor: offer.pricingBasis.priceMinor,
  separateAuthenticatedReviewer: true,
  exactReplay: true, sourceRevision: finalPm.revision }));
