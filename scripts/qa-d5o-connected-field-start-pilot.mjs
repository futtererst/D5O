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
const supervisor = await login("supervisor"), pm = await login("pm");
const id = "rybex-a8fd95e7e20d4bb3881c3549459c99e0";
const read = async (client, keyName) => {
  const { data, error } = await client.rpc("d5o_hosted_prototype_read_v1",
    { p_workspace_key: "rybex", p_state_key: keyName });
  if (error) throw error;
  return data;
};
const workRead = await read(supervisor, "work");
const scheduleRead = await read(supervisor, "schedule");
const work = workRead.state.records.find((item) => item.id === id);
const [north, south] = work.design.packages;
const input = (packageId, commandId) => ({ p_workspace_key: "rybex",
  p_presentation_id: id,p_package_id: packageId,p_action: "authorize-start",
  p_reason: "All published crew acknowledgments and field conditions checked",
  p_command_id: commandId,p_expected_source_revision: workRead.revision,
  p_expected_design_revision: work.design.authorityRevision,
  p_expected_schedule_revision: scheduleRead.revision,
  p_expected_deploy_revision: work.deploy?.authorityRevision ?? 0 });
const { error: pmError } = await pm.rpc("d5o_hosted_field_start_command_v1",
  input(north.packageId,"connected-pilot-pm-start-denied-v1"));
if (!pmError || pmError.code !== "42501") throw new Error("pm_field_start_not_denied");
const { error: southError } = await supervisor.rpc("d5o_hosted_field_start_command_v1",
  input(south.packageId,"connected-pilot-south-premature-start-v1"));
if (!southError || southError.code !== "23514")
  throw new Error(`south_predecessor_not_blocked:${southError?.code}`);
if (!work.deploy?.permits.some((item) => item.packageId === north.packageId
  && item.status === "Authorized")) {
  const { error } = await supervisor.rpc("d5o_hosted_field_start_command_v1",
    input(north.packageId,"connected-pilot-north-authorize-start-v1"));
  if (error) throw new Error(`north_start:${error.code}:${error.message}`);
}
const after = await read(supervisor, "work");
const saved = after.state.records.find((item) => item.id === id);
if (saved.deploy.permits.filter((item) => item.status === "Authorized").length !== 1
  || saved.deploy.permits[0].releaseId !== work.design.releases[0].id)
  throw new Error("exact_north_field_permit_not_persisted");
console.log(JSON.stringify({ status: "north_field_start_authorized",
  authorizedPackages: 1, southPredecessor: "blocked",
  projectManager: "denied", releaseBound: true }));
