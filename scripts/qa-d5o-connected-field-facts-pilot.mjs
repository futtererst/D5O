import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const file = process.env.D5O_PILOT_CREDENTIALS_FILE;
if (process.env.D5O_ISOLATED_PILOT !== "1" || url !== "http://127.0.0.1:56321" || !key || !file)
  throw new Error("disposable_pilot_only");
const users = JSON.parse(readFileSync(file, "utf8")).users;
const login = async (name) => {
  const user = users.find((item) => item.key === name);
  const client = createClient(url, key, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error) throw error;
  return client;
};
const [nate, avery, supervisor, quality] = await Promise.all([
  login("worker"), login("worker2"), login("supervisor"), login("quality")
]);
const id = "rybex-a8fd95e7e20d4bb3881c3549459c99e0";
const read = async (client, stateKey) => {
  const { data, error } = await client.rpc("d5o_hosted_prototype_read_v1", {
    p_workspace_key: "rybex", p_state_key: stateKey
  });
  if (error) throw error;
  return data;
};
const basis = async () => {
  const [source, schedule] = await Promise.all([read(supervisor, "work"), read(supervisor, "schedule")]);
  const work = source.state.records.find((item) => item.id === id);
  if (!work) throw new Error("pilot_work_missing");
  return { source, schedule, work };
};
const command = async (client, packageId, action, input, commandId) => {
  const { source, schedule, work } = await basis();
  const { data, error } = await client.rpc("d5o_hosted_field_fact_command_v1", {
    p_workspace_key: "rybex", p_presentation_id: id, p_package_id: packageId,
    p_action: action, p_input: input, p_command_id: commandId,
    p_expected_source_revision: source.revision,
    p_expected_design_revision: work.design.authorityRevision,
    p_expected_schedule_revision: schedule.revision,
    p_expected_deploy_revision: work.deploy.authorityRevision
  });
  return { data, error };
};
const requireSuccess = ({ error }, label) => {
  if (error) throw new Error(`${label}:${error.code}:${error.message}`);
};
const start = await basis();
const north = start.work.design.packages[0].packageId;
const release = start.work.design.releases.find((item) => item.packageId === north);
const requirementId = release.snapshot.requirementIds[0];
const booking = start.schedule.state.publications.at(-1).assignments.find((item) => item.packageId === north);
const report = async (worker, quantity, token) => {
  const current = await basis();
  const existing = current.work.deploy.reports.find((item) => item.summary === `Pilot ${token} installation, measured and checked`);
  if (!existing) requireSuccess(await command(worker, north, "save-report", {
    bookingId: booking.id, quantity, unit: "m", laborHours: 6,
    summary: `Pilot ${token} installation, measured and checked`
  }, `connected-field-${token}-draft-v1`), `${token}_draft`);
  const saved = (await basis()).work.deploy.reports.find((item) => item.summary === `Pilot ${token} installation, measured and checked`);
  if (saved.status === "Draft") requireSuccess(await command(worker, north, "submit-report", {
    bookingId: booking.id, reportId: saved.id
  }, `connected-field-${token}-submit-v1`), `${token}_submit`);
  const submitted = (await basis()).work.deploy.reports.find((item) => item.id === saved.id);
  if (submitted.status === "Submitted") requireSuccess(await command(supervisor, north, "review-report", {
    reportId: saved.id, decision: "Reviewed", note: `Independent review of ${token} measured installation`
  }, `connected-field-${token}-review-v1`), `${token}_review`);
  return saved.id;
};
const firstId = await report(nate, 40, "partial");
if (!(await basis()).work.deploy.reports.some((item) => item.summary === "Pilot correction installation, measured and checked")) {
  const partial = await command(quality, north, "review-completion", {
    note: "Check whether partial measured scope can close"
  }, "connected-field-partial-completion-denied-v1");
  if (partial.error?.message !== "measured_scope_incomplete_or_exceeded")
    throw new Error(`partial_scope_not_blocked:${partial.error?.message}`);
}
const inspect = async (result, token, supersedesId, requirement = requirementId) => {
  const current = await basis();
  const prior = current.work.deploy.inspections.find((item) => item.note === `Pilot ${token} inspection`);
  if (!prior) requireSuccess(await command(nate, north, "record-inspection", {
    bookingId: booking.id, reportId: firstId, requirementId: requirement,
    result, method: "Visual and continuity inspection", note: `Pilot ${token} inspection`,
    ...(supersedesId ? { supersedesId } : {})
  }, `connected-field-${token}-inspection-v1`), `${token}_inspection`);
  const saved = (await basis()).work.deploy.inspections.find((item) => item.note === `Pilot ${token} inspection`);
  if (saved.status === "Submitted") requireSuccess(await command(quality, north, "review-inspection", {
    inspectionId: saved.id, decision: "Verified", note: `Independent ${token} inspection review`
  }, `connected-field-${token}-inspection-review-v1`), `${token}_inspection_review`);
  return saved.id;
};
const failId = await inspect("Fail", "failed");
await report(avery, 60, "correction");
if (!(await basis()).work.deploy.inspections.some((item) => item.note === "Pilot retest inspection")) {
  const failed = await command(quality, north, "review-completion", {
    note: "Check whether failed inspection can close"
  }, "connected-field-failed-completion-denied-v1");
  if (failed.error?.message !== "verified_requirement_or_retest_missing")
    throw new Error(`failed_inspection_not_blocked:${failed.error?.message}`);
}
await inspect("Pass", "retest", failId);
for (const [index, requirement] of release.snapshot.requirementIds.slice(1).entries())
  await inspect("Pass", `other-${index}`, undefined, requirement);
const afterRetest = await command(quality, north, "review-completion", {
  note: "Check remaining evidence control after passing retest"
}, "connected-field-evidence-completion-denied-v1");
if (afterRetest.error?.message !== "reviewed_evidence_required")
  throw new Error(`evidence_not_blocked:${afterRetest.error?.message}`);
const final = await basis();
console.log(JSON.stringify({ status: "measured_reports_and_failed_retest_verified",
  reviewedQuantity: final.work.deploy.reports.filter((item) => item.packageId === north && item.status === "Reviewed")
    .reduce((sum, item) => sum + item.quantity, 0), partialBlocked: true,
  failedInspectionBlocked: true, evidenceStillRequired: true }));
