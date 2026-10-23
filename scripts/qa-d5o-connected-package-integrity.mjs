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
const rpc = async (name, args) => {
  const { data, error } = await client.rpc(name, args);
  if (error) throw error;
  return data;
};
const id = "rybex-a8fd95e7e20d4bb3881c3549459c99e0";
const work = await rpc("d5o_hosted_prototype_read_v1",
  { p_workspace_key: "rybex", p_state_key: "work" });
const catalog = await rpc("d5o_hosted_prototype_read_v1",
  { p_workspace_key: "rybex", p_state_key: "catalog" });
const target = work.state.records.find((item) => item.id === id);
const packages = catalog.state.packages.filter((item) => item.workId === id);
if (packages.length !== 2 || target.packages.length !== 2)
  throw new Error("two_packages_required");
const base = { p_workspace_key: "rybex", p_presentation_id: id,
  p_name: "South fiber path and commissioning", p_owner: "Synthetic Engineering Lead",
  p_command_id: "connected-pilot-package-2-v1",
  p_expected_work_revision: work.revision,
  p_expected_catalog_revision: catalog.revision,
  p_expected_handoff_revision: target.discovery.designHandoff.revision,
  p_expected_package_count: 1 };
const replay = await rpc("d5o_hosted_create_connected_package_v2", base);
if (replay.created.id !== packages[1].id) throw new Error("package_replay_changed_identity");
const conflict = await client.rpc("d5o_hosted_create_connected_package_v2", {
  ...base, p_name: "Altered package name"
});
if (!conflict.error || conflict.error.code !== "23505")
  throw new Error("package_conflicting_replay_allowed");
const stale = await client.rpc("d5o_hosted_create_connected_package_v2", {
  ...base, p_command_id: "connected-pilot-package-stale-v1"
});
if (!stale.error || stale.error.code !== "23505")
  throw new Error("package_stale_count_allowed");
const forged = structuredClone(work.state);
forged.records.find((item) => item.id === id).packages[0].name = "Forged scope";
const generic = await client.rpc("d5o_hosted_prototype_save_v1", {
  p_workspace_key: "rybex", p_state_key: "work",
  p_expected_revision: work.revision, p_state: forged
});
if (!generic.error || generic.error.code !== "42501")
  throw new Error("package_generic_edit_allowed");
const legitimate = await client.rpc("d5o_hosted_prototype_save_v1", {
  p_workspace_key: "rybex", p_state_key: "work",
  p_expected_revision: work.revision, p_state: work.state
});
if (legitimate.error || legitimate.data.state.records.find((item) => item.id === id)
  .packages.length !== 2) throw new Error(`draft_save_broke_package_projection:${legitimate.error?.message}`);
const after = await rpc("d5o_hosted_prototype_read_v1",
  { p_workspace_key: "rybex", p_state_key: "work" });
if (after.state.records.find((item) => item.id === id).packages.length !== 2)
  throw new Error("package_projection_duplicated_on_reload");
console.log(JSON.stringify({ stableReplay: true, conflictingReplay: "rejected",
  staleCount: "rejected", genericMutation: "rejected",
  ordinaryDraftSave: "preserved two packages" }));
