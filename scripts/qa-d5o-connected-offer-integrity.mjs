import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const path = process.env.D5O_PILOT_CREDENTIALS_FILE;
if (process.env.D5O_ISOLATED_PILOT !== "1" || url !== "http://127.0.0.1:56321"
  || !key || !path) throw new Error("disposable_pilot_only");
const users = JSON.parse(readFileSync(path, "utf8")).users;
const pilotId = "rybex-a8fd95e7e20d4bb3881c3549459c99e0";
async function session(email) {
  const identity = users.find((user) => user.email === email);
  if (!identity) throw new Error("missing_pilot_identity");
  const client = createClient(url, key, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: identity.password });
  if (error) throw new Error(`sign_in_failed:${error.message}`);
  return client;
}
const pm = await session("d5o-pilot-pm@example.test");
const operations = await session("d5o-pilot-operations@example.test");
const read = async (client) => {
  const { data, error } = await client.rpc("d5o_hosted_prototype_read_v1",
    { p_workspace_key: "rybex", p_state_key: "work" });
  if (error) throw new Error(`read_failed:${error.code}`);
  return data;
};
const current = await read(pm);
const work = current.state.records.find((item) => item.id === pilotId);
if (work?.discovery?.proposal?.status !== "Approved")
  throw new Error("approved_offer_required");
const forged = structuredClone(current.state);
forged.records.find((item) => item.id === pilotId).discovery.proposal.status = "Submitted";
const fake = await pm.rpc("d5o_hosted_prototype_save_v1", {
  p_workspace_key: "rybex", p_state_key: "work",
  p_expected_revision: current.revision, p_state: forged
});
if (fake.error?.code !== "42501") throw new Error("generic_offer_forgery_not_rejected");
const approval = { p_workspace_key: "rybex", p_presentation_id: pilotId,
  p_action: "approve-proposal", p_due_date: null,
  p_expected_source_revision: current.revision, p_expected_decision_revision: 1,
  p_offer_revision: 1 };
const conflicting = await operations.rpc("d5o_hosted_offer_review_command_v1", {
  ...approval, p_reason: "Different text must not reuse the original receipt",
  p_command_id: "connected-pilot-offer-approve-v1"
});
if (conflicting.error?.code !== "23505") throw new Error("conflicting_replay_not_rejected");
const stale = await operations.rpc("d5o_hosted_offer_review_command_v1", {
  ...approval, p_reason: "Old decision revision must remain stale",
  p_command_id: "connected-pilot-offer-stale-probe-v1"
});
if (stale.error?.code !== "23505") throw new Error("stale_offer_decision_not_rejected");
const wrongTenant = await operations.rpc("d5o_hosted_offer_review_command_v1", {
  ...approval, p_workspace_key: "rotork", p_reason: "Cross-tenant probe",
  p_command_id: "connected-pilot-offer-cross-tenant-v1"
});
if (wrongTenant.error?.code !== "42501") throw new Error("cross_tenant_offer_not_rejected");
const after = await read(pm);
if (after.revision !== current.revision ||
  after.state.records.find((item) => item.id === pilotId).discovery.proposal.status !== "Approved")
  throw new Error("denied_command_changed_state");
console.log(JSON.stringify({ status: "passed", genericForgery: "rejected",
  conflictingReplay: "rejected", staleDecision: "rejected",
  crossTenant: "rejected", stateUnchanged: true }));
