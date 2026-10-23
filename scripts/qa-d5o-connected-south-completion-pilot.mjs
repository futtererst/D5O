import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SECRET_KEY, file = process.env.D5O_PILOT_CREDENTIALS_FILE;
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
const [worker, supervisor, quality] = await Promise.all([
  login("worker2"), login("supervisor"), login("quality")
]);
const admin = createClient(url, service, { auth: { persistSession: false } });
const id = "rybex-a8fd95e7e20d4bb3881c3549459c99e0";
const basis = async () => {
  const read = async (stateKey) => {
    const { data, error } = await supervisor.rpc("d5o_hosted_prototype_read_v1", {
      p_workspace_key: "rybex", p_state_key: stateKey
    });
    if (error) throw error;
    return data;
  };
  const [source, schedule] = await Promise.all([read("work"), read("schedule")]);
  return { source, schedule, work: source.state.records.find((item) => item.id === id) };
};
const send = async (client, action, input, commandId, functionName = "d5o_hosted_field_fact_command_v1") => {
  const { source, schedule, work } = await basis();
  const packageId = work.design.packages[1].packageId;
  const { error } = await client.rpc(functionName, {
    p_workspace_key: "rybex", p_presentation_id: id,p_package_id: packageId,
    p_action: action,p_input: input,p_command_id: commandId,
    p_expected_source_revision: source.revision,
    p_expected_design_revision: work.design.authorityRevision,
    p_expected_schedule_revision: schedule.revision,
    p_expected_deploy_revision: work.deploy.authorityRevision
  });
  if (error) throw new Error(`${action}:${error.code}:${error.message}`);
};
const first = await basis();
const south = first.work.design.packages[1].packageId;
const release = first.work.design.releases.find((item) => item.packageId === south);
const booking = first.schedule.state.publications.at(-1).assignments.find((item) => item.packageId === south);
const planned = release.snapshot.completionBasis.plannedQuantity;
const unit = release.snapshot.completionBasis.unit;
let report = first.work.deploy.reports.find((item) => item.summary === "Synthetic south pilot installation and test preparation");
if (!report) {
  await send(worker, "save-report", { bookingId: booking.id, quantity: planned, unit,
    laborHours: 7, summary: "Synthetic south pilot installation and test preparation" },
  "connected-south-field-draft-v1");
  report = (await basis()).work.deploy.reports.find((item) => item.summary === "Synthetic south pilot installation and test preparation");
}
if (report.status === "Draft") await send(worker, "submit-report", {
  bookingId: booking.id,reportId: report.id
}, "connected-south-field-submit-v1");
report = (await basis()).work.deploy.reports.find((item) => item.id === report.id);
if (report.status === "Submitted") await send(supervisor, "review-report", {
  reportId: report.id, decision: "Reviewed",
  note: "Independent review of south package measured installation"
}, "connected-south-field-review-v1");
for (const [index, requirementId] of release.snapshot.requirementIds.entries()) {
  const note = `Synthetic south requirement ${index + 1} pass`;
  let inspection = (await basis()).work.deploy.inspections.find((item) => item.note === note);
  if (!inspection) {
    await send(worker, "record-inspection", { bookingId: booking.id,
      reportId: report.id,requirementId,result: "Pass",
      method: "Visual and continuity check",note
    }, `connected-south-inspection-${index}-v1`);
    inspection = (await basis()).work.deploy.inspections.find((item) => item.note === note);
  }
  if (inspection.status === "Submitted") await send(quality, "review-inspection", {
    inspectionId: inspection.id,decision: "Verified",
    note: `Independent south requirement ${index + 1} verification`
  }, `connected-south-inspection-review-${index}-v1`);
}
let evidence = (await basis()).work.deploy.evidence.find((item) => item.caption === "Synthetic south pilot completion photo");
if (!evidence) {
  const evidenceId = randomUUID();
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRxkAAAAASUVORK5CYII=", "base64");
  const path = `rybex/${createHash("sha256").update(id).digest("hex")}/${evidenceId}`;
  const { error } = await admin.storage.from("d5o-deploy-evidence").upload(path, bytes,
    { contentType: "image/png", upsert: false });
  if (error) throw new Error(`south_upload:${error.message}`);
  await send(worker, "register-upload", { bookingId: booking.id,evidenceId,
    purpose: "After work",caption: "Synthetic south pilot completion photo",
    filename: "synthetic-south.png",
    checksumSha256: createHash("sha256").update(bytes).digest("hex")
  }, "connected-south-evidence-upload-v1", "d5o_hosted_field_evidence_command_v1");
  evidence = (await basis()).work.deploy.evidence.find((item) => item.id === evidenceId);
}
if (evidence.state === "Uploaded") await send(quality, "review-evidence", {
  evidenceId: evidence.id,decision: "Reviewed",
  note: "Independent south completion photo review"
}, "connected-south-evidence-review-v1", "d5o_hosted_field_evidence_command_v1");
if (!(await basis()).work.deploy.completions?.some((item) => item.packageId === south))
  await send(quality, "review-completion", {
    note: "South measured scope, tests and evidence independently verified"
  }, "connected-south-completion-v1");
const after = (await basis()).work;
if (!after.deploy.completions?.some((item) => item.packageId === south
  && item.reviewedQuantity === planned && item.status === "Reviewed"))
  throw new Error("south_completion_missing");
console.log(JSON.stringify({ status: "two_packages_measured_and_reviewed",
  southQuantity: planned, unit, twoCompletions: after.deploy.completions.length }));
