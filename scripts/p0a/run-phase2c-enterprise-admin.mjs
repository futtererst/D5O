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
const hostedRehearsal = process.env.D5O_RC18_HOSTED_REHEARSAL === "1";
const rc20TaskProbe = process.env.D5O_RC20_TASK_PROBE === "1";
const releaseTaskProbe = process.env.D5O_RELEASE_TASK_PROBE === "1";
const output = resolve(root, "docs/architecture/evidence/phase2c-two-tenant-results.json");
const evidence = { baseline: "b4a4e5c43c3e3a78dc07191019dd0ba638bf4a63",
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
  // Rehearsal requests must use the existing approved origin in request-origin.ts.
  const port = hostedRehearsal ? 61643 : await freePort();
  const env = { ...process.env, NODE_ENV: hostedRehearsal ? "production" : "development", NEXT_TELEMETRY_DISABLED: "1",
    NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: anon, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: anon,
    SUPABASE_SECRET_KEY: service, SUPABASE_SERVICE_ROLE_KEY: service, D5O_HOSTED_ENABLED: "1",
    D5O_ISOLATED_PILOT: hostedRehearsal ? undefined : "1",
    D5O_ISOLATED_PILOT_URL: hostedRehearsal ? undefined : url,
    D5O_REHEARSAL_TARGET_URL: hostedRehearsal ? url : undefined,
    D5O_ISOLATED_APP_ORIGIN: `http://127.0.0.1:${port}`,
    D5O_COMMAND_RUNTIME: hostedRehearsal ? "rehearsal" : "pilot",
    RYBEXOS_RUNTIME_MODE: hostedRehearsal ? "production" : "test",
    RYBEXOS_AUTH_MODE: "supabase", RYBEXOS_DATA_SOURCE: "database",
    CIRCLE_NODE_TOTAL: hostedRehearsal ? "2" : process.env.CIRCLE_NODE_TOTAL };
  if (hostedRehearsal) {
    const build = spawnSync(process.execPath, [resolve(root,"node_modules/next/dist/bin/next"),
      "build","--webpack"], {cwd:root,env,encoding:"utf8",shell:false,maxBuffer:10*1024*1024});
    if (build.status !== 0) throw Error(`hosted_build_failed:${(build.stderr || build.stdout).slice(-1000)}`);
  }
  const handle = spawn(process.execPath, [resolve(root,"node_modules/next/dist/bin/next"),
    ...(hostedRehearsal ? ["start"] : ["dev","--webpack"]),"-p",String(port),"-H","127.0.0.1"],
    {cwd:root,env,stdio:"ignore",shell:false});
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
  evidence.runtimeMode = hostedRehearsal ? "production_rehearsal" : "test_pilot";
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const users = {};
  for (const key of ["vendor","a_admin","b_admin","outsider",...(releaseTaskProbe ? ["project_manager"] : [])]) {
    const email = `phase2c-${key}-${randomUUID().slice(0,8)}@example.test`;
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
  await check("vendor suspension blocks existing sessions and direct RPC; reactivation restores only prior rights",async()=>{
    const existing=await call("b_admin","d5o_hosted_create_work_v1",{
      p_workspace_key:b.workspaceKey,p_command_id:"phase2c-before-suspension",
      p_configuration_version_id:versions.b_admin,p_work_type_key:"lifecycle-service",
      p_title:"Existing authorized Work"});
    assert(!existing.error,existing.error?.message);
    const before=(await call("vendor","d5o_platform_provisioning_directory_v1")).data
      .find((item)=>item.workspaceKey===b.workspaceKey);
    const suspendArgs={
      p_workspace_key:b.workspaceKey,p_action:"suspend",p_expected_revision:before.revision,
      p_command_id:"phase2c-suspend-b",p_reason:"Suspend fictional tenant to verify command enforcement"};
    const attempts=await Promise.all([
      call("vendor","d5o_platform_lifecycle_command_v1",suspendArgs),
      call("vendor","d5o_platform_lifecycle_command_v1",{
        ...suspendArgs,p_command_id:"phase2c-suspend-b-concurrent"})]);
    const suspend=attempts.find((item)=>!item.error);
    const concurrent=attempts.find((item)=>item.error);
    const winningId=attempts[0]===suspend ? suspendArgs.p_command_id : "phase2c-suspend-b-concurrent";
    assert(suspend);
    assert(!suspend.error,suspend.error?.message);
    assert.equal(concurrent?.error?.code,"23505");
    const replay=await call("vendor","d5o_platform_lifecycle_command_v1",{
      p_workspace_key:b.workspaceKey,p_action:"suspend",p_expected_revision:before.revision,
      p_command_id:winningId,p_reason:"Suspend fictional tenant to verify command enforcement"});
    assert.deepEqual(replay.data,suspend.data);
    const work=await call("b_admin","d5o_hosted_create_work_v1",{
      p_workspace_key:b.workspaceKey,p_command_id:"phase2c-suspended-work",
      p_configuration_version_id:versions.b_admin,p_work_type_key:"lifecycle-service",p_title:"Blocked"});
    assert(work.error);
    const direct=await connected("b_admin",b,versions.b_admin,"phase2c-suspended-connected");
    assert.equal(direct.error?.code,"42501");
    let backgroundDenied=false;
    try { sql(`update d5o_hosted.work_records set title='Background bypass'
      where id=${q(existing.data.workId)};`); }
    catch(error) { backgroundDenied=String(error.message).includes("tenant_not_active"); }
    assert(backgroundDenied,"suspended background Work update was not denied");
    sql(`update d5o_hosted.memberships set status='suspended'
      where workspace_id=${q(b.workspaceId)} and actor_user_id=${q(users.b_admin.id)};`);
    const revokedReactivate=await call("vendor","d5o_platform_lifecycle_command_v1",{
      p_workspace_key:b.workspaceKey,p_action:"reactivate",p_expected_revision:suspend.data.revision,
      p_command_id:"phase2c-revoked-reactivate",p_reason:"Reject reactivation without any active customer administrator"});
    assert.equal(revokedReactivate.error?.code,"23514");
    sql(`update d5o_hosted.memberships set status='active'
      where workspace_id=${q(b.workspaceId)} and actor_user_id=${q(users.b_admin.id)};`);
    const aStill=await call("a_admin","d5o_hosted_capability_read_v1",{p_workspace_key:a.workspaceKey});
    assert(!aStill.error,aStill.error?.message);assert.equal(aStill.data.connectedWork,true);
    const reactivate=await call("vendor","d5o_platform_lifecycle_command_v1",{
      p_workspace_key:b.workspaceKey,p_action:"reactivate",p_expected_revision:suspend.data.revision,
      p_command_id:"phase2c-reactivate-b",p_reason:"Reactivate qualified fictional tenant after isolation test"});
    assert(!reactivate.error,reactivate.error?.message);
    const restored=await call("b_admin","d5o_hosted_create_work_v1",{
      p_workspace_key:b.workspaceKey,p_command_id:"phase2c-restored-work",
      p_configuration_version_id:versions.b_admin,p_work_type_key:"lifecycle-service",p_title:"Restored"});
    assert(!restored.error,restored.error?.message);
    return {suspended:suspend.data.lifecycle,reactivated:reactivate.data.lifecycle,
      existingSessionDenied:true,backgroundDenied:true,concurrentTransitionDenied:true,
      missingAdministratorDenied:true,otherTenantUnaffected:true,
      restoredWork:restored.data.workId};
  });
  await check("same Work and approval commands apply distinct tenant policies",async()=>{
    const decisions=[];
    for(const [who,tenant] of [["a_admin",a],["b_admin",b]]) {
      const created=await call(who,"d5o_hosted_create_work_v1",{
        p_workspace_key:tenant.workspaceKey,p_command_id:`phase2c-work-${who}`,
        p_configuration_version_id:versions[who],p_work_type_key:"lifecycle-service",
        p_title:"Equivalent USD 15,000 service request"});
      assert(!created.error,created.error?.message);
      const decision=await call(who,"d5o_hosted_service_approval_command_v1",{
        p_workspace_key:tenant.workspaceKey,p_work_id:created.data.workId,p_action:"request",
        p_amount_minor:1500000,p_currency:"USD",p_command_id:`phase2c-policy-${who}`});
      assert(!decision.error,decision.error?.message);
      decisions.push({tenant:tenant.workspaceKey,required:decision.data.approvalRequired,
        status:decision.data.status,versionId:versions[who]});
    }
    assert.equal(decisions[0].required,true);assert.equal(decisions[1].required,false);
    return decisions;
  });
  await check("audit and cross-tenant configuration access remain isolated",async()=>{
    const cross=await call("a_admin","d5o_hosted_configuration_admin_read_v1",{p_workspace_key:b.workspaceKey});
    assert.equal(cross.error?.code,"42501");
    const crossWrite=await config("a_admin",b.workspaceKey,"create-draft",versions.b_admin,
      versions.b_admin,1,{},"cross-tenant");
    assert.equal(crossWrite.error?.code,"42501");
    const crossOnboarding=await call("a_admin","d5o_hosted_onboarding_read_v1",{p_workspace_key:b.workspaceKey});
    assert.equal(crossOnboarding.error?.code,"42501");
    const events=Number(sql(`select count(*) from d5o_hosted.platform_events where workspace_id in (${q(a.workspaceId)},${q(b.workspaceId)});`));
    assert(events>=6);return {crossTenantDenied:true,platformEvents:events};
  });
  await check("suspended initial administrator immediately loses protected access",async()=>{
    sql(`update d5o_hosted.memberships set status='suspended'
      where workspace_id=${q(a.workspaceId)} and actor_user_id=${q(users.a_admin.id)};`);
    try {
      const denied=await call("a_admin","d5o_hosted_onboarding_read_v1",{p_workspace_key:a.workspaceKey});
      assert.equal(denied.error?.code,"42501");
      const deniedWork=await call("a_admin","d5o_hosted_create_work_v1",{
        p_workspace_key:a.workspaceKey,p_command_id:"phase2c-suspended-work",
        p_configuration_version_id:versions.a_admin,p_work_type_key:"lifecycle-service",p_title:"Suspended actor"});
      assert(deniedWork.error);
      return {onboardingDenied:true,workDenied:true};
    } finally {
      sql(`update d5o_hosted.memberships set status='active'
        where workspace_id=${q(a.workspaceId)} and actor_user_id=${q(users.a_admin.id)};`);
    }
  });
  await check("authenticated vendor and customer onboarding pages render",async()=>{
    server=await startNext(url,anon,service);
    const browser=await chromium.launch();const files=[];
    const dir=resolve(root,"docs/architecture/evidence/phase2c-admin-ui");mkdirSync(dir,{recursive:true});
    try {
      for(const [who,path,file,heading] of [
        ["vendor","/platform-admin","vendor-directory-1440.png","Customer onboarding"],
        ["vendor",`/platform-admin/tenants/${a.workspaceKey}`,"vendor-tenant-a-1440.png","Rybex Test"],
        ["a_admin",`/work/admin/configuration?workspace=${a.workspaceKey}`,"customer-configuration-1440.png","Configuration"],
        ["a_admin",`/work/onboarding?workspace=${a.workspaceKey}`,"customer-onboarding-1440.png","Set up Rybex Test"]]) {
        const page=await browser.newPage({viewport:{width:1440,height:900}});
        await page.goto(`http://127.0.0.1:${server.port}/auth/sign-in?next=${encodeURIComponent(path)}`);
        await page.getByLabel("Email").fill(users[who].email);
        await page.getByLabel("Password").fill(users[who].password);
        await page.getByRole("button",{name:"Continue to your work"}).click();
        await page.getByRole("heading",{name:heading,exact:true}).waitFor({timeout:30000});
        if (heading==="Configuration") await page.getByRole("heading",{name:"Discover intake"}).waitFor({timeout:30000});
        await page.screenshot({path:resolve(dir,file),fullPage:true});files.push(file);
        if (heading==="Configuration") {
          await page.getByLabel("Reason for the next configuration decision").fill("Restore optional intake through audited publication");
          await page.getByRole("button",{name:/Create draft from active/}).click();
          await page.getByRole("heading",{name:/Draft v/}).waitFor({timeout:30000});
          await page.getByLabel("Require initial discovery information").uncheck();
          await page.getByRole("button",{name:"Save Discover policy to draft"}).click();
          await page.getByRole("status").filter({hasText:"Draft change saved"}).waitFor({timeout:30000});
          await page.getByRole("button",{name:/Validate and publish/}).click();
          await page.getByRole("heading",{name:/Validated candidate/}).waitFor({timeout:30000});
          await page.screenshot({path:resolve(dir,"customer-publication-review-1440.png"),fullPage:true});
          files.push("customer-publication-review-1440.png");
          await page.getByRole("button",{name:/Activate v/}).click();
          await page.getByRole("heading",{name:"Published policy"}).waitFor({timeout:30000});
          await page.screenshot({path:resolve(dir,"customer-publication-active-1440.png"),fullPage:true});
          files.push("customer-publication-active-1440.png");
          await page.getByRole("link",{name:"Start connected Work"}).first().click();
          await page.getByRole("heading",{name:"Start connected Work"}).first().waitFor();
          await page.getByLabel("Work name").fill("Browser connected Work qualification");
          await page.getByLabel("Customer",{exact:true}).fill("Fictional Customer");
          await page.getByLabel("Site",{exact:true}).fill("Test location");
          await page.getByLabel("Accountable owner").fill("Rybex Test Administrator");
          await page.getByLabel("Demand source").fill("Direct customer");
          await page.getByLabel("Customer need").fill("Qualify customer connected Work creation");
          await page.getByLabel("Procurement route").fill("Direct");
          await page.getByRole("button",{name:"Create connected Work"}).click();
          await page.getByRole("status").filter({hasText:"Connected Work created"}).waitFor({timeout:30000});
          assert.equal(await page.locator("section.d5o-publication").getByRole("alert").count(),0);
          assert.equal(await page.getByLabel("Work name").inputValue(),"");
          await page.screenshot({path:resolve(dir,"customer-connected-work-1440.png"),fullPage:true});
          files.push("customer-connected-work-1440.png");
        }
        if(path==="/platform-admin" || who==="a_admin") {
          await page.setViewportSize({width:390,height:844});
          const mobile=file.replace("1440","390");
          await page.screenshot({path:resolve(dir,mobile),fullPage:true});files.push(mobile);
          await page.setViewportSize({width:1440,height:900});
        }
        if(who==="vendor" && path==="/platform-admin") {
          await page.getByLabel("Legal name").fill("Browser Qualification Test LLC");
          await page.getByLabel("Display name").fill("Browser Qualification Test");
          await page.getByLabel("Tenant key").fill("browser_qualification_test");
          await page.getByLabel("Initial administrator email").fill(users.outsider.email);
          await page.getByRole("combobox",{name:"Configuration template",exact:true}).selectOption(template.id);
          await page.getByRole("button",{name:"Review customer setup"}).click();
          await page.getByRole("heading",{name:"Review before provisioning"}).waitFor();
          await page.screenshot({path:resolve(dir,"vendor-create-review-1440.png"),fullPage:true});
          files.push("vendor-create-review-1440.png");
          await page.getByRole("button",{name:"Provision customer"}).click();
          await page.getByRole("status").filter({hasText:"was provisioned"}).waitFor({timeout:30000});
          await page.screenshot({path:resolve(dir,"vendor-create-complete-1440.png"),fullPage:true});
          files.push("vendor-create-complete-1440.png");
          assert.equal(Number(sql("select count(*) from d5o_hosted.workspaces where workspace_key='browser_qualification_test';")),1);
        }
        if(who==="a_admin") {
          const denied=await page.request.get(`http://127.0.0.1:${server.port}/api/d5o-platform/provisioning`);
          assert.equal(denied.status(),403);
        }
        await page.close();
      }
      const deniedPage=await browser.newPage({viewport:{width:1440,height:900}});
      await deniedPage.goto(`http://127.0.0.1:${server.port}/auth/sign-in?next=${encodeURIComponent(
        `/work/connected-work?workspace=${b.workspaceKey}`)}`);
      await deniedPage.getByLabel("Email").fill(users.b_admin.email);
      await deniedPage.getByLabel("Password").fill(users.b_admin.password);
      await deniedPage.getByRole("button",{name:"Continue to your work"}).click();
      await deniedPage.getByText("Connected Work is unavailable for this organization.",{exact:false}).waitFor({timeout:30000});
      await deniedPage.goto(`http://127.0.0.1:${server.port}/work/admin/configuration?workspace=${b.workspaceKey}`);
      await deniedPage.getByRole("heading",{name:"Configuration",exact:true}).waitFor({timeout:30000});
      assert.equal(await deniedPage.getByRole("link",{name:"Start connected Work"}).count(),0);
      await deniedPage.goto(`http://127.0.0.1:${server.port}/work/connected-work?workspace=${b.workspaceKey}`);
      await deniedPage.getByText("Connected Work is unavailable for this organization.",{exact:false}).waitFor({timeout:30000});
      await deniedPage.screenshot({path:resolve(dir,"customer-feature-unavailable-1440.png"),fullPage:true});
      files.push("customer-feature-unavailable-1440.png");
      const bypassStatus=await deniedPage.evaluate(async({workspace,version})=>{
        const response=await fetch(`/api/d5o-hosted/connected-work?workspace=${workspace}`,{
          method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({commandId:crypto.randomUUID(),configurationVersionId:version,
            workTypeKey:"lifecycle-service",title:"Forbidden connected Work",
            customer:"Fictional Customer",site:"Test location",owner:"Test owner"})});
        return response.status;
      },{workspace:b.workspaceKey,version:versions.b_admin});
      assert.equal(bypassStatus,403);
      await deniedPage.close();
      const browserTenant=(await call("vendor","d5o_platform_provisioning_directory_v1")).data
        .find((item)=>item.workspaceKey==="browser_qualification_test");
      assert(browserTenant?.invitationId && browserTenant?.configurationVersionId);
      const recipient=await browser.newPage({viewport:{width:1440,height:900}});
      await recipient.goto(`http://127.0.0.1:${server.port}/auth/sign-in?next=${encodeURIComponent(
        `/work/initial-invitation?workspace=${browserTenant.workspaceKey}&request=${browserTenant.invitationId}`)}`);
      await recipient.getByLabel("Email").fill(users.outsider.email);
      await recipient.getByLabel("Password").fill(users.outsider.password);
      await recipient.getByRole("button",{name:"Continue to your work"}).click();
      await recipient.getByRole("heading",{name:"Administrator invitation"}).waitFor({timeout:30000});
      await recipient.getByRole("button",{name:"Accept administrator invitation"}).click();
      await recipient.getByRole("status").filter({hasText:"is active"}).waitFor({timeout:30000});
      await recipient.screenshot({path:resolve(dir,"initial-admin-accepted-1440.png"),fullPage:true});
      files.push("initial-admin-accepted-1440.png");
      const browserDraft=await config("outsider",browserTenant.workspaceKey,"create-draft",
        browserTenant.configurationVersionId,browserTenant.configurationVersionId,1,{},"browser-draft");
      assert(!browserDraft.error,browserDraft.error?.message);
      const browserVersion=browserDraft.data.versionId;
      const browserPolicy=await config("outsider",browserTenant.workspaceKey,"save-policy",
        browserVersion,browserTenant.configurationVersionId,1,
        {key:"service-approval",thresholdMinor:2000000,currency:"USD",comparison:"greater_than",
          authorityRole:"admin",unavailableBehavior:"block"},"browser-policy");
      assert(!browserPolicy.error,browserPolicy.error?.message);
      const browserPublish=await config("outsider",browserTenant.workspaceKey,"validate-publish",
        browserVersion,browserTenant.configurationVersionId,2,{},"browser-publish");
      assert(!browserPublish.error,browserPublish.error?.message);
      const browserActivateConfig=await config("outsider",browserTenant.workspaceKey,"activate",
        browserVersion,browserTenant.configurationVersionId,3,{},"browser-config-activate");
      assert(!browserActivateConfig.error,browserActivateConfig.error?.message);
      await recipient.getByRole("link",{name:/Continue to customer setup/}).click();
      await recipient.getByRole("heading",{name:"Set up Browser Qualification Test"}).waitFor({timeout:30000});
      recipient.once("dialog",(dialog)=>void dialog.accept());
      await recipient.getByRole("button",{name:"Submit as ready"}).click();
      await recipient.getByRole("status").filter({hasText:"Setup is ready"}).waitFor({timeout:30000});
      await recipient.screenshot({path:resolve(dir,"customer-ready-1440.png"),fullPage:true});
      files.push("customer-ready-1440.png");
      await recipient.close();
      const activation=await browser.newPage({viewport:{width:1440,height:900}});
      const detailPath=`/platform-admin/tenants/${browserTenant.workspaceKey}`;
      await activation.goto(`http://127.0.0.1:${server.port}/auth/sign-in?next=${encodeURIComponent(detailPath)}`);
      await activation.getByLabel("Email").fill(users.vendor.email);
      await activation.getByLabel("Password").fill(users.vendor.password);
      await activation.getByRole("button",{name:"Continue to your work"}).click();
      await activation.getByRole("heading",{name:"Browser Qualification Test"}).waitFor({timeout:30000});
      await activation.getByLabel("Decision reason").fill("Activate browser-qualified fictional customer");
      activation.once("dialog",(dialog)=>void dialog.accept());
      await activation.getByRole("button",{name:"Activate customer"}).click();
      await activation.getByRole("definition").filter({hasText:"active"}).first().waitFor({timeout:30000});
      assert.equal(await activation.getByLabel("Decision reason").count(),1);
      await activation.screenshot({path:resolve(dir,"vendor-activated-1440.png"),fullPage:true});
      files.push("vendor-activated-1440.png");
      await activation.getByLabel("Decision reason").fill("Grant connected Work to browser qualification tenant");
      activation.once("dialog",(dialog)=>void dialog.accept());
      await activation.getByRole("button",{name:"Grant entitlement"}).click();
      await activation.getByRole("button",{name:"Remove entitlement"}).waitFor({timeout:30000});
      await activation.reload();
      await activation.getByRole("heading",{name:"Browser Qualification Test"}).waitFor();
      await activation.getByLabel("Decision reason").fill("Enable connected Work for browser qualification tenant");
      activation.once("dialog",(dialog)=>void dialog.accept());
      await activation.getByRole("button",{name:"Enable rollout flag"}).click();
      await activation.getByRole("button",{name:"Disable rollout flag"}).waitFor({timeout:30000});
      await activation.reload();
      await activation.getByRole("heading",{name:"Browser Qualification Test"}).waitFor();
      await activation.screenshot({path:resolve(dir,"vendor-feature-enabled-1440.png"),fullPage:true});
      files.push("vendor-feature-enabled-1440.png");
      await activation.getByLabel("Decision reason").fill("Suspend browser qualification tenant operations");
      activation.once("dialog",(dialog)=>void dialog.accept());
      await activation.getByRole("button",{name:"Suspend customer operations"}).click();
      await activation.getByRole("button",{name:"Reactivate customer"}).waitFor({timeout:30000});
      await activation.reload();
      await activation.getByRole("heading",{name:"Browser Qualification Test"}).waitFor();
      await activation.getByText(/Effective: unavailable/).waitFor();
      await activation.screenshot({path:resolve(dir,"vendor-suspended-1440.png"),fullPage:true});
      files.push("vendor-suspended-1440.png");
      await activation.getByLabel("Decision reason").fill("Reactivate browser qualification tenant after controlled suspension");
      activation.once("dialog",(dialog)=>void dialog.accept());
      await activation.getByRole("button",{name:"Reactivate customer"}).click();
      await activation.getByRole("button",{name:"Suspend customer operations"}).waitFor({timeout:30000});
      await activation.reload();
      await activation.getByText(/Effective: available/).waitFor();
      await activation.close();
      return {files,ephemeralPreview:`http://127.0.0.1:${server.port}/platform-admin`};
    } finally {await browser.close();}
  });
  await check("audited rollback creates a new version and preserves historical pins",async()=>{
    const activeRow=sql(`select v.id||'|'||v.edit_revision from d5o_hosted.configuration_versions v
      join d5o_hosted.configuration_tenants t on t.id=v.tenant_id
      where t.workspace_id=${q(a.workspaceId)} and v.status='published'
        and v.effective_from<=now() and (v.effective_to is null or v.effective_to>now());`);
    const [current,revisionText]=activeRow.split("|");
    assert.notEqual(current,versions.a_admin);
    const draft=await config("a_admin",a.workspaceKey,"create-draft",current,current,
      Number(revisionText),{sourceVersionId:versions.a_admin},"restore-draft");
    assert(!draft.error,draft.error?.message);
    const candidate=await config("a_admin",a.workspaceKey,"validate-publish",draft.data.versionId,
      current,1,{},"restore-publish");assert(!candidate.error,candidate.error?.message);
    const activated=await config("a_admin",a.workspaceKey,"activate",draft.data.versionId,
      current,2,{},"restore-activate");assert(!activated.error,activated.error?.message);
    const preserved=Number(sql(`select count(*) from d5o_hosted.work_records
      where workspace_id=${q(a.workspaceId)} and configuration_version_id=${q(versions.a_admin)};`));
    assert(preserved>=1);
    const restored=sql(`select manifest_json#>>'{discoverIntake,requireInitialDiscovery}'
      from d5o_hosted.configuration_versions where id=${q(draft.data.versionId)};`);
    assert.equal(restored,"true");
    return {sourceVersion:versions.a_admin,newVersion:draft.data.versionId,
      preservedWorkCount:preserved,restoredDiscoverRequirement:true};
  });
  if(releaseTaskProbe) await check("release hosted employee invitation and My Work decision",async()=>{
    if(!hostedRehearsal || !server) throw Error("production-mode rehearsal required");
    const base=`http://127.0.0.1:${server.port}`;
    const browser=await chromium.launch();
    try {
      const adminPage=await browser.newPage({viewport:{width:1440,height:900}});
      await adminPage.goto(`${base}/auth/sign-in?next=${encodeURIComponent(`/work/admin/invitations?workspace=${a.workspaceKey}`)}`);
      await adminPage.getByLabel("Email").fill(users.a_admin.email);
      await adminPage.getByLabel("Password").fill(users.a_admin.password);
      await adminPage.getByRole("button",{name:"Continue to your work"}).click();
      await adminPage.getByRole("heading",{name:"Invitations"}).first().waitFor({timeout:30000});
      const inviteId=randomUUID();
      const invitation=await adminPage.evaluate(async({workspace,email,commandId})=>{
        const response=await fetch("/api/d5o-hosted/org-admin",{method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({workspace,action:"invitation.request",email,role:"project_manager",
            expiresAt:new Date(Date.now()+7*86400000).toISOString(),reason:"Assign fictional project manager for release acceptance",commandId})});
        return {status:response.status,body:await response.json()};
      },{workspace:a.workspaceKey,email:users.project_manager.email,commandId:inviteId});
      assert.equal(invitation.status,200,JSON.stringify(invitation.body));
      assert.equal(invitation.body.result?.status,"existing_confirmed");
      const employee=await browser.newPage({viewport:{width:1440,height:900}});
      await employee.goto(`${base}/auth/sign-in?next=${encodeURIComponent(`/work/invitation?workspace=${a.workspaceKey}&request=${inviteId}`)}`);
      await employee.getByLabel("Email").fill(users.project_manager.email);
      await employee.getByLabel("Password").fill(users.project_manager.password);
      await employee.getByRole("button",{name:"Continue to your work"}).click();
      await employee.getByRole("heading",{name:"Organization invitation"}).waitFor({timeout:30000});
      await employee.getByRole("button",{name:"Accept invitation"}).click();
      await employee.getByRole("status").filter({hasText:"project manager"}).waitFor({timeout:30000});
      const created=await employee.evaluate(async({workspaceKey,configurationVersionId})=>{
        const response=await fetch("/api/d5o-hosted/work",{method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({workspaceKey,commandId:crypto.randomUUID(),configurationVersionId,
            workTypeKey:"lifecycle-service",title:"Fictional employee acceptance Work"})});
        return {status:response.status,body:await response.json()};
      },{workspaceKey:a.workspaceKey,configurationVersionId:versions.a_admin});
      assert.equal(created.status,201,JSON.stringify(created.body));
      const workId=created.body.result?.workId;
      assert(workId,"missing canonical Work identity");
      await employee.goto(`${base}/work/customer/${a.workspaceKey}`);
      await employee.getByRole("heading",{name:"My Work"}).waitFor({timeout:30000});
      const taskList=employee.getByRole("heading",{name:"My Work"}).locator("xpath=following-sibling::*[1]");
      const taskLink=taskList.locator(`a[href*="work=${workId}"][href*="task=discover%3A"]`).first();
      await taskLink.waitFor({timeout:30000});
      const href=await taskLink.getAttribute("href");
      assert(href?.includes("&task="));
      await taskLink.click();
      await employee.getByRole("status").filter({hasText:"Assigned responsibility: Prepare Discover intake"})
        .waitFor({timeout:30000});
      await employee.reload();
      await employee.getByRole("status").filter({hasText:"Assigned responsibility: Prepare Discover intake"})
        .waitFor({timeout:30000});
      const control=employee.getByRole("article",{name:"Pursuit and Define handoff control"});
      await control.getByLabel("Customer / account").fill("Fictional release customer");
      await control.getByLabel("Site / location").fill("Fictional test site");
      await control.getByLabel("Accountable owner").fill("Fictional project manager");
      await control.getByLabel("Customer need").fill("Qualify a synthetic service delivery request");
      await control.getByLabel("Requester").fill("Fictional requester");
      await control.getByLabel("Intended customer outcome").fill("Accepted supported service");
      await control.getByLabel("Rough value").fill("15000");
      await control.getByLabel("Currency").fill("USD");
      await control.getByLabel("Required date").fill("2026-12-15");
      await control.getByLabel("Known risk or unknown").fill("Synthetic scheduling dependency");
      await control.getByRole("button",{name:"Save intake revision"}).click();
      await control.getByText(/Intake revision 1/).waitFor({timeout:30000});
      await control.getByRole("button",{name:"Submit intake for pursuit decision"}).click();
      await control.getByText(/submitted/).first().waitFor({timeout:30000});
      await employee.reload();
      const after=await employee.evaluate(async(workspace)=>{
        const response=await fetch(`/api/d5o-hosted/customer-work?workspace=${workspace}`);
        return {status:response.status,body:await response.json()};
      },a.workspaceKey);
      assert.equal(after.status,200);
      assert(!after.body.tasks.some((task)=>task.workId===workId&&task.action==="intake"),"submitted task remained available");
      await employee.close();await adminPage.close();
      return {invitationStatus:invitation.body.result.status,employeeRole:"project_manager",workId,
        taskLink:href,authenticatedBrowserDecision:"Discover intake submitted",taskResolved:true,
        persistenceAfterReload:true};
    } finally {await browser.close();}
  });
  if(rc20TaskProbe) await check("RC20 hosted customer My Work task link",async()=>{
    if(!hostedRehearsal || !server) throw Error("production-mode rehearsal required");
    const browser=await chromium.launch();
    try {
      const page=await browser.newPage({viewport:{width:1440,height:900}});
      const path=`/work/customer/${a.workspaceKey}`;
      await page.goto(`http://127.0.0.1:${server.port}/auth/sign-in?next=${encodeURIComponent(path)}`);
      await page.getByLabel("Email").fill(users.a_admin.email);
      await page.getByLabel("Password").fill(users.a_admin.password);
      await page.getByRole("button",{name:"Continue to your work"}).click();
      await page.getByRole("heading",{name:"Work lifecycle"}).waitFor({timeout:30000});
      await page.getByRole("heading",{name:"My Work"}).waitFor({timeout:30000});
      const taskList=page.getByRole("heading",{name:"My Work"})
        .locator("xpath=following-sibling::*[1]");
      if(await taskList.evaluate((node)=>node.tagName)!=="UL")
        throw Error("no_assigned_task_after_synthetic_onboarding");
      const links=taskList.locator("a");
      const taskCount=await links.count();
      if(!taskCount) throw Error("no_assigned_task_after_synthetic_onboarding");
      const href=await links.first().getAttribute("href");
      if(!href?.startsWith(`/work/customer/${a.workspaceKey}?work=`)||!href.includes("&task="))
        throw Error("unexpected_task_link");
      await links.first().click();
      try {await page.getByRole("status").filter({hasText:"Assigned responsibility:"})
        .waitFor({timeout:8000});}
      catch {
        const alert=await page.getByRole("alert").allTextContents();
        const status=await page.getByRole("status").allTextContents();
        throw Error(`task_link_not_resolved:href=${href}:url=${new URL(page.url()).pathname}:alerts=${alert.join('|').slice(0,180)}:status=${status.join('|').slice(0,180)}`);
      }
      await page.reload();
      await page.getByRole("status").filter({hasText:"Assigned responsibility:"})
        .waitFor({timeout:30000});
      await page.close();
      return {taskCount,taskLinkResolved:true,reloadPreserved:true,
        decisionExecuted:false};
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
  console.log(JSON.stringify({...evidence.summary,output:"docs/architecture/evidence/phase2c-two-tenant-results.json"}));
  if(evidence.summary.failed||evidence.summary.setupError||!evidence.summary.cleanupVerified) process.exitCode=1;
}
