import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url?.startsWith("http://127.0.0.1:") || !key ||
  process.env.D5O_RUN_FICTIONAL_SUPPORT_MUTATIONS !== "1")
  throw new Error("explicit_disposable_fixture_required");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS, "utf8")).users;
const supervisorTwo = JSON.parse(readFileSync(process.env.D5O_SECOND_SUPERVISOR_CREDENTIALS, "utf8"));
const workId = "rybex-9e4f1e5f9e6b4e429142d3b01e1825e5";
async function login(user) {
  const client = createClient(url, key, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error) throw error;
  return client;
}
const operations = await login(users.find((item) => item.key === "operations"));
const pm = await login(users.find((item) => item.key === "pm"));
const supervisor = await login(users.find((item) => item.key === "supervisor"));
const second = await login(supervisorTwo);
async function read(client) {
  const { data, error } = await client.rpc("d5o_hosted_prototype_read_v1", {
    p_workspace_key: "rybex", p_state_key: "work"
  });
  if (error) throw error;
  return { data, work: data.state.records.find((item) => item.id === workId) };
}
const before = await read(operations);
const turnover = before.work.deploy.turnovers.find((item) =>
  item.status === "Client accepted" && item.receipt === "Accepted" &&
  item.obligations.toLowerCase().includes("as-built"));
if (!turnover) throw new Error("accepted_turnover_missing");
const base = {
  p_workspace_key: "rybex", p_presentation_id: workId,
  p_turnover_id: turnover.id,p_action: "assign",
  p_supervisor_email: users.find((item) => item.key === "supervisor").email,
  p_reason: "Fictional Operations assignment to supply this accepted package's retained documents.",
  p_expected_source_revision: before.data.revision,
  p_expected_deploy_revision: before.work.deploy.authorityRevision,
  p_expected_operate_revision: before.work.operate.authorityRevision
};
const call = (client, args) => client.rpc("d5o_hosted_assign_support_document_supplier_v1", args);
async function rejected(client, label, args, expected) {
  const { error } = await call(client, args);
  if (error?.message !== expected) throw new Error(label + ":" + error?.code + ":" + error?.message);
  return { label, error: error.message, code: error.code };
}
const results = [];
const unassigned = await read(second);
if (unassigned.work.supportDocumentSupplierPackageIds?.includes(
  before.work.design.releases.find((item) => turnover.releaseIds.includes(item.id))?.packageId))
  throw new Error("report_review_still_grants_supply");
results.push({ label: "report_review_not_assignment", result: "no_supplier_control" });
results.push(await rejected(pm, "wrong_role", { ...base,p_command_id: randomUUID() },
  "support_assignment_authority_required"));
results.push(await rejected(operations, "wrong_tenant", { ...base,p_workspace_key: "rotork",p_command_id: randomUUID() },
  "workspace_forbidden"));
results.push(await rejected(operations, "unknown_account", { ...base,p_supervisor_email: "nobody@example.test",p_command_id: randomUUID() },
  "active_supervisor_account_required"));
const commandId = randomUUID();
const assigned = await call(operations, { ...base,p_command_id: commandId });
if (assigned.error) throw assigned.error;
const replay = await call(operations, { ...base,p_command_id: commandId });
if (replay.error || JSON.stringify(replay.data) !== JSON.stringify(assigned.data))
  throw new Error("identical_replay_failed:" + replay.error?.message);
results.push({ label: "assigned_and_replayed", result: "original_receipt" });
results.push(await rejected(operations, "conflicting_replay", { ...base,p_reason: "Different assignment rationale",p_command_id: commandId },
  "command_reuse_conflict"));
results.push(await rejected(operations, "stale_revision", { ...base,p_command_id: randomUUID() },
  "stale_support_assignment_basis"));
const after = await read(operations), own = await read(supervisor), other = await read(second);
const packageId = before.work.design.releases.find((item) => turnover.releaseIds.includes(item.id))?.packageId;
if (!own.work.supportDocumentSupplierPackageIds?.includes(packageId) ||
  other.work.supportDocumentSupplierPackageIds?.includes(packageId))
  throw new Error("supplier_projection_incorrect");
if (after.work.operate.authorityRevision !== before.work.operate.authorityRevision + 1)
  throw new Error("rejected_commands_mutated_state");
results.push({ label: "scoped_supplier_projection", result: "only_assigned_supervisor" });
console.log(JSON.stringify({ result: "support_supplier_assignment_pass",workId,
  turnoverId: turnover.id,packageId,sourceRevision: after.data.revision,
  operateRevision: after.work.operate.authorityRevision,results }));
