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
const { error: signInError } = await client.auth.signInWithPassword({
  email: identity.email, password: identity.password
});
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
if (target.discovery.designHandoff?.status !== "accepted") throw new Error("handoff_required");
const forged = structuredClone(before.state);
forged.records.find((item) => item.id === id).discovery.designHandoff.status = "returned";
const denied = await client.rpc("d5o_hosted_prototype_save_v1", {
  p_workspace_key: "rybex", p_state_key: "work",
  p_expected_revision: before.revision, p_state: forged
});
if (!denied.error || denied.error.code !== "42501")
  throw new Error(`generic_handoff_mutation_allowed:${denied.error?.code}`);
const unchanged = await read();
if (unchanged.revision !== before.revision) throw new Error("denied_mutation_changed_revision");
const legitimate = await client.rpc("d5o_hosted_prototype_save_v1", {
  p_workspace_key: "rybex", p_state_key: "work",
  p_expected_revision: unchanged.revision, p_state: unchanged.state
});
if (legitimate.error || legitimate.data.state.records.find((item) => item.id === id)
  .discovery.designHandoff.status !== "accepted")
  throw new Error(`unchanged_draft_save_failed:${legitimate.error?.message}`);
const after = await read();
if (after.state.records.find((item) => item.id === id).discovery.designHandoff.status !== "accepted")
  throw new Error("handoff_projection_not_persistent");
console.log(JSON.stringify({ genericHandoffMutation: "rejected",
  ordinaryDraftSave: "preserved accepted receipt", reload: true }));
