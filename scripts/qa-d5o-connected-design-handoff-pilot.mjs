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
const receiver = await signIn("d5o-pilot-operations@example.test");
const current = await read(pm);
const work = record(current);
if (work.discovery?.outcome !== "Won" || work.discovery?.proposal?.status !== "Submitted")
  throw new Error("awarded_offer_required");
if (work.discovery.designHandoff?.status === "accepted") {
  console.log(JSON.stringify({ status: "already_accepted",
    handoffRevision: work.discovery.designHandoff.revision }));
  process.exit(0);
}
const base = { p_workspace_key: "rybex", p_presentation_id: id,
  p_expected_source_revision: current.revision,
  p_offer_revision: work.discovery.proposal.package.revision };
const submitted = await rpc(pm, "d5o_hosted_design_handoff_command_v1", {
  ...base, p_action: "submit-design-handoff", p_due_date: "2026-10-23",
  p_reason: null, p_command_id: "connected-pilot-design-handoff-submit-v1",
  p_expected_decision_revision: 0, p_handoff_revision: 1
});
const handoff = record(submitted).discovery.designHandoff;
if (handoff?.status !== "submitted" || handoff.brief.offerRevision !== 1
  || !handoff.brief.develop?.estimateSnapshot?.evaluation)
  throw new Error("exact_handoff_brief_missing");
const denied = await pm.rpc("d5o_hosted_design_handoff_command_v1", {
  ...base, p_action: "accept-design-handoff", p_due_date: null,
  p_reason: "Attempted self-receipt must remain prohibited for this exact source.",
  p_command_id: "connected-pilot-design-handoff-self-denied-v1",
  p_expected_decision_revision: 1, p_handoff_revision: 1
});
if (!denied.error || denied.error.code !== "42501")
  throw new Error(`self_receipt_allowed:${denied.error?.code}`);
const accepted = await rpc(receiver, "d5o_hosted_design_handoff_command_v1", {
  ...base, p_action: "accept-design-handoff", p_due_date: null,
  p_reason: "Received the exact approved Define, solution, estimate, offer and synthetic award basis.",
  p_command_id: "connected-pilot-design-handoff-accept-v1",
  p_expected_decision_revision: 1, p_handoff_revision: 1
});
const finalPm = record(await read(pm));
const finalReceiver = record(await read(receiver));
if (record(accepted).discovery.designHandoff.status !== "accepted"
  || finalPm.discovery.designHandoff.status !== "accepted"
  || finalReceiver.discovery.designHandoff.status !== "accepted"
  || finalReceiver.discovery.designHandoff.decidedByActorId ===
    finalReceiver.discovery.designHandoff.submittedByActorId)
  throw new Error("independent_receipt_not_persistent");
console.log(JSON.stringify({ status: "accepted", handoffRevision: 1,
  exactOfferRevision: handoff.brief.offerRevision,
  exactDefineRevision: handoff.brief.definitionRevision,
  independentReceiver: true, separateSessionsAgree: true }));
