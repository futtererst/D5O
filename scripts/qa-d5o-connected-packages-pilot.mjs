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
const workId = "rybex-a8fd95e7e20d4bb3881c3549459c99e0";
const read = (key) => rpc("d5o_hosted_prototype_read_v1",
  { p_workspace_key: "rybex", p_state_key: key });
let work = await read("work");
let catalog = await read("catalog");
const existing = catalog.state.packages.filter((item) => item.workId === workId);
if (existing.length >= 2) {
  console.log(JSON.stringify({ status: "already_present", packages: existing.map((item) => item.id) }));
  process.exit(0);
}
const names = ["North fiber path and inspection", "South fiber path and commissioning"];
const created = [];
for (let index = existing.length; index < 2; index++) {
  const basis = work.state.records.find((item) => item.id === workId);
  if (basis.discovery?.designHandoff?.status !== "accepted")
    throw new Error("accepted_design_receipt_required");
  const result = await rpc("d5o_hosted_create_connected_package_v2", {
    p_workspace_key: "rybex", p_presentation_id: workId,
    p_name: names[index], p_owner: "Synthetic Engineering Lead",
    p_command_id: `connected-pilot-package-${index + 1}-v1`,
    p_expected_work_revision: work.revision,
    p_expected_catalog_revision: catalog.revision,
    p_expected_handoff_revision: basis.discovery.designHandoff.revision,
    p_expected_package_count: catalog.state.packages.filter((item) => item.workId === workId).length
  });
  created.push(result.created.id);
  work = await read("work");
  catalog = await read("catalog");
  const inWork = work.state.records.find((item) => item.id === workId).packages
    .some((item) => item.id === result.created.id);
  const inCatalog = catalog.state.packages.some((item) => item.id === result.created.id
    && item.workId === workId);
  if (!inWork || !inCatalog) throw new Error("package_indexes_diverged");
}
console.log(JSON.stringify({ status: "two_packages_created", created,
  workAndCatalogAgree: true, canonicalWorkId: work.state.records
    .find((item) => item.id === workId).canonicalWorkId }));
