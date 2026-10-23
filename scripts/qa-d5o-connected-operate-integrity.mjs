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
    p_workspace_key: "rybex",p_state_key: "work"
  });
  if (error) throw error;
  return data;
};
const current = await read();
const work = current.state.records.find((item) => item.id === id);
const base = { p_workspace_key: "rybex",p_presentation_id: id,
  p_expected_source_revision: current.revision,
  p_expected_deploy_revision: work.deploy.authorityRevision,
  p_expected_operate_revision: work.operate.authorityRevision };
const denied = async (client, name, args, codes) => {
  const { error } = await client.rpc(name, args);
  if (!error || !codes.includes(error.code))
    throw new Error(`${name}:expected_denial:${error?.code ?? "accepted"}:${error?.message ?? ""}`);
};
await denied(pm,"d5o_hosted_operate_command_v1",{ ...base,p_action: "update-finance",
  p_input: { status: "Closed",note: "Project manager cannot close Finance" },
  p_command_id: "connected-integrity-pm-finance-denied-v1" },["42501"]);
await denied(finance,"d5o_hosted_operate_command_v1",{ ...base,p_action: "activate",
  p_input: { note: "Finance cannot grant operational activation" },
  p_command_id: "connected-integrity-finance-activation-denied-v1" },["23514"]);
await denied(operations,"d5o_hosted_operate_command_v1",{ ...base,
  p_expected_operate_revision: base.p_expected_operate_revision-1,
  p_action: "update-finance",p_input: { status: "Closed",note: "Stale attempt" },
  p_command_id: "connected-integrity-stale-operate-v1" },["23505"]);
await denied(operations,"d5o_hosted_operate_command_v1",{ ...base,
  p_action: "activate",p_input: { note: "Replay with different intent" },
  p_command_id: "connected-operate-activation-v1" },["23505"]);
await denied(pm,"d5o_hosted_prototype_save_v1",{
  p_workspace_key: "rybex",p_state_key: "work",p_expected_revision: current.revision,
  p_state: { ...current.state,records: current.state.records.map((item) =>
    item.id === id ? { ...item,operate: { ...item.operate,finance: {
      status: "Closed",owner: "Project manager",note: "Forged" } } } : item) }
},["42501"]);
const { data: saved,error: draftError } = await pm.rpc("d5o_hosted_prototype_save_v1",{
  p_workspace_key: "rybex",p_state_key: "work",p_expected_revision: current.revision,
  p_state: { ...current.state,revision: current.revision+1 }
});
if (draftError) throw new Error(`ordinary_draft_save_failed:${draftError.code}:${draftError.message}`);
const after = saved.state.records.find((item) => item.id === id);
if (after.operate.finance.status !== "In review" || after.operate.activation.status !== "Active")
  throw new Error("operate_decisions_not_preserved");
console.log(JSON.stringify({ status: "operate_integrity_passed",
  wrongRole: "rejected",stale: "rejected",replayConflict: "rejected",
  genericBypass: "rejected",ordinaryDraftCorrection: "preserved" }));
