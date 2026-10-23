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
  const { error } = await client.auth.signInWithPassword({ email, password: identity.password });
  if (error) throw error;
  return client;
};
const pm = await signIn("d5o-pilot-pm@example.test");
const ops = await signIn("d5o-pilot-operations@example.test");
const quality = await signIn("d5o-pilot-quality@example.test");
const id = "rybex-a8fd95e7e20d4bb3881c3549459c99e0";
const rpc = async (client, name, args) => {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(`${name}:${error.code}:${error.message}`);
  return data;
};
const read = (client, key = "work") => rpc(client, "d5o_hosted_prototype_read_v1",
  { p_workspace_key: "rybex", p_state_key: key });
let current = await read(pm);
let target = current.state.records.find((item) => item.id === id);
const refresh = async () => { current = await read(pm); target = current.state.records.find((item) => item.id === id); };
const send = async (client, action, input, commandId, functionName) => {
  const result = await rpc(client, functionName, {
    p_workspace_key: "rybex", p_presentation_id: id,
    p_action: action, p_input: input, p_command_id: commandId,
    p_expected_source_revision: current.revision,
    p_expected_decision_revision: target.design.authorityRevision
  });
  await refresh();
  return result.state.records.find((item) => item.id === id);
};
const draft = "d5o_hosted_design_draft_command_v1";
const review = "d5o_hosted_design_review_command_v1";
const release = "d5o_hosted_design_release_command_v1";
const original = target.design.packages[0];
if (!target.design.releases.length) {
  const { error } = await pm.rpc(release, {
    p_workspace_key: "rybex", p_presentation_id: id,
    p_action: "release-package", p_input: { packageId: original.packageId,
      receivingOwner: "Operations", dueDate: "2026-10-25",
      note: "Attempt release before physical material and dated crew demand" },
    p_command_id: "connected-pilot-design-premature-release-v1",
    p_expected_source_revision: current.revision,
    p_expected_decision_revision: target.design.authorityRevision
  });
  if (!error || error.code !== "23514") throw new Error("premature_release_was_not_blocked");
}
for (const [index, originalPackage] of [...target.design.packages].entries()) {
  const pkg = target.design.packages.find((item) => item.packageId === originalPackage.packageId);
  if (pkg.revision === 1) {
    const side = index === 0 ? "north" : "south";
    const material = { id: `pilot-${side}-fiber-kit`, item: `${side} fiber pathway kit`,
      quantity: 100, unit: "m", source: `SYNTHETIC-PILOT-PHYSICAL-COUNT-${side.toUpperCase()}`,
      status: "Available", requiredDate: "2026-10-28", forecastDate: "2026-10-25",
      alternative: "", receivedQuantity: 100, availableQuantity: 100,
      confidence: "Physically counted" };
    await send(pm, "save-package", { package: { ...pkg, materialLines: [material],
      materialStatus: "Available", materialSource: material.source,
      materialForecastDate: material.forecastDate },
      note: `Synthetic pilot ${side} counted material basis; require fresh reviews` },
    `connected-pilot-design-material-${side}-v2`, draft);
  }
  const revised = target.design.packages.find((item) => item.packageId === originalPackage.packageId);
  if (!(target.design.demands ?? []).some((item) => item.packageId === revised.packageId
    && item.designPackageRevision === revised.revision)) {
    await rpc(pm, "d5o_hosted_design_demand_command_v1", {
      p_workspace_key: "rybex", p_presentation_id: id,
      p_demand: { workId: id, packageId: revised.packageId,
        qualification: "Fiber installation", minimumPeople: 2,
        estimatedPersonHours: 32, priority: "High",
        prerequisite: "Accepted Design release", crewSchedulable: true,
        requiredSlots: [{ date: `2026-10-${26 + index}`, shift: "07:00–15:00" }] },
      p_command_id: `connected-pilot-design-demand-${revised.packageId}-v2`,
      p_expected_source_revision: current.revision,
      p_expected_decision_revision: target.design.authorityRevision
    });
    await refresh();
  }
  for (const discipline of ["Engineering", "Delivery", "Safety", "Quality", "Procurement"]) {
    let item = target.design.reviews.find((row) => row.packageId === revised.packageId
      && row.revision === revised.revision && row.discipline === discipline);
    if (!item) {
      await send(pm, "request-review", { packageId: revised.packageId,
        discipline, assignee: `${discipline} review queue`, dueDate: "2026-10-23",
        note: `Review revision ${revised.revision} including synthetic material basis` },
      `connected-pilot-design-${revised.packageId}-${discipline}-request-v2`, review);
      item = target.design.reviews.find((row) => row.packageId === revised.packageId
        && row.revision === revised.revision && row.discipline === discipline);
    }
    if (item.status === "Requested") await send(discipline === "Quality" ? quality : ops,
      "decide-review", { reviewId: item.id, decision: "Approved",
        note: `Independently reviewed ${discipline} revision ${revised.revision} and synthetic physical count` },
      `connected-pilot-design-${revised.packageId}-${discipline}-approve-v2`, review);
  }
}
for (const pkg of target.design.packages) {
  if (target.design.releases.some((row) => row.packageId === pkg.packageId
    && row.status === "Accepted")) continue;
  let pending = target.design.releases.find((row) => row.packageId === pkg.packageId
    && row.status === "Awaiting receipt");
  if (!pending) {
    await send(pm, "release-package", { packageId: pkg.packageId,
      receivingOwner: "Operations receiver", dueDate: "2026-10-25",
      note: `Release exact ${pkg.packageId} revision ${pkg.revision} to independent receiver` },
    `connected-pilot-design-${pkg.packageId}-release-v2`, release);
    pending = target.design.releases.find((row) => row.packageId === pkg.packageId
      && row.status === "Awaiting receipt");
  }
  if (!pending) throw new Error("pending_release_missing");
  await send(ops, "respond-receipt", { releaseId: pending.id, response: "Accepted",
    note: `Accepted exact ${pkg.packageId} manifest independently for Deploy` },
  `connected-pilot-design-${pkg.packageId}-receipt-v2`, release);
}
if (target.design.releases.filter((item) => item.status === "Accepted").length !== 2
  || target.design.releases.some((item) => item.issuedByActorId === item.receivedByActorId))
  throw new Error("exact_two_package_receipt_missing");
console.log(JSON.stringify({ status: "two_design_packages_released_and_received",
  accepted: 2, packageRevisions: target.design.releases.map((item) => item.packageRevision),
  syntheticMaterialCount: true, independentReceipt: true }));
