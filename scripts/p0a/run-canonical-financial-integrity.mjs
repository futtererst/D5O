import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "node:net";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "@playwright/test";
import { createP0aRuntime, cleanupP0aRuntime } from "./disposable-runtime.mjs";
import { captureNextEnv } from "./next-env-guard.mjs";

const root = resolve(process.cwd());
const restoreNextEnv = captureNextEnv(root);
const output = resolve(root, ".tmp/d5o-evidence/financial/canonical-integrity.json");
const evidence = { startedAt: new Date().toISOString(), checks: [], error: null, cleanup: null };
const q = (value) => `'${String(value).replaceAll("'", "''")}'`;
const uuid = () => randomUUID();
const digest = "a".repeat(64);
let runtime, server, browser;
const freePort = () => new Promise((done, fail) => { const socket = createServer();
  socket.once("error", fail);
  socket.listen(0, "127.0.0.1", () => { const address = socket.address();
    socket.close(() => done(address.port)); }); });
async function startNext(url, anon, service) {
  const port = await freePort();
  const env = { ...process.env, NODE_ENV: "development", NEXT_TELEMETRY_DISABLED: "1",
    NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: anon, SUPABASE_SECRET_KEY: service,
    SUPABASE_SERVICE_ROLE_KEY: service, D5O_HOSTED_ENABLED: "1", D5O_ISOLATED_PILOT: "1",
    D5O_ISOLATED_PILOT_URL: url, D5O_ISOLATED_APP_ORIGIN: `http://127.0.0.1:${port}`,
    D5O_COMMAND_RUNTIME: "pilot", RYBEXOS_RUNTIME_MODE: "test",
    RYBEXOS_AUTH_MODE: "supabase", RYBEXOS_DATA_SOURCE: "database" };
  const processHandle = spawn(process.execPath, [resolve(root, "node_modules/next/dist/bin/next"),
    "dev", "--webpack", "-p", String(port), "-H", "127.0.0.1"],
  { cwd: root, env, stdio: "ignore", shell: false });
  for (let attempt = 0; attempt < 160; attempt++) {
    if (processHandle.exitCode !== null) throw Error(`next_exited:${processHandle.exitCode}`);
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok)
      return { process: processHandle, port }; } catch { /* startup */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  processHandle.kill(); throw Error("next_start_timeout");
}
function sql(query) {
  const result = spawnSync("docker", ["exec", "-i", runtime.dbContainer, "psql", "-U", "postgres",
    "-d", "postgres", "-X", "-t", "-A", "-v", "ON_ERROR_STOP=1"],
  { input: query, encoding: "utf8", shell: false, maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw Error(`sql_failed:${result.stderr.slice(-900)}`);
  return result.stdout.trim();
}
async function check(name, fn) {
  const detail = await fn();
  evidence.checks.push({ name, status: "PASS", detail: detail ?? null });
  console.log(JSON.stringify({ name, status: "PASS" }));
}
function fixture(tenant, users) {
  const id = { workspace: uuid(), configTenant: uuid(), configVersion: uuid(), work: uuid(),
    presentation: `${tenant}-financial-${uuid().replaceAll("-", "")}`, bom: uuid(), quote: uuid(),
    doc: uuid() };
  const workKey = tenant === "a" ? "rybex" : tenant === "b" ? "rotork" : "financial_race_test";
  const account = `FICTIONAL-${tenant.toUpperCase()}-ACCOUNT`;
  const amounts = tenant === "b" ? [300000, 300000, 200000, 200001, 100000]
    : tenant === "c" ? [100000] : [300000, 300000, 200000, 200001];
  const materials = amounts.map(() => uuid());
  const quoteLines = amounts.map((amount, index) => ({ lineNumber: String(index + 1),
    graybarSku: `FICTIONAL-${tenant}-${index}`, description: `Fictional material ${index + 1}`,
    unit: "each", quantity: "1", packSize: "1", priceBasis: "each",
    unitPriceMinor: String(amount), extendedMinor: String(amount) }));
  const quote = { id: id.quote, quoteNumber: `FICTIONAL-${tenant}-QUOTE`, quoteRevision: "1",
    accountReference: account, currency: "USD", freightMinor: "0",
    acceptedAt: new Date().toISOString(), expiresAt: "2027-12-31", lines: quoteLines };
  const bom = { id: id.bom, status: "Approved", designRevision: 1, defineRevision: 1,
    estimateRevision: 1, lines: materials.map((materialId, index) => ({ materialId,
      quantity: "1", unit: "each", supplyResponsibility: "Rybex", quoteId: id.quote,
      lineNumber: String(index + 1) })) };
  const state = { quotes: [quote], assessments: [], bom, orders: [], shipments: [], receipts: [],
    supplierInvoices: [], returns: [], credits: [], installed: [] };
  const defineProjection = { developHandoff: { status: "accepted" },
    scopeControl: { requirements: [{ id: "req-1", state: "Confirmed", owner: "Customer" }] } };
  const romEstimate = { detailed: { input: { estimateMaturity: "ROM", lines: [{ id: "labor-1",
    category: "labor", unit: "person-hour", quantity: "10", quantityBasis: "One fictional unit",
    sourceKind: "Assumed", sourceDate: new Date().toISOString().slice(0, 10) }],
    romBasis: { communication: { scope: "Fictional installation", assumptions: "One unit",
      informationNeeded: "Site access", designValidation: "Engineering review", reviewDate: "2026-10-29" },
      coverage: [{ obligationId: "req-1", sourceRevision: "1", owner: "PM",
        rationale: "Included labor", treatment: "Line", lineIds: ["labor-1"] }],
      installationScenario: { lineId: "labor-1", units: "1", lowHoursPerUnit: "8",
        baseHoursPerUnit: "10", highHoursPerUnit: "12", quantitySource: "Fictional field plan",
        rationale: "Conservative installation range" } } },
    policySnapshot: { proposalApproverRole: "admin", method: "target-margin", overheadPercent: 10,
      contingencyPercent: 10, targetMarginPercent: 20 },
    evaluation: { directCostMinor: 100000, lines: [{ id: "labor-1", amountMinor: 100000 }] } } };
  const ids = Object.entries(users).map(([role, user]) => `insert into d5o_hosted.memberships(workspace_id,actor_user_id,role)
    values(${q(id.workspace)},${q(user.id)},${q(role === "pm" ? "project_manager" : "admin")});`).join("\n");
  const statements = `begin;
    insert into d5o_hosted.workspaces(id,workspace_key,display_name)
      values(${q(id.workspace)},${q(workKey)},${q(`Fictional ${tenant} financial tenant`)});
    ${ids}
    insert into d5o_hosted.configuration_tenants(id,workspace_id,status)
      values(${q(id.configTenant)},${q(id.workspace)},'active');
    insert into d5o_hosted.configuration_versions(id,tenant_id,version_number,status,source_sha256,manifest_json,effective_from)
      values(${q(id.configVersion)},${q(id.configTenant)},1,'draft',${q(digest)},
      '{"workTypes":[{"key":"technical-delivery"}]}'::jsonb,now()-interval '1 day');
    insert into d5o_hosted.configuration_work_types(configuration_version_id,work_type_key,display_name,status)
      values(${q(id.configVersion)},'technical-delivery','Technical delivery','active');
    update d5o_hosted.configuration_versions set status='published' where id=${q(id.configVersion)};
    insert into d5o_hosted.work_records(id,workspace_id,configuration_tenant_id,configuration_version_id,
      configuration_digest,work_type_key,title,created_by)
      values(${q(id.work)},${q(id.workspace)},${q(id.configTenant)},${q(id.configVersion)},
      ${q(digest)},'technical-delivery','Fictional financial integrity work',${q(users.pm.id)});
    insert into d5o_hosted.work_identity_links(workspace_id,work_id,presentation_id)
      values(${q(id.workspace)},${q(id.work)},${q(id.presentation)});
    insert into d5o_hosted.connected_define_states(workspace_id,work_id,source_revision,source_digest,
      definition_revision,decision_revision,status,submitted_by,projection,next_action)
      values(${q(id.workspace)},${q(id.work)},1,'define-digest',1,1,'Approved',${q(users.pm.id)},
      ${q(JSON.stringify(defineProjection))}::jsonb,'');
    insert into d5o_hosted.connected_solution_states(workspace_id,work_id,source_digest,solution_revision,
      decision_revision,status,submitter,review,next_action)
      values(${q(id.workspace)},${q(id.work)},'solution-digest',1,1,'Approved',${q(users.pm.id)},'{}'::jsonb,'');
    insert into d5o_hosted.connected_estimate_states(workspace_id,work_id,estimate_revision,decision_revision,
      solution_digest,definition_revision,status,estimate,next_action)
      values(${q(id.workspace)},${q(id.work)},1,1,'solution-digest',1,'Approved',
      ${q(JSON.stringify(romEstimate))}::jsonb,'');
    insert into d5o_hosted.connected_offer_states(workspace_id,work_id,offer_revision,decision_revision,
      estimate_revision,offer_digest,status,proposal,submitter)
      values(${q(id.workspace)},${q(id.work)},1,1,1,'offer-digest','Submitted','{}'::jsonb,${q(users.pm.id)});
    insert into d5o_hosted.connected_rom_design_states(workspace_id,work_id,decision_revision,estimate_revision,
      offer_revision,definition_revision,solution_digest,status,acknowledgment,design_authorization,prepared_by)
      values(${q(id.workspace)},${q(id.work)},1,1,1,1,'solution-digest','Design authorized','{}'::jsonb,
      '{"spendCapMinor":1000000,"currency":"USD","fundingSource":"Fictional customer funding","sourceReference":"FICTIONAL-AWARD"}'::jsonb,${q(users.pm.id)});
    insert into d5o_hosted.connected_design_states(workspace_id,work_id,decision_revision,source_handoff_revision,state)
      values(${q(id.workspace)},${q(id.work)},1,1,'{}'::jsonb);
    insert into d5o_hosted.graybar_states(workspace_id,work_id,revision,state)
      values(${q(id.workspace)},${q(id.work)},1,${q(JSON.stringify(state))}::jsonb);
    insert into d5o_hosted.graybar_documents(id,workspace_id,work_id,kind,filename,media_type,
      storage_path,sha256,byte_count,uploaded_by)
      values(${q(id.doc)},${q(id.workspace)},${q(id.work)},'other','fictional-subcontract.pdf',
      'application/pdf',${q(`fictional-${id.doc}.pdf`)},${q(digest)},100,${q(users.pm.id)});
    commit;`;
  sql(statements);
  return { ...id, workKey, account, amounts, materials };
}
try {
  runtime = await createP0aRuntime(root);
  const url = runtime.status.API_URL ?? runtime.status.SUPABASE_URL;
  const anon = runtime.status.ANON_KEY ?? runtime.status.PUBLISHABLE_KEY;
  const service = runtime.status.SERVICE_ROLE_KEY ?? runtime.status.SECRET_KEY;
  assert(url?.startsWith("http://127.0.0.1:") && anon && service);
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const users = {};
  const clients = {};
  for (const tenant of ["a", "b"]) {
    users[tenant] = {};
    for (const role of ["pm", "admin", "delegate"]) {
      const email = `financial-${tenant}-${role}-${uuid()}@example.test`;
      const password = `${randomBytes(24).toString("base64url")}!`;
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      assert.ifError(created.error);
      users[tenant][role] = { id: created.data.user.id, email, password };
      const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
      const login = await client.auth.signInWithPassword({ email, password });
      assert.ifError(login.error);
      clients[`${tenant}_${role}`] = client;
    }
  }
  const a = fixture("a", users.a), b = fixture("b", users.b);
  const call = (key, name, args) => clients[key].rpc(name, args);
  const purchaseRead = (tenant, f) => call(`${tenant}_pm`, "d5o_purchase_authority_read_v1",
    { p_workspace_key: f.workKey, p_presentation_id: f.presentation });
  const purchaseCommand = (tenant, role, f, action, input, revision, sourceDigest, commandId = uuid()) =>
    call(`${tenant}_${role}`, "d5o_purchase_authority_command_v1", { p_workspace_key: f.workKey,
      p_presentation_id: f.presentation, p_action: action, p_input: input,
      p_command_id: commandId, p_expected_revision: revision,
      p_expected_source_digest: sourceDigest });
  await check("two tenant source and independent parent authority", async () => {
    for (const [tenant, f] of [["a", a], ["b", b]]) {
      const read = await purchaseRead(tenant, f);
      assert.ifError(read.error);
      assert(read.data.source?.digest, `${tenant}:source_missing`);
      const validFrom = new Date().toISOString().slice(0, 10);
      const prepared = await purchaseCommand(tenant, "pm", f, "prepare", {
        parentCapMinor: "1000000", purchaseCapMinor: "500000", subcontractEnabled: true,
        validFrom, validUntil: "2027-12-31", purchasingEntity: "Fictional procurement",
        graybarAccountReference: f.account, scope: "Fictional procurement integrity testing",
        fundingSource: "Fictional customer funding", sourceReference: "FICTIONAL-AWARD",
        conditions: "Only approved fictional commitments may consume authority"
      }, read.data.revision, read.data.source.digest);
      assert.ifError(prepared.error);
      const wrong = await purchaseCommand(tenant, "pm", f, "approve", {
        authorityId: prepared.data.subjectId, reason: "Wrong role must be denied" },
      prepared.data.revision, read.data.source.digest);
      assert.equal(wrong.error?.code, "42501");
      const approved = await purchaseCommand(tenant, "admin", f, "approve", {
        authorityId: prepared.data.subjectId, reason: "Independent approval of fictional authority" },
      prepared.data.revision, read.data.source.digest);
      assert.ifError(approved.error);
      f.authorityId = prepared.data.subjectId;
    }
  });
  await check("canonical purchase approval concurrency and exact cap", async () => {
    const graybar = (role, f, action, input, revision, commandId = uuid()) =>
      call(`a_${role}`, "d5o_graybar_command_v1", { p_workspace_key: f.workKey,
        p_presentation_id: f.presentation, p_action: action, p_input: input,
        p_command_id: commandId, p_expected_revision: revision });
    let revision = 1;
    const orderIds = [];
    for (let index = 0; index < a.amounts.length; index++) {
      const prepared = await graybar("pm", a, "prepare-po", {
        lines: [{ materialId: a.materials[index], quantity: "1", unit: "each" }],
        shipTo: "Fictional site", accountReference: a.account, requiredDate: "2027-01-15",
        budgetMinor: "500000" }, revision);
      assert.ifError(prepared.error);
      revision = prepared.data.revision;
      orderIds.push(prepared.data.state.orders.find((item) => item.lines[0].materialId === a.materials[index]).id);
    }
    const wrongTenant = await call("b_admin", "d5o_graybar_command_v1", {
      p_workspace_key: a.workKey, p_presentation_id: a.presentation, p_action: "approve-po",
      p_input: { orderId: orderIds[0] }, p_command_id: uuid(), p_expected_revision: revision });
    assert.equal(wrongTenant.error?.code, "42501");
    const approval = (role, orderId, atRevision, commandId = uuid()) => graybar(role, a,
      "approve-po", { orderId, authorityBasis: "Independent fictional reviewer" }, atRevision, commandId);
    const wrongRole = await approval("pm", orderIds[0], revision);
    assert.equal(wrongRole.error?.code, "42501");
    const firstCommandId = uuid(), secondCommandId = uuid();
    const concurrent = await Promise.all([approval("admin", orderIds[0], revision, firstCommandId),
      approval("admin", orderIds[1], revision, secondCommandId)]);
    assert.equal(concurrent.filter((x) => !x.error).length, 1);
    const winner = concurrent.find((x) => !x.error);
    const winnerOrder = concurrent[0].error ? orderIds[1] : orderIds[0];
    const winnerCommand = concurrent[0].error ? secondCommandId : firstCommandId;
    const loserOrder = concurrent[0].error ? orderIds[0] : orderIds[1];
    const replay = await approval("admin", winnerOrder, revision, winnerCommand);
    assert.ifError(replay.error);
    assert.equal(replay.data.revision, winner.data.revision);
    const after = await call("a_admin", "d5o_graybar_read_v1",
      { p_workspace_key: a.workKey, p_presentation_id: a.presentation });
    assert.ifError(after.error);
    const retry = await approval("admin", loserOrder, after.data.revision);
    assert.equal(retry.error?.code, "23514");
    const exact = await approval("admin", orderIds[2], after.data.revision);
    assert.ifError(exact.error);
    const above = await approval("admin", orderIds[3], exact.data.revision);
    assert.equal(above.error?.code, "23514");
    const duplicate = await approval("admin", orderIds[2], exact.data.revision);
    assert.equal(duplicate.error?.code, "42501");
    const reservations = sql(`select count(*)||':'||sum(amount_minor) from d5o_hosted.purchase_reservations
      where workspace_id=${q(a.workspace)} and work_id=${q(a.work)};`);
    assert.equal(reservations, "2:500000");
    const events = sql(`select count(*) from d5o_hosted.graybar_events where workspace_id=${q(a.workspace)}
      and work_id=${q(a.work)};`);
    assert.equal(events, "6");
    a.pendingOrderId = orderIds[3];
    a.graybarRevision = exact.data.revision;
    return { concurrentAccepted: 1, rejectedRetry: true, exactCapMinor: 500000,
      reservations, events, winnerRevision: winner.data.revision };
  });
  await check("PO draft cancellation and replay have no commitment effect", async () => {
    const args = { p_workspace_key: a.workKey, p_presentation_id: a.presentation,
      p_action: "cancel-po-draft", p_input: { orderId: a.pendingOrderId,
        reason: "Withdraw over-cap fictional purchase draft" }, p_command_id: uuid(),
      p_expected_revision: a.graybarRevision };
    const before = sql(`select count(*)||':'||sum(amount_minor) from d5o_hosted.purchase_reservations
      where workspace_id=${q(a.workspace)} and work_id=${q(a.work)};`);
    const cancelled = await call("a_pm", "d5o_graybar_command_v1", args);
    assert.ifError(cancelled.error);
    assert.equal(cancelled.data.state.orders.find((order) => order.id === a.pendingOrderId)?.status,
      "Cancelled");
    const replay = await call("a_pm", "d5o_graybar_command_v1", args);
    assert.ifError(replay.error);
    assert.equal(replay.data.revision, cancelled.data.revision);
    const duplicate = await call("a_pm", "d5o_graybar_command_v1", {
      ...args, p_command_id: uuid(), p_expected_revision: cancelled.data.revision });
    assert.equal(duplicate.error?.code, "42501");
    const replacement = await call("a_pm", "d5o_graybar_command_v1", {
      ...args, p_action: "prepare-po", p_input: {
        lines: [{ materialId: a.materials[3], quantity: "1", unit: "each" }],
        shipTo: "Revised fictional site", accountReference: a.account,
        requiredDate: "2027-01-16", budgetMinor: "500000" },
      p_command_id: uuid(), p_expected_revision: cancelled.data.revision });
    assert.ifError(replacement.error);
    const replacementOrder = replacement.data.state.orders.find((order) => order.status === "Prepared"
      && order.lines[0].materialId === a.materials[3]);
    assert(replacementOrder && replacementOrder.id !== a.pendingOrderId);
    const withdrawn = await call("a_pm", "d5o_graybar_command_v1", {
      ...args, p_input: { orderId: replacementOrder.id,
        reason: "Withdraw revised over-cap fictional purchase draft" },
      p_command_id: uuid(), p_expected_revision: replacement.data.revision });
    assert.ifError(withdrawn.error);
    assert.equal(sql(`select count(*)||':'||sum(amount_minor) from d5o_hosted.purchase_reservations
      where workspace_id=${q(a.workspace)} and work_id=${q(a.work)};`), before);
    const events = sql(`select count(*) from d5o_hosted.graybar_events
      where workspace_id=${q(a.workspace)} and work_id=${q(a.work)};`);
    assert.equal(events, "9");
    return { cancelledDraft: true, replacementDraft: true,
      replaySameRevision: true, unchangedReservations: before };
  });
  await check("canonical subcontract agreement and variation share parent cap with POs", async () => {
    const read = () => call("a_pm", "d5o_subcontract_read_v1",
      { p_workspace_key: a.workKey, p_presentation_id: a.presentation });
    const command = (role, action, input, revision, sourceDigest, commandId = uuid()) =>
      call(`a_${role}`, "d5o_subcontract_command_v1", { p_workspace_key: a.workKey,
        p_presentation_id: a.presentation, p_action: action, p_input: input,
        p_command_id: commandId, p_expected_revision: revision,
        p_expected_source_digest: sourceDigest });
    let position = await read();
    assert.ifError(position.error);
    const sourceDigest = position.data.source.digest;
    const allocation = await command("pm", "prepare-allocation", {
      capMinor: "800000", scope: "Fictional subcontract installation scope",
      conditions: "Only independently approved fictional agreements",
      sourceReference: "FICTIONAL-SUBCONTRACT-AWARD" }, position.data.revision, sourceDigest);
    assert.ifError(allocation.error);
    const wrongRole = await command("pm", "review-allocation", {
      allocationId: allocation.data.subjectId, decision: "Approved",
      reason: "Wrong reviewer must not approve" }, allocation.data.revision, sourceDigest);
    assert.equal(wrongRole.error?.code, "42501");
    const allocationApproved = await command("admin", "review-allocation", {
      allocationId: allocation.data.subjectId, decision: "Approved",
      reason: "Independent fictional subcontract allocation" }, allocation.data.revision, sourceDigest);
    assert.ifError(allocationApproved.error);
    const company = await command("pm", "register-company", {
      name: "Fictional Subcontract Company", contactName: "Fictional Contact",
      contactReference: "fictional@example.test" }, allocationApproved.data.revision, sourceDigest);
    assert.ifError(company.error);
    const agreement = await command("pm", "prepare-agreement", {
      companyId: company.data.subjectId, documentId: a.doc, amountMinor: "400000",
      agreementReference: "FICTIONAL-AGREEMENT-001", scope: "Fictional installation work package",
      exclusions: "None", deliverables: "Installed test assembly",
      acceptanceCriteria: "Independent inspection accepted",
      scheduleBasis: "Fictional site schedule", milestoneBasis: "One completion milestone"
    }, company.data.revision, sourceDigest);
    assert.ifError(agreement.error);
    const agreementApproved = await command("admin", "review-agreement", {
      agreementId: agreement.data.subjectId, decision: "Approved",
      reason: "Independent fictional subcontract agreement approval"
    }, agreement.data.revision, sourceDigest);
    assert.ifError(agreementApproved.error);
    const variationInput = (deltaMinor) => ({ agreementId: agreement.data.subjectId,
      deltaMinor: String(deltaMinor), documentId: a.doc,
      scopeDifference: "Fictional added installation scope",
      scheduleImpact: "One day", rationale: "Documented fictional site condition" });
    const exactVariation = await command("pm", "prepare-variation", variationInput(100000),
      agreementApproved.data.revision, sourceDigest);
    assert.ifError(exactVariation.error);
    const exactApproved = await command("admin", "review-variation", {
      agreementId: agreement.data.subjectId, variationId: exactVariation.data.subjectId,
      decision: "Approved", reason: "Independent fictional variation approval"
    }, exactVariation.data.revision, sourceDigest);
    assert.ifError(exactApproved.error);
    const aboveVariation = await command("pm", "prepare-variation", variationInput(1),
      exactApproved.data.revision, sourceDigest);
    assert.ifError(aboveVariation.error);
    const beforeDeniedEvents = sql(`select count(*) from d5o_hosted.subcontract_events
      where workspace_id=${q(a.workspace)} and work_id=${q(a.work)};`);
    const beforeDeniedReservations = sql(`select count(*)||':'||sum(amount_minor)
      from d5o_hosted.subcontract_reservations
      where workspace_id=${q(a.workspace)} and work_id=${q(a.work)};`);
    const denied = await command("admin", "review-variation", {
      agreementId: agreement.data.subjectId, variationId: aboveVariation.data.subjectId,
      decision: "Approved", reason: "This change exceeds shared parent capacity"
    }, aboveVariation.data.revision, sourceDigest);
    assert.equal(denied.error?.code, "23514");
    assert.equal(sql(`select count(*) from d5o_hosted.subcontract_events
      where workspace_id=${q(a.workspace)} and work_id=${q(a.work)};`), beforeDeniedEvents);
    assert.equal(sql(`select count(*)||':'||sum(amount_minor)
      from d5o_hosted.subcontract_reservations
      where workspace_id=${q(a.workspace)} and work_id=${q(a.work)};`), beforeDeniedReservations);
    const duplicate = await command("admin", "review-variation", {
      agreementId: agreement.data.subjectId, variationId: exactVariation.data.subjectId,
      decision: "Approved", reason: "Duplicate independent variation approval"
    }, aboveVariation.data.revision, sourceDigest);
    assert.equal(duplicate.error?.code, "23514");
    const totals = sql(`select (select coalesce(sum(amount_minor),0) from d5o_hosted.purchase_reservations
      where workspace_id=${q(a.workspace)} and work_id=${q(a.work)})||':'||
      (select coalesce(sum(amount_minor),0) from d5o_hosted.subcontract_reservations
      where workspace_id=${q(a.workspace)} and work_id=${q(a.work)});`);
    assert.equal(totals, "500000:500000");
    return { parentCapMinor: 1000000, purchaseMinor: 500000, subcontractMinor: 500000,
      exactVariationMinor: 100000, aboveDenied: true };
  });
  await check("canonical Design commitments serialize under their cap", async () => {
    const read = () => call("b_pm", "d5o_hosted_design_spend_read_v1",
      { p_workspace_key: b.workKey, p_presentation_id: b.presentation });
    const command = (role, action, input, revision, sourceDigest, commandId = uuid()) =>
      call(`b_${role}`, "d5o_hosted_design_spend_command_v1", { p_workspace_key: b.workKey,
        p_presentation_id: b.presentation, p_action: action, p_input: input,
        p_command_id: commandId, p_expected_revision: revision,
        p_expected_source_digest: sourceDigest });
    const initial = await read();
    assert.ifError(initial.error);
    assert(initial.data.source?.digest);
    const sourceDigest = initial.data.source.digest;
    const authority = await command("pm", "prepare-authority", { capMinor: "600000",
      validFrom: new Date().toISOString().slice(0, 10), validUntil: "2027-12-31",
      extent: "Fictional detailed Design services for this Work",
      sourceReference: "FICTIONAL-DESIGN-2026" }, initial.data.revision, sourceDigest);
    assert.ifError(authority.error);
    const wrong = await command("pm", "approve-authority", { authorityId: authority.data.subjectId,
      reason: "Preparer cannot independently approve this authority" }, authority.data.revision, sourceDigest);
    assert.equal(wrong.error?.code, "42501");
    const approved = await command("admin", "approve-authority", { authorityId: authority.data.subjectId,
      reason: "Independent approval of fictional Design authority" }, authority.data.revision, sourceDigest);
    assert.ifError(approved.error);
    let revision = approved.data.revision;
    const ids = [];
    for (const amount of [400000, 400000, 200000, 1]) {
      const prepared = await command("pm", "prepare-commitment", { authorityId: authority.data.subjectId,
        amountMinor: String(amount), activity: "Fictional detailed Design work",
        sourceReference: `FICTIONAL-DESIGN-${amount}-${ids.length}` }, revision, sourceDigest);
      assert.ifError(prepared.error);
      revision = prepared.data.revision;
      ids.push(prepared.data.subjectId);
    }
    const review = (id, atRevision, commandId = uuid()) => command("admin", "approve-commitment",
      { commitmentId: id, reason: "Independent fictional Design commitment review" },
      atRevision, sourceDigest, commandId);
    const firstCommandId = uuid(), secondCommandId = uuid();
    const simultaneous = await Promise.all([review(ids[0], revision, firstCommandId),
      review(ids[1], revision, secondCommandId)]);
    assert.equal(simultaneous.filter((item) => !item.error).length, 1);
    const winnerIndex = simultaneous[0].error ? 1 : 0;
    const replay = await review(ids[winnerIndex], revision,
      winnerIndex === 0 ? firstCommandId : secondCommandId);
    assert.ifError(replay.error);
    const current = await read();
    assert.ifError(current.error);
    const losingRetry = await review(ids[1 - winnerIndex], current.data.revision);
    assert.equal(losingRetry.error?.code, "23514");
    const exact = await review(ids[2], current.data.revision);
    assert.ifError(exact.error);
    const beforeDeniedEvents = sql(`select count(*) from d5o_hosted.design_spend_events
      where workspace_id=${q(b.workspace)} and work_id=${q(b.work)};`);
    const above = await review(ids[3], exact.data.revision);
    assert.equal(above.error?.code, "23514");
    assert.equal(sql(`select count(*) from d5o_hosted.design_spend_events
      where workspace_id=${q(b.workspace)} and work_id=${q(b.work)};`), beforeDeniedEvents);
    const final = await read();
    assert.ifError(final.error);
    assert.equal(final.data.committedMinor, 600000);
    const persisted = sql(`select count(*)||':'||sum(amount_minor) from d5o_hosted.design_spend_commitments
      where workspace_id=${q(b.workspace)} and work_id=${q(b.work)} and status='Approved';`);
    assert.equal(persisted, "2:600000");
    return { concurrentAccepted: 1, capMinor: 600000, committedMinor: 600000,
      aboveDenied: true, persisted };
  });
  await check("labor authority cap changes preserve existing exposure", async () => {
    const read = () => call("b_pm", "d5o_labor_authority_read_v1",
      { p_workspace_key: b.workKey, p_presentation_id: b.presentation });
    const command = (role, action, input, revision, sourceDigest, commandId = uuid()) =>
      call(`b_${role}`, "d5o_labor_authority_command_v1", { p_workspace_key: b.workKey,
        p_presentation_id: b.presentation, p_action: action, p_input: input,
        p_command_id: commandId, p_expected_revision: revision,
        p_expected_source_digest: sourceDigest });
    const initial = await read();
    assert.ifError(initial.error);
    const sourceDigest = initial.data.source.digest;
    const basis = (capMinor, supersedesId) => ({ capMinor: String(capMinor), rateMinor: "15000",
      rateVersion: "FICTIONAL-2026", rateSource: "Fictional field rate card",
      rateBasis: "One qualified technician hour at fictional rate",
      scope: "Fictional equipment installation and inspection",
      conditions: "Only qualified and published Work assignments",
      validFrom: new Date().toISOString().slice(0, 10), validUntil: "2027-12-31",
      ...(supersedesId ? { supersedesId } : {}) });
    const aboveParent = await command("pm", "prepare", basis(1000001),
      initial.data.revision, sourceDigest);
    assert.equal(aboveParent.error?.code, "23514");
    const prepared = await command("pm", "prepare", basis(500000),
      initial.data.revision, sourceDigest);
    assert.ifError(prepared.error);
    const wrong = await command("pm", "approve", { authorityId: prepared.data.subjectId,
      reason: "Preparer cannot review labor authority" }, prepared.data.revision, sourceDigest);
    assert.equal(wrong.error?.code, "42501");
    const approved = await command("admin", "approve", { authorityId: prepared.data.subjectId,
      reason: "Independent fictional labor authority review" }, prepared.data.revision, sourceDigest);
    assert.ifError(approved.error);
    // Existing fictional exposure is a source fixture. The cap-change commands
    // under test use the production authenticated RPC, with every trigger enabled.
    sql(`insert into d5o_hosted.labor_reservations(workspace_id,work_id,labor_authority_id,
      publication_id,assignment_id,assignment_digest,person,person_user_id,package_id,
      design_revision,demand_revision,release_id,work_date,shift,authorized_hours,
      rate_minor,amount_minor,currency,status,approved_by) values(
      ${q(b.workspace)},${q(b.work)},${q(prepared.data.subjectId)},${q(uuid())},${q(uuid())},
      'fictional-digest','Fictional Technician',${q(users.b.pm.id)},'fictional-package',
      1,1,'fictional-release',current_date,'Day',20,15000,300000,'USD','Active',${q(users.b.admin.id)});`);
    const exposure = await read();
    assert.ifError(exposure.error);
    assert.equal(exposure.data.laborExposureMinor, 300000);
    const revoked = await command("admin", "revoke", { authorityId: prepared.data.subjectId,
      reason: "Fictional cap revision requires replacement" }, approved.data.revision, sourceDigest);
    assert.ifError(revoked.error);
    const lower = await command("pm", "prepare", basis(299999, prepared.data.subjectId),
      revoked.data.revision, sourceDigest);
    assert.ifError(lower.error);
    const beforeDenied = sql(`select count(*) from d5o_hosted.labor_authority_events
      where workspace_id=${q(b.workspace)} and work_id=${q(b.work)};`);
    const denied = await command("admin", "approve", { authorityId: lower.data.subjectId,
      reason: "This cap is below existing commitments" }, lower.data.revision, sourceDigest);
    assert.equal(denied.error?.code, "23514");
    assert.equal(sql(`select count(*) from d5o_hosted.labor_authority_events
      where workspace_id=${q(b.workspace)} and work_id=${q(b.work)};`), beforeDenied);
    const returned = await command("admin", "return", { authorityId: lower.data.subjectId,
      reason: "Return below-exposure cap for correction" }, lower.data.revision, sourceDigest);
    assert.ifError(returned.error);
    const exact = await command("pm", "prepare", basis(300000, lower.data.subjectId),
      returned.data.revision, sourceDigest);
    assert.ifError(exact.error);
    const exactApproved = await command("admin", "approve", { authorityId: exact.data.subjectId,
      reason: "Existing fictional exposure exactly matches revised cap" }, exact.data.revision, sourceDigest);
    assert.ifError(exactApproved.error);
    const final = await read();
    assert.ifError(final.error);
    assert.equal(final.data.laborRemainingMinor, 0);
    assert.equal(final.data.laborExposureMinor, 300000);
    return { exposedMinor: 300000, belowDenied: true, exactApproved: true, remainingMinor: 0 };
  });
  await check("selected delegate alone approves a canonical PO at the combined cap", async () => {
    const delegateRead = await call("b_admin", "d5o_spending_delegate_read_v1",
      { p_workspace_key: b.workKey });
    assert.ifError(delegateRead.error);
    const configured = await call("b_admin", "d5o_spending_delegate_command_v1", {
      p_workspace_key: b.workKey, p_action: "add", p_input: {
        category: "purchase_order", role: "admin", kind: "delegate",
        actorId: users.b.delegate.id, maxMinor: "100000", currency: "USD", priority: "100",
        validFrom: new Date().toISOString().slice(0, 10), validUntil: "2027-12-31",
        sourceReference: "FICTIONAL-DELEGATED-PO" },
      p_command_id: uuid(), p_expected_revision: delegateRead.data.revision });
    assert.ifError(configured.error);
    const prepare = (role, action, input, revision, commandId = uuid()) =>
      call(`b_${role}`, "d5o_graybar_command_v1", { p_workspace_key: b.workKey,
        p_presentation_id: b.presentation, p_action: action, p_input: input,
        p_command_id: commandId, p_expected_revision: revision });
    const draft = await prepare("pm", "prepare-po", {
      lines: [{ materialId: b.materials[4], quantity: "1", unit: "each" }],
      shipTo: "Fictional site", accountReference: b.account,
      requiredDate: "2027-01-15", budgetMinor: "100000" }, 1);
    assert.ifError(draft.error);
    const orderId = draft.data.state.orders[0].id;
    const approvalInput = { orderId, authorityBasis: "Selected fictional delegate" };
    const wrongReviewer = await prepare("admin", "approve-po", approvalInput, draft.data.revision);
    assert.equal(wrongReviewer.error?.code, "42501");
    server = await startNext(url, anon, service);
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
    await page.goto(`http://127.0.0.1:${server.port}/auth/sign-in?next=%2Fwork`);
    await page.getByLabel("Email").fill(users.b.delegate.email);
    await page.getByLabel("Password").fill(users.b.delegate.password);
    await page.getByRole("button", { name: "Continue to your work" }).click();
    await page.waitForURL((location) => !location.pathname.startsWith("/auth/sign-in"));
    await page.goto(`http://127.0.0.1:${server.port}/work/procurement?workspace=${b.workKey}&workId=${b.presentation}&step=po`);
    const approval = page.getByRole("button", { name: "Approve independently" });
    await approval.waitFor({ state: "visible", timeout: 30000 });
    const [response] = await Promise.all([page.waitForResponse((item) =>
      item.url().includes("/api/d5o-hosted/graybar") && item.request().method() === "POST"),
    approval.click()]);
    assert.equal(response.status(), 200, await response.text());
    await page.getByText(/PO [0-9a-f]{8} · Approved/).waitFor({ timeout: 30000 });
    const screen = resolve(root, ".tmp/d5o-evidence/financial/delegated-po-tablet.png");
    mkdirSync(resolve(output, ".."), { recursive: true });
    await page.screenshot({ path: screen, fullPage: true });
    const totals = sql(`select
      (select coalesce(sum(amount_minor),0) from d5o_hosted.design_spend_commitments
       where workspace_id=${q(b.workspace)} and work_id=${q(b.work)} and status='Approved')||':'||
      (select coalesce(sum(amount_minor),0) from d5o_hosted.labor_reservations
       where workspace_id=${q(b.workspace)} and work_id=${q(b.work)} and status='Active')||':'||
      (select coalesce(sum(amount_minor),0) from d5o_hosted.purchase_reservations
       where workspace_id=${q(b.workspace)} and work_id=${q(b.work)} and status='Reserved');`);
    assert.equal(totals, "600000:300000:100000");
    return { wrongReviewerDenied: true, selectedDelegateApprovedViaBrowser: true,
      combinedCommittedMinor: 1000000, parentCapMinor: 1000000 };
  });
  await check("PO and subcontract variation cannot jointly overspend shared parent cap", async () => {
    const c = fixture("c", users.a);
    const purchase = (role, action, input, revision, sourceDigest) =>
      call(`a_${role}`, "d5o_purchase_authority_command_v1", {
        p_workspace_key: c.workKey, p_presentation_id: c.presentation,
        p_action: action, p_input: input, p_command_id: uuid(),
        p_expected_revision: revision, p_expected_source_digest: sourceDigest });
    const purchaseRead = await call("a_pm", "d5o_purchase_authority_read_v1", {
      p_workspace_key: c.workKey, p_presentation_id: c.presentation });
    assert.ifError(purchaseRead.error);
    const purchaseDigest = purchaseRead.data.source.digest;
    const preparedAuthority = await purchase("pm", "prepare", {
      parentCapMinor: "1000000", purchaseCapMinor: "1000000", subcontractEnabled: true,
      validFrom: new Date().toISOString().slice(0, 10), validUntil: "2027-12-31",
      purchasingEntity: "Fictional cross-family purchasing", graybarAccountReference: c.account,
      scope: "Fictional shared budget race", fundingSource: "Fictional customer funding",
      sourceReference: "FICTIONAL-RACE-AWARD", conditions: "Independent approvals required"
    }, purchaseRead.data.revision, purchaseDigest);
    assert.ifError(preparedAuthority.error);
    const authority = await purchase("admin", "approve", {
      authorityId: preparedAuthority.data.subjectId,
      reason: "Independent fictional shared budget authority" },
    preparedAuthority.data.revision, purchaseDigest);
    assert.ifError(authority.error);
    const graybar = (role, action, input, revision) => call(`a_${role}`,
      "d5o_graybar_command_v1", { p_workspace_key: c.workKey,
        p_presentation_id: c.presentation, p_action: action, p_input: input,
        p_command_id: uuid(), p_expected_revision: revision });
    const poDraft = await graybar("pm", "prepare-po", {
      lines: [{ materialId: c.materials[0], quantity: "1", unit: "each" }],
      shipTo: "Fictional race site", accountReference: c.account,
      requiredDate: "2027-01-15", budgetMinor: "1000000" }, 1);
    assert.ifError(poDraft.error);
    const orderId = poDraft.data.state.orders[0].id;
    const subcontract = (role, action, input, revision, digest) =>
      call(`a_${role}`, "d5o_subcontract_command_v1", {
        p_workspace_key: c.workKey, p_presentation_id: c.presentation,
        p_action: action, p_input: input, p_command_id: uuid(),
        p_expected_revision: revision, p_expected_source_digest: digest });
    const initial = await call("a_pm", "d5o_subcontract_read_v1", {
      p_workspace_key: c.workKey, p_presentation_id: c.presentation });
    assert.ifError(initial.error);
    const subcontractDigest = initial.data.source.digest;
    const allocation = await subcontract("pm", "prepare-allocation", {
      capMinor: "1000000", scope: "Fictional installation race scope",
      conditions: "Independent approvals required", sourceReference: "FICTIONAL-RACE-SUBCONTRACT"
    }, initial.data.revision, subcontractDigest);
    assert.ifError(allocation.error);
    const allocationApproved = await subcontract("admin", "review-allocation", {
      allocationId: allocation.data.subjectId, decision: "Approved",
      reason: "Independent fictional allocation" }, allocation.data.revision, subcontractDigest);
    assert.ifError(allocationApproved.error);
    const company = await subcontract("pm", "register-company", {
      name: "Fictional Race Contractor", contactName: "Fictional Contact",
      contactReference: "fictional@example.test" }, allocationApproved.data.revision, subcontractDigest);
    assert.ifError(company.error);
    const agreement = await subcontract("pm", "prepare-agreement", {
      companyId: company.data.subjectId, documentId: c.doc, amountMinor: "900000",
      agreementReference: "FICTIONAL-RACE-AGREEMENT", scope: "Fictional site work",
      exclusions: "None", deliverables: "Fictional installed assembly",
      acceptanceCriteria: "Independent inspection", scheduleBasis: "Fictional schedule",
      milestoneBasis: "One completion milestone" }, company.data.revision, subcontractDigest);
    assert.ifError(agreement.error);
    const agreementApproved = await subcontract("admin", "review-agreement", {
      agreementId: agreement.data.subjectId, decision: "Approved",
      reason: "Independent fictional agreement" }, agreement.data.revision, subcontractDigest);
    assert.ifError(agreementApproved.error);
    const variation = await subcontract("pm", "prepare-variation", {
      agreementId: agreement.data.subjectId, deltaMinor: "100000", documentId: c.doc,
      scopeDifference: "Fictional extra work", scheduleImpact: "One day",
      rationale: "Fictional site condition" }, agreementApproved.data.revision, subcontractDigest);
    assert.ifError(variation.error);
    const before = sql(`select
      (select coalesce(sum(amount_minor),0) from d5o_hosted.purchase_reservations
       where workspace_id=${q(c.workspace)} and work_id=${q(c.work)})||':'||
      (select coalesce(sum(amount_minor),0) from d5o_hosted.subcontract_reservations
       where workspace_id=${q(c.workspace)} and work_id=${q(c.work)});`);
    assert.equal(before, "0:900000");
    const [poResult, variationResult] = await Promise.all([
      graybar("admin", "approve-po", { orderId,
        authorityBasis: "Independent fictional PO race approval" }, poDraft.data.revision),
      subcontract("admin", "review-variation", {
        agreementId: agreement.data.subjectId, variationId: variation.data.subjectId,
        decision: "Approved", reason: "Independent fictional variation race approval"
      }, variation.data.revision, subcontractDigest)
    ]);
    assert.equal([poResult, variationResult].filter((item) => !item.error).length, 1,
      `cross_family_race:${JSON.stringify({poResult,variationResult}).slice(0,900)}`);
    const after = sql(`select
      (select coalesce(sum(amount_minor),0) from d5o_hosted.purchase_reservations
       where workspace_id=${q(c.workspace)} and work_id=${q(c.work)})||':'||
      (select coalesce(sum(amount_minor),0) from d5o_hosted.subcontract_reservations
       where workspace_id=${q(c.workspace)} and work_id=${q(c.work)});`);
    assert(["100000:900000", "0:1000000"].includes(after), `shared_cap_overspend:${after}`);
    return { before, after, accepted: 1, rejected: 1,
      rejectedCode: (poResult.error ?? variationResult.error).code };
  });
} catch (error) { evidence.error = String(error.stack ?? error).slice(0, 2500); }
finally {
  if (browser) await browser.close();
  if (server) server.process.kill();
  restoreNextEnv();
  if (runtime) evidence.cleanup = cleanupP0aRuntime(runtime);
  evidence.finishedAt = new Date().toISOString();
  evidence.summary = { passed: evidence.checks.length, error: Boolean(evidence.error),
    cleanupVerified: Boolean(evidence.cleanup?.clean) };
  mkdirSync(resolve(output, ".."), { recursive: true });
  writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({ ...evidence.summary, output }));
  if (evidence.error || !evidence.cleanup?.clean) process.exitCode = 1;
}
