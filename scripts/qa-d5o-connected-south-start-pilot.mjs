import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const file = process.env.D5O_PILOT_CREDENTIALS_FILE;
if (process.env.D5O_ISOLATED_PILOT !== "1" || url !== "http://127.0.0.1:56321" || !key || !file)
  throw new Error("disposable_pilot_only");
const users = JSON.parse(readFileSync(file, "utf8")).users;
const user = users.find((item) => item.key === "supervisor");
const client = createClient(url, key, { auth: { persistSession: false } });
const { error: authError } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
if (authError) throw authError;
const read = async (stateKey) => {
  const { data, error } = await client.rpc("d5o_hosted_prototype_read_v1", {
    p_workspace_key: "rybex", p_state_key: stateKey
  });
  if (error) throw error;
  return data;
};
const [source, schedule] = await Promise.all([read("work"), read("schedule")]);
const id = "rybex-a8fd95e7e20d4bb3881c3549459c99e0";
const work = source.state.records.find((item) => item.id === id);
const south = work.design.packages[1].packageId;
if (!work.deploy.permits.some((item) => item.packageId === south && item.status === "Authorized")) {
  const { error } = await client.rpc("d5o_hosted_field_start_command_v1", {
    p_workspace_key: "rybex",p_presentation_id: id,p_package_id: south,
    p_action: "authorize-start",p_reason: "North predecessor has reviewed measured completion and verification",
    p_command_id: "connected-pilot-south-authorize-after-north-v1",
    p_expected_source_revision: source.revision,
    p_expected_design_revision: work.design.authorityRevision,
    p_expected_schedule_revision: schedule.revision,
    p_expected_deploy_revision: work.deploy.authorityRevision
  });
  if (error) throw new Error(`south_start:${error.code}:${error.message}`);
}
const after = await read("work");
const updated = after.state.records.find((item) => item.id === id);
if (!updated.deploy.permits.some((item) => item.packageId === south && item.status === "Authorized"))
  throw new Error("south_permit_missing");
console.log(JSON.stringify({ status: "south_start_authorized_after_north_completion",
  predecessor: "reviewed_measured_completion", southRelease: "accepted" }));
