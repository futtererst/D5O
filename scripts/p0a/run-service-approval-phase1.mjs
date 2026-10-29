import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "node:net";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "@playwright/test";
import { createP0aRuntime, cleanupP0aRuntime } from "./disposable-runtime.mjs";

const root = resolve(process.cwd());
const output = resolve(root, "docs/architecture/evidence/phase1-two-tenant-results.json");
const evidence = { startedAt: new Date().toISOString(), environment: "disposable local Supabase",
  tests: [], cleanup: null, setupError: null };
let runtime, server;
function freePort() { return new Promise((done, fail) => { const socket = createServer(); socket.once("error", fail);
  socket.listen(0, "127.0.0.1", () => { const address = socket.address(); socket.close(() => done(address.port)); }); }); }
async function startNext(url, anon, service) {
  const port = await freePort();
  const env = { ...process.env, NODE_ENV: "development", NEXT_TELEMETRY_DISABLED: "1",
    NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: anon, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: anon,
    SUPABASE_SECRET_KEY: service, SUPABASE_SERVICE_ROLE_KEY: service, D5O_HOSTED_ENABLED: "1",
    D5O_ISOLATED_PILOT: "1", D5O_ISOLATED_PILOT_URL: url,
    D5O_ISOLATED_APP_ORIGIN: `http://127.0.0.1:${port}`, D5O_COMMAND_RUNTIME: "pilot",
    RYBEXOS_RUNTIME_MODE: "test", RYBEXOS_AUTH_MODE: "supabase", RYBEXOS_DATA_SOURCE: "database" };
  const processHandle = spawn(process.execPath, [resolve(root, "node_modules/next/dist/bin/next"),
    "dev", "--webpack", "-p", String(port), "-H", "127.0.0.1"], { cwd: root, env, stdio: "ignore", shell: false });
  for (let attempt = 0; attempt < 160; attempt++) {
    if (processHandle.exitCode !== null) throw new Error(`next_exited:${processHandle.exitCode}`);
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return { process: processHandle, port }; }
    catch { /* Startup. */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  processHandle.kill(); throw new Error("next_start_timeout");
}
function sql(query) {
  const result = spawnSync("docker", ["exec", "-i", runtime.dbContainer, "psql", "-U", "postgres", "-d", "postgres",
    "-X", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: query, encoding: "utf8", shell: false });
  if (result.status !== 0) throw new Error(`sql_failed:${result.stderr.slice(0, 600)}`);
  return result.stdout.trim();
}
const quoted = (value) => `'${String(value).replaceAll("'", "''")}'`;
async function check(name, fn) {
  try { evidence.tests.push({ name, status: "PASS", detail: await fn() ?? null }); }
  catch (error) { evidence.tests.push({ name, status: "FAIL", detail: String(error.message).slice(0, 500) }); }
}
const phases = ["discover", "define", "develop", "design", "deploy", "operate"];
function manifest() {
  const workTypes = [{ key: "technical-delivery", label: "Technical Delivery", status: "active", templateKey: "technical-delivery" },
    { key: "lifecycle-service", label: "Lifecycle Service", status: "active", templateKey: "lifecycle-service" }];
  return { workTypes, d5oPresentation: { phaseContract: { schemaVersion: 1, workTypes: workTypes.map((item) => ({
    workTypeKey: item.key, workTypeLabel: item.label, version: "prototype-v2",
    phases: phases.map((key) => ({ key, label: key, purpose: `${key} work` })),
    designControls: { reviewLeadDays: 2, procurementBufferDays: 2 },
    deployControls: { fieldStartLeadMinutes: 10, maxActualHoursPerShift: 12 },
    operateControls: { timezone: "America/New_York", defaultResponseHours: 24 },
  })) }, handoffRoles: { discoverDefine: "project_manager", designDeploy: "operations_leader", deployOperate: "admin" } } };
}
try {
  runtime = await createP0aRuntime(root);
  const url = runtime.status.API_URL ?? runtime.status.SUPABASE_URL;
  const anon = runtime.status.ANON_KEY ?? runtime.status.PUBLISHABLE_KEY;
  const service = runtime.status.SERVICE_ROLE_KEY ?? runtime.status.SECRET_KEY;
  assert(url === `http://127.0.0.1:${runtime.ports.api}` && anon && service);
  evidence.environment = { projectId: runtime.projectId, apiPort: runtime.ports.api, loopbackOnly: true };
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const users = {};
  for (const key of ["a_admin", "a_pm", "a_ops", "b_admin", "b_pm", "b_ops", "outsider", "vendor"]) {
    const email = `phase1-${key}-${randomUUID().slice(0, 8)}@example.test`;
    const password = randomBytes(24).toString("base64url") + "!";
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw new Error(`user_create_failed:${key}:${created.error?.code}`);
    users[key] = { id: created.data.user.id, email, password };
  }
  const ids = { a: { workspace: randomUUID(), tenant: randomUUID(), version: randomUUID() },
    b: { workspace: randomUUID(), tenant: randomUUID(), version: randomUUID() } };
  const base = manifest();
  const fixture = ["begin;", `insert into d5o_hosted.platform_administrators(actor_user_id,status) values (${quoted(users.vendor.id)},'active');`, ...Object.entries(ids).flatMap(([tenant, id]) => [
    `insert into d5o_hosted.workspaces(id,workspace_key,display_name) values (${quoted(id.workspace)},${quoted(tenant === "a" ? "rybex" : "enterprise_test")},${quoted(tenant === "a" ? "Rybex Test" : "Independent Enterprise Test")});`,
    ...["admin", "pm", "ops"].map((role) => `insert into d5o_hosted.memberships(workspace_id,actor_user_id,role) values (${quoted(id.workspace)},${quoted(users[`${tenant}_${role}`].id)},${quoted(role === "pm" ? "project_manager" : role === "ops" ? "operations_leader" : "admin")});`),
    `insert into d5o_hosted.configuration_tenants(id,workspace_id,status) values (${quoted(id.tenant)},${quoted(id.workspace)},'active');`,
    `insert into d5o_hosted.configuration_versions(id,tenant_id,version_number,status,source_sha256,manifest_json,effective_from) values (${quoted(id.version)},${quoted(id.tenant)},1,'draft',${quoted("a".repeat(64))},${quoted(JSON.stringify(base))}::jsonb,now()-interval '1 day');`,
    ...base.workTypes.map((type) => `insert into d5o_hosted.configuration_work_types(configuration_version_id,work_type_key,display_name,status) values (${quoted(id.version)},${quoted(type.key)},${quoted(type.label)},'active');`),
    ...base.workTypes.flatMap((type) => ["admin", "project_manager"].map((role) => `insert into d5o_hosted.configuration_create_rights(configuration_version_id,work_type_key,workspace_role) values (${quoted(id.version)},${quoted(type.key)},${quoted(role)});`)),
    ...Object.entries(base.d5oPresentation.handoffRoles).map(([key, role]) => `insert into d5o_hosted.configuration_handoff_roles(configuration_version_id,route_key,receiving_role,configured_by) values (${quoted(id.version)},${quoted(key)},${quoted(role)},${quoted(users[`${tenant}_admin`].id)});`),
    `update d5o_hosted.configuration_versions set status='published' where id=${quoted(id.version)};`,
  ]), "commit;"].join("\n");
  sql(fixture);
  const clients = {};
  for (const [key, identity] of Object.entries(users)) {
    clients[key] = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const login = await clients[key].auth.signInWithPassword(identity);
    if (login.error) throw new Error(`login_failed:${key}`);
  }
  const call = (key, name, args) => clients[key].rpc(name, args);
  await check("vendor directory is distinct from tenant administration", async () => {
    const vendor = await call("vendor", "d5o_platform_tenant_directory_v1", {});
    const tenant = await call("a_admin", "d5o_platform_tenant_directory_v1", {});
    const outsider = await call("outsider", "d5o_platform_tenant_directory_v1", {});
    assert(!vendor.error, vendor.error?.message);
    assert.equal(vendor.data.length, 2);
    assert.equal(tenant.error?.code, "42501");
    assert.equal(outsider.error?.code, "42501");
    return { visibleTenants: vendor.data.map((item) => item.workspaceKey), tenantAdminDenied: true };
  });
  const config = (key, workspace, action, version, active, revision, input, suffix) => call(key,
    "d5o_hosted_configuration_admin_command_v1", { p_workspace_key: workspace,
      p_action: action, p_version: version, p_expected_active: active, p_expected_revision: revision,
      p_input: input, p_reason: `Phase 1 acceptance ${action}`, p_command_id: `${key}-${action}-${suffix}` });
  const versions = {};
  for (const [tenant, threshold] of [["a", 1000000], ["b", 2500000]]) {
    const id = ids[tenant], key = `${tenant}_admin`, workspace = tenant === "a" ? "rybex" : "enterprise_test";
    await check(`${tenant} administrator drafts and publishes USD ${threshold / 100}`, async () => {
      const draft = await config(key, workspace, "create-draft", id.version, id.version, 1, {}, "draft");
      assert(!draft.error, draft.error?.message);
      const draftId = draft.data.versionId;
      const saved = await config(key, workspace, "save-policy", draftId, id.version, 1,
        { key: "service-approval", thresholdMinor: threshold, currency: "USD", comparison: "greater_than", authorityRole: "operations_leader", unavailableBehavior: "block" }, "save");
      assert(!saved.error, saved.error?.message);
      const published = await config(key, workspace, "validate-publish", draftId, id.version, 2, {}, "publish");
      assert(!published.error, published.error?.message);
      const activated = await config(key, workspace, "activate", draftId, id.version, 3, {}, "activate");
      assert(!activated.error, activated.error?.message);
      versions[tenant] = draftId;
      const inventory = await call(key, "d5o_hosted_configuration_admin_read_v1", { p_workspace_key: workspace });
      assert.equal(inventory.data?.activeVersionId, draftId);
      assert(inventory.data.versions.some((v) => v.id === id.version && v.status === "superseded"));
      const history = await call(key, "d5o_hosted_configuration_history_v1", { p_workspace_key: workspace });
      assert(!history.error, history.error?.message);
      assert(history.data.some((event) => event.versionId === draftId && event.action === "activate"));
      return { thresholdMinor: threshold, activeVersionId: draftId, oldVersionRetained: true };
    });
  }
  await check("authenticated customer configuration screenshots", async () => {
    server = await startNext(url, anon, service);
    const browser = await chromium.launch();
    const directory = resolve(root, "docs/architecture/evidence/phase1-admin-ui");
    mkdirSync(directory, { recursive: true });
    try {
      const files = [];
      for (const [tenant, width] of [["a", 1440], ["a", 390], ["b", 1440], ["b", 390]]) {
        const workspace = tenant === "a" ? "rybex" : "enterprise_test";
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        const target = `/work/admin/configuration?workspace=${workspace}`;
        await page.goto(`http://127.0.0.1:${server.port}/auth/sign-in?next=${encodeURIComponent(target)}`);
        await page.getByLabel("Email").fill(users[`${tenant}_admin`].email);
        await page.getByLabel("Password").fill(users[`${tenant}_admin`].password);
        await page.getByRole("button", { name: "Continue to your work" }).click();
        try { await page.getByRole("heading", { name: "Service-work approval" }).waitFor({ timeout: 30000 }); }
        catch { await page.screenshot({ path: resolve(directory, `diagnostic-${tenant}-${width}.png`), fullPage: true });
          throw new Error(`configuration_page_not_ready:${tenant}:${width}:${page.url()}:${(await page.locator("body").innerText()).slice(0, 320)}`); }
        await page.getByText(tenant === "a" ? "10,000.00" : "25,000.00").first().waitFor();
        const file = `${tenant}-${width}.png`;
        await page.screenshot({ path: resolve(directory, file), fullPage: true });
        files.push(file);
        await page.close();
      }
      const platform = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await platform.goto(`http://127.0.0.1:${server.port}/auth/sign-in?next=%2Fplatform-admin`);
      await platform.getByLabel("Email").fill(users.vendor.email);
      await platform.getByLabel("Password").fill(users.vendor.password);
      await platform.getByRole("button", { name: "Continue to your work" }).click();
      await platform.getByRole("heading", { name: "Tenant directory" }).waitFor({ timeout: 30000 });
      await platform.screenshot({ path: resolve(directory, "platform-directory-1440.png"), fullPage: true });
      files.push("platform-directory-1440.png");
      await platform.getByRole("link", { name: "View tenant" }).first().click();
      await platform.getByText("Service-work threshold").waitFor();
      await platform.screenshot({ path: resolve(directory, "platform-tenant-detail-1440.png"), fullPage: true });
      files.push("platform-tenant-detail-1440.png");
      await platform.close();
      return { files, preview: `http://127.0.0.1:${server.port}/work/admin/configuration?workspace=rybex` };
    } finally { await browser.close(); }
  });
  await check("stale and unauthorized publication denied", async () => {
    const id = ids.a;
    const stale = await config("a_admin", "rybex", "create-draft", id.version, id.version, 1, {}, "stale");
    const nonAdmin = await config("a_pm", "rybex", "create-draft", versions.a, versions.a, 4, {}, "nonadmin");
    const cross = await call("a_admin", "d5o_hosted_configuration_admin_read_v1", { p_workspace_key: "enterprise_test" });
    assert(stale.error && nonAdmin.error && cross.error);
    return { stale: stale.error.code, nonAdmin: nonAdmin.error.code, crossTenant: cross.error.code };
  });
  const work = {};
  for (const tenant of ["a", "b"]) {
    await check(`${tenant} service Work pins active version`, async () => {
      const workspace = tenant === "a" ? "rybex" : "enterprise_test";
      const created = await call(`${tenant}_pm`, "d5o_hosted_create_work_v1", {
        p_workspace_key: workspace, p_command_id: `${tenant}-service-work-phase1`,
        p_configuration_version_id: versions[tenant], p_work_type_key: "lifecycle-service",
        p_title: "Synthetic USD 15,000 service request" });
      assert(!created.error, created.error?.message);
      work[tenant] = created.data.workId;
      assert(work[tenant]);
      return { workId: work[tenant], configurationVersionId: versions[tenant] };
    });
  }
  for (const tenant of ["a", "b"]) {
    await check(`${tenant} authoritative USD 15,000 decision`, async () => {
      const workspace = tenant === "a" ? "rybex" : "enterprise_test";
      const args = { p_workspace_key: workspace, p_work_id: work[tenant], p_action: "request",
        p_amount_minor: 1500000, p_currency: "USD", p_command_id: `${tenant}-service-approval-request` };
      const first = await call(`${tenant}_pm`, "d5o_hosted_service_approval_command_v1", args);
      assert(!first.error, first.error?.message);
      assert.equal(first.data.approvalRequired, tenant === "a");
      assert.equal(first.data.status, tenant === "a" ? "pending" : "not_required");
      const replay = await call(`${tenant}_pm`, "d5o_hosted_service_approval_command_v1", args);
      assert.deepEqual(replay.data, first.data);
      return first.data;
    });
  }
  for (const [tenant, workspace, threshold] of [
    ["a", "rybex", 1000000], ["b", "enterprise_test", 2500000],
  ]) {
    await check(`${tenant} service approval exact, below and above threshold persists correctly`, async () => {
      const outcomes = [];
      for (const [boundary, amount, required] of [
        ["below", threshold - 1, false], ["exact", threshold, false], ["above", threshold + 1, true],
      ]) {
        const created = await call(`${tenant}_pm`, "d5o_hosted_create_work_v1", {
          p_workspace_key: workspace, p_command_id: `boundary-${tenant}-${boundary}-work`,
          p_configuration_version_id: versions[tenant], p_work_type_key: "lifecycle-service",
          p_title: `Fictional ${tenant} ${boundary} threshold service` });
        assert(!created.error, `${tenant}:${boundary}:create:${created.error?.message}`);
        const workId = created.data.workId;
        const request = await call(`${tenant}_pm`, "d5o_hosted_service_approval_command_v1", {
          p_workspace_key: workspace, p_work_id: workId, p_action: "request",
          p_amount_minor: amount, p_currency: "USD", p_command_id: `boundary-${tenant}-${boundary}-request` });
        assert(!request.error, `${tenant}:${boundary}:request:${request.error?.message}`);
        assert.equal(request.data.approvalRequired, required);
        assert.equal(request.data.status, required ? "pending" : "not_required");
        const persisted = sql(`select amount_minor||':'||threshold_minor||':'||approval_required||':'||status
          from d5o_hosted.service_approval_requests where work_id=${quoted(workId)};`);
        assert.equal(persisted, `${amount}:${threshold}:${required}:${required ? "pending" : "not_required"}`);
        assert.equal(Number(sql(`select count(*) from d5o_hosted.service_approval_events
          where work_id=${quoted(workId)};`)), 1);
        outcomes.push({ boundary, amountMinor: amount, workId, approvalRequired: required });
      }
      return outcomes;
    });
  }
  await check("cross-tenant, currency, and unauthorized bypass denied", async () => {
    const before = sql(`select (select count(*) from d5o_hosted.service_approval_events where work_id=${quoted(work.a)})||':'||
      (select status from d5o_hosted.service_approval_requests where work_id=${quoted(work.a)});`);
    const base = { p_workspace_key: "rybex", p_work_id: work.a, p_action: "approve",
      p_amount_minor: 1500000, p_currency: "USD", p_command_id: "unauthorized-bypass-phase1" };
    const cross = await call("b_ops", "d5o_hosted_service_approval_command_v1", base);
    const self = await call("a_pm", "d5o_hosted_service_approval_command_v1", base);
    const currency = await call("a_ops", "d5o_hosted_service_approval_command_v1", { ...base, p_currency: "EUR" });
    assert(cross.error && self.error && currency.error);
    const after = sql(`select (select count(*) from d5o_hosted.service_approval_events where work_id=${quoted(work.a)})||':'||
      (select status from d5o_hosted.service_approval_requests where work_id=${quoted(work.a)});`);
    assert.equal(after, before, "rejected approvals changed financial state or audit events");
    return { crossTenant: cross.error.code, wrongRole: self.error.code, currency: currency.error.code };
  });
  await check("independent approver records versioned decision and audit", async () => {
    const approval = await call("a_ops", "d5o_hosted_service_approval_command_v1", {
      p_workspace_key: "rybex", p_work_id: work.a, p_action: "approve",
      p_amount_minor: 1500000, p_currency: "USD", p_command_id: "independent-approval-phase1" });
    assert(!approval.error, approval.error?.message);
    assert.equal(approval.data.status, "approved");
    const rows = Number(sql(`select count(*) from d5o_hosted.service_approval_events where work_id=${quoted(work.a)} and configuration_version_id=${quoted(versions.a)};`));
    assert.equal(rows, 2);
    return { status: approval.data.status, eventCount: rows, configurationVersionId: versions.a };
  });
  await check("work-type name edit publishes without repinning historical Work", async () => {
    const current = versions.b;
    const revision = Number(sql(`select edit_revision from d5o_hosted.configuration_versions where id=${quoted(current)};`));
    const draft = await config("b_admin", "enterprise_test", "create-draft", current, current, revision, {}, "name-draft");
    assert(!draft.error, draft.error?.message);
    const saved = await config("b_admin", "enterprise_test", "rename-work-type", draft.data.versionId,
      current, 1, { key: "technical-delivery", label: "Enterprise Technical Delivery" }, "name-save");
    assert(!saved.error, saved.error?.message);
    const validated = await config("b_admin", "enterprise_test", "validate-publish", draft.data.versionId,
      current, 2, {}, "name-publish");
    assert(!validated.error, validated.error?.message);
    const activated = await config("b_admin", "enterprise_test", "activate", draft.data.versionId,
      current, 3, {}, "name-activate");
    assert(!activated.error, activated.error?.message);
    const pinned = sql(`select configuration_version_id from d5o_hosted.work_records where id=${quoted(work.b)};`);
    assert.equal(pinned, current);
    return { activeVersionId: draft.data.versionId, workPinnedVersionId: pinned };
  });
  await check("customer administrator edits, validates and activates policy in browser", async () => {
    const browser = await chromium.launch();
    const directory = resolve(root, "docs/architecture/evidence/phase1-admin-ui");
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const target = "/work/admin/configuration?workspace=enterprise_test";
      await page.goto(`http://127.0.0.1:${server.port}/auth/sign-in?next=${encodeURIComponent(target)}`);
      await page.getByLabel("Email").fill(users.b_admin.email);
      await page.getByLabel("Password").fill(users.b_admin.password);
      await page.getByRole("button", { name: "Continue to your work" }).click();
      await page.getByRole("heading", { name: "Service-work approval" }).waitFor();
      await page.getByLabel("Reason for the next configuration decision").fill("Test browser policy publication and safe rollback");
      await page.getByRole("button", { name: /Create draft from active/ }).click();
      await page.getByRole("heading", { name: /Draft v/ }).waitFor();
      await page.screenshot({ path: resolve(directory, "tenant-b-draft-1440.png"), fullPage: true });
      await page.getByLabel("Threshold (USD)").fill("24000");
      await page.getByRole("button", { name: "Save approval policy to draft" }).click();
      await page.getByText("Draft threshold: USD 24000.00").waitFor();
      await page.getByRole("button", { name: /Validate and publish/ }).click();
      await page.getByRole("heading", { name: /Validated candidate/ }).waitFor();
      await page.getByRole("button", { name: /Activate v/ }).click();
      await page.getByText("24,000.00").first().waitFor();
      const inventory = await call("b_admin", "d5o_hosted_configuration_admin_read_v1", { p_workspace_key: "enterprise_test" });
      assert(!inventory.error, inventory.error?.message);
      const active = inventory.data.versions.find((version) => version.id === inventory.data.activeVersionId);
      assert.equal(active.manifest.serviceWorkApproval.thresholdMinor, 2400000);
      await page.close();
      return { activeVersionId: active.id, thresholdMinor: 2400000,
        screenshot: "docs/architecture/evidence/phase1-admin-ui/tenant-b-draft-1440.png" };
    } finally { await browser.close(); }
  });
  await check("browser policy change rolls back through a new version", async () => {
    const inventory = await call("b_admin", "d5o_hosted_configuration_admin_read_v1", { p_workspace_key: "enterprise_test" });
    assert(!inventory.error, inventory.error?.message);
    const current = inventory.data.versions.find((version) => version.id === inventory.data.activeVersionId);
    const draft = await config("b_admin", "enterprise_test", "create-draft", current.id,
      current.id, current.revision, {}, "browser-rollback-draft");
    assert(!draft.error, draft.error?.message);
    const saved = await config("b_admin", "enterprise_test", "save-policy", draft.data.versionId,
      current.id, 1, { key: "service-approval", thresholdMinor: 2500000, currency: "USD",
        comparison: "greater_than", authorityRole: "operations_leader", unavailableBehavior: "block" }, "browser-rollback-save");
    assert(!saved.error, saved.error?.message);
    const validated = await config("b_admin", "enterprise_test", "validate-publish", draft.data.versionId,
      current.id, 2, {}, "browser-rollback-publish");
    assert(!validated.error, validated.error?.message);
    const activated = await config("b_admin", "enterprise_test", "activate", draft.data.versionId,
      current.id, 3, {}, "browser-rollback-activate");
    assert(!activated.error, activated.error?.message);
    const pinned = sql(`select r.threshold_minor from d5o_hosted.service_approval_requests r where r.work_id=${quoted(work.b)};`);
    assert.equal(pinned, "2500000");
    return { activeVersionId: draft.data.versionId, restoredThresholdMinor: 2500000,
      historicalDecisionThresholdMinor: Number(pinned) };
  });
  await check("membership revocation immediately denies authority", async () => {
    sql(`update d5o_hosted.memberships set status='suspended' where workspace_id=${quoted(ids.b.workspace)} and actor_user_id=${quoted(users.b_pm.id)};`);
    const denied = await call("b_pm", "d5o_hosted_service_approval_command_v1", {
      p_workspace_key: "enterprise_test", p_work_id: work.b, p_action: "request",
      p_amount_minor: 1500000, p_currency: "USD", p_command_id: "b-service-approval-request" });
    assert(denied.error); return { code: denied.error.code };
  });
  await check("safe rollback creates auditable new decision", async () => {
    const id = ids.a;
    async function publish(threshold, suffix) {
      const current = suffix === "alternate" ? versions.a : id.rollbackAlternate;
      const currentRevision = Number(sql(`select edit_revision from d5o_hosted.configuration_versions where id=${quoted(current)};`));
      const draft = await config("a_admin", "rybex", "create-draft", current, current, currentRevision, {}, `${suffix}-draft`);
      assert(!draft.error, draft.error?.message);
      const draftId = draft.data.versionId;
      const saved = await config("a_admin", "rybex", "save-policy", draftId, current, 1,
        { key: "service-approval", thresholdMinor: threshold, currency: "USD", comparison: "greater_than", authorityRole: "operations_leader", unavailableBehavior: "block" }, `${suffix}-save`);
      assert(!saved.error, saved.error?.message);
      const validated = await config("a_admin", "rybex", "validate-publish", draftId, current, 2, {}, `${suffix}-publish`);
      assert(!validated.error, validated.error?.message);
      const activated = await config("a_admin", "rybex", "activate", draftId, current, 3, {}, `${suffix}-activate`);
      assert(!activated.error, activated.error?.message);
      return draftId;
    }
    id.rollbackAlternate = await publish(500000, "alternate");
    id.rollbackRestored = await publish(1000000, "restore");
    const events = Number(sql(`select count(*) from d5o_hosted.configuration_admin_events where workspace_id=${quoted(id.workspace)} and action='activate';`));
    assert.equal(events, 3);
    return { activeVersionId: id.rollbackRestored, activationEvents: events };
  });
  await check("historical work keeps pinned policy after rollback", async () => {
    const rows = sql(`select r.threshold_minor||':'||v.status from d5o_hosted.service_approval_requests r join d5o_hosted.configuration_versions v on v.id=r.configuration_version_id where r.work_id=${quoted(work.a)};`);
    assert.equal(rows, "1000000:superseded");
    return { pinnedThresholdMinor: 1000000, status: "superseded" };
  });
  await check("suspended administrator cannot publish", async () => {
    sql(`update d5o_hosted.memberships set status='suspended' where workspace_id=${quoted(ids.a.workspace)} and actor_user_id=${quoted(users.a_admin.id)};`);
    const denied = await config("a_admin", "rybex", "create-draft", ids.a.rollbackRestored,
      ids.a.rollbackRestored, 4, {}, "suspended-admin");
    assert.equal(denied.error?.code, "42501");
    return { code: denied.error.code };
  });
} catch (error) { evidence.setupError = String(error.message).slice(0, 1200); }
finally {
  if (server) { server.process.kill(); await new Promise((done) => setTimeout(done, 1000)); }
  if (runtime) evidence.cleanup = cleanupP0aRuntime(runtime);
  evidence.finishedAt = new Date().toISOString();
  evidence.summary = { passed: evidence.tests.filter((t) => t.status === "PASS").length,
    failed: evidence.tests.filter((t) => t.status === "FAIL").length,
    setupError: Boolean(evidence.setupError), cleanupVerified: Boolean(evidence.cleanup?.clean) };
  mkdirSync(resolve(root, "docs/architecture/evidence"), { recursive: true });
  writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({ ...evidence.summary, output: "docs/architecture/evidence/phase1-two-tenant-results.json" }));
  if (evidence.setupError || evidence.summary.failed || !evidence.summary.cleanupVerified) process.exitCode = 1;
}
