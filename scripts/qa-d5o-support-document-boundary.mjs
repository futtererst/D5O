import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (url !== "http://127.0.0.1:56621" || !key) throw new Error("disposable_target_required");
const users = JSON.parse(readFileSync(process.env.TEMP + "/d5o-fresh-replay-final2-20261009/pilot/pilot-credentials.json", "utf8")).users;
async function login(name) {
  const user = users.find((item) => item.key === name);
  const client = createClient(url, key, { auth: { persistSession: false } });
  const signed = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  if (signed.error) throw signed.error;
  return client;
}
const pm = await login("pm"), quality = await login("quality");
const read = async () => {
  const { data, error } = await pm.rpc("d5o_hosted_prototype_read_v1", {
    p_workspace_key: "rybex", p_state_key: "work"
  });
  if (error) throw error;
  return data;
};
const before = await read();
const work = before.state.records.find((item) => item.id === "rybex-d86cdd4cd0c04dea97da79c382cf790c");
const base = { p_workspace_key: "rybex", p_presentation_id: work.id,
  p_action: "review", p_turnover_id: "8a8fd746-0c2f-4039-b2a2-5feb177045ef",
  p_kind: "inspection", p_evidence_id: "ade41c60-539d-484f-9d41-661a8964bbe2",
  p_decision: "Reviewed", p_note: "Fictional pilot index inspected against exact retained source and accepted package.",
  p_expected_source_revision: before.revision,
  p_expected_deploy_revision: work.deploy.authorityRevision,
  p_expected_operate_revision: work.operate.authorityRevision };
async function denied(client, label, args, expected) {
  const { error } = await client.rpc("d5o_hosted_support_document_command_v1", args);
  if (error?.message !== expected) throw new Error(label + ":" + error?.code + ":" + error?.message);
  return { label, code: error.code, error: error.message };
}
const results = [];
results.push(await denied(pm, "pm_review", { ...base, p_command_id: randomUUID() },
  "support_document_authority_required"));
results.push(await denied(quality, "cross_tenant", { ...base,
  p_workspace_key: "rotork", p_command_id: randomUUID() },
  "workspace_forbidden"));
results.push(await denied(quality, "stale_revision", { ...base,
  p_expected_operate_revision: base.p_expected_operate_revision - 1,
  p_command_id: randomUUID() }, "stale_support_document_basis"));
const replay = await quality.rpc("d5o_hosted_support_document_command_v1", { ...base,
  p_expected_operate_revision: 11,
  p_command_id: "ab1ab12d-60fd-4c09-9ce6-6880c1270a9e" });
if (replay.error) throw new Error("identical_replay:" + replay.error.message);
results.push({ label: "identical_replay", result: "original_receipt" });
results.push(await denied(quality, "conflicting_replay", { ...base,
  p_expected_operate_revision: 11,p_note: "Conflicting review reason",
  p_command_id: "ab1ab12d-60fd-4c09-9ce6-6880c1270a9e" },
  "command_reuse_conflict"));
const forged = structuredClone(before.state);
forged.records.find((item) => item.id === work.id).operate.documentationObligations = [];
const tamper = await pm.rpc("d5o_hosted_prototype_save_v1", {
  p_workspace_key: "rybex",p_state_key: "work",p_expected_revision: before.revision,
  p_state: forged
});
if (tamper.error?.message !== "typed_operate_command_required")
  throw new Error("generic_tamper:" + tamper.error?.code + ":" + tamper.error?.message);
results.push({ label: "generic_tamper", code: tamper.error.code, error: tamper.error.message });
const after = await read();
if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("denials_mutated_projected_state");
console.log(JSON.stringify({ result: "support_document_boundaries_pass", results,
  unchangedSourceRevision: before.revision,
  unchangedOperateRevision: work.operate.authorityRevision }));
