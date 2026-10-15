import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!url?.startsWith("http://127.0.0.1:") ||
  !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || !process.env.SUPABASE_SECRET_KEY)
  throw new Error("explicit_disposable_target_required");
const second = JSON.parse(readFileSync(process.env.D5O_SECOND_SUPERVISOR_CREDENTIALS, "utf8"));
const pilot = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS, "utf8"));
const client = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: false } });
const { error: loginError } = await client.auth.signInWithPassword({ email: second.email, password: second.password });
if (loginError) throw loginError;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false } });
const read = async () => {
  const { data, error } = await client.rpc("d5o_hosted_prototype_read_v1",
    { p_workspace_key: "rybex",p_state_key: "work" });
  if (error) throw error;
  return data;
};
const before = await read();
const work = before.state.records.find((item) =>
  item.id === "rybex-9e4f1e5f9e6b4e429142d3b01e1825e5");
const other = work.deploy.turnovers.find((item) => item.status === "Client accepted" &&
  item.receipt === "Accepted" && item.obligations.toLowerCase().includes("as-built") &&
  !work.supportDocumentSupplierPackageIds?.includes(
    work.design.releases.find((release) => item.releaseIds.includes(release.id))?.packageId));
if (!other) throw new Error("unassigned_turnover_missing");
const evidenceId = randomUUID();
const submitted = await client.rpc("d5o_hosted_support_document_command_v1", {
  p_workspace_key: "rybex",p_presentation_id: work.id,p_action: "submit",
  p_turnover_id: other.id,p_kind: "as-built",p_evidence_id: evidenceId,
  p_decision: null,p_note: "Fictional denied unassigned supplier probe.",p_command_id: randomUUID(),
  p_expected_source_revision: before.revision,
  p_expected_deploy_revision: work.deploy.authorityRevision,
  p_expected_operate_revision: work.operate.authorityRevision
});
if (submitted.error?.message !== "support_document_package_assignment_required")
  throw new Error("typed_submission_denial_missing:" + submitted.error?.message);
const registered = await admin.rpc("d5o_hosted_register_support_document_v1", {
  p_workspace_key: "rybex",p_presentation_id: work.id,p_evidence_id: evidenceId,
  p_turnover_id: other.id,p_kind: "as-built",p_basis: {},
  p_checksum_sha256: "0".repeat(64),p_filename: "fictional-denied.pdf",
  p_uploader_id: second.userId
});
if (registered.error?.message !== "support_document_package_assignment_required")
  throw new Error("custody_boundary_denial_missing:" + registered.error?.message);
const pm = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: false } });
const pmUser = pilot.users.find((item) => item.key === "pm");
const { error: pmError } = await pm.auth.signInWithPassword({ email: pmUser.email, password: pmUser.password });
if (pmError) throw pmError;
const forged = structuredClone(before.state);
forged.records.find((item) => item.id === work.id).operate.supportDocumentAssignments = [];
const generic = await pm.rpc("d5o_hosted_prototype_save_v1", {
  p_workspace_key: "rybex",p_state_key: "work",p_expected_revision: before.revision,
  p_state: forged
});
if (generic.error?.message !== "typed_operate_command_required")
  throw new Error("generic_write_guard_missing:" + generic.error?.message);
const after = await read();
if (JSON.stringify(before) !== JSON.stringify(after))
  throw new Error("rejected_supplier_commands_mutated_work");
console.log(JSON.stringify({ result: "support_supplier_protected_pass",workId: work.id,
  turnoverId: other.id,sourceRevision: after.revision,
  operateRevision: work.operate.authorityRevision,
  observed: ["authenticated_submit_denied", "service_custody_registration_denied",
    "generic_assignment_replacement_denied", "projected_work_unchanged"] }));
