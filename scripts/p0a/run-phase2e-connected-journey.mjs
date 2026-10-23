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
const output = resolve(root, "docs/architecture/evidence/phase2e-connected-journey-results.json");
const evidence = { baseline: "224c9b62dcdfc7ab45ddd00d2372dd8f0c9e89b2",
  startedAt: new Date().toISOString(), tests: [], setupError: null, cleanup: null };
let runtime, server;
const q = (value) => `'${String(value).replaceAll("'", "''")}'`;
function sql(query) {
  const result = spawnSync("docker", ["exec", "-i", runtime.dbContainer, "psql", "-U", "postgres", "-d", "postgres",
    "-X", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: query, encoding: "utf8", shell: false });
  if (result.status !== 0) throw Error(`sql_failed:${result.stderr.slice(-900)}`);
  return result.stdout.trim();
}
async function check(name, run) {
  try { evidence.tests.push({ name, status: "PASS", detail: await run() ?? null }); }
  catch (error) { evidence.tests.push({ name, status: "FAIL", detail: String(error.message).slice(0, 800) }); }
}
const freePort = () => new Promise((done, fail) => { const socket = createServer();socket.once("error", fail);
  socket.listen(0,"127.0.0.1",()=>{const address=socket.address();socket.close(()=>done(address.port));}); });
async function startNext(url, anon, service) {
  const port = await freePort();
  const env = { ...process.env, NODE_ENV: "development", NEXT_TELEMETRY_DISABLED: "1",
    NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: anon, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: anon,
    SUPABASE_SECRET_KEY: service, SUPABASE_SERVICE_ROLE_KEY: service, D5O_HOSTED_ENABLED: "1",
    D5O_ISOLATED_PILOT: "1", D5O_ISOLATED_PILOT_URL: url,
    D5O_ISOLATED_APP_ORIGIN: `http://127.0.0.1:${port}`, D5O_COMMAND_RUNTIME: "pilot",
    RYBEXOS_RUNTIME_MODE: "test", RYBEXOS_AUTH_MODE: "supabase", RYBEXOS_DATA_SOURCE: "database" };
  const handle = spawn(process.execPath, [resolve(root,"node_modules/next/dist/bin/next"),
    "dev","--webpack","-p",String(port),"-H","127.0.0.1"],{cwd:root,env,stdio:"ignore",shell:false});
  for(let n=0;n<160;n++) { try { if((await fetch(`http://127.0.0.1:${port}/api/health`)).ok)
    return {handle,port}; } catch { /* startup */ } await new Promise((done)=>setTimeout(done,500)); }
  handle.kill();throw Error("next_start_timeout");
}

