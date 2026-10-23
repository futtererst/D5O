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
const output = resolve(root, "docs/architecture/evidence/phase2a-two-tenant-results.json");
const evidence = { baseline: "448c00be9d09e4b527aa7f3a3c89d99ce5ceda6f",
  startedAt: new Date().toISOString(), tests: [], setupError: null, cleanup: null };
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
    if (processHandle.exitCode !== null) throw Error(`next_exited:${processHandle.exitCode}`);
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return { process: processHandle, port }; }
    catch { /* Startup. */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  processHandle.kill(); throw Error("next_start_timeout");
}
const q = (value) => `'${String(value).replaceAll("'", "''")}'`;
function sql(query) {
  const result = spawnSync("docker", ["exec", "-i", runtime.dbContainer, "psql", "-U", "postgres", "-d", "postgres",
    "-X", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: query, encoding: "utf8", shell: false });
  if (result.status !== 0) throw Error(`sql_failed:${result.stderr.slice(0, 500)}`);
  return result.stdout.trim();
}
async function check(name, run) {
  try { evidence.tests.push({ name, status: "PASS", detail: await run() ?? null }); }
  catch (error) { evidence.tests.push({ name, status: "FAIL", detail: String(error.message).slice(0, 700) }); }
}
try {
  runtime = await createP0aRuntime(root);
  const url = runtime.status.API_URL ?? runtime.status.SUPABASE_URL;
  const anon = runtime.status.ANON_KEY ?? runtime.status.PUBLISHABLE_KEY;
  const service = runtime.status.SERVICE_ROLE_KEY ?? runtime.status.SECRET_KEY;
  const serviceClient = createClient(url, service, { auth: { persistSession: false } });
  const identities = {};
  for (const key of ["a_admin", "a_pm", "a_field", "a_finance", "a_new", "b_admin", "b_ops", "b_field", "outsider"]) {
    const email = `phase2a-${key}-${randomUUID().slice(0, 8)}@example.test`;
    const password = randomBytes(24).toString("base64url") + "!";
    const created = await serviceClient.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw Error(`auth_create_failed:${key}`);
    identities[key] = { id: created.data.user.id, email, password };
  }
  const a = { id: randomUUID(), key: "rybex" };
  const b = { id: randomUUID(), key: "enterprise_test" };
  sql(`begin;
    insert into d5o_hosted.workspaces(id,workspace_key,display_name) values
      (${q(a.id)},${q(a.key)},'Rybex Test'),(${q(b.id)},${q(b.key)},'Independent Enterprise Test');
    insert into d5o_hosted.memberships(workspace_id,actor_user_id,role) values
      (${q(a.id)},${q(identities.a_admin.id)},'admin'),
      (${q(a.id)},${q(identities.a_pm.id)},'project_manager'),
      (${q(a.id)},${q(identities.a_field.id)},'field_worker'),
      (${q(a.id)},${q(identities.a_finance.id)},'billing_commercial_lead'),
      (${q(b.id)},${q(identities.b_admin.id)},'admin'),
      (${q(b.id)},${q(identities.b_ops.id)},'operations_leader'),
      (${q(b.id)},${q(identities.b_field.id)},'field_worker');
    insert into d5o_hosted.connected_crew_profiles(workspace_id,actor_user_id,person,display_name,qualifications,weekly_capacity_hours)
      values(${q(a.id)},${q(identities.a_field.id)},'a-field-person','A field user',array['site-safe'],40),
        (${q(b.id)},${q(identities.b_field.id)},'b-field-person','B field user',array['site-safe'],40);
    commit;`);
  const clients = {};
  for (const [key, identity] of Object.entries(identities)) {
    const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const signed = await client.auth.signInWithPassword(identity);
    if (signed.error) throw Error(`login_failed:${key}`);
    clients[key] = client;
  }
  const call = (user, name, args) => clients[user].rpc(name, args);
  const read = (user, tenant, kind, search = "") => call(user, "d5o_hosted_org_admin_read_v1", {
    p_workspace_key: tenant.key, p_kind: kind, p_search: search, p_offset: 0, p_limit: 25 });
  const command = (user, tenant, action, data = {}, subject = null, revision = 0, commandId = randomUUID()) =>
    call(user, "d5o_hosted_org_admin_command_v1", { p_workspace_key: tenant.key, p_action: action,
      p_subject_id: subject, p_input: data, p_expected_revision: revision,
      p_reason: `Phase 2A synthetic ${action} decision`, p_command_id: commandId });
  const invite = (user, tenant, email, role = "project_manager", commandId = randomUUID(),
    expiresAt = new Date(Date.now() + 14 * 86400000).toISOString()) =>
    call(user, "d5o_hosted_org_invitation_request_v1", { p_workspace_key: tenant.key,
      p_email: email, p_role: role, p_reason: "Phase 2A synthetic invitation",
      p_command_id: commandId, p_expires_at: expiresAt });
  const create = async (user, tenant, action, data) => {
    const result = await command(user, tenant, action, data);
    assert(!result.error, result.error?.message);
    return result.data.record;
  };
  const fixture = { a: {}, b: {} };

  await check("tenant administrators see only their own organization", async () => {
    const [own, foreign, ordinary] = await Promise.all([
      read("a_admin", a, "overview"), read("a_admin", b, "overview"), read("a_pm", a, "overview")]);
    assert(!own.error, own.error?.message);
    assert.equal(own.data.organization.id, a.id);
    assert.equal(foreign.error?.code, "42501");
    assert.equal(ordinary.error?.code, "42501");
    return { own: true, foreignDenied: true, nonAdminDenied: true };
  });
  await check("A and B create independent structures with stable identities", async () => {
    for (const [tenantKey, tenant, adminUser, teamCount] of [["a", a, "a_admin", 3], ["b", b, "b_admin", 2]]) {
      const home = await read(adminUser, tenant, "overview");
      const saved = await command(adminUser, tenant, "organization.save", { name: `${tenantKey.toUpperCase()} Test Holdings`,
        displayName: home.data.organization.displayName, contactEmail: `${tenantKey}@example.test`,
        timeZone: "America/New_York", currency: "USD", branding: {} }, tenant.id, 1);
      assert(!saved.error, saved.error?.message);
      const firstUnit = await create(adminUser, tenant, "unit.create", { code: "OPS", name: "Operations" });
      const secondUnit = await create(adminUser, tenant, "unit.create", { code: "FIN", name: "Finance" });
      const firstLocation = await create(adminUser, tenant, "location.create", { code: "NYC", name: "New York",
        country: "US", timeZone: "America/New_York", address: { city: "New York" }, unitId: firstUnit.id });
      await create(adminUser, tenant, "location.create", { code: "BOS", name: "Boston", country: "US",
        timeZone: "America/New_York", address: { city: "Boston" } });
      const manager = identities[tenantKey === "a" ? "a_pm" : "b_ops"].id;
      for (let index = 0; index < teamCount; index++) {
        const team = await create(adminUser, tenant, "team.create", { code: `T${index + 1}`,
          name: `Team ${index + 1}`, unitId: firstUnit.id, locationId: firstLocation.id,
          managerUserId: manager });
        if (index === 0) fixture[tenantKey].team = team;
        if (index === 1) fixture[tenantKey].secondTeam = team;
      }
      fixture[tenantKey].unit = firstUnit; fixture[tenantKey].secondUnit = secondUnit;
      fixture[tenantKey].location = firstLocation;
      const overview = await read(adminUser, tenant, "overview");
      assert.equal(overview.data.units, 2); assert.equal(overview.data.locations, 2);
      assert.equal(overview.data.teams, teamCount);
    }
    return { a: { units: 2, locations: 2, teams: 3 }, b: { units: 2, locations: 2, teams: 2 } };
  });
  await check("cross-tenant manager, unit and record writes are denied", async () => {
    const foreignManager = await command("a_admin", a, "team.create", { code: "BAD1", name: "Foreign manager",
      managerUserId: identities.b_ops.id });
    const foreignUnit = await command("a_admin", a, "location.create", { code: "BAD2", name: "Foreign unit",
      country: "US", timeZone: "America/New_York", unitId: fixture.b.unit.id });
    const foreignUpdate = await command("a_admin", a, "unit.update", { code: "OPS", name: "Forgery" },
      fixture.b.unit.id, 1);
    const nonAdmin = await command("a_pm", a, "unit.create", { code: "BAD3", name: "Ordinary write" });
    for (const result of [foreignManager, foreignUnit, foreignUpdate, nonAdmin]) assert(result.error);
    return { managerDenied: true, unitDenied: true, recordDenied: true, nonAdminDenied: true };
  });
  await check("business-unit hierarchy supports a parent and rejects cycles", async () => {
    const child = await command("a_admin", a, "unit.update", { code: "FIN", name: "Finance",
      parentId: fixture.a.unit.id }, fixture.a.secondUnit.id, 1);
    assert(!child.error, child.error?.message);
    const cycle = await command("a_admin", a, "unit.update", { code: "OPS", name: "Operations",
      parentId: fixture.a.secondUnit.id }, fixture.a.unit.id, 1);
    assert.equal(cycle.error?.code, "23514");
    return { childParent: fixture.a.unit.id, cycleDenied: true };
  });
  await check("revision conflicts, retirement dependencies and code uniqueness are enforced", async () => {
    const original = fixture.a.unit;
    const renamed = await command("a_admin", a, "unit.update", { code: "OPS", name: "Operations East" }, original.id, 1);
    assert(!renamed.error, renamed.error?.message);
    assert.equal(renamed.data.record.id, original.id);
    const stale = await command("a_admin", a, "unit.update", { code: "OPS", name: "Stale" }, original.id, 1);
    assert.equal(stale.error?.code, "23505");
    const inUse = await command("a_admin", a, "unit.retire", {}, original.id, 2);
    assert.equal(inUse.error?.code, "23514");
    const duplicate = await command("a_admin", a, "unit.create", { code: "OPS", name: "Duplicate" });
    assert.equal(duplicate.error?.code, "23505");
    fixture.a.unit = renamed.data.record;
    return { stableId: original.id, staleDenied: true, inUseDenied: true, duplicateDenied: true };
  });
  await check("team assignments and workforce associations stay tenant-owned", async () => {
    const aPerson = sql(`select id from d5o_hosted.connected_crew_profiles where workspace_id=${q(a.id)};`);
    const bPerson = sql(`select id from d5o_hosted.connected_crew_profiles where workspace_id=${q(b.id)};`);
    const assigned = await command("a_admin", a, "person.assign", { unitId: fixture.a.unit.id,
      locationId: fixture.a.location.id }, aPerson, 1);
    assert(!assigned.error, assigned.error?.message);
    const member = await command("a_admin", a, "team-member.add", { teamId: fixture.a.team.id,
      memberUserId: identities.a_pm.id });
    assert(!member.error, member.error?.message);
    const secondTeam = await command("a_admin", a, "team-member.add", { teamId: fixture.a.secondTeam.id,
      memberUserId: identities.a_pm.id });
    assert(!secondTeam.error, secondTeam.error?.message);
    const foreignUser = await command("a_admin", a, "team-member.add", { teamId: fixture.a.team.id,
      memberUserId: identities.b_ops.id });
    const foreignPerson = await command("a_admin", a, "person.assign", { unitId: fixture.a.unit.id }, bPerson, 1);
    assert(foreignUser.error); assert(foreignPerson.error);
    const team = await read("a_admin", a, "teams");
    assert.equal(team.data.items.find((item) => item.id === fixture.a.team.id).members.length, 1);
    return { memberAssignedToTwoTeams: true, workforceLinked: true, crossTenantDenied: true };
  });
  await check("membership roles, suspension, reactivation and removal enforce authority", async () => {
    const list = await read("a_admin", a, "people");
    const member = list.data.items.find((item) => item.actor_user_id === identities.a_pm.id);
    const self = list.data.items.find((item) => item.actor_user_id === identities.a_admin.id);
    const promoted = await command("a_admin", a, "member.role", { role: "operations_leader" }, member.id, 1);
    assert(!promoted.error, promoted.error?.message);
    const selfPromotion = await command("a_admin", a, "member.role", { role: "operations_leader" }, self.id, 1);
    assert.equal(selfPromotion.error?.code, "42501");
    const ordinary = await command("a_pm", a, "member.role", { role: "admin" }, member.id, 2);
    assert.equal(ordinary.error?.code, "42501");
    const suspended = await command("a_admin", a, "member.suspend", {}, member.id, 2);
    assert(!suspended.error, suspended.error?.message);
    const denied = await read("a_pm", a, "overview");
    assert.equal(denied.error?.code, "42501");
    const reactivated = await command("a_admin", a, "member.reactivate", {}, member.id, 3);
    assert(!reactivated.error, reactivated.error?.message);
    const removed = await command("a_admin", a, "member.remove", {}, member.id, 4);
    assert(!removed.error, removed.error?.message);
    assert.equal(removed.data.endedTeamAssignments, 2);
    const deniedAgain = await call("a_pm", "d5o_hosted_actor_v1", { p_workspace_key: a.key });
    assert.equal(deniedAgain.error?.code, "42501");
    return { roleChanged: true, selfPromotionDenied: true, suspensionImmediate: true, removedDenied: true };
  });
  await check("invitations are scoped, accepted once, and auditable", async () => {
    const inviteId = randomUUID();
    const expiresAt = new Date(Date.now() + 14 * 86400000).toISOString();
    const requested = await invite("a_admin", a, identities.a_new.email, "project_manager", inviteId, expiresAt);
    assert(!requested.error, requested.error?.message);
    assert.equal(requested.data.status, "existing_confirmed");
    const replay = await invite("a_admin", a, identities.a_new.email, "project_manager", inviteId, expiresAt);
    assert.equal(replay.data.replay, true);
    const duplicate = await invite("a_admin", a, identities.a_new.email);
    assert.equal(duplicate.error?.code, "23505");
    const wrongTenant = await call("a_new", "d5o_hosted_org_invitation_accept_v1", {
      p_workspace_key: b.key, p_command_id: inviteId });
    const wrongUser = await call("b_ops", "d5o_hosted_org_invitation_accept_v1", {
      p_workspace_key: a.key, p_command_id: inviteId });
    assert(wrongTenant.error); assert.equal(wrongUser.error?.code, "42501");
    const accepted = await call("a_new", "d5o_hosted_org_invitation_accept_v1", {
      p_workspace_key: a.key, p_command_id: inviteId });
    assert(!accepted.error, accepted.error?.message);
    const again = await call("a_new", "d5o_hosted_org_invitation_accept_v1", {
      p_workspace_key: a.key, p_command_id: inviteId });
    assert.equal(again.data.replay, true);
    const membership = sql(`select role||':'||status from d5o_hosted.memberships where workspace_id=${q(a.id)} and actor_user_id=${q(identities.a_new.id)};`);
    assert.equal(membership, "project_manager:active");
    return { accepted: true, replaySafe: true, foreignDenied: true, role: "project_manager" };
  });
  await check("revoked and expired invitations cannot grant access", async () => {
    const revokeId = randomUUID();
    const revokeRequest = await invite("b_admin", b, identities.outsider.email, "read_only_auditor", revokeId);
    assert(!revokeRequest.error, revokeRequest.error?.message);
    const revoked = await call("b_admin", "d5o_hosted_org_invitation_revoke_v1", {
      p_workspace_key: b.key, p_command_id: revokeId, p_reason: "Withdraw synthetic test invitation" });
    assert(!revoked.error, revoked.error?.message);
    const denied = await call("outsider", "d5o_hosted_org_invitation_accept_v1", {
      p_workspace_key: b.key, p_command_id: revokeId });
    assert.equal(denied.error?.code, "23514");
    const expireId = randomUUID();
    const expireRequest = await invite("b_admin", b, identities.outsider.email, "read_only_auditor", expireId);
    assert(!expireRequest.error, expireRequest.error?.message);
    sql(`update d5o_hosted.admin_identity_requests set expires_at=now()-interval '1 minute' where workspace_id=${q(b.id)} and command_id=${q(expireId)};`);
    const expired = await call("outsider", "d5o_hosted_org_invitation_accept_v1", {
      p_workspace_key: b.key, p_command_id: expireId });
    assert.equal(expired.error?.code, "23514");
    return { revokedDenied: true, expiredDenied: true };
  });
  await check("receipt replay, concurrent writes and audit remain consistent", async () => {
    const commandId = randomUUID();
    const args = { code: "QAS", name: "Quality Assurance" };
    const [first, second] = await Promise.all([
      command("b_admin", b, "unit.create", args, null, 0, commandId),
      command("b_admin", b, "unit.create", args, null, 0, commandId)]);
    assert(!first.error, first.error?.message); assert(!second.error, second.error?.message);
    assert.equal(first.data.id, second.data.id);
    const count = sql(`select count(*) from d5o_hosted.org_units where workspace_id=${q(b.id)} and code='QAS';`);
    assert.equal(count, "1");
    const audit = await read("b_admin", b, "activity");
    assert(!audit.error, audit.error?.message);
    assert(audit.data.items.some((item) => item.action === "unit.create" && item.actor_email === identities.b_admin.email));
    const direct = await clients.b_ops.from("org_units").select("id");
    assert(direct.error || !direct.data?.length);
    return { oneUnit: true, oneReceipt: true, auditVisible: true, directTableDenied: true };
  });
  await check("authenticated administration UI and API work for both tenants", async () => {
    server = await startNext(url, anon, service);
    const browser = await chromium.launch();
    const directory = resolve(root, "docs/architecture/evidence/phase2a-admin-ui");
    mkdirSync(directory, { recursive: true });
    try {
      const files = [];
      for (const [tenant, width] of [["a", 1440], ["a", 390], ["b", 1440]]) {
        const workspace = tenant === "a" ? "rybex" : "enterprise_test";
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        const target = `/work/admin/organization?workspace=${workspace}`;
        await page.goto(`http://127.0.0.1:${server.port}/auth/sign-in?next=${encodeURIComponent(target)}`);
        await page.getByLabel("Email").fill(identities[`${tenant}_admin`].email);
        await page.getByLabel("Password").fill(identities[`${tenant}_admin`].password);
        await page.getByRole("button", { name: "Continue to your work" }).click();
        await page.getByRole("heading", { name: "Organization profile" }).waitFor({ timeout: 30000 });
        const overviewFile = `${tenant}-organization-${width}.png`;
        await page.screenshot({ path: resolve(directory, overviewFile), fullPage: true });
        files.push(overviewFile);
        if (width === 1440) {
          await page.goto(`http://127.0.0.1:${server.port}/work/admin/business-units?workspace=${workspace}`);
          await page.getByRole("button", { name: "Create business unit" }).waitFor();
          await page.getByRole("button", { name: "Create business unit" }).click();
          await page.getByLabel("Code").fill(tenant === "a" ? "UIA" : "UIB");
          await page.getByLabel("Name", { exact: true }).fill("Browser created unit");
          await page.getByLabel("Change reason").fill("Verify authenticated organization administration");
          await page.getByRole("button", { name: "Save business unit" }).click();
          try { await page.getByText("Browser created unit").first().waitFor({ timeout: 12000 }); }
          catch {
            await page.screenshot({ path: resolve(directory, `diagnostic-${tenant}-units.png`), fullPage: true });
            throw Error(`browser_unit_create_failed:${tenant}:${(await page.locator("body").innerText()).slice(-900)}`);
          }
          const unitsFile = `${tenant}-business-units-1440.png`;
          await page.screenshot({ path: resolve(directory, unitsFile), fullPage: true });
          files.push(unitsFile);
          const api = await page.request.get(`http://127.0.0.1:${server.port}/api/d5o-hosted/org-admin?workspace=${tenant === "a" ? "enterprise_test" : "rybex"}&kind=units`);
          assert.equal(api.status(), 403);
          for (const [section, heading] of [["organization-settings", "Organization settings"],
            ["locations", "Locations"], ["teams", "Teams"], ["people", "People"],
            ["roles", "Roles & access"], ["activity", "Administration activity"]]) {
            await page.goto(`http://127.0.0.1:${server.port}/work/admin/${section}?workspace=${workspace}`);
            await page.getByRole("heading", { name: heading, exact: true }).waitFor();
          }
          await page.goto(`http://127.0.0.1:${server.port}/work/admin/invitations?workspace=${workspace}`);
          await page.getByRole("heading", { name: "Invite a member" }).waitFor();
          if (tenant === "a") {
            await page.getByLabel("Email").fill(identities.outsider.email);
            await page.getByLabel("Reason").fill("Invite synthetic user through browser administration");
            await page.getByRole("button", { name: "Create invitation" }).click();
            await page.getByText(identities.outsider.email).first().waitFor();
            const inviteFile = "a-invitations-1440.png";
            await page.screenshot({ path: resolve(directory, inviteFile), fullPage: true });
            files.push(inviteFile);
            const inviteId = sql(`select command_id from d5o_hosted.admin_identity_requests where workspace_id=${q(a.id)} and target_email=${q(identities.outsider.email)} and status='existing_confirmed' order by created_at desc limit 1;`);
            assert(inviteId);
            const recipient = await browser.newPage({ viewport: { width: 1440, height: 900 } });
            const acceptance = `/work/invitation?workspace=rybex&request=${inviteId}`;
            await recipient.goto(`http://127.0.0.1:${server.port}/auth/sign-in?next=${encodeURIComponent(acceptance)}`);
            await recipient.getByLabel("Email").fill(identities.outsider.email);
            await recipient.getByLabel("Password").fill(identities.outsider.password);
            await recipient.getByRole("button", { name: "Continue to your work" }).click();
            await recipient.getByRole("button", { name: "Accept invitation" }).click();
            await recipient.getByText("Access to rybex is active").waitFor();
            const acceptFile = "a-invitation-accepted-1440.png";
            await recipient.screenshot({ path: resolve(directory, acceptFile), fullPage: true });
            files.push(acceptFile);
            await recipient.close();
          }
        }
        await page.close();
      }
      const aUnits = await read("a_admin", a, "units");
      const bUnits = await read("b_admin", b, "units");
      assert(aUnits.data.items.some((item) => item.code === "UIA"));
      assert(bUnits.data.items.some((item) => item.code === "UIB"));
      return { files, tenantIsolationInApi: true, authenticatedUiWrites: true,
        ephemeralPreview: `http://127.0.0.1:${server.port}/work/admin/organization?workspace=rybex` };
    } finally { await browser.close(); }
  });
} catch (error) { evidence.setupError = String(error.message).slice(-3000); }
finally {
  if (server) server.process.kill();
  if (runtime) evidence.cleanup = cleanupP0aRuntime(runtime);
  evidence.finishedAt = new Date().toISOString();
  evidence.summary = { passed: evidence.tests.filter((test) => test.status === "PASS").length,
    failed: evidence.tests.filter((test) => test.status === "FAIL").length,
    setupError: Boolean(evidence.setupError), cleanupVerified: Boolean(evidence.cleanup?.clean) };
  mkdirSync(resolve(root, "docs/architecture/evidence"), { recursive: true });
  writeFileSync(output, JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify({ ...evidence.summary, output: "docs/architecture/evidence/phase2a-two-tenant-results.json" }));
  if (evidence.summary.failed || evidence.summary.setupError || !evidence.summary.cleanupVerified) process.exitCode = 1;
}
