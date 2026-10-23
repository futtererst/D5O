import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const file = process.env.D5O_PILOT_CREDENTIALS_FILE;
if (process.env.D5O_ISOLATED_PILOT !== "1" || url !== "http://127.0.0.1:56321"
  || !key || !file) throw new Error("disposable_pilot_only");
const users = JSON.parse(readFileSync(file, "utf8")).users;
const login = async (name) => {
  const user = users.find((item) => item.key === name);
  const client = createClient(url, key, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({
    email: user.email, password: user.password });
  if (error) throw error;
  return client;
};
const pm = await login("pm"), supervisor = await login("supervisor");
const id = "rybex-a8fd95e7e20d4bb3881c3549459c99e0";
const read = async () => {
  const { data, error } = await pm.rpc("d5o_hosted_prototype_read_v1",
    { p_workspace_key: "rybex", p_state_key: "work" });
  if (error) throw error;
  return data;
};
const current = await read();
const target = current.state.records.find((item) => item.id === id);
if (target.deploy?.permits?.length !== 1) throw new Error("north_permit_required");
const base = { p_workspace_key: "rybex",p_presentation_id: id,
  p_package_id: target.deploy.permits[0].packageId,p_action: "authorize-start",
  p_reason: "All published crew acknowledgments and field conditions checked",
  p_expected_source_revision: current.revision,
  p_expected_design_revision: target.design.authorityRevision,
  p_expected_schedule_revision: (await pm.rpc("d5o_hosted_prototype_read_v1",
    { p_workspace_key: "rybex", p_state_key: "schedule" })).data.revision,
  p_expected_deploy_revision: target.deploy.authorityRevision };
const denied = async (client, name, args, codes) => {
  const { error } = await client.rpc(name, args);
  if (!error || !codes.includes(error.code))
    throw new Error(`${name}:expected_denial:${error?.code ?? "accepted"}:${error?.message ?? ""}`);
};
await denied(pm,"d5o_hosted_field_start_command_v1",
  { ...base,p_command_id: "connected-pilot-integrity-pm-start-v1" },["42501"]);
await denied(supervisor,"d5o_hosted_field_start_command_v1",
  { ...base,p_expected_schedule_revision: base.p_expected_schedule_revision-1,
    p_command_id: "connected-pilot-integrity-stale-schedule-v1" },["23505"]);
await denied(supervisor,"d5o_hosted_field_start_command_v1",
  { ...base,p_command_id: "connected-pilot-north-authorize-start-v1" },["23505"]);
await denied(pm,"d5o_hosted_prototype_save_v1",{
  p_workspace_key: "rybex",p_state_key: "work",p_expected_revision: current.revision,
  p_state: { ...current.state,records: current.state.records.map((item) =>
    item.id === id ? { ...item,deploy: { ...item.deploy,permits: [] } } : item) }
},["42501"]);
const { data: saved, error: saveError } = await pm.rpc("d5o_hosted_prototype_save_v1",{
  p_workspace_key: "rybex",p_state_key: "work",p_expected_revision: current.revision,
  p_state: { ...current.state,revision: current.revision+1 }
});
if (saveError) throw new Error(`ordinary_draft_save_failed:${saveError.code}:${saveError.message}`);
const after = saved.state.records.find((item) => item.id === id);
if (after.deploy.permits.length !== 1 || after.deploy.permits[0].id !== target.deploy.permits[0].id)
  throw new Error("field_start_not_preserved_after_draft_save");
console.log(JSON.stringify({ status: "field_start_integrity_passed",
  staleSchedule: "rejected",wrongRole: "rejected",conflictingReplay: "rejected",
  genericBypass: "rejected",ordinaryDraftSave: "preserved" }));
