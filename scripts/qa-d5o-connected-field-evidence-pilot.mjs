import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SECRET_KEY;
const file = process.env.D5O_PILOT_CREDENTIALS_FILE;
if (process.env.D5O_ISOLATED_PILOT !== "1" || url !== "http://127.0.0.1:56321"
  || !key || !service || !file) throw new Error("disposable_pilot_only");
const users = JSON.parse(readFileSync(file, "utf8")).users;
const login = async (name) => {
  const user = users.find((item) => item.key === name);
  const client = createClient(url, key, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error) throw error;
  return client;
};
const [worker, quality, supervisor] = await Promise.all([
  login("worker"), login("quality"), login("supervisor")
]);
const admin = createClient(url, service, { auth: { persistSession: false } });
const id = "rybex-a8fd95e7e20d4bb3881c3549459c99e0";
const read = async (stateKey) => {
  const { data, error } = await supervisor.rpc("d5o_hosted_prototype_read_v1", {
    p_workspace_key: "rybex", p_state_key: stateKey
  });
  if (error) throw error;
  return data;
};
const basis = async () => {
  const [source, schedule] = await Promise.all([read("work"), read("schedule")]);
  return { source, schedule, work: source.state.records.find((item) => item.id === id) };
};
const command = async (client, packageId, action, input, commandId, functionName = "d5o_hosted_field_evidence_command_v1") => {
  const { source, schedule, work } = await basis();
  return client.rpc(functionName, { p_workspace_key: "rybex", p_presentation_id: id,
    p_package_id: packageId, p_action: action, p_input: input, p_command_id: commandId,
    p_expected_source_revision: source.revision,
    p_expected_design_revision: work.design.authorityRevision,
    p_expected_schedule_revision: schedule.revision,
    p_expected_deploy_revision: work.deploy.authorityRevision });
};
const { work, schedule } = await basis();
const north = work.design.packages[0].packageId;
const release = work.design.releases.find((item) => item.packageId === north);
const booking = schedule.state.publications.at(-1).assignments.find((item) => item.packageId === north);
const existing = work.deploy.evidence.find((item) => item.caption === "Synthetic pilot continuity photo");
let evidenceId = existing?.id;
if (!evidenceId) {
  evidenceId = randomUUID();
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRxkAAAAASUVORK5CYII=", "base64");
  const path = `rybex/${createHash("sha256").update(id).digest("hex")}/${evidenceId}`;
  const { error: uploadError } = await admin.storage.from("d5o-deploy-evidence")
    .upload(path, bytes, { contentType: "image/png", upsert: false });
  if (uploadError) throw new Error(`pilot_upload:${uploadError.message}`);
  const { error } = await command(worker, north, "register-upload", {
    bookingId: booking.id, evidenceId, purpose: "Inspection result",
    caption: "Synthetic pilot continuity photo", filename: "synthetic-pilot.png",
    checksumSha256: createHash("sha256").update(bytes).digest("hex")
  }, "connected-field-register-evidence-v1");
  if (error) throw new Error(`register_evidence:${error.code}:${error.message}`);
}
const uploaded = (await basis()).work.deploy.evidence.find((item) => item.id === evidenceId);
if (uploaded.state === "Uploaded") {
  const { error: wrongRole } = await command(worker, north, "review-evidence", {
    evidenceId,decision: "Reviewed",note: "Worker cannot independently review own upload"
  }, "connected-field-worker-review-denied-v1");
  if (!wrongRole || wrongRole.code !== "42501") throw new Error("worker_review_not_denied");
  const { error } = await command(quality, north, "review-evidence", {
    evidenceId,decision: "Reviewed",note: "Independent inspection photo review completed"
  }, "connected-field-review-evidence-v1");
  if (error) throw new Error(`review_evidence:${error.code}:${error.message}`);
}
const completion = (await basis()).work.deploy.completions?.find((item) => item.packageId === north);
if (!completion) {
  const { error } = await command(quality, north, "review-completion", {
    note: "Exact measured scope and independent inspection verified"
  }, "connected-field-north-completion-v1", "d5o_hosted_field_fact_command_v1");
  if (error) throw new Error(`north_completion:${error.code}:${error.message}`);
}
const after = (await basis()).work;
if (!after.deploy.completions?.some((item) => item.packageId === north && item.status === "Reviewed"
  && item.reviewedQuantity === 100 && item.releaseId === release.id))
  throw new Error("measured_completion_not_persisted");
console.log(JSON.stringify({ status: "north_measured_completion_reviewed",
  evidence: "stored_and_independently_reviewed", quantity: 100, unit: "m",
  southStillRequiresIndependentFieldStart: true }));
