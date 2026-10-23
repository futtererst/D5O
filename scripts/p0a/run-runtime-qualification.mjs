import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { createP0aRuntime, cleanupP0aRuntime } from "./disposable-runtime.mjs";

const root = resolve(process.cwd());
const output = resolve(root, "docs/architecture/evidence/p0a-runtime-results.json");
const result = { schemaVersion: 1, startedAt: new Date().toISOString(), baseline: process.env.P0A_BASELINE_SHA ?? "unrecorded",
  environment: "disposable local Supabase", tests: [], migrationLineage: null, cleanup: null, gates: {} };
let runtime, server;
const record = async (name, fn) => {
  try { const detail = await fn(); result.tests.push({ name, status: "PASS", detail: detail ?? null }); }
  catch (error) { result.tests.push({ name, status: "FAIL", detail: String(error.message).slice(0, 450) }); }
};
try {
  runtime = await createP0aRuntime(root);
  const url = runtime.status.API_URL ?? runtime.status.SUPABASE_URL;
  const anon = runtime.status.ANON_KEY ?? runtime.status.PUBLISHABLE_KEY;
  const service = runtime.status.SERVICE_ROLE_KEY ?? runtime.status.SECRET_KEY;
  assert(url === `http://127.0.0.1:${runtime.ports.api}` && anon && service && runtime.projectId.startsWith("d5o-p0a-"),
    "disposable_target_identity_failed");
  result.environment = { projectId: runtime.projectId, apiPort: runtime.ports.api,
    dbPort: runtime.ports.db, containerCount: runtime.bindings.containers.length,
    loopbackOnly: runtime.bindings.containers.every((item) => item.bindings.every((entry) => entry.hostIp === "127.0.0.1")) };
  const localFiles = readdirSync(resolve(root, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
  const localDigest = createHash("sha256");
  for (const file of localFiles) localDigest.update(file).update(readFileSync(resolve(root, "supabase/migrations", file)));
  const applied = sql("select version from supabase_migrations.schema_migrations order by version").trim().split(/\r?\n/).filter(Boolean);
  const versions = localFiles.map((f) => f.slice(0, f.indexOf("_")));
  const duplicateVersions = versions.filter((v, index) => versions.indexOf(v) !== index);
  result.migrationLineage = { localCount: localFiles.length, appliedCount: applied.length,
    localDigest: localDigest.digest("hex"), appliedVersionDigest: createHash("sha256").update(applied.join("\n")).digest("hex"),
    duplicateVersions, exactVersionSet: [...new Set(versions)].length === applied.length
      && versions.every((v) => applied.includes(v)) };
  assert(result.migrationLineage.exactVersionSet, "migration_version_mismatch");

  const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });
  const specs = ["a_admin", "a_pm", "a_field", "a_finance", "b_admin", "b_pm", "b_field", "b_finance", "none", "revoked", "dual"];
  const identities = {};
  for (const key of specs) {
    const email = `p0a-${key}@example.test`;
    const password = randomBytes(24).toString("base64url") + "!";
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) throw new Error(`synthetic_user_create_failed:${key}:${error?.code ?? "unknown"}`);
    identities[key] = { id: data.user.id, email, password };
  }
  const A = "a0000000-0000-4000-8000-000000000001";
  const B = "b0000000-0000-4000-8000-000000000002";
  const AT = "a1000000-0000-4000-8000-000000000001";
  const BT = "b1000000-0000-4000-8000-000000000002";
  const AV = "a2000000-0000-4000-8000-000000000001";
  const BV = "b2000000-0000-4000-8000-000000000002";
  const AW = "a3000000-0000-4000-8000-000000000001";
  const BW = "b3000000-0000-4000-8000-000000000002";
  const memberRows = [
    [A, "a_admin", "admin"], [A, "a_pm", "project_manager"], [A, "a_field", "field_supervisor"],
    [A, "a_finance", "billing_commercial_lead"], [A, "revoked", "project_manager"], [A, "dual", "project_manager"],
    [B, "b_admin", "admin"], [B, "b_pm", "project_manager"], [B, "b_field", "field_supervisor"],
    [B, "b_finance", "billing_commercial_lead"], [B, "dual", "project_manager"],
  ];
  const fixture = ["begin;",
    `insert into d5o_hosted.workspaces(id,workspace_key,display_name) values ('${A}','rybex','Rybex Test'),('${B}','enterprise_test','Independent Enterprise Test');`,
    ...memberRows.map(([workspace, key, role]) => `insert into d5o_hosted.memberships(workspace_id,actor_user_id,role) values ('${workspace}','${identities[key].id}','${role}');`),
    `insert into d5o_hosted.configuration_tenants(id,workspace_id,status) values ('${AT}','${A}','active'),('${BT}','${B}','active');`,
    `insert into d5o_hosted.configuration_versions(id,tenant_id,version_number,status,source_sha256,manifest_json,effective_from) values ('${AV}','${AT}',1,'draft','${"a".repeat(64)}','{"workTypes":[{"key":"technical-delivery","label":"Technical Delivery"}]}'::jsonb,now()-interval '1 day'),('${BV}','${BT}',1,'draft','${"b".repeat(64)}','{"workTypes":[{"key":"technical-delivery","label":"Technical Delivery"}]}'::jsonb,now()-interval '1 day');`,
    `insert into d5o_hosted.configuration_work_types(configuration_version_id,work_type_key,display_name,status) values ('${AV}','technical-delivery','Technical Delivery','active'),('${BV}','technical-delivery','Technical Delivery','active');`,
    `update d5o_hosted.configuration_versions set status='published' where id in ('${AV}','${BV}');`,
    `insert into d5o_hosted.work_records(id,workspace_id,configuration_tenant_id,configuration_version_id,configuration_digest,work_type_key,title,created_by) values ('${AW}','${A}','${AT}','${AV}','${"a".repeat(64)}','technical-delivery','Synthetic A Work','${identities.a_admin.id}'),('${BW}','${B}','${BT}','${BV}','${"b".repeat(64)}','technical-delivery','Synthetic B Work','${identities.b_admin.id}');`,
    "commit;"].join("\n");
  sql(fixture);

  const clients = {};
  const cookies = {};
  for (const key of specs) {
    const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await client.auth.signInWithPassword(identities[key]);
    if (error) throw new Error(`synthetic_signin_failed:${key}:${error.code}`);
    clients[key] = client;
    const jar = [];
    const ssr = createServerClient(url, anon, { cookies: {
      getAll: () => jar,
      setAll: (items) => { for (const item of items) { const prior = jar.findIndex((v) => v.name === item.name);
        if (prior >= 0) jar.splice(prior, 1); jar.push({ name: item.name, value: item.value }); } },
    } });
    const signed = await ssr.auth.signInWithPassword(identities[key]);
    if (signed.error) throw new Error(`synthetic_cookie_signin_failed:${key}`);
    cookies[key] = jar.map((item) => `${item.name}=${item.value}`).join("; ");
  }
  const rpc = (key, fn, args) => clients[key].rpc(fn, args);
  const denied = (value) => Boolean(value.error && ["42501", "PGRST301", "PGRST202"].includes(value.error.code));

  await record("authenticated own actor and cross-tenant denial", async () => {
    const own = await rpc("a_admin", "d5o_hosted_actor_v1", { p_workspace_key: "rybex" });
    const cross = await rpc("a_admin", "d5o_hosted_actor_v1", { p_workspace_key: "enterprise_test" });
    assert.equal(own.data?.role, "admin"); assert(denied(cross), `cross_actor:${cross.error?.code}`);
  });
  await record("independent B and nonmember actor denial", async () => {
    const own = await rpc("b_admin", "d5o_hosted_actor_v1", { p_workspace_key: "enterprise_test" });
    const none = await rpc("none", "d5o_hosted_actor_v1", { p_workspace_key: "rybex" });
    assert.equal(own.data?.workspaceId, B); assert(denied(none));
  });
  await record("multi-membership remains explicit", async () => {
    const both = await rpc("dual", "d5o_hosted_workspaces_v1", {});
    assert.deepEqual(both.data.map((v) => v.workspaceKey), ["enterprise_test", "rybex"]);
    for (const workspace of ["rybex", "enterprise_test"])
      assert.equal((await rpc("dual", "d5o_hosted_actor_v1", { p_workspace_key: workspace })).data.workspaceKey, workspace);
  });
  await record("direct DB RLS work-record isolation", async () => {
    assert.equal(roleCount(identities.a_pm.id, A), "1");
    assert.equal(roleCount(identities.a_pm.id, B), "0");
    assert.equal(roleCount(identities.b_pm.id, A), "0");
    assert.equal(roleCount(identities.b_pm.id, B), "1");
    assert.equal(roleCount(identities.none.id, A), "0");
  });
  await record("direct authenticated and anonymous mutation denied", async () => {
    const update = sqlTry(`set role authenticated; select set_config('request.jwt.claim.sub','${identities.a_pm.id}',false); update d5o_hosted.work_records set title='FORGED' where id='${BW}';`);
    const insert = sqlTry(`set role authenticated; select set_config('request.jwt.claim.sub','${identities.a_pm.id}',false); insert into d5o_hosted.workspaces(workspace_key,display_name) values('forged','Forged');`);
    const anonRead = sqlTry("set role anon; select count(*) from d5o_hosted.work_records;");
    assert(update.status !== 0 && insert.status !== 0 && anonRead.status !== 0);
    assert.equal(sql(`select title from d5o_hosted.work_records where id='${BW}'`).trim(), "Synthetic B Work");
  });
  await record("direct configuration and audit tables remain closed", async () => {
    for (const table of ["configuration_versions", "configuration_admin_events", "configuration_admin_receipts"]) {
      const read = sqlTry(`set role authenticated; select set_config('request.jwt.claim.sub','${identities.a_admin.id}',false); select count(*) from d5o_hosted.${table};`);
      const anonymous = sqlTry(`set role anon; select count(*) from d5o_hosted.${table};`);
      assert(read.status !== 0 && anonymous.status !== 0, `direct_table_grant:${table}`);
    }
  });
  await record("invalid bearer token is rejected by authenticated RPC", async () => {
    const response = await fetch(`${url}/rest/v1/rpc/d5o_hosted_actor_v1`, { method: "POST",
      headers: { apikey: anon, Authorization: "Bearer invalid-p0a-token", "Content-Type": "application/json" },
      body: JSON.stringify({ p_workspace_key: "rybex" }) });
    assert.equal(response.status, 401);
  });
  await record("RPC work read and cross-record isolation", async () => {
    const own = await rpc("a_pm", "d5o_hosted_load_work_v1", { p_workspace_key: "rybex", p_work_id: AW });
    const cross = await rpc("a_pm", "d5o_hosted_load_work_v1", { p_workspace_key: "rybex", p_work_id: BW });
    const wrong = await rpc("a_pm", "d5o_hosted_load_work_v1", { p_workspace_key: "enterprise_test", p_work_id: BW });
    assert(!own.error && own.data); assert(cross.error || !cross.data); assert(denied(wrong));
  });
  await record("configuration admin scope and ordinary-user denial", async () => {
    const own = await rpc("a_admin", "d5o_hosted_configuration_admin_read_v1", { p_workspace_key: "rybex" });
    const cross = await rpc("a_admin", "d5o_hosted_configuration_admin_read_v1", { p_workspace_key: "enterprise_test" });
    const ordinary = await rpc("a_field", "d5o_hosted_configuration_admin_read_v1", { p_workspace_key: "rybex" });
    assert(!own.error && own.data?.activeVersionId === AV); assert(denied(cross)); assert(denied(ordinary));
  });
  await record("admin replay, conflict, and cross-tenant command denial", async () => {
    const args = { p_workspace_key: "rybex", p_action: "create-draft", p_version: AV,
      p_expected_active: AV, p_expected_revision: 1, p_input: {},
      p_reason: "Synthetic P0A draft", p_command_id: "p0a-create-draft-a" };
    const first = await rpc("a_admin", "d5o_hosted_configuration_admin_command_v1", args);
    const replay = await rpc("a_admin", "d5o_hosted_configuration_admin_command_v1", args);
    const conflict = await rpc("a_admin", "d5o_hosted_configuration_admin_command_v1", { ...args, p_reason: "Changed P0A reason" });
    const cross = await rpc("a_admin", "d5o_hosted_configuration_admin_command_v1", { ...args, p_workspace_key: "enterprise_test", p_version: BV, p_expected_active: BV, p_command_id: "p0a-cross-draft-a" });
    assert(!first.error && first.data?.versionId); assert.deepEqual(replay.data, first.data);
    assert.equal(conflict.error?.code, "23505"); assert(denied(cross));
  });
  await record("concurrent B draft and stale default", async () => {
    const base = { p_workspace_key: "enterprise_test", p_action: "create-draft", p_version: BV,
      p_expected_active: BV, p_expected_revision: 1, p_input: {}, p_reason: "Synthetic B draft" };
    const [one, two] = await Promise.all(["p0a-b-concurrent-1", "p0a-b-concurrent-2"].map((id) =>
      rpc("b_admin", "d5o_hosted_configuration_admin_command_v1", { ...base, p_command_id: id })));
    assert.equal([one, two].filter((v) => !v.error).length, 1);
    assert.equal([one, two].filter((v) => v.error?.code === "23505").length, 1);
  });
  await record("revoked membership and role change take effect", async () => {
    sql(`update d5o_hosted.memberships set status='suspended' where workspace_id='${A}' and actor_user_id='${identities.revoked.id}';`);
    const revoked = await rpc("revoked", "d5o_hosted_actor_v1", { p_workspace_key: "rybex" });
    assert(denied(revoked));
    sql(`update d5o_hosted.memberships set role='project_manager' where workspace_id='${A}' and actor_user_id='${identities.a_field.id}';`);
    const changed = await rpc("a_field", "d5o_hosted_actor_v1", { p_workspace_key: "rybex" });
    assert.equal(changed.data?.role, "project_manager");
  });
  await record("storage direct access and cross-object denial", async () => {
    const path = `${A}/${AW}/p0a-evidence.txt`;
    const upload = await admin.storage.from("d5o-deploy-evidence").upload(path, new Uint8Array([80, 48, 65]), { contentType: "application/pdf" });
    assert(!upload.error, `service_fixture_upload:${upload.error?.message}`);
    for (const key of ["a_admin", "b_admin"]) {
      const ownOrCross = await clients[key].storage.from("d5o-deploy-evidence").download(path);
      const signed = await clients[key].storage.from("d5o-deploy-evidence").createSignedUrl(path, 30);
      const remove = await clients[key].storage.from("d5o-deploy-evidence").remove([path]);
      const listed = await clients[key].storage.from("d5o-deploy-evidence").list(`${A}/${AW}`);
      assert(ownOrCross.error && signed.error && (listed.error || listed.data?.length === 0),
        `direct_storage_grant:${key}:download=${Boolean(ownOrCross.error)}:signed=${Boolean(signed.error)}:list=${listed.data?.length}`);
      const survivesRemove = await admin.storage.from("d5o-deploy-evidence").download(path);
      assert(!survivesRemove.error && survivesRemove.data,
        `direct_storage_delete_succeeded:${key}:removeError=${Boolean(remove.error)}`);
    }
    const serviceDownload = await admin.storage.from("d5o-deploy-evidence").download(path);
    assert(!serviceDownload.error && serviceDownload.data);
    const serviceSigned = await admin.storage.from("d5o-deploy-evidence").createSignedUrl(path, 1);
    assert(!serviceSigned.error && serviceSigned.data?.signedUrl);
    await new Promise((resolveWait) => setTimeout(resolveWait, 2200));
    const expired = await fetch(serviceSigned.data.signedUrl);
    assert(!expired.ok, `expired_storage_url_succeeded:${expired.status}`);
    const serviceRemove = await admin.storage.from("d5o-deploy-evidence").remove([path]);
    assert(!serviceRemove.error);
  });

  server = await startNext(url, anon, service, runtime.ports.api);
  const base = `http://127.0.0.1:${server.port}`;
  const get = async (key, path) => fetch(base + path, { headers: key ? { Cookie: cookies[key] } : {}, redirect: "manual" });
  await record("API rejects anonymous and forged workspace", async () => {
    const anonResponse = await get(null, "/api/d5o-hosted/work?workspace=rybex");
    const own = await get("a_admin", "/api/d5o-hosted/work?workspace=rybex");
    const cross = await get("a_admin", "/api/d5o-hosted/work?workspace=enterprise_test");
    const bOwn = await get("b_admin", "/api/d5o-hosted/work?workspace=enterprise_test");
    assert.equal(anonResponse.status, 401); assert.equal(own.status, 200);
    assert.equal(cross.status, 403); assert.equal(bOwn.status, 200);
  });
  await record("API prevents cross-tenant work ID and admin escalation", async () => {
    const crossRecord = await get("a_admin", `/api/d5o-hosted/work?workspace=rybex&work=${BW}`);
    const noAdmin = await get("a_field", "/api/d5o-hosted/admin-configuration?workspace=rybex");
    const otherAdmin = await get("a_admin", "/api/d5o-hosted/admin-configuration?workspace=enterprise_test");
    assert([403, 404].includes(crossRecord.status)); assert.equal(noAdmin.status, 403);
    assert([400, 403].includes(otherAdmin.status));
  });
  await record("pilot allowlist remains enforced", async () => {
    const adminB = await get("b_admin", "/api/d5o-hosted/admin-configuration?workspace=enterprise_test");
    const searchB = await get("b_admin", "/api/d5o-hosted/prototype-search?workspace=enterprise_test&view=search");
    assert.equal(adminB.status, 400); assert.equal(searchB.status, 400);
  });
} catch (error) {
  result.setupError = String(error.message).slice(0, 1200);
} finally {
  if (server) { server.process.kill(); await new Promise((resolveWait) => setTimeout(resolveWait, 1000)); }
  if (runtime) result.cleanup = cleanupP0aRuntime(runtime);
  result.finishedAt = new Date().toISOString();
  result.summary = { passed: result.tests.filter((t) => t.status === "PASS").length,
    failed: result.tests.filter((t) => t.status === "FAIL").length,
    setupError: Boolean(result.setupError), cleanupVerified: Boolean(result.cleanup?.clean) };
  mkdirSync(resolve(root, "docs/architecture/evidence"), { recursive: true });
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ ...result.summary, output: "docs/architecture/evidence/p0a-runtime-results.json" }));
  if (result.setupError || result.summary.failed || !result.summary.cleanupVerified) process.exitCode = 1;
}