try {
  runtime = await createP0aRuntime(root);
  const url = runtime.status.API_URL ?? runtime.status.SUPABASE_URL;
  const anon = runtime.status.ANON_KEY ?? runtime.status.PUBLISHABLE_KEY;
  const service = runtime.status.SERVICE_ROLE_KEY ?? runtime.status.SECRET_KEY;
  assert(url === `http://127.0.0.1:${runtime.ports.api}` && anon && service);
  evidence.environment = { projectId: runtime.projectId, apiPort: runtime.ports.api, loopbackOnly: true };
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const users = {};
  for (const key of ["vendor","a_admin","b_admin","outsider",
    "a_finance","a_ops","b_finance","b_ops"]) {
    const email = `phase2d-${key}-${randomUUID().slice(0,8)}@example.test`;
    const password = randomBytes(24).toString("base64url") + "!";
    const created = await admin.auth.admin.createUser({email,password,email_confirm:true});
    assert(!created.error && created.data.user, `create_user:${key}:${created.error?.message}`);
    users[key] = {id:created.data.user.id,email,password};
  }
  // Platform authority is an explicit disposable fixture; no tenant/config/member row is seeded.
  sql(`insert into d5o_hosted.platform_administrators(actor_user_id,status)
    values(${q(users.vendor.id)},'active');`);
  const clients = {};
  for (const [key,user] of Object.entries(users)) {
    clients[key] = createClient(url, anon, { auth: { persistSession:false, autoRefreshToken:false } });
    const login = await clients[key].auth.signInWithPassword({email:user.email,password:user.password});
    assert(!login.error, `login:${key}`);
  }
  const call = (key,name,args={}) => clients[key].rpc(name,args);
  let template, a, b, versions = {};
  await check("vendor sees validated immutable template directory", async () => {
    const read = await call("vendor","d5o_platform_templates_v1");
    const denied = await call("outsider","d5o_platform_templates_v1");
    assert(!read.error,read.error?.message);assert.equal(read.data.length,2);
    assert(read.data.every((item)=>item.status==="published" && item.valid));
    assert.equal(denied.error?.code,"42501");
    template=read.data.find((item)=>item.templateKey==="service-operations");
    assert(template);
    return {template:template.name,version:template.version,outsiderDenied:true};
  });
  const args = (key,user,requestId) => ({p_request_id:requestId,p_workspace_key:key,
    p_legal_name:key==="tenant_a_test"?"Rybex Test LLC":"Independent Enterprise Test LLC",
    p_display_name:key==="tenant_a_test"?"Rybex Test":"Independent Enterprise Test",
    p_admin_email:user.email,p_country:"US",p_time_zone:"America/New_York",p_currency:"USD",
    p_template_version_id:template.id,p_reason:"Provision fictional customer in disposable test"});
  const aArgs=args("tenant_a_test",users.a_admin,"phase2c-provision-tenant-a");
  const bArgs=args("tenant_b_test",users.b_admin,"phase2c-provision-tenant-b");
  await check("vendor provisions A and B through one authoritative command", async () => {
    const first=await call("vendor","d5o_platform_provision_v1",aArgs);
    const second=await call("vendor","d5o_platform_provision_v1",bArgs);
    assert(!first.error,first.error?.message);assert(!second.error,second.error?.message);
    a=first.data;b=second.data;
    assert.notEqual(a.workspaceId,b.workspaceId);assert.notEqual(a.configurationVersionId,b.configurationVersionId);
    assert.equal(a.lifecycle,"awaiting_admin");assert.equal(b.lifecycle,"awaiting_admin");
    assert.equal(Number(sql("select count(*) from d5o_hosted.workspaces where workspace_key in ('tenant_a_test','tenant_b_test');")),2);
    return {A:a.workspaceKey,B:b.workspaceKey,independentVersions:true};
  });
  await check("non-vendor and customer cannot provision or mutate template", async () => {
    const outsider=await call("outsider","d5o_platform_provision_v1",{...aArgs,p_request_id:"phase2c-outsider-denied",p_workspace_key:"evil_tenant"});
    const customer=await call("a_admin","d5o_platform_provision_v1",{...aArgs,p_request_id:"phase2c-customer-denied",p_workspace_key:"evil_tenant"});
    const templateWrite=await call("a_admin","d5o_platform_template_command_v1",{
      p_template_key:"service-operations",p_action:"retire",p_version_id:template.id,
      p_payload:null,p_command_id:"phase2c-template-denied",p_reason:"Unauthorized template mutation test"});
    assert.equal(outsider.error?.code,"42501");assert.equal(customer.error?.code,"42501");
    assert.equal(templateWrite.error?.code,"42501");return {denied:true};
  });
  await check("replay, collision and duplicate tenant key preserve one result", async () => {
    const replay=await call("vendor","d5o_platform_provision_v1",aArgs);
    const collision=await call("vendor","d5o_platform_provision_v1",{...aArgs,p_display_name:"Changed",});
    const duplicate=await call("vendor","d5o_platform_provision_v1",{...aArgs,p_request_id:"phase2c-other-key"});
    assert.deepEqual(replay.data,a);assert.equal(collision.error?.code,"23505");
    assert.equal(duplicate.error?.code,"23505");return {replay:true,collisionDenied:true};
  });
  await check("concurrent identical provisioning creates one tenant",async()=>{
    const concurrentArgs={...bArgs,p_request_id:"phase2c-concurrent-provision",
      p_workspace_key:"concurrent_qualification_test",p_display_name:"Concurrent Qualification Test"};
    const attempts=await Promise.all([
      call("vendor","d5o_platform_provision_v1",concurrentArgs),
      call("vendor","d5o_platform_provision_v1",concurrentArgs)]);
    assert(attempts.every((item)=>!item.error),attempts.map((item)=>item.error?.message).join(","));
    assert.deepEqual(attempts[0].data,attempts[1].data);
    assert.equal(Number(sql("select count(*) from d5o_hosted.workspaces where workspace_key='concurrent_qualification_test';")),1);
    return {sameResult:true,workspaceCount:1};
  });
  await check("provider failure remains inactive and vendor recovery replaces only the offer",async()=>{
    const pendingArgs={...aArgs,p_request_id:"phase2c-provider-failure",
      p_workspace_key:"provider_failure_test",p_display_name:"Provider Failure Test",
      p_admin_email:"no-delivery-phase2c@example.test"};
    const created=await call("vendor","d5o_platform_provision_v1",pendingArgs);
    assert(!created.error,created.error?.message);
    assert.equal(created.data.invitationStatus,"pending");
    const failed=await admin.rpc("d5o_platform_invitation_finish_v1",{
      p_workspace_key:created.data.workspaceKey,p_invitation_id:created.data.invitationId,
      p_vendor_user_id:users.vendor.id,p_status:"provider_rejected",p_provider_user_id:null});
    assert(!failed.error,failed.error?.message);
    const before=await call("vendor","d5o_platform_provisioning_directory_v1");
    assert.equal(before.data.find((item)=>item.workspaceKey===created.data.workspaceKey)?.status,"failed");
    const recovered=await call("vendor","d5o_platform_invitation_recover_v1",{
      p_workspace_key:created.data.workspaceKey,p_command_id:"phase2c-provider-recovery",
      p_reason:"Recover rejected disposable provider invitation"});
    assert(!recovered.error,recovered.error?.message);
    assert.notEqual(recovered.data.invitationId,created.data.invitationId);
    assert.equal(Number(sql(`select count(*) from d5o_hosted.memberships where workspace_id=${q(created.data.workspaceId)};`)),0);
    assert.equal(Number(sql(`select count(*) from d5o_hosted.workspaces where id=${q(created.data.workspaceId)};`)),1);
    return {failedState:true,recoveredState:recovered.data.lifecycle,duplicateTenant:false,grantCount:0};
  });
  await check("expired initial invitation recovers without a duplicate tenant",async()=>{
    sql(`update d5o_hosted.admin_identity_requests set expires_at=now()-interval '1 minute'
      where workspace_id=${q(a.workspaceId)} and command_id=${q(a.invitationId)};`);
    const expired=await call("a_admin","d5o_platform_initial_admin_accept_v1",{
      p_workspace_key:a.workspaceKey,p_invitation_id:a.invitationId});
    assert.equal(expired.error?.code,"23514");
    const oldId=a.invitationId;
    const recovered=await call("vendor","d5o_platform_invitation_recover_v1",{
      p_workspace_key:a.workspaceKey,p_command_id:"phase2c-recover-tenant-a",
      p_reason:"Replace expired fictional invitation safely"});
    assert(!recovered.error,recovered.error?.message);
    const replay=await call("vendor","d5o_platform_invitation_recover_v1",{
      p_workspace_key:a.workspaceKey,p_command_id:"phase2c-recover-tenant-a",
      p_reason:"Replace expired fictional invitation safely"});
    assert.deepEqual(replay.data,recovered.data);
    a.invitationId=recovered.data.invitationId;
    const stale=await call("a_admin","d5o_platform_initial_admin_accept_v1",{
      p_workspace_key:a.workspaceKey,p_invitation_id:oldId});
    assert.equal(stale.error?.code,"42501");
    assert.equal(Number(sql(`select count(*) from d5o_hosted.workspaces where id=${q(a.workspaceId)};`)),1);
    return {expiredDenied:true,oldOfferDenied:true,recoveryReplaySafe:true};
  });
  await check("governed template version is validated, published, immutable and retired",async()=>{
    const draft=await call("vendor","d5o_platform_template_command_v1",{
      p_template_key:"standard-d5o",p_action:"create-draft",p_version_id:null,p_payload:null,
      p_command_id:"phase2c-template-draft",p_reason:"Create disposable template revision for governance test"});
    assert(!draft.error,draft.error?.message);
    const id=draft.data.versionId;
    const unpublished=await call("vendor","d5o_platform_provision_v1",{
      ...aArgs,p_request_id:"phase2c-unpublished-template",p_workspace_key:"unpublished_template_tenant",
      p_template_version_id:id});
    assert.equal(unpublished.error?.code,"23514");
    const validate=await call("vendor","d5o_platform_template_command_v1",{
      p_template_key:"standard-d5o",p_action:"validate",p_version_id:id,p_payload:null,
      p_command_id:"phase2c-template-validate",p_reason:"Validate disposable template revision"});
    assert(!validate.error,validate.error?.message);
    const publish=await call("vendor","d5o_platform_template_command_v1",{
      p_template_key:"standard-d5o",p_action:"publish",p_version_id:id,p_payload:null,
      p_command_id:"phase2c-template-publish",p_reason:"Publish disposable template revision"});
    assert(!publish.error,publish.error?.message);
    const mutation=await call("vendor","d5o_platform_template_command_v1",{
      p_template_key:"standard-d5o",p_action:"save",p_version_id:id,p_payload:{},
      p_command_id:"phase2c-template-mutate",p_reason:"Attempt mutation of published template"});
    assert.equal(mutation.error?.code,"23514");
    const immutable=spawnSync("docker",["exec","-i",runtime.dbContainer,"psql","-U","postgres","-d","postgres",
      "-X","-t","-A","-v","ON_ERROR_STOP=1"],{input:`update d5o_hosted.configuration_template_versions
      set status='draft' where id=${q(id)};`,encoding:"utf8",shell:false});
    assert.notEqual(immutable.status,0);
    const retired=await call("vendor","d5o_platform_template_command_v1",{
      p_template_key:"standard-d5o",p_action:"retire",p_version_id:null,p_payload:null,
      p_command_id:"phase2c-template-retire",p_reason:"Retire disposable standard template after test"});
    assert(!retired.error,retired.error?.message);
    const refused=await call("vendor","d5o_platform_provision_v1",{
      ...aArgs,p_request_id:"phase2c-retired-template",p_workspace_key:"retired_template_tenant",
      p_template_version_id:id});
    assert.equal(refused.error?.code,"23514");
    return {publishedVersion:id,immutable:true,unpublishedSelectionDenied:true,retiredSelectionDenied:true};
  });
  await check("initial offers are tenant-bound and accepted by exact recipients", async () => {
    const forged=await call("a_admin","d5o_platform_initial_admin_accept_v1",{
      p_workspace_key:b.workspaceKey,p_invitation_id:b.invitationId});
    const wrong=await call("outsider","d5o_platform_initial_admin_accept_v1",{
      p_workspace_key:a.workspaceKey,p_invitation_id:a.invitationId});
    assert.equal(forged.error?.code,"42501");assert.equal(wrong.error?.code,"42501");
    const acceptedA=await call("a_admin","d5o_platform_initial_admin_accept_v1",{
      p_workspace_key:a.workspaceKey,p_invitation_id:a.invitationId});
    const acceptedB=await call("b_admin","d5o_platform_initial_admin_accept_v1",{
      p_workspace_key:b.workspaceKey,p_invitation_id:b.invitationId});
    assert(!acceptedA.error,acceptedA.error?.message);assert(!acceptedB.error,acceptedB.error?.message);
    const replay=await call("a_admin","d5o_platform_initial_admin_accept_v1",{
      p_workspace_key:a.workspaceKey,p_invitation_id:a.invitationId});
    assert.equal(replay.data.replay,true);
    return {A:acceptedA.data.status,B:acceptedB.data.status,replaySafe:true};
  });
  await check("incomplete tenants cannot create Work or activate", async () => {
    const work=await call("a_admin","d5o_hosted_create_work_v1",{
      p_workspace_key:a.workspaceKey,p_command_id:"phase2c-premature-work",
      p_configuration_version_id:a.configurationVersionId,p_work_type_key:"lifecycle-service",p_title:"Premature"});
    const activation=await call("vendor","d5o_platform_activate_v1",{
      p_workspace_key:a.workspaceKey,p_expected_revision:2,p_command_id:"phase2c-premature-activation",
      p_reason:"Attempt activation before customer setup"});
    const unauthorized=await call("a_admin","d5o_platform_activate_v1",{
      p_workspace_key:a.workspaceKey,p_expected_revision:2,p_command_id:"phase2c-unauthorized-activation",
      p_reason:"Attempt activation without vendor authority"});
    assert(work.error);assert.equal(activation.error?.code,"23514");
    assert.equal(unauthorized.error?.code,"42501");
    return {workDenied:work.error.code,activationDenied:activation.error.code,
      customerActivationDenied:true};
  });
  const config=(who,workspace,action,version,active,revision,input,suffix)=>call(who,
    "d5o_hosted_configuration_admin_command_v1",{p_workspace_key:workspace,p_action:action,
      p_version:version,p_expected_active:active,p_expected_revision:revision,p_input:input,
      p_reason:`Phase 2B customer ${action}`,p_command_id:`phase2c-${who}-${action}-${suffix}`});
  for(const [who,tenant,threshold] of [["a_admin",a,1000000],["b_admin",b,2500000]]) {
    await check(`${tenant.workspaceKey} publishes its own USD ${threshold/100} threshold`, async () => {
      const draft=await config(who,tenant.workspaceKey,"create-draft",tenant.configurationVersionId,
        tenant.configurationVersionId,1,{},"draft");assert(!draft.error,draft.error?.message);
      const id=draft.data.versionId;
      const saved=await config(who,tenant.workspaceKey,"save-policy",id,tenant.configurationVersionId,1,
        {key:"service-approval",thresholdMinor:threshold,currency:"USD",comparison:"greater_than",
          authorityRole:"admin",unavailableBehavior:"block"},"save");assert(!saved.error,saved.error?.message);
      const published=await config(who,tenant.workspaceKey,"validate-publish",id,tenant.configurationVersionId,2,{},"publish");
      assert(!published.error,published.error?.message);
      const activated=await config(who,tenant.workspaceKey,"activate",id,tenant.configurationVersionId,3,{},"activate");
      assert(!activated.error,activated.error?.message);versions[who]=id;
      return {thresholdMinor:threshold,versionId:id};
    });
  }
  for(const [who,tenant] of [["a_admin",a],["b_admin",b]]) {
    await check(`${tenant.workspaceKey} confirms readiness and vendor activates`,async()=>{
      const read=await call(who,"d5o_hosted_onboarding_read_v1",{p_workspace_key:tenant.workspaceKey});
      assert(!read.error,read.error?.message);assert.equal(read.data.ready,true);
      const ready=await call(who,"d5o_hosted_onboarding_ready_v1",{
        p_workspace_key:tenant.workspaceKey,p_expected_revision:read.data.revision,
        p_command_id:`phase2c-ready-${who}`,p_reason:"Confirm required customer setup is complete"});
      assert(!ready.error,ready.error?.message);
      const active=await call("vendor","d5o_platform_activate_v1",{
        p_workspace_key:tenant.workspaceKey,p_expected_revision:ready.data.revision,
        p_command_id:`phase2c-activate-${who}`,p_reason:"Activate qualified fictional customer tenant"});
      assert(!active.error,active.error?.message);
      const replay=await call("vendor","d5o_platform_activate_v1",{
        p_workspace_key:tenant.workspaceKey,p_expected_revision:ready.data.revision,
        p_command_id:`phase2c-activate-${who}`,p_reason:"Activate qualified fictional customer tenant"});
      assert.deepEqual(replay.data,active.data);
      const stale=await call("vendor","d5o_platform_activate_v1",{
        p_workspace_key:tenant.workspaceKey,p_expected_revision:ready.data.revision,
        p_command_id:`phase2c-activate-stale-${who}`,p_reason:"Reject stale duplicate tenant activation"});
      assert.equal(stale.error?.code,"23514");
      return {ready:ready.data.lifecycle,activated:active.data.lifecycle,replaySafe:true,staleDenied:true};
    });
  }
  await check("vendor grants and flags connected Work independently",async()=>{
    const grant=await call("vendor","d5o_platform_capability_command_v1",{
      p_workspace_key:a.workspaceKey,p_kind:"entitlement",p_enabled:true,p_expected_revision:0,
      p_command_id:"phase2c-a-entitlement",p_reason:"Grant qualified connected Work capability"});
    const flag=await call("vendor","d5o_platform_capability_command_v1",{
      p_workspace_key:a.workspaceKey,p_kind:"flag",p_enabled:true,p_expected_revision:0,
      p_command_id:"phase2c-a-flag",p_reason:"Enable qualified connected Work rollout"});
    const bFlag=await call("vendor","d5o_platform_capability_command_v1",{
      p_workspace_key:b.workspaceKey,p_kind:"flag",p_enabled:true,p_expected_revision:0,
      p_command_id:"phase2c-b-flag",p_reason:"Enable rollout without a tenant entitlement"});
    assert(!grant.error,grant.error?.message);assert(!flag.error,flag.error?.message);
    assert(!bFlag.error,bFlag.error?.message);
    assert.equal(flag.data.available,true);assert.equal(bFlag.data.available,false);
    const replay=await call("vendor","d5o_platform_capability_command_v1",{
      p_workspace_key:a.workspaceKey,p_kind:"flag",p_enabled:true,p_expected_revision:0,
      p_command_id:"phase2c-a-flag",p_reason:"Enable qualified connected Work rollout"});
    assert.deepEqual(replay.data,flag.data);
    const forbidden=await call("a_admin","d5o_platform_capability_command_v1",{
      p_workspace_key:b.workspaceKey,p_kind:"entitlement",p_enabled:true,p_expected_revision:0,
      p_command_id:"phase2c-forged-grant",p_reason:"Attempt an unauthorized entitlement grant"});
    assert.equal(forbidden.error?.code,"42501");
    const crossRead=await call("a_admin","d5o_hosted_capability_read_v1",{
      p_workspace_key:b.workspaceKey});
    assert.equal(crossRead.error?.code,"42501");
    return {A:flag.data.available,B:bFlag.data.available,replaySafe:true,
      customerDenied:true,crossTenantReadDenied:true};
  });
  await check("Discover policy publication controls connected Work creation",async()=>{
    const draft=await config("a_admin",a.workspaceKey,"create-draft",versions.a_admin,
      versions.a_admin,4,{},"discover-draft");
    assert(!draft.error,draft.error?.message);const id=draft.data.versionId;
    const saved=await config("a_admin",a.workspaceKey,"save-policy",id,versions.a_admin,1,
      {key:"discover-intake",requireInitialDiscovery:true},"discover-save");
    assert(!saved.error,saved.error?.message);
    const invalid=await config("a_admin",a.workspaceKey,"save-policy",id,versions.a_admin,2,
      {key:"discover-intake",requireInitialDiscovery:"yes"},"discover-invalid");
    assert.equal(invalid.error?.code,"22023");
    const published=await config("a_admin",a.workspaceKey,"validate-publish",id,
      versions.a_admin,2,{},"discover-publish");assert(!published.error,published.error?.message);
    const active=await config("a_admin",a.workspaceKey,"activate",id,
      versions.a_admin,3,{},"discover-activate");assert(!active.error,active.error?.message);
    const historical=sql(`select manifest_json#>>'{discoverIntake,requireInitialDiscovery}'
      from d5o_hosted.configuration_versions where id=${q(versions.a_admin)};`);
    assert.equal(historical,"");
    versions.a_admin=id;
    return {activeVersion:id,required:true,invalidPolicyDenied:true,historicalUnchanged:true};
  });
  const connected=(who,tenant,version,id,discovery=null)=>admin.rpc("d5o_hosted_create_connected_work_v1",{
    p_workspace_key:tenant.workspaceKey,p_command_id:id,p_expected_work_revision:0,
    p_expected_catalog_revision:0,p_configuration_version_id:version,
    p_work_type_key:"lifecycle-service",p_title:"Connected Work qualification",
    p_customer:"Fictional Customer",p_site:"Test location",p_owner:"Test owner",
    p_actor_user_id:users[who].id,
    p_membership_id:sql(`select id from d5o_hosted.memberships where workspace_id=${q(tenant.workspaceId)} and actor_user_id=${q(users[who].id)};`),
    p_initial_discovery:discovery});
  await check("direct RPC enforces entitlement and Discover policy",async()=>{
    const missing=await connected("a_admin",a,versions.a_admin,"phase2c-connected-missing");
    assert.equal(missing.error?.code,"23514");
    const denied=await connected("b_admin",b,versions.b_admin,"phase2c-connected-unentitled",{
      source:"Test",need:"Need service",procurement:"Direct",closeDate:""});
    assert.equal(denied.error?.code,"42501");
    const coreBypass=await admin.rpc("d5o_hosted_create_connected_work_core_v1",{
      p_workspace_key:a.workspaceKey,p_command_id:"phase2c-core-bypass",
      p_expected_work_revision:0,p_expected_catalog_revision:0,
      p_configuration_version_id:versions.a_admin,p_work_type_key:"lifecycle-service",
      p_title:"Bypass attempt",p_customer:"Fictional Customer",p_site:"Test location",
      p_owner:"Test owner",p_actor_user_id:users.a_admin.id,
      p_membership_id:sql(`select id from d5o_hosted.memberships where workspace_id=${q(a.workspaceId)} and actor_user_id=${q(users.a_admin.id)};`),
      p_initial_discovery:null});
    assert(coreBypass.error);
    const created=await connected("a_admin",a,versions.a_admin,"phase2c-connected-valid",{
      source:"Test",need:"Need service",procurement:"Direct",closeDate:""});
    assert(!created.error,created.error?.message);
    const replay=await connected("a_admin",a,versions.a_admin,"phase2c-connected-valid",{
      source:"Test",need:"Need service",procurement:"Direct",closeDate:""});
    assert(!replay.error,replay.error?.message);assert.deepEqual(replay.data,created.data);
    return {A:created.data.workId,B:denied.error.message,missingIntakeDenied:true,
      coreBypassDenied:true,replaySafe:true};
  });
  await check("both tenants onboard independent commercial and operations authorities",async()=>{
    const members=[];
    for(const [who,tenant,role] of [
      ["a_finance",a,"billing_commercial_lead"],
      ["a_ops",a,"operations_leader"],
      ["b_finance",b,"billing_commercial_lead"],
      ["b_ops",b,"operations_leader"]]) {
      const adminKey=tenant.workspaceKey===a.workspaceKey?"a_admin":"b_admin";
      const commandId=`phase2e-invite-${who}`;
      const invited=await call(adminKey,"d5o_hosted_org_invitation_request_v1",{
        p_workspace_key:tenant.workspaceKey,p_email:users[who].email,p_role:role,
        p_reason:"Independent fictional connected Work authority",
        p_command_id:commandId,
        p_expires_at:new Date(Date.now()+14*86400000).toISOString()});
      assert(!invited.error,`${who}:${invited.error?.message}`);
      const accepted=await call(who,"d5o_hosted_org_invitation_accept_v1",{
        p_workspace_key:tenant.workspaceKey,p_command_id:commandId});
      assert(!accepted.error,`${who}:${accepted.error?.message}`);
      members.push({tenant:tenant.workspaceKey,role,userId:users[who].id});
    }
    return members;
  });
  await check("two tenant administrators publish distinct six-phase requirement sets",async()=>{
    const grant=await call("vendor","d5o_platform_capability_command_v1",{
      p_workspace_key:b.workspaceKey,p_kind:"entitlement",p_enabled:true,p_expected_revision:0,
      p_command_id:"phase2d-b-entitlement",p_reason:"Qualify independent customer connected Work policy"});
    assert(!grant.error,grant.error?.message);
    const outcomes=[];
    for(const [who,tenant,strict] of [["a_admin",a,true],["b_admin",b,false]]) {
      const activeRow=sql(`select v.id||'|'||v.edit_revision from d5o_hosted.configuration_versions v
        join d5o_hosted.configuration_tenants t on t.id=v.tenant_id
        where t.workspace_id=${q(tenant.workspaceId)} and v.status='published'
          and v.effective_from<=now() and (v.effective_to is null or v.effective_to>now());`);
      const [active,revision]=activeRow.split("|");
      const created=await config(who,tenant.workspaceKey,"create-draft",active,active,
        Number(revision),{},`phase2d-${who}-draft`);
      assert(!created.error,created.error?.message);
      const draft=created.data.versionId;let edit=1;
      for(const [key,required] of [["define-risk-narrative",strict],
        ["develop-option-evidence",strict]]) {
        if(!strict && key==="develop-option-evidence") continue;
        const expected=edit++;
        const saved=await config(who,tenant.workspaceKey,"save-policy",draft,active,expected,
          {key,required},`phase2d-${who}-${key}`);
        assert(!saved.error,saved.error?.message);
        if(strict && key==="define-risk-narrative") {
          const replay=await config(who,tenant.workspaceKey,"save-policy",draft,active,expected,
            {key,required},`phase2d-${who}-${key}`);
          assert(!replay.error,replay.error?.message);
          assert.deepEqual(replay.data,saved.data);
        }
      }
      for(const [key,group,field] of [
        ["design-require-mop","designControls","requireMop"],
        ["deploy-require-reviewed-evidence","deployControls","requireReviewedEvidence"],
        ["operate-require-documentation-review","operateControls","requireDocumentationReview"]]) {
        const current=JSON.parse(sql(`select manifest_json::text
          from d5o_hosted.configuration_versions where id=${q(draft)};`))
          .d5oPresentation.phaseContract.workTypes.find(
            (item)=>item.workTypeKey==="lifecycle-service");
        if(current[group]?.[field]===strict) continue;
        const saved=await config(who,tenant.workspaceKey,"save-policy",draft,active,edit++,
          {key,workTypeKey:"lifecycle-service",value:String(strict)},
          `phase2d-${who}-${key}`);
        assert(!saved.error,`${key}: ${saved.error?.message}`);
      }
      const routed=await config(who,tenant.workspaceKey,"save-route",draft,active,edit++,
        {key:"discoverDefine",role:"operations_leader"},
        `phase2e-${who}-discover-define-route`);
      assert(!routed.error,routed.error?.message);
      const designRoute=await config(who,tenant.workspaceKey,"save-route",draft,active,edit++,
        {key:"designDeploy",role:"operations_leader"},
        `phase2e-${who}-design-deploy-route`);
      assert(!designRoute.error,designRoute.error?.message);
      if(strict) {
        const invalid=await config(who,tenant.workspaceKey,"save-policy",draft,active,edit,
          {key:"define-risk-narrative",required:"yes"},`phase2d-${who}-invalid`);
        assert.equal(invalid.error?.code,"22023");
      }
      const forbidden=await config("outsider",tenant.workspaceKey,"validate-publish",
        draft,active,edit,{},`phase2d-${who}-forbidden`);
      assert.equal(forbidden.error?.code,"42501");
      const published=await config(who,tenant.workspaceKey,"validate-publish",draft,active,
        edit,{},`phase2d-${who}-publish`);
      assert(!published.error,published.error?.message);
      const activated=await config(who,tenant.workspaceKey,"activate",draft,active,
        edit+1,{},`phase2d-${who}-activate`);
      assert(!activated.error,activated.error?.message);
      versions[who]=draft;
      const manifest=JSON.parse(sql(`select manifest_json::text from d5o_hosted.configuration_versions
        where id=${q(draft)};`));
      assert.equal(manifest.phase2dRequirements.defineRiskNarrative,strict,
        JSON.stringify(manifest.phase2dRequirements));
      assert.equal(manifest.phase2dRequirements.developOptionEvidence,strict,
        JSON.stringify(manifest.phase2dRequirements));
      const type=manifest.d5oPresentation.phaseContract.workTypes.find(
        (item)=>item.workTypeKey==="lifecycle-service");
      assert.equal(type.designControls.requireMop,strict,JSON.stringify(type.designControls));
      assert.equal(type.deployControls.requireReviewedEvidence,strict,JSON.stringify(type.deployControls));
      assert.equal(type.operateControls.requireDocumentationReview,strict,JSON.stringify(type.operateControls));
      outcomes.push({tenant:tenant.workspaceKey,versionId:draft,strict,
        define:manifest.phase2dRequirements.defineRiskNarrative,
        develop:manifest.phase2dRequirements.developOptionEvidence,
        design:type.designControls.requireMop,deploy:type.deployControls.requireReviewedEvidence,
        operate:type.operateControls.requireDocumentationReview});
    }
    const cross=await config("a_admin",b.workspaceKey,"create-draft",versions.b_admin,
      versions.b_admin,4,{}, "phase2d-cross-tenant");
    assert.equal(cross.error?.code,"42501");
    return outcomes;
  });
  await check("pinned Define command rejects missing risk only for strict tenant",async()=>{
    const created=[];
    for(const [who,tenant] of [["a_admin",a],["b_admin",b]]) {
      const workRevision=Number(sql(`select coalesce((select revision from d5o_hosted.prototype_states
        where workspace_id=${q(tenant.workspaceId)} and state_key='work'),0);`));
      const catalogRevision=Number(sql(`select coalesce((select revision from d5o_hosted.prototype_states
        where workspace_id=${q(tenant.workspaceId)} and state_key='catalog'),0);`));
      const work=await admin.rpc("d5o_hosted_create_connected_work_v1",{
        p_workspace_key:tenant.workspaceKey,p_command_id:`phase2d-connected-${who}`,
        p_expected_work_revision:workRevision,p_expected_catalog_revision:catalogRevision,
        p_configuration_version_id:versions[who],p_work_type_key:"lifecycle-service",
        p_title:"Phase 2D policy qualification",p_customer:"Fictional Customer",
        p_site:"Test location",p_owner:"Test owner",p_actor_user_id:users[who].id,
        p_membership_id:sql(`select id from d5o_hosted.memberships
          where workspace_id=${q(tenant.workspaceId)}
            and actor_user_id=${q(users[who].id)};`),
        p_initial_discovery:{source:"Test",need:"Need service",
          procurement:"Direct",closeDate:""}});
      assert(!work.error,work.error?.message);
      const presentationId=sql(`select presentation_id from d5o_hosted.work_identity_links
        where workspace_id=${q(tenant.workspaceId)} and work_id=${q(work.data.workId)};`);
      const sourceRevision=Number(sql(`select revision from d5o_hosted.prototype_states
        where workspace_id=${q(tenant.workspaceId)} and state_key='work';`));
      const args={p_workspace_key:tenant.workspaceKey,p_presentation_id:presentationId,
        p_action:"submit",p_review_role:null,p_reason:"Submit current definition",
        p_command_id:`phase2d-define-${who}`,p_expected_source_revision:sourceRevision,
        p_expected_decision_revision:0};
      const decision=await call(who,"d5o_hosted_define_command_v1",args);
      assert(decision.error);
      assert.equal(decision.error.message.includes("define_risk_narrative_required"),who==="a_admin");
      const cross=await call(who==="a_admin"?"b_admin":"a_admin",
        "d5o_hosted_define_command_v1",{...args,p_command_id:`phase2d-cross-define-${who}`});
      assert.equal(cross.error?.code,"42501");
      const bypass=await call(who,"d5o_hosted_define_command_pre_phase2d_v1",args);
      assert(bypass.error);
      created.push({tenant:tenant.workspaceKey,workId:work.data.workId,
        policyVersionId:versions[who],decision:decision.error.message,
        crossTenantDenied:true,coreBypassDenied:true});
    }
    return created;
  });
  await check("connected source contract is available for authorized fixture progression",async()=>{
    const observations=[];
    for(const [who,tenant] of [["a_admin",a],["b_admin",b]]) {
      const current=await call(who,"d5o_hosted_prototype_read_v1",{
        p_workspace_key:tenant.workspaceKey,p_state_key:"work"});
      assert(!current.error,current.error?.message);
      const record=current.data.state.records.find((item)=>item.title==="Phase 2D policy qualification");
      assert(record);
      observations.push({tenant:tenant.workspaceKey,revision:current.data.revision,
        recordId:record.id,workId:record.canonicalWorkId,
        discoveryKeys:Object.keys(record.discovery??{}),
        pursuit:record.discovery?.pursuitControl??null,
        definitionKeys:Object.keys(record.definition??{}),
        developKeys:Object.keys(record.develop??{}),
        packageCount:record.packages?.length??0});
    }
    return observations;
  });
  await check("both tenants complete Discover intake and independent Define handoff",async()=>{
    const outcomes=[];
    for(const [prefix,tenant] of [["a",a],["b",b]]) {
      const owner=`${prefix}_admin`,finance=`${prefix}_finance`,receiver=`${prefix}_ops`;
      const initial=await call(owner,"d5o_hosted_prototype_read_v1",{
        p_workspace_key:tenant.workspaceKey,p_state_key:"work"});
      assert(!initial.error,initial.error?.message);
      const record=initial.data.state.records.find((item)=>item.title==="Phase 2D policy qualification");
      assert(record);
      let decision=0;
      const invoke=async(actor,action,intent)=>{
        const result=await call(actor,"d5o_hosted_pursuit_command_v1",{
          p_workspace_key:tenant.workspaceKey,p_presentation_id:record.id,
          p_action:action,p_intent:intent,p_command_id:`phase2e-${prefix}-${action}`,
          p_expected_source_revision:initial.data.revision,
          p_expected_decision_revision:decision});
        assert(!result.error,`${prefix}:${action}:${result.error?.message}`);
        decision++;
        return result.data;
      };
      await invoke(owner,"save-intake",{
        requester:"Fictional customer representative",
        intendedOutcome:"Restore inspected service capability",
        roughValue:"15000",currency:"USD",requiredDate:"2026-12-01",
        knownRisk:"Service outage during inspection",
        customer:record.customer,site:record.site,owner:record.owner,
        need:record.discovery.need});
      await invoke(owner,"submit",{});
      await invoke(finance,"decide",{outcome:"qualified",
        reason:"Qualified fictional service request for controlled delivery"});
      await invoke(owner,"submit-handoff",{
        brief:"Fictional customer service need with a scoped and inspected handoff to Define"});
      await invoke(receiver,"respond-handoff",{outcome:"accepted",
        reason:"Accepted scoped fictional handoff for Define review"});
      const after=await call(owner,"d5o_hosted_prototype_read_v1",{
        p_workspace_key:tenant.workspaceKey,p_state_key:"work"});
      assert(!after.error,after.error?.message);
      const updated=after.data.state.records.find((item)=>item.id===record.id);
      assert.equal(updated.discovery?.pursuitControl?.handoff?.status,"accepted");
      outcomes.push({tenant:tenant.workspaceKey,workId:record.canonicalWorkId,
        sourceRevision:after.data.revision,decisionRevision:decision,
        handoff:updated.discovery.pursuitControl.handoff.status});
    }
    return outcomes;
  });
  await check("both tenants submit an authorized and complete Define draft",async()=>{
    const outcomes=[];
    for(const [prefix,tenant,strict] of [["a",a,true],["b",b,false]]) {
      const owner=`${prefix}_admin`;
      const current=await call(owner,"d5o_hosted_prototype_read_v1",{
        p_workspace_key:tenant.workspaceKey,p_state_key:"work"});
      assert(!current.error,current.error?.message);
      const state=structuredClone(current.data.state);
      const index=state.records.findIndex((item)=>item.title==="Phase 2D policy qualification");
      assert(index>=0);
      const record=state.records[index];
      record.definition={revision:1,status:"Draft",outcome:"Inspected service restored",
        acceptance:"Customer verifies operation after service",
        includedScope:"Inspect and repair service component",
        excludedScope:"Unrelated systems",deliveryApproach:"Controlled visit and test",
        milestones:"Inspect then test",dependencies:"Approved site access",
        estimateBasis:"Synthetic USD 15000 scope",commercialTerms:"Subject to authorization",
        risks:strict?"Service outage during controlled inspection":"",owner:record.owner,
        history:[],project:{customerContact:"Fictional representative",
          siteArea:record.site,affectedSystems:"Service component",
          accessConstraints:"Escorted access",requiredDate:"2026-12-01"},
        findings:[{id:"finding-1",kind:"Customer input",status:"Confirmed",
          detail:"Service component needs inspection",source:"Synthetic customer briefing",
          author:"Fictional representative",at:new Date().toISOString()}],
        clarifications:[],scopeControl:{
          requirements:[{id:"requirement-1",need:"Restore service component",
            source:"Synthetic customer scope",owner:"Project manager",state:"Confirmed"}],
          interfaces:[{id:"interface-1",kind:"Technical",boundary:"Service component",
            owner:"Project manager",counterparty:"Customer",agreement:"Escorted inspection"}],
          assumptions:[],customerAgreement:{representative:"Fictional representative",
            agreedAt:"2026-10-23",basis:"Synthetic accepted scope"}},
        registers:{scope_items:[{id:"scope-1",requirementId:"requirement-1",
          deliverable:"Inspected component",boundary:"Service component",owner:"Project manager"}],
          acceptance_criteria:[{id:"accept-1",scopeId:"scope-1",
            result:"Operational",method:"Functional test",proof:"Synthetic test record",
            authority:"Customer representative"}]}};
      const saved=await call(owner,"d5o_hosted_prototype_save_v1",{
        p_workspace_key:tenant.workspaceKey,p_state_key:"work",
        p_expected_revision:current.data.revision,p_state:state});
      assert(!saved.error,`${prefix}:save:${saved.error?.message}`);
      const result=await call(owner,"d5o_hosted_define_command_v1",{
        p_workspace_key:tenant.workspaceKey,p_presentation_id:record.id,
        p_action:"submit",p_review_role:null,p_reason:"Submit complete Define baseline",
        p_command_id:`phase2e-${prefix}-define-submit`,
        p_expected_source_revision:saved.data.revision,p_expected_decision_revision:0});
      assert(!result.error,`${prefix}:submit:${result.error?.message}`);
      outcomes.push({tenant:tenant.workspaceKey,workId:record.canonicalWorkId,
        versionId:record.phaseConfigurationVersionId,
        sourceRevision:saved.data.revision,result:result.data?.decision?.action??"submit"});
    }
    return outcomes;
  });
  await check("independent Define reviews approve and hand off each pinned baseline",async()=>{
    const outcomes=[];
    for(const [prefix,tenant] of [["a",a],["b",b]]) {
      const owner=`${prefix}_admin`,finance=`${prefix}_finance`,ops=`${prefix}_ops`;
      const current=await call(owner,"d5o_hosted_prototype_read_v1",{
        p_workspace_key:tenant.workspaceKey,p_state_key:"work"});
      assert(!current.error,current.error?.message);
      const record=current.data.state.records.find((item)=>item.title==="Phase 2D policy qualification");
      assert(record);
      let decision=1;
      const invoke=async(actor,action,role)=>{
        const response=await call(actor,"d5o_hosted_define_command_v1",{
          p_workspace_key:tenant.workspaceKey,p_presentation_id:record.id,
          p_action:action,p_review_role:role,p_reason:"Independent review of complete fictional scope",
          p_command_id:`phase2e-${prefix}-define-${action}-${role??"handoff"}`,
          p_expected_source_revision:current.data.revision,
          p_expected_decision_revision:decision});
        assert(!response.error,`${prefix}:${action}:${role}:${response.error?.message}`);
        decision++;
      };
      await invoke(finance,"approve-review","commercial");
      await invoke(ops,"approve-review","delivery");
      await invoke(owner,"submit-handoff",null);
      await invoke(ops,"accept-handoff",null);
      const after=await call(owner,"d5o_hosted_prototype_read_v1",{
        p_workspace_key:tenant.workspaceKey,p_state_key:"work"});
      assert(!after.error,after.error?.message);
      const updated=after.data.state.records.find((item)=>item.id===record.id);
      assert.equal(updated.definition.status,"Approved");
      assert.equal(updated.definition.developHandoff.status,"accepted");
      outcomes.push({tenant:tenant.workspaceKey,workId:record.canonicalWorkId,
        versionId:record.phaseConfigurationVersionId,
        definitionStatus:updated.definition.status,
        handoffStatus:updated.definition.developHandoff.status,
        decisionRevision:decision});
    }
    return outcomes;
  });
  await check("tenant administrators publish a bounded pricing prerequisite for solution decisions",async()=>{
    const policies=[];
    for(const [prefix,tenant] of [["a",a],["b",b]]) {
      const who=`${prefix}_admin`;
      const current=await call(who,"d5o_hosted_prototype_read_v1",{
        p_workspace_key:tenant.workspaceKey,p_state_key:"work"});
      assert(!current.error,current.error?.message);
      const base={p_workspace_key:tenant.workspaceKey,p_policy_id:"phase2e-price",
        p_policy_version:1,p_expected_work_revision:current.data.revision};
      const payload={id:"phase2e-price",version:1,workspace:tenant.workspaceKey,
        status:"draft",name:"Fictional service estimate basis",currency:"USD",
        effectiveFrom:"2026-10-01",method:"target-margin",
        solutionApproverRole:"operations_leader",
        pricingApproverRole:"operations_leader",
        proposalApproverRole:"operations_leader",
        targetMarginPercent:30,floorMarginPercent:15,maxDiscountPercent:10,
        overheadPercent:0,contingencyPercent:0,
        rates:[{id:"service-hour",unit:"hour",source:"Synthetic rate catalog",
          category:"labor",amount:"100.00",effectiveFrom:"2026-10-01",
          scope:{kind:"default"}}]};
      for(const [action,policy] of [["save-draft",payload],["publish",null],["activate",null]]) {
        const result=await call(who,"d5o_hosted_pricing_policy_command_v1",{
          ...base,p_action:action,p_policy:policy,
          p_command_id:`phase2e-${prefix}-pricing-${action}`});
        assert(!result.error,`${prefix}:pricing:${action}:${result.error?.message}`);
      }
      policies.push({tenant:tenant.workspaceKey,policyId:"phase2e-price",version:1});
    }
    return policies;
  });
  await check("Develop policy rejects missing option evidence and accepts a documented selected solution",async()=>{
    const outcomes=[];
    for(const [prefix,tenant,strict] of [["a",a,true],["b",b,false]]) {
      const owner=`${prefix}_admin`,ops=`${prefix}_ops`;
      let current=await call(owner,"d5o_hosted_prototype_read_v1",{
        p_workspace_key:tenant.workspaceKey,p_state_key:"work"});
      assert(!current.error,current.error?.message);
      let state=structuredClone(current.data.state);
      const index=state.records.findIndex((item)=>item.title==="Phase 2D policy qualification");
      assert(index>=0);
      const record=state.records[index];
      const option={id:"service-option",revision:1,name:"Controlled repair",
        approach:"Inspect then repair",requirementIds:["requirement-1"],
        unmetRequirements:"",deliveryModel:"Self-perform",materials:"Existing stock",
        resourceBasis:"Qualified crew",scheduleBasis:"Confirmed window",
        safetyQuality:"Permit and inspection",risks:"Managed outage",
        evidence:"",owner:"Project manager",status:"Viable"};
      record.develop={revision:1,options:[option],selectedOptionId:option.id,
        selectionRationale:"Bounded repair addresses accepted scope",
        laborStrategy:"Qualified service team",procurementStrategy:"Existing stock",
        scheduleStrategy:"Confirmed site window",safetyStrategy:"Permit before work",
        qualityStrategy:"Independent inspection",riskMitigation:"Rollback plan",
        targetDate:"2026-12-01",designOwner:"Project manager",history:[]};
      let saved=await call(owner,"d5o_hosted_prototype_save_v1",{
        p_workspace_key:tenant.workspaceKey,p_state_key:"work",
        p_expected_revision:current.data.revision,p_state:state});
      assert(!saved.error,`${prefix}:develop-save:${saved.error?.message}`);
      const submit=(revision,solutionRevision,commandId)=>call(owner,
        "d5o_hosted_solution_command_v1",{
          p_workspace_key:tenant.workspaceKey,p_presentation_id:record.id,
          p_action:"submit-solution",p_due_date:"2026-12-01",
          p_reason:"Submit bounded service solution",p_command_id:commandId,
          p_expected_source_revision:revision,p_expected_decision_revision:0,
          p_solution_revision:solutionRevision});
      let decision=await submit(saved.data.revision,1,`phase2e-${prefix}-solution-submit`);
      if(strict) {
        assert.equal(decision.error?.message,"develop_option_evidence_required");
        current=await call(owner,"d5o_hosted_prototype_read_v1",{
          p_workspace_key:tenant.workspaceKey,p_state_key:"work"});
        assert(!current.error,current.error?.message);
        state=structuredClone(current.data.state);
        const updated=state.records.find((item)=>item.id===record.id);
        updated.develop.revision=2;
        updated.develop.options[0].evidence="Synthetic inspected option assessment";
        saved=await call(owner,"d5o_hosted_prototype_save_v1",{
          p_workspace_key:tenant.workspaceKey,p_state_key:"work",
          p_expected_revision:current.data.revision,p_state:state});
        assert(!saved.error,`${prefix}:develop-correction:${saved.error?.message}`);
        decision=await submit(saved.data.revision,2,
          `phase2e-${prefix}-solution-documented`);
      }
      assert(!decision.error,`${prefix}:develop-submit:${decision.error?.message}`);
      const review=await call(ops,"d5o_hosted_solution_command_v1",{
        p_workspace_key:tenant.workspaceKey,p_presentation_id:record.id,
        p_action:"approve-solution",p_due_date:null,
        p_reason:"Independent review of selected fictional solution",
        p_command_id:`phase2e-${prefix}-solution-approve`,
        p_expected_source_revision:saved.data.revision,
        p_expected_decision_revision:1,
        p_solution_revision:strict?2:1});
      assert(!review.error,`${prefix}:develop-approve:${review.error?.message}`);
      const after=await call(owner,"d5o_hosted_prototype_read_v1",{
        p_workspace_key:tenant.workspaceKey,p_state_key:"work"});
      assert(!after.error,after.error?.message);
      const approved=after.data.state.records.find((item)=>item.id===record.id);
      assert.equal(approved.develop.review.status,"Approved");
      outcomes.push({tenant:tenant.workspaceKey,workId:record.canonicalWorkId,
        versionId:record.phaseConfigurationVersionId,
        missingEvidenceDenied:strict,solutionStatus:approved.develop.review.status,
        sourceRevision:saved.data.revision});
    }
    return outcomes;
  });
  await check("Design handoff rejects an absent offer revision before award",async()=>{
    const outcomes=[];
    for(const [prefix,tenant] of [["a",a],["b",b]]) {
      const current=await call(`${prefix}_admin`,"d5o_hosted_prototype_read_v1",{
        p_workspace_key:tenant.workspaceKey,p_state_key:"work"});
      assert(!current.error,current.error?.message);
      const record=current.data.state.records.find((item)=>item.title==="Phase 2D policy qualification");
      const denied=await call(`${prefix}_admin`,"d5o_hosted_design_handoff_command_v1",{
        p_workspace_key:tenant.workspaceKey,p_presentation_id:record.id,
        p_action:"submit-design-handoff",p_due_date:"2026-12-01",
        p_reason:null,p_command_id:`phase2e-${prefix}-premature-design`,
        p_expected_source_revision:current.data.revision,
        p_expected_decision_revision:0,p_offer_revision:1,p_handoff_revision:1});
      assert.equal(denied.error?.message,"stale_state");
      outcomes.push({tenant:tenant.workspaceKey,workId:record.canonicalWorkId,
        denied:denied.error.message});
    }
    return outcomes;
  });
  await check("both tenants approve a detailed estimate from the selected solution",async()=>{
    const outcomes=[];
    for(const [prefix,tenant] of [["a",a],["b",b]]) {
      const owner=`${prefix}_admin`,ops=`${prefix}_ops`;
      const current=await call(owner,"d5o_hosted_prototype_read_v1",{
        p_workspace_key:tenant.workspaceKey,p_state_key:"work"});
      assert(!current.error,current.error?.message);
      const record=current.data.state.records.find((item)=>item.title==="Phase 2D policy qualification");
      assert(record);
      const input={currency:"USD",workType:record.type,customer:record.customer,
        region:record.site,pricedAt:"2026-10-23",
        lines:[{id:"service-labor",scopeRef:"service-option",category:"labor",
          description:"Controlled service inspection and repair",quantity:"100",
          unit:"hour",rateId:"service-hour",source:"Synthetic rate catalog",
          assumption:"Qualified crew completes inspected repair"}],
        discountPercent:0,riskBasis:"Synthetic bounded repair contingency",
        estimateMaturity:"Budgetary",definitionRevision:record.definition.revision,
        solutionRevision:record.develop.revision};
      const base={p_workspace_key:tenant.workspaceKey,p_presentation_id:record.id,
        p_expected_source_revision:current.data.revision,p_estimate_revision:1};
      for(const [actor,action,decision,body] of [
        [owner,"save-detailed-estimate",0,{p_input:input,p_due_date:null,p_reason:null}],
        [owner,"submit-pricing",1,{p_input:null,p_due_date:"2026-12-01",p_reason:null}],
        [ops,"approve-pricing",2,{p_input:null,p_due_date:null,
          p_reason:"Independent review of fictional priced service scope"}]]) {
        const result=await call(actor,"d5o_hosted_estimate_command_v1",{
          ...base,p_action:action,...body,
          p_command_id:`phase2e-${prefix}-estimate-${action}`,
          p_expected_decision_revision:decision});
        assert(!result.error,`${prefix}:estimate:${action}:${result.error?.message}`);
      }
      const final=await call(owner,"d5o_hosted_prototype_read_v1",{
        p_workspace_key:tenant.workspaceKey,p_state_key:"work"});
      assert(!final.error,final.error?.message);
      const estimate=final.data.state.records.find((item)=>item.id===record.id).discovery.estimate;
      assert.equal(estimate.status,"Approved");
      outcomes.push({tenant:tenant.workspaceKey,workId:record.canonicalWorkId,
        estimateStatus:estimate.status,revision:estimate.revision,
        policyId:estimate.detailed.evaluation.policyId});
    }
    return outcomes;
  });
  await check("two fictional customer awards establish exact Design handoff basis",async()=>{
    const outcomes=[];
    for(const [prefix,tenant] of [["a",a],["b",b]]) {
      const owner=`${prefix}_admin`,ops=`${prefix}_ops`;
      const current=await call(owner,"d5o_hosted_prototype_read_v1",{
        p_workspace_key:tenant.workspaceKey,p_state_key:"work"});
      assert(!current.error,current.error?.message);
      const state=structuredClone(current.data.state);
      const record=state.records.find((item)=>item.title==="Phase 2D policy qualification");
      assert(record);
      const estimate=record.discovery.estimate;
      const offer={revision:1,estimateRevision:estimate.revision,
        scope:"Inspect and repair the controlled service component",
        assumptions:"Customer confirms escorted access",
        exclusions:"Unrelated equipment and systems",
        commercialTerms:"Synthetic qualification only",
        sellPrice:estimate.sellPrice,preparedAt:new Date().toISOString(),
        definitionSource:estimate.definitionSource,
        pricingBasis:{policyId:estimate.detailed.evaluation.policyId,
          policyVersion:estimate.detailed.evaluation.policyVersion,
          solutionRevision:estimate.detailed.input.solutionRevision,
          currency:estimate.detailed.input.currency,
          includedCostMinor:estimate.detailed.evaluation.includedCostMinor,
          priceMinor:estimate.detailed.evaluation.proposedPriceMinor}};
      record.discovery.proposal={...record.discovery.proposal,
        status:"Draft",package:offer,packageHistory:[offer]};
      const saved=await call(owner,"d5o_hosted_prototype_save_v1",{
        p_workspace_key:tenant.workspaceKey,p_state_key:"work",
        p_expected_revision:current.data.revision,p_state:state});
      assert(!saved.error,`${prefix}:offer-draft:${saved.error?.message}`);
      const base={p_workspace_key:tenant.workspaceKey,p_presentation_id:record.id,
        p_expected_source_revision:saved.data.revision,p_offer_revision:1};
      const submit=await call(owner,"d5o_hosted_offer_review_command_v1",{
        ...base,p_action:"submit-proposal",p_due_date:"2026-12-01",p_reason:null,
        p_command_id:`phase2e-${prefix}-offer-submit`,p_expected_decision_revision:0});
      assert(!submit.error,`${prefix}:offer-submit:${submit.error?.message}`);
      const approve=await call(ops,"d5o_hosted_offer_review_command_v1",{
        ...base,p_action:"approve-proposal",p_due_date:null,
        p_reason:"Independent review of exact fictional offer and price",
        p_command_id:`phase2e-${prefix}-offer-approve`,p_expected_decision_revision:1});
      assert(!approve.error,`${prefix}:offer-approve:${approve.error?.message}`);
      const customerBase={...base,p_recipient:null,p_method:null,p_due_date:null,
        p_response_status:null,p_received_at:null,p_details:null,
        p_source_reference:null,p_next_action:null,p_follow_up_due:null};
      const sent=await call(owner,"d5o_hosted_customer_decision_command_v1",{
        ...customerBase,p_action:"record-customer-submission",
        p_recipient:"Fictional customer buyer",p_method:"Customer portal",
        p_due_date:"2026-12-01",p_command_id:`phase2e-${prefix}-customer-submit`,
        p_expected_decision_revision:2});
      assert(!sent.error,`${prefix}:customer-submit:${sent.error?.message}`);
      const awarded=await call(ops,"d5o_hosted_customer_decision_command_v1",{
        ...customerBase,p_action:"record-customer-response",
        p_response_status:"Awarded",p_received_at:"2026-10-23",
        p_details:"Synthetic buyer awards the exact reviewed service offer",
        p_source_reference:`SYNTHETIC-PHASE2E-AWARD-${prefix.toUpperCase()}`,
        p_command_id:`phase2e-${prefix}-customer-award`,
        p_expected_decision_revision:3});
      assert(!awarded.error,`${prefix}:customer-award:${awarded.error?.message}`);
      const final=await call(owner,"d5o_hosted_prototype_read_v1",{
        p_workspace_key:tenant.workspaceKey,p_state_key:"work"});
      assert(!final.error,final.error?.message);
      const updated=final.data.state.records.find((item)=>item.id===record.id);
      assert.equal(updated.discovery.outcome,"Won");
      outcomes.push({tenant:tenant.workspaceKey,workId:record.canonicalWorkId,
        offerStatus:updated.discovery.proposal.status,
        awardSource:updated.discovery.proposal.responseEvents.at(-1).sourceReference});
    }
    return outcomes;
  });
  await check("Design receives exact awarded scope through independent handoff",async()=>{
    const outcomes=[];
    for(const [prefix,tenant] of [["a",a],["b",b]]) {
      const owner=`${prefix}_admin`,ops=`${prefix}_ops`;
      const current=await call(owner,"d5o_hosted_prototype_read_v1",{
        p_workspace_key:tenant.workspaceKey,p_state_key:"work"});
      assert(!current.error,current.error?.message);
      const record=current.data.state.records.find((item)=>item.title==="Phase 2D policy qualification");
      assert(record);
      const base={p_workspace_key:tenant.workspaceKey,p_presentation_id:record.id,
        p_expected_source_revision:current.data.revision,
        p_offer_revision:record.discovery.proposal.package.revision,
        p_handoff_revision:1};
      const submitted=await call(owner,"d5o_hosted_design_handoff_command_v1",{
        ...base,p_action:"submit-design-handoff",p_due_date:"2026-12-01",
        p_reason:null,p_command_id:`phase2e-${prefix}-design-handoff-submit`,
        p_expected_decision_revision:0});
      assert(!submitted.error,`${prefix}:design-handoff-submit:${submitted.error?.message}`);
      const accepted=await call(ops,"d5o_hosted_design_handoff_command_v1",{
        ...base,p_action:"accept-design-handoff",p_due_date:null,
        p_reason:"Received exact fictional award and reviewed scope",
        p_command_id:`phase2e-${prefix}-design-handoff-accept`,
        p_expected_decision_revision:1});
      assert(!accepted.error,`${prefix}:design-handoff-accept:${accepted.error?.message}`);
      const final=await call(owner,"d5o_hosted_prototype_read_v1",{
        p_workspace_key:tenant.workspaceKey,p_state_key:"work"});
      assert(!final.error,final.error?.message);
      const handoff=final.data.state.records.find((item)=>item.id===record.id).discovery.designHandoff;
      assert.equal(handoff.status,"accepted");
      outcomes.push({tenant:tenant.workspaceKey,workId:record.canonicalWorkId,
        status:handoff.status,sourceRevision:current.data.revision});
    }
    return outcomes;
  });
  await check("both tenants create a connected Design package and issue its document",async()=>{
    const outcomes=[];
    for(const [prefix,tenant] of [["a",a],["b",b]]) {
      const owner=`${prefix}_admin`,ops=`${prefix}_ops`;
      const read=async(key)=>{
        const result=await call(owner,"d5o_hosted_prototype_read_v1",{
          p_workspace_key:tenant.workspaceKey,p_state_key:key});
        assert(!result.error,`${prefix}:read-${key}:${result.error?.message}`);
        return result.data;
      };
      let work=await read("work"),catalog=await read("catalog");
      let record=work.state.records.find((item)=>item.title==="Phase 2D policy qualification");
      const created=await call(owner,"d5o_hosted_create_connected_package_v2",{
        p_workspace_key:tenant.workspaceKey,p_presentation_id:record.id,
        p_name:"Synthetic service restoration package",p_owner:"Fictional Design Lead",
        p_command_id:`phase2e-${prefix}-create-package`,
        p_expected_work_revision:work.revision,p_expected_catalog_revision:catalog.revision,
        p_expected_handoff_revision:record.discovery.designHandoff.revision,
        p_expected_package_count:catalog.state.packages.filter((item)=>item.workId===record.id).length});
      assert(!created.error,`${prefix}:create-package:${created.error?.message}`);
      const packageId=created.data.created.id;
      work=await read("work");record=work.state.records.find((item)=>item.id===record.id);
      const requirementIds=record.definition.scopeControl.requirements
        .filter((item)=>item.state==="Confirmed").map((item)=>item.id);
      assert(requirementIds.length>0,`${prefix}:confirmed-requirements`);
      const documentId=`phase2e-${prefix}-procedure`;
      const doc=await call(owner,"d5o_hosted_design_draft_command_v1",{
        p_workspace_key:tenant.workspaceKey,p_presentation_id:record.id,
        p_action:"save-document",p_input:{document:{id:documentId,
          type:"Method statement",title:"Fictional service restoration method",
          source:`SYNTHETIC-PHASE2E-DESIGN-${prefix.toUpperCase()}`,
          packageIds:[packageId],requirementIds,dueDate:"2026-12-05"},
          note:"Design document for isolated qualification"},
        p_command_id:`phase2e-${prefix}-design-document`,
        p_expected_source_revision:work.revision,
        p_expected_decision_revision:record.design?.authorityRevision??0});
      assert(!doc.error,`${prefix}:design-document:${doc.error?.message}`);
      work=await read("work");record=work.state.records.find((item)=>item.id===record.id);
      const basis={packageId,scope:"Restore and verify synthetic service work",
        location:"Fictional service site",systems:"Service control system",
        completionBasis:{kind:"Qualitative",criterion:"Service restored and independently verified"},
        requirementIds,predecessorIds:[],documentRefs:[`${documentId}@1`],
        materials:"No physical material needed for documented service restoration",
        materialLines:[],materialStatus:"Unknown",materialRequiredDate:"2026-12-10",
        materialForecastDate:"",materialSource:"",access:"Escorted site access",
        permit:"Customer permit confirmed",safetyControls:"Isolation and hazard review",
        equipment:"Test instrument",method:"",rollback:"Restore previous safe operating state",
        verification:"Independent functional check",proof:"Dated test record",
        acceptingAuthority:"Operations receiver",windowStart:"2026-12-08",
        windowEnd:"2026-12-12",targetReleaseDate:"2026-12-06",
        crewDemandRequired:false,crewExemptionReason:"No crew allocation in synthetic qualification",
        commercialImpact:"",commercialDisposition:"None"};
      const saved=await call(owner,"d5o_hosted_design_draft_command_v1",{
        p_workspace_key:tenant.workspaceKey,p_presentation_id:record.id,
        p_action:"save-package",p_input:{package:basis,note:"Synthetic package draft"},
        p_command_id:`phase2e-${prefix}-design-package`,
        p_expected_source_revision:work.revision,
        p_expected_decision_revision:record.design?.authorityRevision??0});
      assert(!saved.error,`${prefix}:design-package:${saved.error?.message}`);
      if(!server) server=await startNext(url,anon,service);
      const browser=await chromium.launch();
      let evidenceId;
      try {
        const page=await browser.newPage({viewport:{width:1280,height:800}});
        await page.goto(`http://127.0.0.1:${server.port}/auth/sign-in`);
        await page.getByLabel("Email").fill(users[owner].email);
        await page.getByLabel("Password").fill(users[owner].password);
        await page.getByRole("button",{name:"Continue to your work"}).click();
        await page.waitForURL((location)=>!location.pathname.startsWith("/auth/sign-in"),{timeout:30000});
        const upload=await page.evaluate(async(args)=>{
          const form=new FormData();
          form.append("file",new File(["%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF"],
            "phase2e-method.pdf",{type:"application/pdf"}));
          const query=new URLSearchParams({workspace:args.workspace,workId:args.workId,
            documentId:args.documentId,revision:"1"});
          const response=await fetch(`/api/d5o-hosted/design-document-evidence?${query}`,{
            method:"POST",body:form});
          return {status:response.status,body:await response.json()};
        },{workspace:tenant.workspaceKey,workId:record.id,documentId});
        assert.equal(upload.status,200,`${prefix}:design-upload:${JSON.stringify(upload)}`);
        evidenceId=upload.body.evidenceId;
        assert(evidenceId,`${prefix}:design-evidence-id`);
      } finally {await browser.close();}
      for(const [index,action,actor] of [[1,"submit-document",owner],
        [2,"approve-document",ops],[3,"issue-document",owner]]) {
        work=await read("work");record=work.state.records.find((item)=>item.id===record.id);
        const reviewed=await call(actor,"d5o_hosted_design_review_command_v1",{
          p_workspace_key:tenant.workspaceKey,p_presentation_id:record.id,
          p_action:action,p_input:{documentId,documentRevision:1,evidenceId,
            note:"Independently reviewed fictional design document"},
          p_command_id:`phase2e-${prefix}-design-document-${index}`,
          p_expected_source_revision:work.revision,
          p_expected_decision_revision:record.design?.authorityRevision??0});
        assert(!reviewed.error,`${prefix}:${action}:${reviewed.error?.message}`);
      }
      outcomes.push({tenant:tenant.workspaceKey,workId:record.canonicalWorkId,
        packageId,documentId,evidenceId,documentStatus:"Issued for use"});
    }
    return outcomes;
  });
  await check("Design policy denies missing method and accepts reviewed package release",async()=>{
    const outcomes=[];
    for(const [prefix,tenant] of [["a",a],["b",b]]) {
      const owner=`${prefix}_admin`,ops=`${prefix}_ops`,strict=prefix==="a";
      const read=async()=>{
        const result=await call(owner,"d5o_hosted_prototype_read_v1",{
          p_workspace_key:tenant.workspaceKey,p_state_key:"work"});
        assert(!result.error,result.error?.message);
        return {revision:result.data.revision,record:result.data.state.records
          .find((item)=>item.title==="Phase 2D policy qualification")};
      };
      let current=await read();
      let pkg=current.record.design.packages[0];
      const releaseArgs=(basis,commandId)=>({p_workspace_key:tenant.workspaceKey,
        p_presentation_id:basis.record.id,p_action:"release-package",
        p_input:{packageId:pkg.packageId,dueDate:"2026-12-08",
          note:"Release fictional service package after independent review"},
        p_command_id:commandId,p_expected_source_revision:basis.revision,
        p_expected_decision_revision:basis.record.design.authorityRevision});
      const denied=await call(owner,"d5o_hosted_design_release_command_v1",
        releaseArgs(current,`phase2e-${prefix}-missing-method-release`));
      if(strict) assert.equal(denied.error?.message,"package_release_readiness_blocked");
      else {
        assert(!denied.error,`${prefix}:optional-method-release:${denied.error?.message}`);
        current=await read();
        const pending=current.record.design.releases.find((item)=>item.packageId===pkg.packageId);
        const accepted=await call(ops,"d5o_hosted_design_release_command_v1",{
          p_workspace_key:tenant.workspaceKey,p_presentation_id:current.record.id,
          p_action:"respond-receipt",p_input:{releaseId:pending.id,response:"Accepted",
            note:"Independently accepted fictional Design package"},
          p_command_id:`phase2e-${prefix}-accept-optional-package`,
          p_expected_source_revision:current.revision,
          p_expected_decision_revision:current.record.design.authorityRevision});
        assert(!accepted.error,`${prefix}:accept-optional-package:${accepted.error?.message}`);
        outcomes.push({tenant:tenant.workspaceKey,workId:current.record.canonicalWorkId,
          packageId:pkg.packageId,methodRequired:false,missingMethodRelease:"allowed",
          releaseStatus:"Accepted",versionId:current.record.phaseConfigurationVersionId});
        continue;
      }
      if(strict) {
        const updated=await call(owner,"d5o_hosted_design_draft_command_v1",{
          p_workspace_key:tenant.workspaceKey,p_presentation_id:current.record.id,
          p_action:"save-package",p_input:{package:{...pkg,
            method:"Isolate, restore, inspect, test, and return service to customer"},
            note:"Add the required method of procedure"},
          p_command_id:`phase2e-${prefix}-add-method`,
          p_expected_source_revision:current.revision,
          p_expected_decision_revision:current.record.design.authorityRevision});
        assert(!updated.error,`${prefix}:add-method:${updated.error?.message}`);
        current=await read();pkg=current.record.design.packages[0];
      }
      const demand=await call(owner,"d5o_hosted_design_demand_command_v1",{
        p_workspace_key:tenant.workspaceKey,p_presentation_id:current.record.id,
        p_demand:{workId:current.record.id,packageId:pkg.packageId,
          qualification:"Service technician",minimumPeople:1,
          estimatedPersonHours:8,priority:"High",
          prerequisite:"Accepted Design release",crewSchedulable:true,
          requiredSlots:[{date:"2026-12-09",shift:"08:00–16:00"}]},
        p_command_id:`phase2e-${prefix}-dated-demand`,
        p_expected_source_revision:current.revision,
        p_expected_decision_revision:current.record.design.authorityRevision});
      assert(!demand.error,`${prefix}:design-demand:${demand.error?.message}`);
      for(const discipline of ["Engineering","Delivery","Safety","Quality"]) {
        current=await read();
        const requested=await call(owner,"d5o_hosted_design_review_command_v1",{
          p_workspace_key:tenant.workspaceKey,p_presentation_id:current.record.id,
          p_action:"request-review",p_input:{packageId:pkg.packageId,discipline,
            assignee:`${discipline} review queue`,dueDate:"2026-12-06",
            note:`Independent ${discipline} review of fictional package`},
          p_command_id:`phase2e-${prefix}-${discipline}-request`,
          p_expected_source_revision:current.revision,
          p_expected_decision_revision:current.record.design.authorityRevision});
        assert(!requested.error,`${prefix}:${discipline}-request:${requested.error?.message}`);
        current=await read();
        const review=current.record.design.reviews.find((item)=>
          item.packageId===pkg.packageId && item.discipline===discipline);
        const approved=await call(ops,"d5o_hosted_design_review_command_v1",{
          p_workspace_key:tenant.workspaceKey,p_presentation_id:current.record.id,
          p_action:"decide-review",p_input:{reviewId:review.id,decision:"Approved",
            note:`Independently approved ${discipline} package basis`},
          p_command_id:`phase2e-${prefix}-${discipline}-approve`,
          p_expected_source_revision:current.revision,
          p_expected_decision_revision:current.record.design.authorityRevision});
        assert(!approved.error,`${prefix}:${discipline}-approve:${approved.error?.message}`);
      }
      current=await read();
      const released=await call(owner,"d5o_hosted_design_release_command_v1",
        releaseArgs(current,`phase2e-${prefix}-release-package`));
      assert(!released.error,`${prefix}:release-package:${released.error?.message}`);
      current=await read();
      const pending=current.record.design.releases.find((item)=>item.packageId===pkg.packageId);
      assert.equal(pending.status,"Awaiting receipt");
      const accepted=await call(ops,"d5o_hosted_design_release_command_v1",{
        p_workspace_key:tenant.workspaceKey,p_presentation_id:current.record.id,
        p_action:"respond-receipt",p_input:{releaseId:pending.id,response:"Accepted",
          note:"Independently accepted exact fictional Design package"},
        p_command_id:`phase2e-${prefix}-accept-package`,
        p_expected_source_revision:current.revision,
        p_expected_decision_revision:current.record.design.authorityRevision});
      assert(!accepted.error,`${prefix}:accept-package:${accepted.error?.message}`);
      current=await read();
      assert.equal(current.record.design.releases.find((item)=>item.id===pending.id).status,"Accepted");
      outcomes.push({tenant:tenant.workspaceKey,workId:current.record.canonicalWorkId,
        packageId:pkg.packageId,methodRequired:strict,
        prematureRelease:denied.error.message,releaseStatus:"Accepted",
        versionId:current.record.phaseConfigurationVersionId});
    }
    return outcomes;
  });
  await check("connected decisions retain tenant, actor, Work and audit events",async()=>{
    const outcomes=[];
    for(const [prefix,tenant] of [["a",a],["b",b]]) {
      const workId=sql(`select w.id from d5o_hosted.work_records w
        where w.workspace_id=${q(tenant.workspaceId)}
          and w.title='Phase 2D policy qualification' limit 1;`);
      const counts={};
      for(const [phase,table] of [["define","connected_define_events"],
        ["develop","connected_solution_events"],
        ["design","connected_design_events"]]) {
        counts[phase]=Number(sql(`select count(*) from d5o_hosted.${table}
          where workspace_id=${q(tenant.workspaceId)} and work_id=${q(workId)}
            and actor_user_id in (${q(users[`${prefix}_admin`].id)},${q(users[`${prefix}_ops`].id)},${q(users[`${prefix}_finance`].id)});`));
        assert(counts[phase]>0,`${prefix}:${phase}-audit-missing`);
      }
      outcomes.push({tenant:tenant.workspaceKey,workId,actorScopedEvents:counts});
    }
    return outcomes;
  });
  await check("cross-tenant Design mutation is denied by the authoritative command",async()=>{
    const source=await call("a_admin","d5o_hosted_prototype_read_v1",{
      p_workspace_key:a.workspaceKey,p_state_key:"work"});
    assert(!source.error,source.error?.message);
    const work=source.data.state.records.find((item)=>item.title==="Phase 2D policy qualification");
    const denied=await call("b_admin","d5o_hosted_design_draft_command_v1",{
      p_workspace_key:a.workspaceKey,p_presentation_id:work.id,
      p_action:"save-document",p_input:{document:{title:"Forged cross-tenant document",
        type:"Procedure",source:"SYNTHETIC-FORGED-CROSS-TENANT",
        packageIds:[],requirementIds:[]}},
      p_command_id:"phase2e-cross-tenant-design-write",
      p_expected_source_revision:source.data.revision,
      p_expected_decision_revision:work.design.authorityRevision});
    assert.equal(denied.error?.code,"42501");
    return {tenant:a.workspaceKey,foreignActor:users.b_admin.id,
      denied:denied.error.message};
  });
  await check("authenticated tenant administration and connected Work entry render",async()=>{
    if(!server) server=await startNext(url,anon,service);
    const browser=await chromium.launch();
    const dir=resolve(root,"docs/architecture/evidence/phase2e-browser");
    mkdirSync(dir,{recursive:true});
    const files=[];
    try {
      for(const [prefix,tenant] of [["a",a],["b",b]]) {
        const page=await browser.newPage({viewport:{width:1440,height:900}});
        const configurationPath=`/work/admin/configuration?workspace=${tenant.workspaceKey}`;
        await page.goto(`http://127.0.0.1:${server.port}/auth/sign-in?next=${encodeURIComponent(configurationPath)}`);
        await page.getByLabel("Email").fill(users[`${prefix}_admin`].email);
        await page.getByLabel("Password").fill(users[`${prefix}_admin`].password);
        await page.getByRole("button",{name:"Continue to your work"}).click();
        await page.getByRole("heading",{name:"Configuration",exact:true}).waitFor({timeout:30000});
        for(const [path,file] of [
          [configurationPath,
            `${prefix}-configuration.png`],
          [`/work/connected-work?workspace=${tenant.workspaceKey}`,
            `${prefix}-connected-work.png`]]) {
          await page.goto(`http://127.0.0.1:${server.port}${path}`);
          await page.getByRole("heading",{level:1,name:file.includes("configuration")?
            "Configuration":"Start connected Work",exact:true}).waitFor({timeout:30000});
          if(file.includes("connected-work"))
            await page.getByRole("button",{name:"Create connected Work"}).waitFor({timeout:30000});
          else await page.getByRole("heading",{name:"Discover intake"}).waitFor({timeout:30000});
          await page.screenshot({path:resolve(dir,file),fullPage:true});
          files.push(file);
        }
        await page.close();
      }
      return {files,ephemeralPreview:`http://127.0.0.1:${server.port}/work/connected-work`};
    } finally {await browser.close();}
  });
} catch(error) {evidence.setupError=String(error.message).slice(-2500);}
finally {
  if(server) server.handle.kill();
  if(runtime) evidence.cleanup=cleanupP0aRuntime(runtime);
  evidence.finishedAt=new Date().toISOString();
  evidence.summary={passed:evidence.tests.filter((t)=>t.status==="PASS").length,
    failed:evidence.tests.filter((t)=>t.status==="FAIL").length,
    setupError:Boolean(evidence.setupError),cleanupVerified:Boolean(evidence.cleanup?.clean)};
  mkdirSync(resolve(root,"docs/architecture/evidence"),{recursive:true});
  writeFileSync(output,JSON.stringify(evidence,null,2)+"\n");
  console.log(JSON.stringify({...evidence.summary,output:"docs/architecture/evidence/phase2e-connected-journey-results.json"}));
  if(evidence.summary.failed||evidence.summary.setupError||!evidence.summary.cleanupVerified) process.exitCode=1;
}
