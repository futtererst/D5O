import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const credentials = process.env.D5O_PILOT_CREDENTIALS_FILE;
if (process.env.D5O_ISOLATED_PILOT !== "1" || url !== "http://127.0.0.1:56321"
  || !anonKey || !credentials) throw new Error("disposable_pilot_only");
const identity = JSON.parse(readFileSync(credentials, "utf8")).users
  .find((item) => item.email === "d5o-pilot-pm@example.test");
const client = createClient(url, anonKey, { auth: { persistSession: false } });
const { error: signInError } = await client.auth.signInWithPassword(identity);
if (signInError) throw signInError;
const read = async () => {
  const { data, error } = await client.rpc("d5o_hosted_prototype_read_v1",
    { p_workspace_key: "rybex", p_state_key: "work" });
  if (error) throw error;
  return data;
};
const id = "rybex-a8fd95e7e20d4bb3881c3549459c99e0";
const before = await read();
const target = before.state.records.find((item) => item.id === id);
if (target.discovery.outcome !== "Won") throw new Error("award_required");
const forgery = structuredClone(before.state);
forgery.records.find((item) => item.id === id).discovery.proposal.responseEvents
  .at(-1).sourceReference = "CHANGED-WITHOUT-COMMAND";
const generic = await client.rpc("d5o_hosted_prototype_save_v1", {
  p_workspace_key: "rybex", p_state_key: "work",
  p_expected_revision: before.revision, p_state: forgery
});
if (!generic.error || generic.error.code !== "42501")
  throw new Error(`generic_decision_forgery_allowed:${generic.error?.code}`);
const base = { p_workspace_key: "rybex", p_presentation_id: id,
  p_action: "record-customer-response", p_offer_revision: 1,
  p_recipient: null, p_method: null, p_due_date: null,
  p_response_status: "Awarded", p_received_at: "2026-10-09",
  p_details: "Synthetic pilot buyer selected the exact Data Hall B dual-path offer.",
  p_source_reference: "SYNTHETIC-PILOT-AWARD-DH-B-01",
  p_next_action: null, p_follow_up_due: null,
  p_expected_source_revision: before.revision,
  p_expected_decision_revision: target.discovery.proposal.authorityRevision
};
const conflict = await client.rpc("d5o_hosted_customer_decision_command_v1", {
  ...base, p_command_id: "connected-pilot-customer-award-v1"
});
if (!conflict.error || conflict.error.code !== "23505")
  throw new Error(`conflicting_replay_allowed:${conflict.error?.code}`);
const stale = await client.rpc("d5o_hosted_customer_decision_command_v1", {
  ...base, p_command_id: "connected-pilot-customer-stale-v1",
  p_expected_decision_revision: 2
});
if (!stale.error || stale.error.code !== "23505")
  throw new Error(`stale_customer_command_allowed:${stale.error?.code}`);
const crossTenant = await client.rpc("d5o_hosted_customer_decision_command_v1", {
  ...base, p_workspace_key: "rotork", p_command_id: "connected-pilot-customer-cross-v1"
});
if (!crossTenant.error || crossTenant.error.code !== "42501")
  throw new Error(`cross_tenant_command_allowed:${crossTenant.error?.code}`);
const after = await read();
if (after.revision !== before.revision || after.state.records.find((item) => item.id === id)
  .discovery.proposal.responseEvents.at(-1).sourceReference !==
    "SYNTHETIC-PILOT-AWARD-DH-B-01") throw new Error("denied_command_changed_state");
console.log(JSON.stringify({ genericForgery: "rejected", conflictingReplay: "rejected",
  stale: "rejected", crossTenant: "rejected", unchanged: true }));