function sql(query) {
  const response = sqlTry(query);
  if (response.status !== 0) throw new Error(`sql_failed:${response.stderr.slice(0, 450)}`);
  return response.stdout;
}
function sqlTry(query) {
  return spawnSync("docker", ["exec", "-i", runtime.dbContainer, "psql", "-U", "postgres", "-d", "postgres",
    "-X", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: query, encoding: "utf8", shell: false });
}
function roleCount(userId, workspaceId) {
  return sql(`set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false); select count(*) from d5o_hosted.work_records where workspace_id='${workspaceId}';`)
    .trim().split(/\r?\n/).at(-1);
}
async function startNext(url, anon, service, apiPort) {
  const port = await freeAppPort();
  const env = { ...process.env, NODE_ENV: "development", NEXT_TELEMETRY_DISABLED: "1",
    NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: anon, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: anon,
    SUPABASE_SECRET_KEY: service, SUPABASE_SERVICE_ROLE_KEY: service, D5O_HOSTED_ENABLED: "1",
    D5O_ISOLATED_PILOT: "1", D5O_ISOLATED_PILOT_URL: url, D5O_COMMAND_RUNTIME: "pilot",
    RYBEXOS_RUNTIME_MODE: "test", RYBEXOS_AUTH_MODE: "supabase", RYBEXOS_DATA_SOURCE: "database" };
  for (const key of ["SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_REF"]) delete env[key];
  const child = spawn(process.execPath, [resolve(root, "node_modules/next/dist/bin/next"), "dev", "--webpack", "-p", String(port), "-H", "127.0.0.1"],
    { cwd: root, env, stdio: "ignore", shell: false });
  for (let i = 0; i < 160; i++) {
    if (child.exitCode !== null) throw new Error(`next_dev_exited:${child.exitCode}`);
    try { const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return { process: child, port }; } catch { /* startup */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  child.kill(); throw new Error("next_dev_start_timeout");
}
async function freeAppPort() {
  const net = await import("node:net");
  return new Promise((resolvePort, reject) => { const server = net.createServer(); server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { const address = server.address(); server.close(() => resolvePort(address.port)); }); });
}
