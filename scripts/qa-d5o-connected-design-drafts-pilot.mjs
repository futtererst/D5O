import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const credentials = process.env.D5O_PILOT_CREDENTIALS_FILE;
if (process.env.D5O_ISOLATED_PILOT !== "1" || url !== "http://127.0.0.1:56321"
  || !anonKey || !credentials) throw new Error("disposable_pilot_only");
const identity = JSON.parse(readFileSync(credentials, "utf8")).users
  .find((item) => item.email === "d5o-pilot-pm@example.test");
const client = createClient(url, anonKey, { auth: { persistSession: false } });
const { error: signInError } = await client.auth.signInWithPassword({
  email: identity.email, password: identity.password
});
if (signInError) throw signInError;
const rpc = async (name, args) => {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(`${name}:${error.code}:${error.message}`);
  return data;
};
const id = "rybex-a8fd95e7e20d4bb3881c3549459c99e0";
const read = () => rpc("d5o_hosted_prototype_read_v1",
  { p_workspace_key: "rybex", p_state_key: "work" });
let current = await read();
let target = current.state.records.find((item) => item.id === id);
if (target.design?.packages?.length >= 2) {
  console.log(JSON.stringify({ status: "already_present", revisions:
    target.design.packages.map((item) => item.revision) }));
  process.exit(0);
}
const packages = target.packages;
if (packages.length !== 2 || target.discovery?.designHandoff?.status !== "accepted")
  throw new Error("received_two_package_basis_required");
const requirements = target.definition.scopeControl.requirements
  .filter((item) => item.state === "Confirmed").map((item) => item.id);
if (!requirements.length) throw new Error("confirmed_requirements_required");
const send = async (action, input, commandId) => {
  const result = await rpc("d5o_hosted_design_draft_command_v1", {
    p_workspace_key: "rybex", p_presentation_id: id,
    p_action: action, p_input: input, p_command_id: commandId,
    p_expected_source_revision: current.revision,
    p_expected_decision_revision: target.design?.authorityRevision ?? 0
  });
  target = result.state.records.find((item) => item.id === id);
  current = await read();
  return target;
};
for (let index = 0; index < 2; index++) {
  const pkg = packages[index];
  const side = index === 0 ? "north" : "south";
  const docId = `pilot-${side}-ifc`;
  if (!target.design?.documents?.some((item) => item.id === docId)) await send("save-document", { document: {
    id: docId, type: "IFC drawing", title: `${side} data hall fiber route`,
    source: `SYNTHETIC-PILOT-${side.toUpperCase()}-DRAWING-R1`,
    owner: "Synthetic Engineering Lead", packageIds: [pkg.id],
    requirementIds: requirements, dueDate: "2026-10-19"
  }, note: `Draft ${side} engineering document` }, `connected-pilot-design-doc-${side}-v1`);
  const basis = {
    packageId: pkg.id, scope: `Install and verify the ${side} fiber path.`,
    location: `Data Hall B ${side} corridor`, systems: "Dual-path fiber backbone",
    completionBasis: { kind: "Measured", plannedQuantity: 100, unit: "m" },
    requirementIds: requirements, predecessorIds: index === 0 ? [] : [packages[0].id],
    documentRefs: [`${docId}@1`], materials: "Synthetic pilot fiber and pathway kit",
    materialLines: [], materialStatus: "Unknown", materialRequiredDate: "2026-10-25",
    materialForecastDate: "", materialSource: "", access: "Customer escorted access",
    permit: "Permit to be confirmed", safetyControls: "Isolation and overhead-work controls",
    equipment: "Fiber test set", method: "Approved method pending review",
    rollback: "Restore original route and isolate failed path",
    verification: "OTDR and visual inspection", proof: "Test file and route photos",
    acceptingAuthority: "Quality reviewer", windowStart: "2026-10-26",
    windowEnd: "2026-10-30", targetReleaseDate: "2026-10-24",
    crewDemandRequired: true, crewExemptionReason: "",
    commercialImpact: "", commercialDisposition: "None"
  };
  if (!target.design?.packages?.some((item) => item.packageId === pkg.id)) await send("save-package", { package: basis,
    note: `Draft ${side} executable package basis` },
  `connected-pilot-design-package-${side}-v1`);
}
const final = (await read()).state.records.find((item) => item.id === id);
if (final.design.documents.length !== 2 || final.design.packages.length !== 2
  || final.design.packages.some((item) => item.status !== "Draft"
    || item.completionBasis.plannedQuantity !== 100))
  throw new Error("design_drafts_not_persistent");
console.log(JSON.stringify({ status: "two_design_drafts_saved",
  documents: final.design.documents.map((item) => `${item.id}@${item.revision}`),
  packageIds: final.design.packages.map((item) => item.packageId),
  released: final.design.releases.length }));
