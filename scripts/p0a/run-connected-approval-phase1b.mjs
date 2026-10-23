import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { createP0aRuntime, cleanupP0aRuntime } from "./disposable-runtime.mjs";

const root = resolve(process.cwd());
const output = resolve(root, "docs/architecture/evidence/phase1b-connected-results.json");
const evidence = { sourceCommit: "7b8a629d57f4652acd7545ac244555e228a563d4",
  startedAt: new Date().toISOString(), tests: [], setupError: null, cleanup: null };
let runtime;
const q = (value) => `'${String(value).replaceAll("'", "''")}'`;
function sql(query) {
  const result = spawnSync("docker", ["exec", "-i", runtime.dbContainer, "psql", "-U", "postgres", "-d", "postgres",
    "-X", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: query, encoding: "utf8", shell: false });
  if (result.status !== 0) throw Error(`sql_failed:${result.stderr.slice(0, 700)}`);
  return result.stdout.trim();
}
async function check(name, fn) {
  try { evidence.tests.push({ name, status: "PASS", detail: await fn() ?? null }); }
  catch (error) { evidence.tests.push({ name, status: "FAIL", detail: String(error.message).slice(0, 600) }); }
}
try {
  runtime = await createP0aRuntime(root);
  const url = runtime.status.API_URL ?? runtime.status.SUPABASE_URL;
  const anon = runtime.status.ANON_KEY ?? runtime.status.PUBLISHABLE_KEY;
  const service = runtime.status.SERVICE_ROLE_KEY ?? runtime.status.SECRET_KEY;
  assert.equal(url, `http://127.0.0.1:${runtime.ports.api}`);
  evidence.environment = { projectId: runtime.projectId, apiPort: runtime.ports.api,
    localOnly: true, migration: "20261023115306_d5o_phase1b_connected_service_approval.sql" };
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const users = {};
  for (const key of ["a_admin", "a_pm", "a_ops", "b_admin", "b_pm", "b_ops"]) {
    const email = `phase1b-${key}-${randomUUID().slice(0, 8)}@example.test`;
    const password = randomBytes(24).toString("base64url") + "!";
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw Error(`user_create_failed:${key}`);
    users[key] = { id: created.data.user.id, email, password };
  }
  const ids = { a: { workspace: randomUUID(), tenant: randomUUID(), version: randomUUID(), work: randomUUID(), request: randomUUID() },
    b: { workspace: randomUUID(), tenant: randomUUID(), version: randomUUID(), work: randomUUID(), request: randomUUID() } };
  const dueDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const statements = ["begin;"];
  for (const [key, id] of Object.entries(ids)) {
    const workspace = key === "a" ? "rybex" : "enterprise_test";
    const threshold = key === "a" ? 1000000 : 2500000;
    const manifest = { workTypes: [{ key: "technical-delivery", label: "Technical Delivery", status: "active", templateKey: "technical-delivery" },
      { key: "lifecycle-service", label: "Lifecycle service", status: "active", templateKey: "lifecycle-service" }],
      serviceWorkApproval: { schemaVersion: 1, thresholdMinor: threshold, currency: "USD", comparison: "greater_than",
        authorityRole: "operations_leader", unavailableBehavior: "block" } };
    const request = { id: id.request, title: "Synthetic service repair", description: "Replace the documented equipment module",
      assetId: `asset-${key}`, agreementId: `agreement-${key}`, status: "Triaged", coverage: "Partially covered",
      reportedAt: "2026-10-23T10:00:00Z", serviceEstimate: { revision: 1, status: "Approved",
        requestCycleAt: "2026-10-23T10:00:00Z", submittedByActorId: users[`${key}_pm`].id,
        input: { lines: [{ scopeRef: id.request, description: "Module replacement" }] },
        evaluation: { proposedPriceMinor: 1500000, currency: "USD" } } };
    const state = { activation: { status: "Active" }, requests: [request],
      assets: [{ id: `asset-${key}`, name: "Synthetic supported module", status: "Supported" }],
      jobs: [], events: [], authorityRevision: 1 };
    const presentation = `${workspace}-${id.work.replaceAll("-", "")}`;
    const parent = { id: presentation, canonicalWorkId: id.work, workspace,
      phaseConfigurationVersionId: id.version, customer: "Synthetic customer", site: "Test site",
      title: "Synthetic connected service", type: "Technical Delivery" };
    const prototype = { workspace, schemaVersion: 1, records: [parent] };
    statements.push(
      `insert into d5o_hosted.workspaces(id,workspace_key,display_name) values (${q(id.workspace)},${q(workspace)},${q(`${workspace} Phase 1B`) });`,
      ...["admin", "pm", "ops"].map((role) => `insert into d5o_hosted.memberships(workspace_id,actor_user_id,role) values (${q(id.workspace)},${q(users[`${key}_${role}`].id)},${q(role === "pm" ? "project_manager" : role === "ops" ? "operations_leader" : "admin")});`),
      `insert into d5o_hosted.configuration_tenants(id,workspace_id,status) values (${q(id.tenant)},${q(id.workspace)},'active');`,
      `insert into d5o_hosted.configuration_versions(id,tenant_id,version_number,status,source_sha256,manifest_json,effective_from) values (${q(id.version)},${q(id.tenant)},1,'draft',${q("a".repeat(64))},${q(JSON.stringify(manifest))}::jsonb,now()-interval '1 day');`,
      `insert into d5o_hosted.configuration_work_types(configuration_version_id,work_type_key,display_name,status) values (${q(id.version)},'technical-delivery','Technical Delivery','active');`,
      `insert into d5o_hosted.configuration_work_types(configuration_version_id,work_type_key,display_name,status) values (${q(id.version)},'lifecycle-service','Lifecycle service','active');`,
      `insert into d5o_hosted.configuration_create_rights(configuration_version_id,work_type_key,workspace_role) values (${q(id.version)},'technical-delivery','project_manager');`,
      `insert into d5o_hosted.configuration_create_rights(configuration_version_id,work_type_key,workspace_role) values (${q(id.version)},'lifecycle-service','project_manager');`,
      `update d5o_hosted.configuration_versions set status='published' where id=${q(id.version)};`,
      `insert into d5o_hosted.work_records(id,workspace_id,configuration_tenant_id,configuration_version_id,configuration_digest,work_type_key,title,created_by) values (${q(id.work)},${q(id.workspace)},${q(id.tenant)},${q(id.version)},${q("a".repeat(64))},'technical-delivery','Synthetic connected service',${q(users[`${key}_pm`].id)});`,
      `insert into d5o_hosted.connected_operate_states(workspace_id,work_id,decision_revision,state) values (${q(id.workspace)},${q(id.work)},1,${q(JSON.stringify(state))}::jsonb);`,
      `insert into d5o_hosted.connected_deploy_states(workspace_id,work_id,decision_revision,state) values (${q(id.workspace)},${q(id.work)},1,'{"authorityRevision":1,"events":[],"permits":[],"reports":[]}'::jsonb);`
    );
    id.key = workspace;
    id.presentation = presentation;
    id.prototype = prototype;
  }
  statements.push("commit;");
  sql(statements.join("\n"));
  for (const [key, id] of Object.entries(ids)) {
    const membershipId = sql(`select id from d5o_hosted.memberships where workspace_id=${q(id.workspace)} and actor_user_id=${q(users[`${key}_pm`].id)};`);
    for (const stateKey of ["work", "catalog"]) {
      const saved = await admin.rpc("d5o_hosted_command_save_v1", {
        p_workspace_key: id.key, p_state_key: stateKey, p_expected_revision: 0,
        p_state: stateKey === "catalog" ? { ...id.prototype, packages: [] } : id.prototype,
        p_actor_user_id: users[`${key}_pm`].id,
        p_membership_id: membershipId });
      if (saved.error) throw Error(`prototype_fixture:${key}:${stateKey}:${saved.error.message}`);
    }
    sql(`insert into d5o_hosted.work_identity_links(workspace_id,work_id,presentation_id) values (${q(id.workspace)},${q(id.work)},${q(id.presentation)});`);
    const bytes = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n");
    const evidenceId = randomUUID();
    const objectPath = `${id.key}/${createHash("sha256").update(id.presentation).digest("hex")}/customer-decisions/${evidenceId}`;
    const uploaded = await admin.storage.from("d5o-deploy-evidence").upload(objectPath, bytes,
      { contentType: "application/pdf", upsert: false });
    if (uploaded.error) throw Error(`synthetic_evidence_upload:${key}:${uploaded.error.message}`);
    sql(`insert into d5o_hosted.customer_decision_evidence(id,workspace_id,work_id,presentation_id,purpose,scope_id,scope_revision,basis,object_path,storage_object_id,storage_updated_at,checksum_sha256,size_bytes,mime_type,filename,uploaded_by)
      select ${q(evidenceId)},${q(id.workspace)},${q(id.work)},${q(id.presentation)},'service-authorization',${q(id.request)},1,
        jsonb_build_object('estimateRevision',1,'amountMinor',1500000,'currency','USD','requestCycleAt','2026-10-23T10:00:00Z'),
        ${q(objectPath)},o.id,o.updated_at,${q(createHash("sha256").update(bytes).digest("hex"))},
        (o.metadata->>'size')::bigint,'application/pdf','synthetic-authorization.pdf',${q(users[`${key}_pm`].id)}
      from storage.objects o where o.bucket_id='d5o-deploy-evidence' and o.name=${q(objectPath)};`);
    id.evidenceId = evidenceId;
  }
  const clients = {};
  for (const [key, identity] of Object.entries(users)) {
    const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const login = await client.auth.signInWithPassword(identity);
    if (login.error) throw Error(`login_failed:${key}`);
    clients[key] = client;
  }
  const call = (user, name, args) => clients[user].rpc(name, args);
  const approve = (user, tenant, action, commandId) => call(user,
    "d5o_hosted_connected_service_approval_command_v1", { p_workspace_key: ids[tenant].key,
      p_parent_presentation_id: ids[tenant].presentation, p_request_id: ids[tenant].request,
      p_action: action, p_command_id: commandId });
  const readApproval = (user, tenant) => call(user,
    "d5o_hosted_connected_service_approval_read_v1", { p_workspace_key: ids[tenant].key,
      p_parent_presentation_id: ids[tenant].presentation,
      p_request_id: ids[tenant].request });
  const pricing = (user, tenant, commandId) => call(user,
    "d5o_hosted_service_pricing_command_v1", { p_workspace_key: ids[tenant].key,
      p_parent_presentation_id: ids[tenant].presentation, p_request_id: ids[tenant].request,
      p_action: "record-service-authorization", p_input: { estimateRevision: 1,
        evidenceId: ids[tenant].evidenceId, customerParty: "Synthetic customer representative",
        customerOrganization: "Synthetic customer", customerRole: "Facilities manager",
        authorityBasis: "Signed synthetic customer authorization for module replacement",
        outcome: "Authorized", note: "Reviewed synthetic customer authorization evidence" },
      p_command_id: commandId,
      p_expected_work_revision: 1, p_expected_operate_revision: 1 });
  const job = (user, tenant, commandId) => call(user,
    "d5o_hosted_service_job_command_v1", { p_workspace_key: ids[tenant].key,
      p_parent_presentation_id: ids[tenant].presentation, p_request_id: ids[tenant].request,
      p_due_date: dueDate, p_owner: "Synthetic service manager", p_command_id: commandId,
      p_expected_work_revision: 1, p_expected_catalog_revision: 1,
      p_expected_operate_revision: ids[tenant].operateRevision ?? 1 });
  await check("A direct authorization and job RPC deny missing approval", async () => {
    const [authorization, creation] = await Promise.all([
      pricing("a_ops", "a", "phase1b-a-auth-denied"), job("a_pm", "a", "phase1b-a-job-denied")]);
    assert.equal(authorization.error?.code, "23514");
    assert.match(authorization.error.message, /connected_service_approval_required/);
    assert.equal(creation.error?.code, "23514");
    assert.match(creation.error.message, /connected_service_approval_required/);
    return { authorization: "denied", job: "denied" };
  });
  await check("A pending approval is scoped and independently decided", async () => {
    const requested = await approve("a_pm", "a", "request", "phase1b-a-request");
    assert(!requested.error, requested.error?.message);
    assert.equal(requested.data.amountMinor, 1500000);
    assert.equal(requested.data.thresholdMinor, 1000000);
    const replay = await approve("a_pm", "a", "request", "phase1b-a-request");
    assert.deepEqual(replay.data, requested.data);
    const wrong = await approve("a_pm", "a", "approve", "phase1b-a-wrong-actor");
    const foreign = await call("b_ops", "d5o_hosted_connected_service_approval_command_v1", {
      p_workspace_key: ids.a.key, p_parent_presentation_id: ids.a.presentation,
      p_request_id: ids.a.request, p_action: "approve", p_command_id: "phase1b-foreign" });
    assert.equal(wrong.error?.code, "42501");
    assert.equal(foreign.error?.code, "42501");
    const decided = await approve("a_ops", "a", "approve", "phase1b-a-approved");
    assert(!decided.error, decided.error?.message);
    assert.equal(decided.data.status, "approved");
    return { status: decided.data.status, wrongActorDenied: true, crossTenantDenied: true };
  });
  await check("A valid approval authorizes customer decision and creates job", async () => {
    const passed = JSON.parse(sql(`select d5o_hosted.require_connected_service_approval_v1(${q(ids.a.workspace)},${q(ids.a.work)},${q(ids.a.request)})::text;`));
    assert.equal(passed.approvalRequired, true);
    assert(passed.approvalId);
    const visible = await readApproval("a_ops", "a");
    assert(!visible.error, visible.error?.message);
    assert.equal(visible.data.status, "approved");
    assert.equal(visible.data.canAuthorize, true);
    const authorization = await pricing("a_ops", "a", "phase1b-a-auth-after-approval");
    assert(!authorization.error, authorization.error?.message);
    ids.a.operateRevision = 2;
    const creation = await job("a_pm", "a", "phase1b-a-job-after-approval");
    assert(!creation.error, creation.error?.message);
    assert(creation.data.jobId);
    const replay = await job("a_pm", "a", "phase1b-a-job-after-approval");
    assert.equal(replay.data?.jobId, creation.data.jobId);
    return { approvalId: passed.approvalId, authorization: "recorded",
      jobId: creation.data.jobId, duplicateJob: "stable" };
  });
  await check("A approval cannot authorize a second request on the same Work", async () => {
    const otherRequestId = randomUUID();
    sql(`update d5o_hosted.connected_operate_states set state=jsonb_set(state,'{requests}',
      state->'requests' || jsonb_build_array((state->'requests'->0) || jsonb_build_object('id',${q(otherRequestId)})))
      where workspace_id=${q(ids.a.workspace)} and work_id=${q(ids.a.work)};`);
    const wrong = await call("a_ops", "d5o_hosted_service_pricing_command_v1", {
      p_workspace_key: ids.a.key, p_parent_presentation_id: ids.a.presentation,
      p_request_id: otherRequestId, p_action: "record-service-authorization",
      p_input: {}, p_command_id: "phase1b-wrong-work-request",
      p_expected_work_revision: 1, p_expected_operate_revision: 3 });
    assert.equal(wrong.error?.code, "23514");
    assert.match(wrong.error.message, /connected_service_approval_required/);
    return { sameWorkDifferentRequest: "denied" };
  });
  await check("B 25000 threshold needs no additional approval record", async () => {
    const basis = JSON.parse(sql(`select d5o_hosted.require_connected_service_approval_v1(${q(ids.b.workspace)},${q(ids.b.work)},${q(ids.b.request)})::text;`));
    assert.equal(basis.amountMinor, 1500000);
    assert.equal(basis.thresholdMinor, 2500000);
    assert.equal(basis.approvalRequired, false);
    const visible = await readApproval("b_pm", "b");
    assert(!visible.error, visible.error?.message);
    assert.equal(visible.data.status, "not_required");
    assert.equal(visible.data.canCreateJob, true);
    const denied = await approve("b_pm", "b", "request", "phase1b-b-unneeded");
    assert.equal(denied.error?.code, "23514");
    assert.equal(sql(`select count(*) from d5o_hosted.service_approval_requests where work_id=${q(ids.b.work)};`), "0");
    const authorization = await pricing("b_ops", "b", "phase1b-b-auth-without-extra-approval");
    assert(!authorization.error, authorization.error?.message);
    ids.b.operateRevision = 2;
    const concurrent = await Promise.all([
      job("b_pm", "b", "phase1b-b-job-concurrent-first"),
      job("b_pm", "b", "phase1b-b-job-concurrent-second")]);
    const accepted = concurrent.filter((result) => !result.error);
    const deniedConcurrent = concurrent.filter((result) => result.error);
    assert.equal(accepted.length, 1);
    assert.equal(deniedConcurrent.length, 1);
    assert.equal(deniedConcurrent[0].error.code, "23505");
    const creation = accepted[0];
    assert(creation.data.jobId);
    return { thresholdMinor: 2500000, approvalRequired: false, fabricatedApprovals: 0,
      authorization: "recorded", jobId: creation.data.jobId,
      concurrentJobAttempts: { accepted: 1, denied: 1 } };
  });
  await check("new active version does not repin A historical connected request", async () => {
    const version2 = randomUUID();
    sql(`begin;
      insert into d5o_hosted.configuration_versions(id,tenant_id,version_number,status,source_sha256,manifest_json,effective_from)
        select ${q(version2)},tenant_id,2,'draft',source_sha256,
          jsonb_set(manifest_json,'{serviceWorkApproval,thresholdMinor}','2500000'::jsonb),now()
        from d5o_hosted.configuration_versions where id=${q(ids.a.version)};
      insert into d5o_hosted.configuration_work_types(configuration_version_id,work_type_key,display_name,status)
        select ${q(version2)},work_type_key,display_name,status from d5o_hosted.configuration_work_types
        where configuration_version_id=${q(ids.a.version)};
      insert into d5o_hosted.configuration_create_rights(configuration_version_id,work_type_key,workspace_role)
        select ${q(version2)},work_type_key,workspace_role from d5o_hosted.configuration_create_rights
        where configuration_version_id=${q(ids.a.version)};
      update d5o_hosted.configuration_versions set status='superseded',effective_to=now()
        where id=${q(ids.a.version)};
      update d5o_hosted.configuration_versions set status='published' where id=${q(version2)};
      commit;`);
    const old = await readApproval("a_ops", "a");
    assert(!old.error, old.error?.message);
    assert.equal(old.data.configurationVersionId, ids.a.version);
    assert.equal(old.data.thresholdMinor, 1000000);
    const created = await call("a_pm", "d5o_hosted_create_work_v1", {
      p_workspace_key: ids.a.key, p_command_id: "phase1b-a-new-version-work",
      p_configuration_version_id: version2, p_work_type_key: "technical-delivery",
      p_title: "New work after synthetic policy publication" });
    assert(!created.error, created.error?.message);
    const pinned = sql(`select configuration_version_id from d5o_hosted.work_records where id=${q(created.data.workId)};`);
    assert.equal(pinned, version2);
    return { historicalVersion: ids.a.version, historicalThresholdMinor: 1000000,
      newWorkVersion: pinned, newThresholdMinor: 2500000 };
  });
  await check("changed amount invalidates A approval", async () => {
    sql(`update d5o_hosted.connected_operate_states set state=jsonb_set(state,'{requests,0,serviceEstimate,evaluation,proposedPriceMinor}','1600000'::jsonb) where workspace_id=${q(ids.a.workspace)} and work_id=${q(ids.a.work)};`);
    const denied = await pricing("a_ops", "a", "phase1b-a-stale-auth");
    assert.equal(denied.error?.code, "23514");
    assert.match(denied.error.message, /connected_service_approval_required/);
    const visible = await readApproval("a_ops", "a");
    assert.equal(visible.data?.status, "stale");
    return { changedAmountMinor: 1600000, authorization: "denied" };
  });
  await check("legacy service-role related-work path also denies stale approval", async () => {
    const attempted = await admin.rpc("d5o_hosted_create_related_work_v1", {
      p_workspace_key: ids.a.key, p_command_id: randomUUID(), p_action: "create-job",
      p_parent_presentation_id: ids.a.presentation, p_expected_work_revision: 1,
      p_expected_catalog_revision: 1, p_parent_after: {},
      p_child: { serviceSource: { requestId: ids.a.request } },
      p_actor_user_id: users.a_pm.id, p_membership_id: randomUUID() });
    assert.equal(attempted.error?.code, "23514");
    assert.match(attempted.error.message, /connected_service_approval_required/);
    return { olderServerRoute: "denied" };
  });
  await check("changed amount requires a new scoped decision while retaining history", async () => {
    const requested = await approve("a_pm", "a", "request", "phase1b-a-revised-request");
    assert(!requested.error, requested.error?.message);
    const approved = await approve("a_ops", "a", "approve", "phase1b-a-revised-approve");
    assert(!approved.error, approved.error?.message);
    const rows = JSON.parse(sql(`select json_agg(json_build_object('id',approval_id,'amount',amount_minor,'status',status) order by amount_minor) from d5o_hosted.service_approval_requests where work_id=${q(ids.a.work)} and service_request_id=${q(ids.a.request)};`));
    assert.equal(rows.length, 2);
    assert.notEqual(rows[0].id, rows[1].id);
    assert.deepEqual(rows.map((row) => row.amount), [1500000, 1600000]);
    assert(rows.every((row) => row.status === "approved"));
    const current = await readApproval("a_ops", "a");
    assert.equal(current.data?.status, "approved");
    return { previousApprovalRetained: true, revisedAmountMinor: 1600000, currentStatus: "approved" };
  });
  await check("Phase 2A role change cannot preserve old approval authority", async () => {
    const membershipId = sql(`select id from d5o_hosted.memberships where workspace_id=${q(ids.a.workspace)} and actor_user_id=${q(users.a_ops.id)};`);
    const change = await call("a_admin", "d5o_hosted_org_admin_command_v1", {
      p_workspace_key: ids.a.key, p_action: "member.role", p_subject_id: membershipId,
      p_input: { role: "project_manager" }, p_expected_revision: 1,
      p_reason: "Synthetic authority role change validation", p_command_id: "phase2a-approval-role-change" });
    assert(!change.error, change.error?.message);
    const denied = await job("a_pm", "a", "phase2a-stale-role-job");
    assert.equal(denied.error?.code, "23514");
    assert.match(denied.error.message, /connected_service_approval_required/);
    const restore = await call("a_admin", "d5o_hosted_org_admin_command_v1", {
      p_workspace_key: ids.a.key, p_action: "member.role", p_subject_id: membershipId,
      p_input: { role: "operations_leader" }, p_expected_revision: 2,
      p_reason: "Restore synthetic authority for revocation test", p_command_id: "phase2a-approval-role-restore" });
    assert(!restore.error, restore.error?.message);
    return { roleChangeDeniedApprovalReuse: true, oldDecisionRetained: true };
  });
  await check("revoked approval authority fails closed", async () => {
    sql(`update d5o_hosted.memberships set status='suspended' where workspace_id=${q(ids.a.workspace)} and actor_user_id=${q(users.a_ops.id)};`);
    const denied = await job("a_pm", "a", "phase1b-a-revoked-job");
    assert.equal(denied.error?.code, "23514");
    assert.match(denied.error.message, /connected_service_approval_required/);
    return { revokedApprover: "denied" };
  });
  await check("direct legacy entry points are not callable", async () => {
    const oldPricing = await call("a_pm", "d5o_hosted_service_pricing_command_pre_approval_v1", {
      p_workspace_key: ids.a.key, p_parent_presentation_id: ids.a.presentation,
      p_request_id: ids.a.request, p_action: "record-service-authorization", p_input: {},
      p_command_id: "phase1b-old-direct", p_expected_work_revision: 1,
      p_expected_operate_revision: 1 });
    assert(oldPricing.error);
    const privilege = sql(`select has_function_privilege('authenticated','public.d5o_hosted_service_pricing_command_pre_approval_v1(text,text,text,text,jsonb,text,bigint,integer)','EXECUTE'),has_function_privilege('authenticated','public.d5o_hosted_service_job_command_pre_approval_v1(text,text,text,date,text,text,bigint,bigint,integer)','EXECUTE'),has_function_privilege('service_role','public.d5o_hosted_create_related_work_pre_approval_v1(text,text,text,text,bigint,bigint,jsonb,jsonb,uuid,uuid)','EXECUTE');`);
    assert.equal(privilege, "f|f|f");
    return { authenticatedPricing: false, authenticatedJob: false, serviceRoleRelatedWork: false };
  });
  await check("decision audit retains tenant and pinned version", async () => {
    const rows = JSON.parse(sql(`select json_agg(json_build_object('workspace',workspace_id,'version',configuration_version_id,'actor',actor_user_id,'approval',approval_id)) from d5o_hosted.service_approval_events where work_id=${q(ids.a.work)};`));
    assert.equal(rows.length, 4);
    assert(rows.every((row) => row.workspace === ids.a.workspace && row.version === ids.a.version && row.approval));
    return { eventCount: rows.length, tenant: "A", pinnedVersion: ids.a.version };
  });
} catch (error) { evidence.setupError = String(error.message).slice(0, 1400); }
finally {
  if (runtime) evidence.cleanup = cleanupP0aRuntime(runtime);
  evidence.finishedAt = new Date().toISOString();
  evidence.summary = { passed: evidence.tests.filter((test) => test.status === "PASS").length,
    failed: evidence.tests.filter((test) => test.status === "FAIL").length,
    setupError: Boolean(evidence.setupError), cleanupVerified: Boolean(evidence.cleanup?.clean) };
  mkdirSync(resolve(root, "docs/architecture/evidence"), { recursive: true });
  writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({ ...evidence.summary, output: "docs/architecture/evidence/phase1b-connected-results.json" }));
  if (evidence.setupError || evidence.summary.failed || !evidence.summary.cleanupVerified) process.exitCode = 1;
}
