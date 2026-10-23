import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (url !== "http://127.0.0.1:56621" || !key) throw new Error("disposable_target_required");
const users = JSON.parse(readFileSync(process.env.TEMP + "/d5o-fresh-replay-final2-20261009/pilot/pilot-credentials.json", "utf8")).users;
const pm = users.find((user) => user.key === "pm");
const client = createClient(url, key, { auth: { persistSession: false } });
const signed = await client.auth.signInWithPassword({ email: pm.email, password: pm.password });
if (signed.error) throw signed.error;
const read = async () => {
  const { data, error } = await client.rpc("d5o_hosted_prototype_read_v1", {
    p_workspace_key: "rybex", p_state_key: "work"
  });
  if (error) throw error;
  const work = data.state.records.find((item) => item.id === "rybex-d86cdd4cd0c04dea97da79c382cf790c");
  return { revision: data.revision, work };
};
const before = await read();
const args = {
  p_workspace_key: "rybex", p_presentation_id: before.work.id,
  p_action: "accept-support", p_command_id: randomUUID(),
  p_expected_source_revision: before.revision,
  p_expected_deploy_revision: before.work.deploy.authorityRevision,
  p_expected_operate_revision: before.work.operate.authorityRevision,
  p_input: { customerContact: "Fictional Rybex customer support contact",
    escalation: "Fictional Operations escalation to the service lead",
    intakeRoute: "Fictional Rybex support request queue",
    warrantyDisposition: "No warranty recorded for this pilot",
    serviceDisposition: "No paid service agreement recorded for this pilot",
    documentation: "Reviewed exact delivery acceptance PDF and both accepted release references",
    residualOwner: "Fictional Operations support lead owns retained as-built and inspections" }
};
const { error } = await client.rpc("d5o_hosted_operate_command_v1", args);
const after = await read();
if (error?.code !== "42501" || error.message !== "support_acceptance_authority_required")
  throw new Error("wrong_guard:" + error?.code + ":" + error?.message);
if (JSON.stringify(before) !== JSON.stringify(after))
  throw new Error("role_denial_mutated_state");
console.log(JSON.stringify({ result: "authenticated_pm_authority_denied", code: error.code,
  domainError: error.message, sourceRevision: before.revision,
  deployRevision: before.work.deploy.authorityRevision,
  operateRevision: before.work.operate.authorityRevision,
  beforeAfterIdentical: true }));
