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
const ops = await signIn("d5o-pilot-operations@example.test");
let current = await read(pm);
let offer = record(current)?.discovery?.proposal;
if (!offer || offer.status !== "Approved" || offer.package?.revision !== 1)
  throw new Error("approved_offer_required");
const base = { p_workspace_key: "rybex", p_presentation_id: id,
  p_offer_revision: 1, p_expected_source_revision: current.revision };
const submission = await rpc(pm, "d5o_hosted_customer_decision_command_v1", {
  ...base, p_action: "record-customer-submission",
  p_recipient: "Synthetic Data Hall B Buyer",
  p_method: "Customer portal", p_due_date: "2026-10-30",
  p_response_status: null, p_received_at: null, p_details: null,
  p_source_reference: null, p_next_action: null, p_follow_up_due: null,
  p_command_id: "connected-pilot-customer-submission-v1",
  p_expected_decision_revision: offer.authorityRevision
});
if (record(submission).discovery.proposal.status !== "Submitted"
  || record(submission).discovery.proposal.submission.packageSnapshot.sellPrice !==
    offer.package.sellPrice) throw new Error("exact_submission_not_saved");
const replay = await rpc(pm, "d5o_hosted_customer_decision_command_v1", {
  ...base, p_action: "record-customer-submission",
  p_recipient: "Synthetic Data Hall B Buyer",
  p_method: "Customer portal", p_due_date: "2026-10-30",
  p_response_status: null, p_received_at: null, p_details: null,
  p_source_reference: null, p_next_action: null, p_follow_up_due: null,
  p_command_id: "connected-pilot-customer-submission-v1",
  p_expected_decision_revision: offer.authorityRevision
});
if (record(replay).discovery.proposal.submission.recordedAt !==
  record(submission).discovery.proposal.submission.recordedAt)
  throw new Error("submission_replay_changed");
current = await read(ops);
offer = record(current).discovery.proposal;
const response = await rpc(ops, "d5o_hosted_customer_decision_command_v1", {
  ...base, p_action: "record-customer-response",
  p_recipient: null, p_method: null, p_due_date: null,
  p_response_status: "Awarded", p_received_at: "2026-10-09",
  p_details: "Synthetic pilot buyer selected the exact Data Hall B dual-path offer.",
  p_source_reference: "SYNTHETIC-PILOT-AWARD-DH-B-01",
  p_next_action: null, p_follow_up_due: null,
  p_command_id: "connected-pilot-customer-award-v1",
  p_expected_decision_revision: offer.authorityRevision
});
const latest = record(response).discovery;
const finalPm = record(await read(pm)).discovery;
if (latest.outcome !== "Won" || latest.phase !== "Outcome"
  || latest.proposal.responseEvents.at(-1).sourceReference !==
    "SYNTHETIC-PILOT-AWARD-DH-B-01"
  || finalPm.outcome !== "Won"
  || finalPm.proposal.submission.packageSnapshot.sellPrice !== offer.package.sellPrice)
  throw new Error("award_projection_or_persistence_failed");
console.log(JSON.stringify({ status: "synthetic_award_recorded",
  offerRevision: offer.package.revision,
  sourceReference: latest.proposal.responseEvents.at(-1).sourceReference,
  pmAndOperationsSessionsAgree: true, submissionReplay: true }));
