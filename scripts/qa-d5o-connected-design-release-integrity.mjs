import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const file = process.env.D5O_PILOT_CREDENTIALS_FILE;
if (process.env.D5O_ISOLATED_PILOT !== "1" || url !== "http://127.0.0.1:56321"
  || !key || !file) throw new Error("disposable_pilot_only");
const users = JSON.parse(readFileSync(file, "utf8")).users;
const login = async (name) => {
  const identity = users.find((item) => item.key === name);
  const client = createClient(url, key, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({
    email: identity.email, password: identity.password });
  if (error) throw error;
  return client;
};
const pm = await login("pm");
const worker = await login("worker");
const id = "rybex-a8fd95e7e20d4bb3881c3549459c99e0";
const { data: current, error: readError } = await pm.rpc("d5o_hosted_prototype_read_v1",
  { p_workspace_key: "rybex", p_state_key: "work" });
if (readError) throw readError;
const target = current.state.records.find((item) => item.id === id);
const accepted = target.design.releases.find((item) => item.status === "Accepted");
if (!accepted) throw new Error("accepted_release_required");
const originalReceipt = target.design.history.find((item) => item.action.includes("respond-receipt"));
const originalCommandId = originalReceipt?.action.split(" · ").at(-1);
if (!originalCommandId) throw new Error("receipt_command_missing");
const base = { p_workspace_key: "rybex", p_presentation_id: id,
  p_action: "release-package", p_input: { packageId: accepted.packageId,
    receivingOwner: "Operations receiver", dueDate: "2026-10-25",
    note: "Attempt a duplicate release with stale design decision revision" },
  p_expected_source_revision: current.revision,
  p_expected_decision_revision: target.design.authorityRevision };
const expect = async (client, name, args, allowed) => {
  const { error } = await client.rpc(name, args);
  if (!error || !allowed.includes(error.code))
    throw new Error(`${name}:expected_rejection:${error?.code ?? "accepted"}:${error?.message ?? ""}`);
};
await expect(pm, "d5o_hosted_design_release_command_v1",
  { ...base, p_command_id: "connected-pilot-integrity-duplicate-release-v1" }, ["23514"]);
await expect(worker, "d5o_hosted_design_release_command_v1",
  { ...base, p_command_id: "connected-pilot-integrity-worker-release-v1" }, ["42501"]);
await expect(pm, "d5o_hosted_design_release_command_v1",
  { ...base, p_expected_decision_revision: target.design.authorityRevision - 1,
    p_command_id: "connected-pilot-integrity-stale-release-v1" }, ["23505"]);
await expect(pm, "d5o_hosted_design_release_command_v1",
  { ...base, p_workspace_key: "rotork",
    p_command_id: "connected-pilot-integrity-cross-tenant-v1" }, ["42501"]);
const tampered = { ...current.state,
  records: current.state.records.map((record) => record.id === id
    ? { ...record, design: { ...record.design, releases: [] } } : record) };
await expect(pm, "d5o_hosted_prototype_save_v1", {
  p_workspace_key: "rybex", p_state_key: "work",
  p_expected_revision: current.revision, p_state: tampered
}, ["42501"]);
const { data: schedule, error: scheduleError } = await pm.rpc(
  "d5o_hosted_prototype_read_v1", { p_workspace_key: "rybex", p_state_key: "schedule" });
if (scheduleError) throw scheduleError;
if (schedule.state.packageDemands.filter((item) => item.workId === id).length !== 2)
  throw new Error("dated_demand_not_projected_into_schedule");
const { data: after, error: afterError } = await pm.rpc("d5o_hosted_prototype_read_v1",
  { p_workspace_key: "rybex", p_state_key: "work" });
if (afterError || after.state.records.find((item) => item.id === id)
  .design.releases.filter((item) => item.status === "Accepted").length !== 2)
  throw new Error("release_integrity_or_reload_failed");
console.log(JSON.stringify({ status: "design_release_integrity_passed",
  wrongRole: "rejected", stale: "rejected", crossTenant: "rejected",
  duplicateRelease: "rejected", genericSnapshot: "rejected",
  scheduleDemands: 2, acceptedReleases: 2 }));
