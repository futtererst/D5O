import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const credentials = process.env.D5O_PILOT_CREDENTIALS_FILE;
if (process.env.D5O_ISOLATED_PILOT !== "1" || url !== "http://127.0.0.1:56321"
  || !anonKey || !credentials) throw new Error("disposable_pilot_only");
const users = JSON.parse(readFileSync(credentials, "utf8")).users;
const signIn = async (email) => {
  const identity = users.find((item) => item.email === email);
  if (!identity) throw new Error(`missing_pilot_identity:${email}`);
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({
    email, password: identity.password
  });
  if (error) throw error;
  return client;
};
const pm = await signIn("d5o-pilot-pm@example.test");
const ops = await signIn("d5o-pilot-operations@example.test");
const quality = await signIn("d5o-pilot-quality@example.test");
const id = "rybex-a8fd95e7e20d4bb3881c3549459c99e0";
const read = async (client) => {
  const { data, error } = await client.rpc("d5o_hosted_prototype_read_v1",
    { p_workspace_key: "rybex", p_state_key: "work" });
  if (error) throw error;
  return data;
};
let current = await read(pm);
let target = current.state.records.find((item) => item.id === id);
if (target.design?.packages?.length !== 2) throw new Error("two_design_drafts_required");
const send = async (client, action, input, commandId) => {
  const { data, error } = await client.rpc("d5o_hosted_design_review_command_v1", {
    p_workspace_key: "rybex", p_presentation_id: id,
    p_action: action, p_input: input, p_command_id: commandId,
    p_expected_source_revision: current.revision,
    p_expected_decision_revision: target.design.authorityRevision
  });
  if (error) throw new Error(`${action}:${error.code}:${error.message}`);
  target = data.state.records.find((item) => item.id === id);
  current = await read(pm);
  return target;
};
for (const doc of [...target.design.documents]) {
  if (doc.status === "Draft") await send(pm, "submit-document", {
    documentId: doc.id, documentRevision: doc.revision,
    note: `Submit ${doc.id} revision for independent technical review`
  }, `connected-pilot-${doc.id}-submit-v1`);
  const updated = target.design.documents.find((item) => item.id === doc.id);
  if (updated.status === "In review") await send(ops, "approve-document", {
    documentId: doc.id, documentRevision: doc.revision,
    note: `Reviewed the exact ${doc.id} drawing and its package links`
  }, `connected-pilot-${doc.id}-approve-v1`);
  const approved = target.design.documents.find((item) => item.id === doc.id);
  if (approved.status === "Approved") await send(pm, "issue-document", {
    documentId: doc.id, documentRevision: doc.revision,
    note: `Issue ${doc.id} revision for package use`
  }, `connected-pilot-${doc.id}-issue-v1`);
}
const disciplines = ["Engineering", "Delivery", "Safety", "Quality", "Procurement"];
for (const pkg of [...target.design.packages]) {
  for (const discipline of disciplines) {
    let review = target.design.reviews.find((item) => item.packageId === pkg.packageId
      && item.revision === pkg.revision && item.discipline === discipline);
    if (!review) {
      await send(pm, "request-review", { packageId: pkg.packageId,
        discipline, assignee: `${discipline} review queue`, dueDate: "2026-10-23",
        note: `Review ${discipline} basis for package ${pkg.packageId}`
      }, `connected-pilot-${pkg.packageId}-${discipline}-request-v1`);
      review = target.design.reviews.find((item) => item.packageId === pkg.packageId
        && item.revision === pkg.revision && item.discipline === discipline);
    }
    if (review.status === "Requested") await send(
      discipline === "Quality" ? quality : ops, "decide-review", {
        reviewId: review.id, decision: "Approved",
        note: `Reviewed ${discipline} controls and exact package revision ${pkg.revision}`
      }, `connected-pilot-${pkg.packageId}-${discipline}-approve-v1`);
  }
}
const final = (await read(quality)).state.records.find((item) => item.id === id).design;
if (final.documents.some((item) => item.status !== "Issued for use")
  || final.reviews.length !== 10
  || final.reviews.some((item) => item.status !== "Approved"
    || item.decidedByActorId === item.requestedByActorId))
  throw new Error("review_projection_or_independence_failed");
console.log(JSON.stringify({ status: "design_reviews_approved",
  issuedDocuments: final.documents.length, approvedPackageReviews: final.reviews.length,
  independentReviewers: true, releasedPackages: final.releases.length }));
