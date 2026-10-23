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
const pm = await login("pm"), worker = await login("worker");
const expectDenied = async (client, name, args, codes) => {
  const { error } = await client.rpc(name, args);
  if (!error || !codes.includes(error.code))
    throw new Error(`${name}:expected_denial:${error?.code ?? "accepted"}`);
};
const { data: schedule, error } = await pm.rpc("d5o_hosted_prototype_read_v1",
  { p_workspace_key: "rybex", p_state_key: "schedule" });
if (error || schedule.state.assignments.length !== 2
  || schedule.state.publications.length !== 1) throw new Error("pilot_schedule_missing");
const booking = schedule.state.assignments[0];
const base = { p_workspace_key: "rybex", p_expected_revision: schedule.revision };
await expectDenied(worker, "d5o_hosted_prototype_read_v1",
  { p_workspace_key: "rybex", p_state_key: "schedule" }, ["42501"]);
await expectDenied(worker, "d5o_hosted_crew_command_v1", {
  ...base, p_action: "save-booking", p_input: { assignment: booking },
  p_command_id: "connected-pilot-worker-edit-denied-v1"
}, ["42501"]);
await expectDenied(pm, "d5o_hosted_crew_command_v1", {
  ...base, p_action: "publish-week", p_input: { week: booking.week },
  p_expected_revision: schedule.revision - 1,
  p_command_id: "connected-pilot-stale-publication-v1"
}, ["23505"]);
await expectDenied(pm, "d5o_hosted_crew_command_v1", {
  ...base, p_action: "publish-week", p_input: { week: booking.week + 1 },
  p_command_id: "connected-pilot-publish-week-v1"
}, ["23505"]);
await expectDenied(pm, "d5o_hosted_prototype_save_v1", {
  p_workspace_key: "rybex", p_state_key: "schedule",
  p_expected_revision: schedule.revision,
  p_state: { ...schedule.state, publications: [] }
}, ["22023"]);
await expectDenied(worker, "d5o_hosted_worker_schedule_read_v1",
  { p_workspace_key: "rotork" }, ["42501"]);
const { data: own, error: ownError } = await worker.rpc(
  "d5o_hosted_worker_schedule_read_v1", { p_workspace_key: "rybex" });
if (ownError || own.person !== "Nate Walker"
  || own.state.assignments.some((item) => !item.people.includes(own.person)))
  throw new Error("worker_scope_projection_failed");
console.log(JSON.stringify({ status: "crew_authority_integrity_passed",
  workerCannotEdit: true, staleRejected: true, replayConflictRejected: true,
  genericScheduleSaveRejected: true, workerViewScoped: true }));
