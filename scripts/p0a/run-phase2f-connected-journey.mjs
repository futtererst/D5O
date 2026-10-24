import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "node:net";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "@playwright/test";
import { createP0aRuntime, cleanupP0aRuntime } from "./disposable-runtime.mjs";

const root = resolve(process.cwd());
const phase2g = process.env.D5O_PHASE2G === "1";
const phase2hsGateB = process.env.D5O_PHASE2HS_GATE_B === "1";
const phase2hsGateA = process.env.D5O_PHASE2HS_GATE_A === "1" || phase2hsGateB;
const phase2hr = process.env.D5O_PHASE2HR === "1" || phase2hsGateA;
const phase2hCompletion = process.env.D5O_PHASE2H_COMPLETION === "1" || phase2hr;
const phase2h = process.env.D5O_PHASE2H === "1" || phase2hCompletion;
const output = resolve(root, phase2hsGateB
  ? "docs/architecture/evidence/phase2hs-develop-gate-results.json"
  : phase2hsGateA
  ? "docs/architecture/evidence/phase2hs-design-gate-results.json"
  : phase2hr
  ? "docs/architecture/evidence/phase2hr-design-browser-results.json"
  : phase2hCompletion
  ? "docs/architecture/evidence/phase2h-completion-define-results.json"
  : phase2h
  ? "docs/architecture/evidence/phase2h-connected-journey-results.json"
  : phase2g
  ? "docs/architecture/evidence/phase2g-two-tenant-results.json"
  : "docs/architecture/evidence/phase2f-connected-journey-results.json");
const evidence = { baseline: phase2hsGateA ? "d1537c2070eee6926ad227c69dcdc43418bb381d" : phase2hr ? "f53aa89192b776221067cc6a761248e87259f82e" : phase2g
    ? "dae8e1fa975bc47ef6d1180b512399683e3c9613"
    : "8d536b4ce74282fe6c3a0e2dbb66b1752ca51ec2",
  startedAt: new Date().toISOString(), tests: [], setupError: null, cleanup: null };
// Field start checks the real shift clock. The disposable journey uses today's
// local business date so that its schedule is actually eligible for execution.
let executionDate = new Intl.DateTimeFormat("en-CA", {timeZone:"America/New_York",
  year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const executionDay = new Date(`${executionDate}T12:00:00Z`).getUTCDay();
const currentFridayOvernight = (phase2hsGateB || phase2g) && executionDay===6;
if(executionDay===0 || executionDay===6) {
  if(!phase2hsGateA && !currentFridayOvernight)
    throw Error("business_day_required_for_field_start");
  if(currentFridayOvernight) {
    // A real Friday overnight shift remains current on Saturday morning.
    // The field-start command checks the actual clock and timezone.
    const priorFriday=new Date(`${executionDate}T12:00:00Z`);
    priorFriday.setUTCDate(priorFriday.getUTCDate()-1);
    executionDate=priorFriday.toISOString().slice(0,10);
  } else {
    const nextBusinessDay=new Date(`${executionDate}T12:00:00Z`);
    nextBusinessDay.setUTCDate(nextBusinessDay.getUTCDate()+(executionDay===6?2:1));
    executionDate=nextBusinessDay.toISOString().slice(0,10);
  }
}
const executionHour = Number(new Intl.DateTimeFormat("en-US", {timeZone:"America/New_York",
  hour:"2-digit",hourCycle:"h23"}).format(new Date()));
const executionShift = currentFridayOvernight ? "23:00–10:59"
  : `${String(Math.max(0,executionHour-2)).padStart(2,"0")}:00–${String(Math.min(23,executionHour+6)).padStart(2,"0")}:59`;
let runtime, server, designBrowser;
const q = (value) => `'${String(value).replaceAll("'", "''")}'`;
function sql(query) {
  const result = spawnSync("docker", ["exec", "-i", runtime.dbContainer, "psql", "-U", "postgres", "-d", "postgres",
    "-X", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: query, encoding: "utf8", shell: false });
  if (result.status !== 0) throw Error(`sql_failed:${result.stderr.slice(-900)}`);
  return result.stdout.trim();
}
async function check(name, run) {
  try { evidence.tests.push({ name, status: "PASS", detail: await run() ?? null }); }
  catch (error) { evidence.tests.push({ name, status: "FAIL", detail: String(error.message).slice(0,
    phase2hsGateB ? 3600 : 800) }); }
  console.log(JSON.stringify({test:name,status:evidence.tests.at(-1).status,
    ...(evidence.tests.at(-1).status==="FAIL"?{detail:evidence.tests.at(-1).detail}:{})}));
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
    "a_finance","a_ops","a_ops2","a_pm","a_worker",
    "b_finance","b_ops","b_ops2","b_pm","b_worker"]) {
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
  const designPages = new Map();
  const designActionEvidence = [];
  if(phase2hr) evidence.designActions=designActionEvidence;
  async function designPage(actor, tenant, workId) {
    if(!server) server=await startNext(url,anon,service);
    if(!designBrowser) designBrowser=await chromium.launch();
    let page=designPages.get(actor);
    if(!page) {
      page=await designBrowser.newPage({viewport:{width:1440,height:900}});
      await page.goto(`http://127.0.0.1:${server.port}/auth/sign-in`);
      await page.getByLabel("Email").fill(users[actor].email);
      await page.getByLabel("Password").fill(users[actor].password);
      await page.getByRole("button",{name:"Continue to your work"}).click();
      await page.waitForURL((location)=>!location.pathname.startsWith("/auth/sign-in"),{timeout:30000});
      designPages.set(actor,page);
    }
    const target=`http://127.0.0.1:${server.port}/work/customer/${tenant.workspaceKey}?work=${workId}#phase-design`;
    if(page.url()===target) await page.reload(); else await page.goto(target);
    await page.getByRole("heading",{name:"Design actions"}).waitFor({timeout:30000});
    await page.getByText("Loading current Work and phase decisions…").waitFor({state:"hidden"});
    return page;
  }
  async function browserDesignAction(actor,tenant,workId,button,prepare=async()=>{},expected=200) {
    const page=await designPage(actor,tenant,workId);
    await prepare(page);
    const taskBefore=await page.locator('.d5o-customer-work-list a[href*="#phase-design"]')
      .allTextContents();
    const control=page.getByRole("button",{name:button,exact:true});
    try { await control.waitFor({state:"visible",timeout:12000}); }
    catch {
      const rendered=await page.locator(".d5o-customer-design-actions").innerText().catch(()=>"no Design panel");
      const detail=await page.evaluate(async({workspace,workId})=>{
        const response=await fetch(`/api/d5o-hosted/customer-work?workspace=${workspace}&workId=${workId}`);
        const body=await response.json();
        return {status:response.status,role:body.role,connectedPackages:body.connectedPackages,
          packages:body.record?.design?.packages,documents:body.record?.design?.documents};
      },{workspace:tenant.workspaceKey,workId});
      throw Error(`design_control_missing:${button}:${JSON.stringify({rendered,detail}).slice(0,2400)}`);
    }
    try { await control.click({trial:true,timeout:15000}); }
    catch {
      const rendered=await page.locator(".d5o-customer-design-actions").innerText().catch(()=>"no Design panel");
      throw Error(`design_control_not_actionable:${button}:${rendered.slice(0,1200)}`);
    }
    const [response]=await Promise.all([
      page.waitForResponse((response)=>response.url().includes("/api/d5o-hosted/customer-design-action")
        && response.request().method()==="POST",{timeout:30000}),
      control.click()
    ]);
    const body=await response.json();
    const requestBody=response.request().postDataJSON();
    const decision=body.result?.state?.records?.find((item)=>item.id===workId)?.design;
    const refreshed=await page.evaluate(async({workspace,workId})=>{
      const [tasks,detail]=await Promise.all([
        fetch(`/api/d5o-hosted/customer-work?workspace=${workspace}`).then((item)=>item.json()),
        fetch(`/api/d5o-hosted/customer-work?workspace=${workspace}&workId=${workId}`)
          .then((item)=>item.json())]);
      return {tasks:(tasks.tasks??[]).filter((item)=>item.workId===workId&&item.phase==="Design")
        .map((item)=>item.action??item.title),phase:detail.phaseStatus?.projection?.currentPhase,
        revision:detail.record?.design?.authorityRevision,
        configurationVersionId:detail.record?.phaseConfigurationVersionId};
    },{workspace:tenant.workspaceKey,workId});
    designActionEvidence.push({tenant:tenant.workspaceKey,workId,actor,button,
      origin:"authenticated_browser_control",httpStatus:response.status(),
      result:body.error??body.action??null,commandId:requestBody.commandId,
      taskBefore,taskAfter:refreshed.tasks,phaseAfter:refreshed.phase,
      decisionRevision:refreshed.revision,configurationVersionId:refreshed.configurationVersionId,
      auditReference:decision?.history?.[0]?.action??null,timestamp:new Date().toISOString()});
    assert.equal(response.status(),expected,`${actor}:${button}:${JSON.stringify(body)}`);
    if(expected===200) await page.getByRole("heading",{name:"Design actions"}).waitFor();
    return {page,body,requestBody};
  }
  async function browserDesignBasis(actor,tenant,workId,method) {
    return browserDesignAction(actor,tenant,workId,"Save package basis",async(page)=>{
      const form=page.locator("form").filter({has:page.getByRole("heading",{name:"Package basis"})});
      const fields={"Scope":"Restore and verify synthetic service work", "Work location":"Fictional service site",
        "Systems":"Service control system","Completion unit":"service",
        "Completion criterion":"One restored and independently verified service",
        "Materials":"No physical material needed for documented service restoration",
        "Access":"Escorted site access","Permit":"Customer permit confirmed",
        "Safety controls":"Isolation and hazard review","Equipment":"Test instrument",
        "Method of procedure":method,"Rollback":"Restore previous safe operating state",
        "Verification":"Independent functional check","Proof":"Dated test record",
        "Accepting authority":"Operations receiver"};
      for(const [label,value] of Object.entries(fields)) await form.getByLabel(label,{exact:true}).fill(value);
      await form.getByLabel("Execution start").fill(executionDate);
      await form.getByLabel("Execution end").fill(executionDate);
    });
  }
  const developActionEvidence=[];
  if(phase2hsGateB) evidence.developActions=developActionEvidence;
  async function developPage(actor,tenant,workId) {
    if(!server) server=await startNext(url,anon,service);
    if(!designBrowser) designBrowser=await chromium.launch();
    let page=designPages.get(actor);
    if(!page) {
      page=await designBrowser.newPage({viewport:{width:1440,height:900}});
      await page.goto(`http://127.0.0.1:${server.port}/auth/sign-in`);
      await page.getByLabel("Email").fill(users[actor].email);
      await page.getByLabel("Password").fill(users[actor].password);
      await page.getByRole("button",{name:"Continue to your work"}).click();
      await page.waitForURL((location)=>!location.pathname.startsWith("/auth/sign-in"),{timeout:30000});
      designPages.set(actor,page);
    }
    const target=`http://127.0.0.1:${server.port}/work/customer/${tenant.workspaceKey}?work=${workId}#phase-develop`;
    await page.goto(target);
    // A hash-only navigation can preserve an older Work snapshot from another
    // employee's decision. Reload before asserting the current task/action.
    await page.reload();
    await page.getByRole("heading",{name:"Develop actions"}).waitFor({timeout:30000});
    await page.getByText("Loading current Work and phase decisions…").waitFor({state:"hidden"});
    return page;
  }
  async function browserDevelopAction(actor,tenant,workId,button,prepare=async()=>{},
    endpoint="customer-develop-action",expected=200) {
    const page=await developPage(actor,tenant,workId);
    const taskTitles={
      "Submit economic authority":"Prepare Work economic authority",
      "Approve economic authority":"Review Work economic authority",
      "Submit labor authority":"Prepare field labor authority",
      "Approve labor authority":"Review field labor authority",
      "Save crew booking":"Assign qualified crew",
      "Publish crew week":"Publish crew assignment",
      "Authorize field start":"Authorize field start"
    };
    const task=page.locator('.d5o-customer-work-list a[href*="#phase-develop"]')
      .filter({hasText:taskTitles[button]??button});
    await task.waitFor({state:"visible",timeout:30000});
    const taskHref=await task.getAttribute("href");
    await task.click();
    await page.waitForURL((location)=>location.hash==="#phase-develop",{timeout:15000});
    try { await prepare(page); }
    catch(error) {
      const panels=await page.locator(".d5o-customer-design-actions").allTextContents();
      const probe=await page.evaluate(async({workspace,workId})=>{
        const urls=["customer-develop-action","customer-develop-authority"];
        return Promise.all(urls.map(async(name)=>{
          const response=await fetch(`/api/d5o-hosted/${name}?workspace=${workspace}&workId=${workId}`);
          return {name,status:response.status,body:await response.json()};
        }));
      },{workspace:tenant.workspaceKey,workId});
      const relevant=panels.filter((item)=>item.startsWith("Execution authority")
        || item.startsWith("Develop actions"));
      throw Error(`${actor}:${button}:prepare:${error.message}:${JSON.stringify({panels:relevant,probe}).slice(0,2800)}`);
    }
    const taskBefore=await page.locator('.d5o-customer-work-list a[href*="#phase-develop"]')
      .allTextContents();
    const control=page.getByRole("button",{name:button,exact:true});
    await control.waitFor({state:"visible",timeout:15000});
    await control.click({trial:true});
    if(button==="Authorize field start") page.once("dialog",(dialog)=>dialog.accept());
    const [response]=await Promise.all([
      page.waitForResponse((item)=>item.url().includes(`/api/d5o-hosted/${endpoint}`)
        && item.request().method()==="POST",{timeout:30000}),
      control.click()
    ]);
    const body=await response.json();
    const requestBody=response.request().postDataJSON();
    assert.equal(response.status(),expected,`${actor}:${button}:${JSON.stringify(body)}`);
    await page.reload();
    await page.getByRole("heading",{name:"Develop actions"}).waitFor({timeout:30000});
    const taskAfter=await page.locator('.d5o-customer-work-list a[href*="#phase-develop"]')
      .allTextContents();
    const status=await page.evaluate(async({workspace,workId})=>{
      const result=await fetch(`/api/d5o-hosted/customer-work?workspace=${workspace}&workId=${workId}`);
      const detail=await result.json();
      return {phase:detail.phaseStatus?.projection?.currentPhase,
        develop:detail.phaseStatus?.projection?.phases?.Develop?.status,
        pin:detail.record?.phaseConfigurationVersionId,
        replay:detail.phaseStatus?.replayMatches};
    },{workspace:tenant.workspaceKey,workId});
    const dir=resolve(root,"docs/architecture/evidence/phase2hs-develop-browser");
    mkdirSync(dir,{recursive:true});
    const screenshot=`${actor}-${button.toLowerCase().replaceAll(/[^a-z0-9]+/g,"-")}.png`;
    await page.screenshot({path:resolve(dir,screenshot),fullPage:true});
    developActionEvidence.push({tenant:tenant.workspaceKey,workId,actor,button,
      origin:"authenticated_browser_control",httpStatus:response.status(),
      openedFromMyWork:true,taskHref,request:requestBody,
      commandId:requestBody.commandId,result:body.result??body.error??null,
      taskBefore,taskAfter,phaseAfter:status.phase,developStatus:status.develop,
      configurationVersionId:status.pin,replayMatches:status.replay,screenshot,
      timestamp:new Date().toISOString()});
    return {page,body,requestBody};
  }
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
  await check("vendor publishes an executable crew-demand template version",async()=>{
    const reason="Require an actual crew demand before fictional service execution";
    const draft=await call("vendor","d5o_platform_template_command_v1",{
      p_template_key:"service-operations",p_action:"create-draft",p_version_id:null,
      p_payload:null,p_command_id:"phase2f-template-crew-draft",p_reason:reason});
    assert(!draft.error,draft.error?.message);
    const row=JSON.parse(sql(`select jsonb_build_object('manifest',manifest_json,
      'workTypes',work_types_json,'createRoles',create_roles_json,'routes',routes_json)::text
      from d5o_hosted.configuration_template_versions where id=${q(draft.data.versionId)};`));
    const serviceType=row.manifest.d5oPresentation.phaseContract.workTypes.find((item)=>
      item.workTypeKey==="lifecycle-service");
    assert(serviceType,"service-template-type-missing");
    serviceType.designControls.requireCrewDemand=true;
    const saved=await call("vendor","d5o_platform_template_command_v1",{
      p_template_key:"service-operations",p_action:"save",p_version_id:draft.data.versionId,
      p_payload:row,p_command_id:"phase2f-template-crew-save",p_reason:reason});
    assert(!saved.error,saved.error?.message);
    const validated=await call("vendor","d5o_platform_template_command_v1",{
      p_template_key:"service-operations",p_action:"validate",p_version_id:draft.data.versionId,
      p_payload:null,p_command_id:"phase2f-template-crew-validate",p_reason:reason});
    assert(!validated.error,validated.error?.message);
    const published=await call("vendor","d5o_platform_template_command_v1",{
      p_template_key:"service-operations",p_action:"publish",p_version_id:draft.data.versionId,
      p_payload:null,p_command_id:"phase2f-template-crew-publish",p_reason:reason});
    assert(!published.error,published.error?.message);
    template.id=published.data.versionId;
    return {versionId:template.id,crewDemandRequired:true};
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
      ["a_ops2",a,"operations_leader"],
      ["a_pm",a,"project_manager"],
      ["b_finance",b,"billing_commercial_lead"],
      ["b_ops",b,"operations_leader"],
      ["b_ops2",b,"operations_leader"],
      ["b_pm",b,"project_manager"]]) {
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
      const operateRoute=await config(who,tenant.workspaceKey,"save-route",draft,active,edit++,
        {key:"deployOperate",role:"operations_leader"},
        `phase2f-${who}-deploy-operate-route`);
      assert(!operateRoute.error,operateRoute.error?.message);
      const projectManagerCreate=await config(who,tenant.workspaceKey,"set-create-role",
        draft,active,edit++,{key:"lifecycle-service",role:"project_manager",enabled:true},
        `phase2f-${who}-project-manager-create`);
      assert(!projectManagerCreate.error,projectManagerCreate.error?.message);
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
      const pm=who.startsWith("a")?"a_pm":"b_pm";
      const workRevision=Number(sql(`select coalesce((select revision from d5o_hosted.prototype_states
        where workspace_id=${q(tenant.workspaceId)} and state_key='work'),0);`));
      const catalogRevision=Number(sql(`select coalesce((select revision from d5o_hosted.prototype_states
        where workspace_id=${q(tenant.workspaceId)} and state_key='catalog'),0);`));
      const work=await admin.rpc("d5o_hosted_create_connected_work_v1",{
        p_workspace_key:tenant.workspaceKey,p_command_id:`phase2d-connected-${who}`,
        p_expected_work_revision:workRevision,p_expected_catalog_revision:catalogRevision,
        p_configuration_version_id:versions[who],p_work_type_key:"lifecycle-service",
        p_title:"Phase 2D policy qualification",p_customer:"Fictional Customer",
        p_site:"Test location",p_owner:"Test owner",p_actor_user_id:users[pm].id,
        p_membership_id:sql(`select id from d5o_hosted.memberships
          where workspace_id=${q(tenant.workspaceId)}
            and actor_user_id=${q(users[pm].id)};`),
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
      if(phase2hCompletion) {
        if(!server)server=await startNext(url,anon,service);
        const browser=await chromium.launch();
        const page=await browser.newPage({viewport:{width:1440,height:900}});
        try {
          await page.goto(`http://127.0.0.1:${server.port}/auth/sign-in?next=%2Fwork`);
          await page.getByLabel("Email").fill(users[owner].email);
          await page.getByLabel("Password").fill(users[owner].password);
          await page.getByRole("button",{name:"Continue to your work"}).click();
          await page.locator(`[data-workspace="${tenant.workspaceKey}"]`).click();
          const task=page.locator(".d5o-customer-work-list a")
            .filter({hasText:"Prepare and submit Define scope"})
            .filter({hasText:"Phase 2D policy qualification"}).first();
          await task.waitFor({timeout:30000});
          await task.click();
          await page.getByRole("heading",{name:"Prepare Define scope"}).waitFor({timeout:30000});
          const dir=resolve(root,"docs/architecture/evidence/phase2h-completion-browser");
          mkdirSync(dir,{recursive:true});
          await page.screenshot({path:resolve(dir,`${prefix}-define-draft-desktop.png`),fullPage:true});
          await page.setViewportSize({width:390,height:844});
          await page.screenshot({path:resolve(dir,`${prefix}-define-draft-mobile.png`),fullPage:true});
          await page.setViewportSize({width:1440,height:900});
          const values={
            "Customer contact":"Fictional representative",
            "Site or work area":record.site,
            "Affected systems":"Service component",
            "Access constraints":"Escorted access",
            "Expected outcome":"Inspected service restored",
            "Excluded scope":"Unrelated systems",
            "Delivery approach":"Controlled visit and test",
            "Delivery milestones":"Inspect then test",
            "Dependencies":"Approved site access",
            "Estimate basis":"Synthetic USD 15000 scope",
            "Commercial terms":"Subject to authorization",
            "Customer representative":"Fictional representative",
            "Customer agreement date":"2026-10-23",
            "Customer agreement basis":"Synthetic accepted scope",
            "Confirmed finding":"Service component needs inspection",
            "Finding source":"Synthetic customer briefing",
            "Customer requirement":"Restore service component",
            "Requirement source":"Synthetic customer scope",
            "Requirement owner":"Project manager",
            "Scoped deliverable":"Inspected component",
            "Scope boundary":"Service component",
            "Scope owner":"Project manager",
            "Acceptance result":"Operational",
            "Acceptance method":"Functional test",
            "Acceptance proof":"Synthetic test record",
            "Acceptance authority":"Customer representative",
            "Interface boundary":"Service component",
            "Interface owner":"Project manager",
            "Interface counterparty":"Customer",
            "Interface agreement":"Escorted inspection"
          };
          for(const [label,value] of Object.entries(values))
            await page.getByLabel(label,{exact:true}).fill(value);
          const initialFields=await page.locator("form.d5o-customer-define-draft")
            .evaluate((form)=>Object.fromEntries(new FormData(form).entries()));
          const direct=async(target,body)=>page.evaluate(async({target,body})=>{
            const response=await fetch(`/api/d5o-hosted/customer-work?workspace=${encodeURIComponent(target)}`,{
              method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
            return {status:response.status,body:await response.json()};
          },{target,body});
          if(prefix==="a") {
            const prematureWork=current.data.state.records.find((item)=>item.title==="Connected Work qualification");
            assert(prematureWork && prematureWork.discovery?.pursuitControl?.handoff?.status!=="accepted");
            const premature=await direct(tenant.workspaceKey,{workId:prematureWork.id,
              command:"define-draft",commandId:randomUUID(),
              arguments:{p_expected_source_revision:current.data.revision,fields:initialFields}});
            assert.equal(premature.status,409,JSON.stringify(premature.body));
            assert.equal(premature.body.error,"define_intake_handoff_required");
          }
          const save=async()=>{
            const responsePromise=page.waitForResponse((response)=>response.url().includes("/api/d5o-hosted/customer-work")
              && response.request().method()==="POST");
            await page.getByRole("button",{name:"Save Define draft"}).click();
            const response=await responsePromise;
            assert.equal(response.status(),200,JSON.stringify(await response.json()));
            await page.getByRole("button",{name:"Request commercial and delivery review"}).waitFor();
          };
          await save();
          await page.getByLabel("Decision reason").fill("Submit complete fictional Define scope for independent review");
          let policyDenied=false;
          if(strict) {
            const responsePromise=page.waitForResponse((response)=>response.url().includes("/api/d5o-hosted/customer-work")
              && response.request().method()==="POST");
            await page.getByRole("button",{name:"Request commercial and delivery review"}).click();
            const response=await responsePromise;
            const denied=await response.json();
            assert.equal(response.status(),422,JSON.stringify(denied));
            assert.match(String(denied.error),/define_risk_narrative_required/,
              `unexpected_define_denial:${JSON.stringify(denied)}`);
            await page.locator(".d5o-customer-work-error")
              .filter({hasText:"define risk narrative required"}).waitFor();
            policyDenied=true;
            await page.getByLabel("Risk narrative").fill("Service outage during controlled inspection");
            await save();
            await page.getByLabel("Decision reason").fill("Submit complete fictional Define scope for independent review");
          }
          const responsePromise=page.waitForResponse((response)=>response.url().includes("/api/d5o-hosted/customer-work")
            && response.request().method()==="POST");
          await page.getByRole("button",{name:"Request commercial and delivery review"}).click();
          const response=await responsePromise;
          const submitPayload=JSON.parse(response.request().postData()??"{}");
          assert.equal(response.status(),200,JSON.stringify(await response.json()));
          const replay=await direct(tenant.workspaceKey,submitPayload);
          assert.equal(replay.status,200,`Define command replay: ${JSON.stringify(replay.body)}`);
          await page.getByText("Scope status: In review.").waitFor({timeout:30000});
          assert.equal(await page.locator(".d5o-customer-work-list a")
            .filter({hasText:"Prepare and submit Define scope"})
            .filter({hasText:"Phase 2D policy qualification"}).count(),0);
          await page.screenshot({path:resolve(dir,`${prefix}-define-submitted.png`),fullPage:true});
          const cross=await direct(prefix==="a"?b.workspaceKey:a.workspaceKey,
            {workId:record.id,command:"define-draft",commandId:randomUUID(),
              arguments:{p_expected_source_revision:current.data.revision,fields:initialFields}});
          assert.equal(cross.status,403,JSON.stringify(cross.body));
          assert.notEqual(cross.body.error,"invalid_origin");
          const stale=await direct(tenant.workspaceKey,
            {workId:record.id,command:"define-draft",commandId:randomUUID(),
              arguments:{p_expected_source_revision:current.data.revision,fields:initialFields}});
          assert.equal(stale.status,409,JSON.stringify(stale.body));
          outcomes.push({tenant:tenant.workspaceKey,workId:record.canonicalWorkId,
            versionId:record.phaseConfigurationVersionId,policyDenied,
            browserDraft:true,browserSubmission:true,taskRemoved:true});
        } finally {await browser.close();}
        continue;
      }
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
  if(phase2hCompletion && evidence.tests.at(-1)?.status!=="PASS")
    throw Error("define_browser_gate_failed");
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
        if(phase2h) {
          if(!server)server=await startNext(url,anon,service);
          const browser=await chromium.launch();
          const page=await browser.newPage({viewport:{width:1440,height:900}});
          try {
            await page.goto(`http://127.0.0.1:${server.port}/auth/sign-in?next=%2Fwork`);
            await page.getByLabel("Email").fill(users[actor].email);
            await page.getByLabel("Password").fill(users[actor].password);
            await page.getByRole("button",{name:"Continue to your work"}).click();
            await page.getByRole("link",{name:/Open workspace/}).first().waitFor({timeout:30000});
            await page.locator(`[data-workspace="${tenant.workspaceKey}"]`).click();
            const label=action==="approve-review"
              ? `Approve ${role} review`
              : action==="submit-handoff"?"Send approved scope":"Receive approved scope";
            const taskTitle=action==="approve-review"
              ? `Review ${role} scope`
              : action==="submit-handoff"?"Send approved scope":"Receive approved scope";
            const taskLink=page.locator(".d5o-customer-work-list a").filter({hasText:taskTitle}).first();
            await taskLink.waitFor({timeout:30000});
            await taskLink.click();
            await page.getByRole("heading",{name:"Phase 2D policy qualification"}).waitFor({timeout:30000});
            await page.getByLabel("Decision reason").fill("Independent review of complete fictional scope");
            if(action==="approve-review" && role==="commercial") {
              const direct=async(targetWorkspace,reviewRole,reason)=>page.evaluate(async({targetWorkspace,workId,reviewRole,reason,sourceRevision,decisionRevision})=>{
                const response=await fetch(`/api/d5o-hosted/customer-work?workspace=${encodeURIComponent(targetWorkspace)}`,{
                  method:"POST",headers:{"Content-Type":"application/json"},
                  body:JSON.stringify({workId,command:"define",commandId:crypto.randomUUID(),arguments:{
                    p_action:"approve-review",p_review_role:reviewRole,p_reason:reason,
                    p_expected_source_revision:sourceRevision,p_expected_decision_revision:decisionRevision}})});
                return {status:response.status,body:await response.json()};
              },{targetWorkspace,workId:record.id,reviewRole,reason,
                sourceRevision:current.data.revision,decisionRevision:decision});
              const foreign=prefix==="a"?b:a;
              const cross=await direct(foreign.workspaceKey,"commercial","Cross tenant decision must be rejected");
              assert.equal(cross.status,403,`${prefix}:cross-tenant Define:${JSON.stringify(cross.body)}`);
              assert.notEqual(cross.body.error,"invalid_origin");
              const wrongRole=await direct(tenant.workspaceKey,"delivery","Wrong role decision must be rejected");
              assert.equal(wrongRole.status,403,`${prefix}:wrong-role Define:${JSON.stringify(wrongRole.body)}`);
              assert.equal(wrongRole.body.error,"define_review_role_denied");
            }
            const dir=resolve(root,"docs/architecture/evidence/phase2h-browser");
            mkdirSync(dir,{recursive:true});
            await page.screenshot({path:resolve(dir,`${prefix}-define-${action}-${role??"handoff"}-before.png`),fullPage:true});
            if(action==="approve-review" && role==="commercial") {
              await page.setViewportSize({width:390,height:844});
              await page.screenshot({path:resolve(dir,`${prefix}-define-commercial-mobile-before.png`),fullPage:true});
              await page.setViewportSize({width:1440,height:900});
            }
            const responsePromise=page.waitForResponse((response)=>response.url().includes("/api/d5o-hosted/customer-work")
              && response.request().method()==="POST");
            await page.getByRole("button",{name:label}).click();
            const response=await responsePromise;
            assert.equal(response.status(),200,`${prefix}:${label}:${await response.text()}`);
            await page.getByRole("button",{name:label}).waitFor({state:"hidden",timeout:30000});
            await page.locator(".d5o-customer-work-list a").filter({hasText:taskTitle})
              .first().waitFor({state:"hidden",timeout:30000});
            await page.screenshot({path:resolve(dir,`${prefix}-define-${action}-${role??"handoff"}.png`),fullPage:true});
            decision++;
            return;
          } finally {await page.close();await browser.close();}
        }
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
  if(phase2g) await check("early solution approval is persisted as Develop preparation only",async()=>{
    const outcomes=[];
    for(const [prefix,tenant] of [["a",a],["b",b]]) {
      const current=await call(`${prefix}_admin`,"d5o_hosted_prototype_read_v1",{
        p_workspace_key:tenant.workspaceKey,p_state_key:"work"});
      assert(!current.error,current.error?.message);
      const work=current.data.state.records.find((item)=>item.title==="Phase 2D policy qualification");
      const status=await call(`${prefix}_admin`,"d5o_hosted_phase_status_read_v1",{
        p_workspace_key:tenant.workspaceKey,p_presentation_id:work.id});
      assert(!status.error,status.error?.message);
      assert.equal(status.data.status,"resolved");
      assert.equal(status.data.replayMatches,true);
      assert.equal(status.data.projection.phases.Develop.status,"preparation_in_progress");
      assert.notEqual(status.data.projection.phases.Design.status,"completed");
      outcomes.push({tenant:tenant.workspaceKey,workId:work.canonicalWorkId,
        develop:status.data.projection.phases.Develop.status,
        design:status.data.projection.phases.Design.status,
        preparationEvidence:status.data.projection.phases.Develop.preparationEvidence});
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
      if(phase2hsGateA) {
        await browserDesignAction(owner,tenant,record.id,"Send awarded Design handoff",async(page)=>{
          await page.getByLabel("Handoff due date").fill("2026-12-01");
        });
        await browserDesignAction(ops,tenant,record.id,"Accept awarded Design handoff",async(page)=>{
          await page.getByLabel("Receipt reason").fill("Independently received the exact fictional award and reviewed scope");
        });
        const browserResult=await call(owner,"d5o_hosted_prototype_read_v1",{
          p_workspace_key:tenant.workspaceKey,p_state_key:"work"});
        assert(!browserResult.error,browserResult.error?.message);
        const handoff=browserResult.data.state.records.find((item)=>item.id===record.id)
          .discovery.designHandoff;
        assert.equal(handoff.status,"accepted");
        outcomes.push({tenant:tenant.workspaceKey,workId:record.canonicalWorkId,
          status:handoff.status,browser:true});
        continue;
      }
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
      if(phase2hr) {
        const initial=await call(owner,"d5o_hosted_prototype_read_v1",{
          p_workspace_key:tenant.workspaceKey,p_state_key:"work"});
        assert(!initial.error,initial.error?.message);
        const workId=initial.data.state.records.find((item)=>item.title==="Phase 2D policy qualification").id;
        const createdAction=await browserDesignAction(owner,tenant,workId,"Create package",async(page)=>{
          await page.getByLabel("Package name").fill("Synthetic service restoration package");
          await page.getByLabel("Responsible owner").fill("Fictional Design Lead");
        });
        const replays=await createdAction.page.evaluate(async({workspace,requestBody})=>
          Promise.all([0,1].map(async()=>{
            const response=await fetch(`/api/d5o-hosted/customer-design-action?workspace=${workspace}`,{
              method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(requestBody)});
            return {status:response.status,body:await response.json()};
          })),{workspace:tenant.workspaceKey,requestBody:createdAction.requestBody});
        assert(replays.every((item)=>item.status===200 &&
          item.body.result?.created?.id===createdAction.body.result?.created?.id),
          `${prefix}:concurrent-create-replay:${JSON.stringify(replays)}`);
        await browserDesignAction(owner,tenant,workId,"Save document draft",async(page)=>{
          await page.getByLabel("Document type").fill("Method statement");
          await page.getByLabel("Document title").fill("Fictional service restoration method");
          await page.getByLabel("Document source reference").fill(`SYNTHETIC-PHASE2HR-DESIGN-${prefix.toUpperCase()}`);
          await page.getByLabel("Due date").first().fill("2026-12-05");
        });
        await browserDesignBasis(owner,tenant,workId,prefix==="a"?"":
          "Isolate, restore, inspect, test, and return service to customer");
        const page=await designPage(owner,tenant,workId);
        await page.getByLabel("Exact document PDF").setInputFiles({name:"phase2hr-method.pdf",
          mimeType:"application/pdf",buffer:Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF")});
        const uploadResponse=page.waitForResponse((response)=>response.url().includes("/api/d5o-hosted/design-document-evidence")
          && response.request().method()==="POST");
        await page.getByRole("button",{name:"Retain private PDF"}).click();
        const upload=await uploadResponse;
        const uploadBody=await upload.json();
        assert.equal(upload.status(),200,JSON.stringify(uploadBody));
        designActionEvidence.push({tenant:tenant.workspaceKey,workId,actor:owner,
          button:"Retain private PDF",origin:"authenticated_browser_control",httpStatus:upload.status(),
          result:uploadBody.evidenceId,timestamp:new Date().toISOString()});
        if(phase2hsGateA) {
          const before=await call(owner,"d5o_hosted_prototype_read_v1",{
            p_workspace_key:tenant.workspaceKey,p_state_key:"work"});
          assert(!before.error,before.error?.message);
          const current=before.data.state.records.find((item)=>item.id===workId);
          const document=current.design.documents[0];
          const wrongIds=[{kind:"nonexistent",id:randomUUID()},
            ...(prefix==="b"?[{kind:"foreign-tenant-and-work",id:outcomes[0].evidenceId}]:[])];
          for(const wrong of wrongIds) {
            const denied=await page.evaluate(async({workspace,workId,revision,designRevision,
              documentId,evidenceId})=>{
              const response=await fetch(`/api/d5o-hosted/customer-design-action?workspace=${workspace}`,{
                method:"POST",headers:{"Content-Type":"application/json"},
                body:JSON.stringify({workId,action:"submit-document",commandId:crypto.randomUUID(),
                  sourceRevision:revision,designRevision,input:{documentId,documentRevision:1,
                    evidenceId,note:"Invalid private PDF reference must not submit"}})});
              return {status:response.status,body:await response.json()};
            },{workspace:tenant.workspaceKey,workId,revision:before.data.revision,
              designRevision:current.design.authorityRevision,documentId:document.id,
              evidenceId:wrong.id});
            assert.equal(denied.status,422,`${prefix}:${wrong.kind}:${JSON.stringify(denied)}`);
            const after=await call(owner,"d5o_hosted_prototype_read_v1",{
              p_workspace_key:tenant.workspaceKey,p_state_key:"work"});
            assert.equal(after.data.state.records.find((item)=>item.id===workId)
              .design.authorityRevision,current.design.authorityRevision);
            evidence.gateA ??= {};
            evidence.gateA[`${prefix}${wrong.kind}`]=denied.status;
          }
        }
        await page.getByRole("button",{name:"Submit document for independent review"}).waitFor({state:"visible"});
        await browserDesignAction(owner,tenant,workId,"Submit document for independent review");
        await browserDesignAction(ops,tenant,workId,"Approve document",async(reviewPage)=>{
          await reviewPage.getByLabel("Independent review note").fill("Independently reviewed fictional Design document");
        });
        await browserDesignAction(owner,tenant,workId,"Issue approved document for use");
        const final=await call(owner,"d5o_hosted_prototype_read_v1",{
          p_workspace_key:tenant.workspaceKey,p_state_key:"work"});
        assert(!final.error,final.error?.message);
        const record=final.data.state.records.find((item)=>item.id===workId);
        const issued=record.design.documents.find((item)=>item.status==="Issued for use");
        assert(issued?.evidenceId,`${prefix}:issued-document-evidence`);
        const dir=resolve(root,"docs/architecture/evidence/phase2hr-design-browser");
        mkdirSync(dir,{recursive:true});
        const issuedPage=await designPage(owner,tenant,workId);
        await issuedPage.getByText("Retained PDF:").waitFor({timeout:30000});
        await issuedPage.screenshot({path:resolve(dir,`${prefix}-issued-document.png`),fullPage:true});
        outcomes.push({tenant:tenant.workspaceKey,workId:record.canonicalWorkId,
          packageId:record.design.packages[0].packageId,documentId:issued.id,
          evidenceId:issued.evidenceId,documentStatus:issued.status,browser:true});
        continue;
      }
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
        completionBasis:{kind:"Measured",plannedQuantity:1,unit:"service",
          criterion:"One restored and independently verified service"},
        requirementIds,predecessorIds:[],documentRefs:[`${documentId}@1`],
        materials:"No physical material needed for documented service restoration",
        materialLines:[],materialStatus:"Unknown",materialRequiredDate:executionDate,
        materialForecastDate:"",materialSource:"",access:"Escorted site access",
        permit:"Customer permit confirmed",safetyControls:"Isolation and hazard review",
        equipment:"Test instrument",method:prefix==="b"?
          "Isolate, restore, inspect, test, and return service to customer":"",
        rollback:"Restore previous safe operating state",
        verification:"Independent functional check",proof:"Dated test record",
        acceptingAuthority:"Operations receiver",windowStart:executionDate,
        windowEnd:executionDate,targetReleaseDate:executionDate,
        crewDemandRequired:true,crewExemptionReason:"",
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
      if(phase2hr) {
        const initial=await call(owner,"d5o_hosted_prototype_read_v1",{
          p_workspace_key:tenant.workspaceKey,p_state_key:"work"});
        assert(!initial.error,initial.error?.message);
        const workId=initial.data.state.records.find((item)=>item.title==="Phase 2D policy qualification").id;
        const releaseForm=async(page)=>{
          await page.getByLabel("Receipt due date").fill("2026-12-08");
          await page.getByLabel("Release reason").fill("Release fictional service package after independent review");
        };
        let demandRaceDone=false;
        const prepareRelease=async()=>{ await browserDesignAction(owner,tenant,workId,"Save dated crew demand",async(page)=>{
          await page.getByLabel("Qualification").fill("Service technician");
          await page.getByLabel("Minimum people").fill("1");
          await page.getByLabel("Estimated person hours").fill("8");
          await page.getByLabel("Prerequisite").fill("Accepted Design release");
          await page.getByLabel("Required date").fill(executionDate);
          await page.getByLabel("Shift").fill(executionShift);
        });
        if(phase2hsGateA && !demandRaceDone) {
          demandRaceDone=true;
          const before=await call(owner,"d5o_hosted_prototype_read_v1",{
            p_workspace_key:tenant.workspaceKey,p_state_key:"work"});
          assert(!before.error,before.error?.message);
          const current=before.data.state.records.find((item)=>item.id===workId);
          const eventCount=Number(sql(`select count(*) from d5o_hosted.connected_design_events
            where workspace_id=${q(tenant.workspaceId)} and work_id=${q(current.canonicalWorkId)}
              and action='save-demand';`));
          const page=await designPage(owner,tenant,workId);
          const base={workId,action:"save-demand",sourceRevision:before.data.revision,
            designRevision:current.design.authorityRevision};
          const responses=await page.evaluate(async({workspace,base,packageId,date,shift})=>
            Promise.all([1,2].map(async(people)=>{
              const response=await fetch(`/api/d5o-hosted/customer-design-action?workspace=${workspace}`,{
                method:"POST",headers:{"Content-Type":"application/json"},
                body:JSON.stringify({...base,commandId:crypto.randomUUID(),input:{
                  workId:base.workId,packageId,qualification:"Service technician",
                  minimumPeople:people,estimatedPersonHours:8,priority:"High",
                  prerequisite:"Accepted Design release",crewSchedulable:true,
                  requiredSlots:[{date,shift}]}})});
              return {status:response.status,body:await response.json()};
            })),{workspace:tenant.workspaceKey,base,
              packageId:current.design.packages[0].packageId,date:executionDate,shift:executionShift});
          assert.deepEqual(responses.map((item)=>item.status).sort(),[200,409],
            `${prefix}:conflicting-demand:${JSON.stringify(responses)}`);
          const after=await call(owner,"d5o_hosted_prototype_read_v1",{
            p_workspace_key:tenant.workspaceKey,p_state_key:"work"});
          assert.equal(after.data.state.records.find((item)=>item.id===workId)
            .design.authorityRevision,current.design.authorityRevision+1);
          assert.equal(Number(sql(`select count(*) from d5o_hosted.connected_design_events
            where workspace_id=${q(tenant.workspaceId)} and work_id=${q(current.canonicalWorkId)}
              and action='save-demand';`)),eventCount+1);
          evidence.gateA ??= {};
          evidence.gateA[`${prefix}ConcurrentDemand`]=responses.map((item)=>item.status);
          // The concurrency probe can legitimately leave the two-person demand
          // as the winner. Restore the one-person connected fixture through the
          // same authenticated Design form before accepting the package.
          if(responses[1].status===200) {
            await browserDesignAction(owner,tenant,workId,"Save dated crew demand",async(page)=>{
              await page.getByLabel("Qualification").fill("Service technician");
              await page.getByLabel("Minimum people").fill("1");
              await page.getByLabel("Estimated person hours").fill("8");
              await page.getByLabel("Prerequisite").fill("Accepted Design release");
              await page.getByLabel("Required date").fill(executionDate);
              await page.getByLabel("Shift").fill(executionShift);
            });
          }
        }
        for(const discipline of ["Engineering","Delivery","Safety","Quality"]) {
          await browserDesignAction(owner,tenant,workId,`Request ${discipline} review`,async(page)=>{
            const form=page.locator("form").filter({has:page.getByRole("heading",{name:`${discipline} review`})});
            await form.getByLabel("Review due date").fill("2026-12-06");
          });
          await browserDesignAction(ops,tenant,workId,`Approve ${discipline} review`,async(page)=>{
            const form=page.locator("form").filter({has:page.getByRole("heading",{name:`${discipline} review`})});
            await form.getByLabel("Independent decision note").fill(`Independently approved ${discipline} package basis`);
          });
        }};
        await prepareRelease();
        if(strict) {
          const negative=await browserDesignAction(owner,tenant,workId,
            "Release for independent receipt",releaseForm,422);
          assert.equal(negative.body.error,"package_release_readiness_blocked");
          await browserDesignBasis(owner,tenant,workId,
            "Isolate, restore, inspect, test, and return service to customer");
          // Changing the package creates a new revision. Demand and independent
          // reviews must be re-established for that revision before release.
          await prepareRelease();
        }
        const released=await browserDesignAction(owner,tenant,workId,
          "Release for independent receipt",releaseForm);
        const replayRelease=await released.page.evaluate(async({workspace,body})=>{
          const requests=await Promise.all([1,2].map(()=>fetch(
            `/api/d5o-hosted/customer-design-action?workspace=${workspace}`,{
              method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})));
          return requests.map((item)=>item.status);
        },{workspace:tenant.workspaceKey,body:released.requestBody});
        assert.deepEqual(replayRelease,[200,200],`${prefix}:release-replay`);
        const opsPage=await designPage(ops,tenant,workId);
        await opsPage.getByLabel("Package receipt reason").fill("Independently accepted exact fictional Design package");
        const receiptResponse=opsPage.waitForResponse((response)=>response.url().includes("/api/d5o-hosted/customer-work")
          && response.request().method()==="POST");
        await opsPage.getByRole("button",{name:"Accept released package"}).click();
        const receipt=await receiptResponse;
        assert.equal(receipt.status(),200,JSON.stringify(await receipt.json()));
        const receiptPayload=receipt.request().postDataJSON();
        const replayReceipt=await opsPage.evaluate(async({workspace,body})=>{
          const response=await fetch(`/api/d5o-hosted/customer-work?workspace=${workspace}`,{
            method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
          return response.status;
        },{workspace:tenant.workspaceKey,body:receiptPayload});
        assert.equal(replayReceipt,200,`${prefix}:receipt-replay`);
        await opsPage.getByRole("button",{name:"Accept released package"}).waitFor({state:"hidden",timeout:30000});
        await opsPage.getByText("Completed",{exact:true}).first().waitFor({timeout:30000});
        designActionEvidence.push({tenant:tenant.workspaceKey,workId,actor:ops,button:"Accept released package",
          origin:"authenticated_browser_control",httpStatus:receipt.status(),result:"respond-receipt",
          timestamp:new Date().toISOString()});
        const final=await call(owner,"d5o_hosted_prototype_read_v1",{
          p_workspace_key:tenant.workspaceKey,p_state_key:"work"});
        assert(!final.error,final.error?.message);
        const record=final.data.state.records.find((item)=>item.id===workId);
        assert.equal(record.design.releases[0].status,"Accepted");
        const dir=resolve(root,"docs/architecture/evidence/phase2hr-design-browser");
        mkdirSync(dir,{recursive:true});
        await opsPage.screenshot({path:resolve(dir,`${prefix}-design-receipt-accepted.png`),fullPage:true});
        await opsPage.setViewportSize({width:390,height:844});
        const mobileWidth=await opsPage.evaluate(() => ({viewport:window.innerWidth,
          document:document.documentElement.scrollWidth}));
        assert(mobileWidth.document<=mobileWidth.viewport+2,
          `${prefix}:mobile-horizontal-overflow:${JSON.stringify(mobileWidth)}`);
        await opsPage.screenshot({path:resolve(dir,`${prefix}-design-receipt-mobile.png`),fullPage:true});
        outcomes.push({tenant:tenant.workspaceKey,workId:record.canonicalWorkId,
          packageId:record.design.packages[0].packageId,methodRequired:strict,
          releaseStatus:"Accepted",versionId:record.phaseConfigurationVersionId,browserReceipt:true,
          concurrentReleaseReplay:replayRelease,receiptReplay:replayReceipt});
        continue;
      }
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
      const denied=strict?await call(owner,"d5o_hosted_design_release_command_v1",
        releaseArgs(current,`phase2e-${prefix}-missing-method-release`)):null;
      if(strict) assert.equal(denied.error?.message,"package_release_readiness_blocked");
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
          requiredSlots:[{date:executionDate,shift:executionShift}]},
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
      let browserReceipt=false;
      if(phase2hCompletion) {
        if(!server)server=await startNext(url,anon,service);
        const browser=await chromium.launch();
        const page=await browser.newPage({viewport:{width:1440,height:900}});
        try {
          await page.goto(`http://127.0.0.1:${server.port}/auth/sign-in?next=%2Fwork`);
          await page.getByLabel("Email").fill(users[ops].email);
          await page.getByLabel("Password").fill(users[ops].password);
          await page.getByRole("button",{name:"Continue to your work"}).click();
          await page.locator(`[data-workspace="${tenant.workspaceKey}"]`).click();
          const task=page.locator(".d5o-customer-work-list a")
            .filter({hasText:"Receive released Design package"})
            .filter({hasText:"Phase 2D policy qualification"}).first();
          await task.waitFor({timeout:30000});
          await task.click();
          await page.getByLabel("Package receipt reason").fill("Independently accepted exact fictional Design package");
          const dir=resolve(root,"docs/architecture/evidence/phase2h-completion-browser");
          mkdirSync(dir,{recursive:true});
          await page.screenshot({path:resolve(dir,`${prefix}-design-receipt-before.png`),fullPage:true});
          const responsePromise=page.waitForResponse((response)=>response.url().includes("/api/d5o-hosted/customer-work")
            && response.request().method()==="POST");
          await page.getByRole("button",{name:"Accept released package"}).click();
          const response=await responsePromise;
          assert.equal(response.status(),200,JSON.stringify(await response.json()));
          await task.waitFor({state:"hidden",timeout:30000});
          await page.screenshot({path:resolve(dir,`${prefix}-design-receipt-accepted.png`),fullPage:true});
          browserReceipt=true;
        } finally {await browser.close();}
      } else {
        const accepted=await call(ops,"d5o_hosted_design_release_command_v1",{
          p_workspace_key:tenant.workspaceKey,p_presentation_id:current.record.id,
          p_action:"respond-receipt",p_input:{releaseId:pending.id,response:"Accepted",
            note:"Independently accepted exact fictional Design package"},
          p_command_id:`phase2e-${prefix}-accept-package`,
          p_expected_source_revision:current.revision,
          p_expected_decision_revision:current.record.design.authorityRevision});
        assert(!accepted.error,`${prefix}:accept-package:${accepted.error?.message}`);
      }
      current=await read();
      assert.equal(current.record.design.releases.find((item)=>item.id===pending.id).status,"Accepted");
      outcomes.push({tenant:tenant.workspaceKey,workId:current.record.canonicalWorkId,
        packageId:pkg.packageId,methodRequired:strict,
        prematureRelease:denied?.error?.message??null,releaseStatus:"Accepted",
        versionId:current.record.phaseConfigurationVersionId,browserReceipt});
    }
    return outcomes;
  });
  if(phase2hr) await check("tenant-neutral Design API rejects foreign, wrong-role, forged and stale actions",async()=>{
    const read=async(actor,tenant)=>{
      const result=await call(actor,"d5o_hosted_prototype_read_v1",{
        p_workspace_key:tenant.workspaceKey,p_state_key:"work"});
      assert(!result.error,result.error?.message);
      return {revision:result.data.revision,record:result.data.state.records.find((item)=>
        item.title==="Phase 2D policy qualification")};
    };
    const aWork=await read("a_admin",a),bWork=await read("b_admin",b);
    const page=await designPage("a_admin",a,aWork.record.id);
    const request=async(target,body)=>page.evaluate(async({target,body})=>{
      const response=await fetch(target,{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify(body)});
      return {status:response.status,body:await response.json()};
    },{target,body});
    const base={action:"save-demand",commandId:randomUUID(),sourceRevision:aWork.revision,
      designRevision:aWork.record.design.authorityRevision,
      input:{workId:aWork.record.id,packageId:aWork.record.design.packages[0].packageId,
        qualification:"Service technician",minimumPeople:1,estimatedPersonHours:8,
        priority:"High",requiredSlots:[{date:executionDate,shift:executionShift}]}};
    const cross=await request(`/api/d5o-hosted/customer-design-action?workspace=${b.workspaceKey}`,
      {...base,workId:bWork.record.id});
    assert.equal(cross.status,403,JSON.stringify(cross));
    const forged=await request(`/api/d5o-hosted/customer-design-action?workspace=${a.workspaceKey}`,
      {...base,workId:`forged-${randomUUID()}`});
    assert.equal(forged.status,404,JSON.stringify(forged));
    const stale=await request(`/api/d5o-hosted/customer-design-action?workspace=${a.workspaceKey}`,
      {...base,workId:aWork.record.id,sourceRevision:aWork.revision-1,commandId:randomUUID()});
    assert.equal(stale.status,409,JSON.stringify(stale));
    const financePage=await designPage("a_finance",a,aWork.record.id);
    const wrongRole=await financePage.evaluate(async({workspace,body})=>{
      const response=await fetch(`/api/d5o-hosted/customer-design-action?workspace=${workspace}`,{
        method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      return {status:response.status,body:await response.json()};
    },{workspace:a.workspaceKey,body:{...base,workId:aWork.record.id,commandId:randomUUID()}});
    assert.equal(wrongRole.status,403,JSON.stringify(wrongRole));
    const wrongReviewer=await financePage.evaluate(async({workspace,body})=>{
      const response=await fetch(`/api/d5o-hosted/customer-design-action?workspace=${workspace}`,{
        method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      return {status:response.status,body:await response.json()};
    },{workspace:a.workspaceKey,body:{...base,workId:aWork.record.id,action:"approve-document",
      commandId:randomUUID(),input:{documentId:aWork.record.design.documents[0].id,
        documentRevision:1,evidenceId:aWork.record.design.documents[0].evidenceId,
        note:"Unauthorized independent review attempt"}}});
    assert.equal(wrongReviewer.status,403,JSON.stringify(wrongReviewer));
    const foreignEvidence=await page.evaluate(async({workspace,workId,documentId})=>{
      const query=new URLSearchParams({workspace,workId,documentId,revision:"1"});
      const response=await fetch(`/api/d5o-hosted/design-document-evidence?${query}`);
      return {status:response.status,body:await response.json()};
    },{workspace:b.workspaceKey,workId:bWork.record.id,documentId:bWork.record.design.documents[0].id});
    assert.equal(foreignEvidence.status,403,JSON.stringify(foreignEvidence));
    const final=await read("a_admin",a);
    assert.equal(final.record.design.authorityRevision,aWork.record.design.authorityRevision);
    return {crossTenant:cross.status,forgedWork:forged.status,staleRevision:stale.status,
      wrongRole:wrongRole.status,wrongReviewer:wrongReviewer.status,
      crossTenantEvidence:foreignEvidence.status,
      unchangedDesignRevision:final.record.design.authorityRevision};
  });
  if(phase2hsGateA && !phase2hsGateB) await check("private Design evidence rejects forged, foreign, deleted and unreviewed references",async()=>{
    const tenant=a,owner="a_admin",reviewer="a_ops";
    const read=async()=>{
      const result=await call(owner,"d5o_hosted_prototype_read_v1",{
        p_workspace_key:tenant.workspaceKey,p_state_key:"work"});
      assert(!result.error,result.error?.message);
      return {revision:result.data.revision,record:result.data.state.records.find((item)=>
        item.title==="Phase 2D policy qualification")};
    };
    let current=await read();
    const catalog=await call(owner,"d5o_hosted_prototype_read_v1",{
      p_workspace_key:tenant.workspaceKey,p_state_key:"catalog"});
    assert(!catalog.error,catalog.error?.message);
    const second=await call(owner,"d5o_hosted_create_connected_package_v2",{
      p_workspace_key:tenant.workspaceKey,p_presentation_id:current.record.id,
      p_name:"Synthetic negative-reference package",p_owner:"Fictional Design Lead",
      p_command_id:randomUUID(),p_expected_work_revision:current.revision,
      p_expected_catalog_revision:catalog.data.revision,
      p_expected_handoff_revision:current.record.discovery.designHandoff.revision,
      p_expected_package_count:catalog.data.state.packages
        .filter((item)=>item.workId===current.record.id).length});
    assert(!second.error,`negative-reference-package:${second.error?.message}`);
    const secondPackageId=second.data.created.id;
    current=await read();
    const docId=`negative-ref-${randomUUID()}`;
    const doc=await call(owner,"d5o_hosted_design_draft_command_v1",{
      p_workspace_key:tenant.workspaceKey,p_presentation_id:current.record.id,
      p_action:"save-document",p_input:{document:{id:docId,type:"Method statement",
        title:"Synthetic negative reference review",source:"SYNTHETIC-NEGATIVE-REFERENCE",
        packageIds:[secondPackageId],requirementIds:current.record.definition.scopeControl.requirements
          .filter((item)=>item.state==="Confirmed").map((item)=>item.id),
        dueDate:"2026-12-10"},note:"Isolated evidence boundary test"},
      p_command_id:randomUUID(),p_expected_source_revision:current.revision,
      p_expected_decision_revision:current.record.design.authorityRevision});
    assert(!doc.error,`negative-reference-document:${doc.error?.message}`);
    current=await read();
    const page=await designPage(owner,tenant,current.record.id);
    const pdf=await page.evaluate(async({workspace,workId,documentId})=>{
      const form=new FormData();
      form.append("file",new File(["%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF"],
        "phase2hs-negative.pdf",{type:"application/pdf"}));
      const query=new URLSearchParams({workspace,workId,documentId,revision:"1"});
      const response=await fetch(`/api/d5o-hosted/design-document-evidence?${query}`,{
        method:"POST",body:form});
      return {status:response.status,body:await response.json()};
    },{workspace:tenant.workspaceKey,workId:current.record.id,documentId:docId});
    assert.equal(pdf.status,200,JSON.stringify(pdf));
    const evidenceId=pdf.body.evidenceId;
    const receipt=await admin.rpc("d5o_hosted_design_document_evidence_read_v1",{
      p_workspace_key:tenant.workspaceKey,p_presentation_id:current.record.id,
      p_document_id:docId,p_document_revision:1});
    assert(!receipt.error && receipt.data?.objectPath,"registered private receipt required");
    const privateRead=await page.evaluate(async({workspace,workId,documentId})=>{
      const query=new URLSearchParams({workspace,workId,documentId,revision:"1"});
      const meta=await fetch(`/api/d5o-hosted/design-document-evidence?${query}`);
      const download=await fetch(`/api/d5o-hosted/design-document-evidence?${query}&download=1`);
      return {metadata:meta.status,download:download.status,
        contentType:download.headers.get("content-type"),
        bytes:await download.arrayBuffer().then((value)=>value.byteLength)};
    },{workspace:tenant.workspaceKey,workId:current.record.id,documentId:docId});
    assert.equal(privateRead.metadata,200);
    assert.equal(privateRead.download,200);
    assert.equal(privateRead.contentType,"application/pdf");
    assert(privateRead.bytes>0);
    const bRead=await call("b_admin","d5o_hosted_prototype_read_v1",{
      p_workspace_key:b.workspaceKey,p_state_key:"work"});
    const foreign=bRead.data.state.records.find((item)=>item.title==="Phase 2D policy qualification")
      .design.documents[0].evidenceId;
    const original=current.record.design.documents[0].evidenceId;
    const unregistered=randomUUID();
    const unregisteredPath=`${tenant.workspaceKey}/${createHash("sha256")
      .update(current.record.id).digest("hex")}/design-documents/${unregistered}`;
    const stored=await admin.storage.from("d5o-deploy-evidence").upload(unregisteredPath,
      Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF"),
      {contentType:"application/pdf",upsert:false});
    assert(!stored.error,stored.error?.message);
    const denied=[];
    for(const [kind,badId] of [["nonexistent",randomUUID()],
      ["other-package-and-document",original],["other-tenant-and-work",foreign],
      ["storage-without-receipt",unregistered]]) {
      current=await read();
      const attempted=await page.evaluate(async({workspace,workId,documentId,revision,
        designRevision,evidenceId})=>{
        const response=await fetch(`/api/d5o-hosted/customer-design-action?workspace=${workspace}`,{
          method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({workId,action:"submit-document",commandId:crypto.randomUUID(),
            sourceRevision:revision,designRevision,input:{documentId,
              documentRevision:1,evidenceId,note:"Invalid evidence must not submit"}})});
        return {status:response.status,body:await response.json()};
      },{workspace:tenant.workspaceKey,workId:current.record.id,documentId:docId,
        revision:current.revision,designRevision:current.record.design.authorityRevision,
        evidenceId:badId});
      assert.equal(attempted.status,422,`${kind}:${JSON.stringify(attempted)}`);
      const after=await read();
      assert.equal(after.record.design.authorityRevision,current.record.design.authorityRevision);
      denied.push({kind,status:attempted.status});
    }
    await admin.storage.from("d5o-deploy-evidence").remove([unregisteredPath]);
    current=await read();
    const submitted=await call(owner,"d5o_hosted_design_review_command_v1",{
      p_workspace_key:tenant.workspaceKey,p_presentation_id:current.record.id,
      p_action:"submit-document",p_input:{documentId:docId,documentRevision:1,evidenceId,
        note:"Submit exact private PDF for independent review"},p_command_id:randomUUID(),
      p_expected_source_revision:current.revision,
      p_expected_decision_revision:current.record.design.authorityRevision});
    assert(!submitted.error,submitted.error?.message);
    current=await read();
    const premature=await call(owner,"d5o_hosted_design_review_command_v1",{
      p_workspace_key:tenant.workspaceKey,p_presentation_id:current.record.id,
      p_action:"issue-document",p_input:{documentId:docId,documentRevision:1,evidenceId,
        note:"Premature issue must fail"},p_command_id:randomUUID(),
      p_expected_source_revision:current.revision,
      p_expected_decision_revision:current.record.design.authorityRevision});
    assert.equal(premature.error?.code,"42501");
    const removed=await admin.storage.from("d5o-deploy-evidence").remove([receipt.data.objectPath]);
    assert(!removed.error,removed.error?.message);
    const unavailable=await page.evaluate(async({workspace,workId,documentId})=>{
      const query=new URLSearchParams({workspace,workId,documentId,revision:"1"});
      return (await fetch(`/api/d5o-hosted/design-document-evidence?${query}`)).status;
    },{workspace:tenant.workspaceKey,workId:current.record.id,documentId:docId});
    assert.equal(unavailable,404);
    const deleted=await call(reviewer,"d5o_hosted_design_review_command_v1",{
      p_workspace_key:tenant.workspaceKey,p_presentation_id:current.record.id,
      p_action:"approve-document",p_input:{documentId:docId,documentRevision:1,
        note:"Deleted object must never approve"},p_command_id:randomUUID(),
      p_expected_source_revision:current.revision,
      p_expected_decision_revision:current.record.design.authorityRevision});
    assert.equal(deleted.error?.code,"23514",JSON.stringify(deleted));
    const after=await read();
    assert.equal(after.record.design.authorityRevision,current.record.design.authorityRevision);
    assert.equal(after.record.design.documents.find((item)=>item.id===docId).status,"In review");
    return {privateRead,denied,prematureIssueCode:premature.error.code,
      deletedObjectRead:unavailable,deletedObjectReviewCode:deleted.error.code,
      unchangedRevision:after.record.design.authorityRevision};
  });
  if(!phase2hsGateA || phase2hsGateB) {
  const connectedBasis = async (prefix,tenant) => {
    const workRead=await call(`${prefix}_admin`,"d5o_hosted_prototype_read_v1",{
      p_workspace_key:tenant.workspaceKey,p_state_key:"work"});
    const scheduleRead=await call(`${prefix}_admin`,"d5o_hosted_prototype_read_v1",{
      p_workspace_key:tenant.workspaceKey,p_state_key:"schedule"});
    assert(!workRead.error,workRead.error?.message);
    assert(!scheduleRead.error,scheduleRead.error?.message);
    const work=workRead.data.state.records.find((item)=>item.title==="Phase 2D policy qualification");
    assert(work,`${prefix}:connected-work-missing`);
    const stateRow=(name)=>sql(`select pg_catalog.jsonb_build_object(
      'revision',decision_revision,'state',state)::text from d5o_hosted.${name}
      where workspace_id=${q(tenant.workspaceId)} and work_id=${q(work.canonicalWorkId)};`);
    const deployRow=stateRow("connected_deploy_states");
    const operateRow=stateRow("connected_operate_states");
    return {source:workRead.data,schedule:scheduleRead.data,work,
      packageId:work.design.packages[0].packageId,
      deploy:deployRow?JSON.parse(deployRow):{revision:0,state:{}},
      operate:operateRow?JSON.parse(operateRow):{revision:0,state:{}}};
  };
  const crewCommand=async(prefix,tenant,action,input,id)=>{
    const basis=await connectedBasis(prefix,tenant);
    return call(`${prefix}_admin`,"d5o_hosted_crew_command_v1",{
      p_workspace_key:tenant.workspaceKey,p_action:action,p_input:input,
      p_command_id:`phase2f-${prefix}-${id}`,p_expected_revision:basis.schedule.revision});
  };
  await check("both connected Works receive independent purchase and labor authority",async()=>{
    const outcomes=[];
    const validUntil=new Date(Date.parse(`${executionDate}T12:00:00Z`)+30*86400000)
      .toISOString().slice(0,10);
    for(const [prefix,tenant] of [["a",a],["b",b]]) {
      const basis=await connectedBasis(prefix,tenant);
      if(phase2hsGateB) {
        const validUntil=new Date(Date.parse(`${executionDate}T12:00:00Z`)+30*86400000)
          .toISOString().slice(0,10);
        const fill=async(page,button,values)=>{
          const form=page.locator("form").filter({has:page.getByRole("button",{name:button})});
          for(const [name,value] of Object.entries(values))
            await form.locator(`[name="${name}"]`).fill(String(value));
        };
        await browserDevelopAction(`${prefix}_pm`,tenant,basis.work.id,
          "Submit economic authority",(page)=>fill(page,"Submit economic authority",{
            parentCapMinor:"1000000",purchaseCapMinor:"0",validFrom:executionDate,
            validUntil,purchasingEntity:"Fictional procurement entity",
            graybarAccountReference:`SYNTH-${prefix.toUpperCase()}-NO-PURCHASE`,
            scope:"Labor only fictional service restoration authorization",
            fundingSource:"Fictional customer award funding",
            sourceReference:`SYNTH-${prefix.toUpperCase()}-AWARD`,
            conditions:"No physical purchasing; subcontract capacity remains unused"
          }),"customer-develop-authority");
        await browserDevelopAction(`${prefix}_admin`,tenant,basis.work.id,
          "Approve economic authority",(page)=>fill(page,"Approve economic authority",{
            reason:"Independent approval of fictional labor only parent cap"}),
          "customer-develop-authority");
        await browserDevelopAction(`${prefix}_pm`,tenant,basis.work.id,
          "Submit labor authority",(page)=>fill(page,"Submit labor authority",{
            capMinor:"500000",rateMinor:"10000",rateVersion:"TEST-2026",
            rateSource:"Fictional labor rate card",
            rateBasis:"Hourly rate for qualified service technician",
            scope:"Fictional service restoration and independent inspection",
            conditions:"Only published eligible crew and reviewed hours may consume cap",
            validFrom:executionDate,validUntil
          }),"customer-develop-authority");
        await browserDevelopAction(`${prefix}_admin`,tenant,basis.work.id,
          "Approve labor authority",(page)=>fill(page,"Approve labor authority",{
            reason:"Independent fictional qualified labor authority review"}),
          "customer-develop-authority");
        const purchase=await call(`${prefix}_pm`,"d5o_purchase_authority_read_v1",{
          p_workspace_key:tenant.workspaceKey,p_presentation_id:basis.work.id});
        const labor=await call(`${prefix}_pm`,"d5o_labor_authority_read_v1",{
          p_workspace_key:tenant.workspaceKey,p_presentation_id:basis.work.id});
        assert(!purchase.error && purchase.data.parentCapMinor,`${prefix}:purchase-not-approved`);
        assert(!labor.error && labor.data.laborAuthorityId,`${prefix}:labor-not-approved`);
        outcomes.push({tenant:tenant.workspaceKey,workId:basis.work.canonicalWorkId,
          purchaseAuthorityId:purchase.data.authorities.findLast((item)=>item.status==="Approved")?.id,
          laborAuthorityId:labor.data.laborAuthorityId,browserQualified:true});
        continue;
      }
      const purchasing=await call(`${prefix}_pm`,"d5o_purchase_authority_read_v1",{
        p_workspace_key:tenant.workspaceKey,p_presentation_id:basis.work.id});
      assert(!purchasing.error,`${prefix}:purchase-read:${purchasing.error?.message}`);
      assert(purchasing.data.source?.digest,`${prefix}:funded-source-missing`);
      const parentInput={parentCapMinor:"1000000",purchaseCapMinor:"0",
        subcontractEnabled:true,validFrom:executionDate,validUntil,
        purchasingEntity:"Fictional procurement entity",
        graybarAccountReference:`SYNTH-${prefix.toUpperCase()}-NO-PURCHASE`,
        scope:"Labor only fictional service restoration authorization",
        fundingSource:"Fictional customer award funding",
        sourceReference:`SYNTH-${prefix.toUpperCase()}-AWARD`,
        conditions:"No physical purchasing; subcontract capacity remains unused"};
      const parent=await call(`${prefix}_pm`,"d5o_purchase_authority_command_v1",{
        p_workspace_key:tenant.workspaceKey,p_presentation_id:basis.work.id,
        p_action:"prepare",p_input:parentInput,p_command_id:`phase2f-${prefix}-prepare-parent`,
        p_expected_revision:purchasing.data.revision,
        p_expected_source_digest:purchasing.data.source.digest});
      assert(!parent.error,`${prefix}:parent-prepare:${parent.error?.message}`);
      const parentApproved=await call(`${prefix}_admin`,"d5o_purchase_authority_command_v1",{
        p_workspace_key:tenant.workspaceKey,p_presentation_id:basis.work.id,
        p_action:"approve",p_input:{authorityId:parent.data.subjectId,
          reason:"Independent approval of fictional labor only parent cap"},
        p_command_id:`phase2f-${prefix}-approve-parent`,
        p_expected_revision:parent.data.revision,
        p_expected_source_digest:purchasing.data.source.digest});
      assert(!parentApproved.error,`${prefix}:parent-approve:${parentApproved.error?.message}`);
      const laborRead=await call(`${prefix}_pm`,"d5o_labor_authority_read_v1",{
        p_workspace_key:tenant.workspaceKey,p_presentation_id:basis.work.id});
      assert(!laborRead.error,`${prefix}:labor-read:${laborRead.error?.message}`);
      assert.equal(laborRead.data.parentAuthorityId,parent.data.subjectId);
      const labor=await call(`${prefix}_pm`,"d5o_labor_authority_command_v1",{
        p_workspace_key:tenant.workspaceKey,p_presentation_id:basis.work.id,
        p_action:"prepare",p_input:{capMinor:"500000",rateMinor:"10000",
          rateVersion:"TEST-2026",rateSource:"Fictional labor rate card",
          rateBasis:"Hourly rate for qualified service technician",
          scope:"Fictional service restoration and independent inspection",
          conditions:"Only published eligible crew and reviewed hours may consume cap",
          validFrom:executionDate,validUntil},
        p_command_id:`phase2f-${prefix}-prepare-labor`,
        p_expected_revision:laborRead.data.revision,
        p_expected_source_digest:laborRead.data.source.digest});
      assert(!labor.error,`${prefix}:labor-prepare:${labor.error?.message}`);
      const laborApproved=await call(`${prefix}_admin`,"d5o_labor_authority_command_v1",{
        p_workspace_key:tenant.workspaceKey,p_presentation_id:basis.work.id,
        p_action:"approve",p_input:{authorityId:labor.data.subjectId,
          reason:"Independent fictional qualified labor authority review"},
        p_command_id:`phase2f-${prefix}-approve-labor`,
        p_expected_revision:labor.data.revision,
        p_expected_source_digest:laborRead.data.source.digest});
      assert(!laborApproved.error,`${prefix}:labor-approve:${laborApproved.error?.message}`);
      outcomes.push({tenant:tenant.workspaceKey,workId:basis.work.canonicalWorkId,
        purchaseAuthorityId:parent.data.subjectId,laborAuthorityId:labor.data.subjectId,
        independentApproverId:users[`${prefix}_admin`].id});
    }
    return outcomes;
  });
  await check("both accepted Design packages receive qualified, published and acknowledged crew",async()=>{
    const outcomes=[];
    for(const [prefix,tenant] of [["a",a],["b",b]]) {
      const person=`Fictional ${prefix.toUpperCase()} Technician`;
      const first=await connectedBasis(prefix,tenant);
      const anchor=Date.parse(`${first.schedule.state.anchorDate}T00:00:00Z`);
      const week=Math.floor((Date.parse(`${executionDate}T00:00:00Z`)-anchor)/604800000);
      const day=(new Date(`${executionDate}T12:00:00Z`).getUTCDay()+6)%7;
      const assignment={id:`phase2f-${prefix}-booking`,crew:`Fictional ${prefix.toUpperCase()} crew`,
        people:[person],workId:first.work.id,packageId:first.packageId,week,day,
        date:executionDate,shift:executionShift,personHoursPerWorker:2};
      const unqualified=await crewCommand(prefix,tenant,"save-booking",{assignment},"unqualified-booking");
      assert.equal(unqualified.error?.code,"23514",`${prefix}:unqualified:${unqualified.error?.message}`);
      const workforce=await call(`${prefix}_admin`,"d5o_hosted_workforce_read_v1",{
        p_workspace_key:tenant.workspaceKey});
      assert(!workforce.error,`${prefix}:workforce-read:${workforce.error?.message}`);
      const profile=await call(`${prefix}_admin`,"d5o_hosted_workforce_impact_command_v1",{
        p_workspace_key:tenant.workspaceKey,p_action:"save-person",
        p_input:{person,displayName:person,qualifications:["Service technician"],
          weeklyCapacityHours:40},p_command_id:`phase2f-${prefix}-qualified-worker`,
        p_expected_revision:workforce.data.revision,
        p_expected_schedule_revision:first.schedule.revision});
      assert(!profile.error,`${prefix}:profile:${profile.error?.message}`);
      const bound=await call(`${prefix}_admin`,"d5o_hosted_workforce_impact_command_v1",{
        p_workspace_key:tenant.workspaceKey,p_action:"bind-person",
        p_input:{id:profile.data.id,email:users[`${prefix}_worker`].email},
        p_command_id:`phase2f-${prefix}-bind-worker`,
        p_expected_revision:profile.data.revision,
        p_expected_schedule_revision:first.schedule.revision});
      assert(!bound.error,`${prefix}:bind:${bound.error?.message}`);
      if(phase2hsGateB) {
        const current=await connectedBasis(prefix,tenant);
        const blocked=await call(`${prefix}_admin`,"d5o_hosted_availability_command_v1",{
          p_workspace_key:tenant.workspaceKey,p_action:"record-unavailability",
          p_input:{person,week,day,date:executionDate,note:"Synthetic absence denial probe"},
          p_command_id:randomUUID(),p_expected_revision:current.schedule.revision});
        assert(!blocked.error,`${prefix}:absence:${blocked.error?.message}`);
        const unavailable=await crewCommand(prefix,tenant,"save-booking",{assignment},"unavailable-booking");
        assert.equal(unavailable.error?.code,"23514",`${prefix}:unavailable:${unavailable.error?.message}`);
        assert.match(unavailable.error.message,/worker_unavailable_for_shift/);
        const block=blocked.data.state.availabilityBlocks.find((item)=>item.person===person
          && item.date===executionDate);
        assert(block,`${prefix}:absence-record-missing`);
        const cleared=await call(`${prefix}_admin`,"d5o_hosted_availability_command_v1",{
          p_workspace_key:tenant.workspaceKey,p_action:"clear-unavailability",
          p_input:{id:block.id},p_command_id:randomUUID(),
          p_expected_revision:blocked.data.revision});
        assert(!cleared.error,`${prefix}:clear-absence:${cleared.error?.message}`);
        const low=await call(`${prefix}_admin`,"d5o_hosted_workforce_impact_command_v1",{
          p_workspace_key:tenant.workspaceKey,p_action:"save-person",
          p_input:{id:profile.data.id,person,displayName:person,
            qualifications:["Service technician"],weeklyCapacityHours:1},
          p_command_id:randomUUID(),p_expected_revision:bound.data.revision,
          p_expected_schedule_revision:cleared.data.revision});
        assert(!low.error,`${prefix}:low-capacity:${low.error?.message}`);
        const insufficient=await crewCommand(prefix,tenant,"save-booking",{assignment},"capacity-booking");
        assert.equal(insufficient.error?.code,"23514",`${prefix}:capacity:${insufficient.error?.message}`);
        assert.match(insufficient.error.message,/worker_weekly_capacity_exceeded/);
        const restored=await call(`${prefix}_admin`,"d5o_hosted_workforce_impact_command_v1",{
          p_workspace_key:tenant.workspaceKey,p_action:"save-person",
          p_input:{id:profile.data.id,person,displayName:person,
            qualifications:["Service technician"],weeklyCapacityHours:40},
          p_command_id:randomUUID(),p_expected_revision:low.data.revision,
          p_expected_schedule_revision:cleared.data.revision});
        assert(!restored.error,`${prefix}:restore-capacity:${restored.error?.message}`);
      }
      if(phase2hsGateB) {
        await browserDevelopAction(`${prefix}_ops`,tenant,first.work.id,
          "Save crew booking",async(page)=>{
            const form=page.locator("form").filter({has:page.getByRole("button",{name:"Save crew booking"})});
            await form.locator("select").selectOption([person]);
          });
        await browserDevelopAction(`${prefix}_ops`,tenant,first.work.id,"Publish crew week");
      } else {
        const booked=await crewCommand(prefix,tenant,"save-booking",{assignment},"save-booking");
        assert(!booked.error,`${prefix}:booking:${booked.error?.message}`);
        const published=await crewCommand(prefix,tenant,"publish-week",{week},"publish-week");
        assert(!published.error,`${prefix}:publish:${published.error?.message}`);
      }
      const current=await connectedBasis(prefix,tenant);
      const publication=current.schedule.state.publications.at(-1);
      const assigned=publication?.assignments.find((item)=>item.workId===first.work.id
        && item.packageId===first.packageId);
      assert(assigned,`${prefix}:published-assignment-missing`);
      if(phase2hsGateB) {
        if(!designBrowser) designBrowser=await chromium.launch();
        const actor=`${prefix}_worker`;
        let page=designPages.get(actor);
        if(!page) {
          page=await designBrowser.newPage({viewport:{width:1440,height:900}});
          await page.goto(`http://127.0.0.1:${server.port}/auth/sign-in`);
          await page.getByLabel("Email").fill(users[actor].email);
          await page.getByLabel("Password").fill(users[actor].password);
          await page.getByRole("button",{name:"Continue to your work"}).click();
          await page.waitForURL((location)=>!location.pathname.startsWith("/auth/sign-in"),{timeout:30000});
          designPages.set(actor,page);
        }
        await page.goto(`http://127.0.0.1:${server.port}/work/customer/${tenant.workspaceKey}/assignments`);
        const control=page.getByRole("button",{name:"Acknowledge assignment"});
        await control.waitFor({state:"visible",timeout:30000});
        const [ackResponse]=await Promise.all([
          page.waitForResponse((item)=>item.url().includes("/api/d5o-hosted/customer-develop-action")
            && item.request().method()==="POST",{timeout:30000}),control.click()]);
        const result=await ackResponse.json();
        assert.equal(ackResponse.status(),200,`${prefix}:browser-ack:${JSON.stringify(result)}`);
        await page.reload();
        await page.getByText("Acknowledged by you").waitFor({timeout:30000});
        const dir=resolve(root,"docs/architecture/evidence/phase2hs-develop-browser");
        mkdirSync(dir,{recursive:true});
        const screenshot=`${actor}-acknowledged-assignment.png`;
        await page.screenshot({path:resolve(dir,screenshot),fullPage:true});
        developActionEvidence.push({tenant:tenant.workspaceKey,workId:first.work.id,actor,
          button:"Acknowledge assignment",origin:"authenticated_browser_control",
          httpStatus:ackResponse.status(),commandId:ackResponse.request().postDataJSON().commandId,
          result:result.result??null,screenshot,timestamp:new Date().toISOString()});
      } else {
        const response=await call(`${prefix}_worker`,"d5o_hosted_crew_command_v1",{
          p_workspace_key:tenant.workspaceKey,p_action:"respond-booking",
          p_input:{publicationId:publication.id,assignmentId:assigned.id,response:"acknowledged"},
          p_command_id:`phase2f-${prefix}-acknowledge-booking`,
          p_expected_revision:current.schedule.revision});
        assert(!response.error,`${prefix}:acknowledge:${response.error?.message}`);
      }
      outcomes.push({tenant:tenant.workspaceKey,workId:first.work.canonicalWorkId,
        packageId:first.packageId,bookingId:assigned.id,publicationId:publication.id,
        workerId:users[`${prefix}_worker`].id,unqualifiedDenied:true});
    }
    return outcomes;
  });
  const fieldStart=async(prefix,tenant,actor,id)=>{
    const basis=await connectedBasis(prefix,tenant);
    return call(actor,"d5o_hosted_field_start_command_v1",{
      p_workspace_key:tenant.workspaceKey,p_presentation_id:basis.work.id,
      p_package_id:basis.packageId,p_action:"authorize-start",
      p_reason:"Qualified crew and current accepted package checked for fictional field work",
      p_command_id:`phase2f-${prefix}-${id}`,
      p_expected_source_revision:basis.source.revision,
      p_expected_design_revision:basis.work.design.authorityRevision,
      p_expected_schedule_revision:basis.schedule.revision,
      p_expected_deploy_revision:basis.deploy.revision});
  };
  await check("both tenants authorize current published Work through field-start command",async()=>{
    const outcomes=[];
    for(const [prefix,tenant] of [["a",a],["b",b]]) {
      const basis=await connectedBasis(prefix,tenant);
      const designState=JSON.parse(sql(`select state::text from d5o_hosted.connected_design_states
        where workspace_id=${q(tenant.workspaceId)} and work_id=${q(basis.work.canonicalWorkId)};`));
      const release=designState.releases.find((item)=>
        item.packageId===basis.packageId && item.status==="Accepted");
      assert(release?.crewDemandSnapshot?.requiredSlots?.some((slot)=>
        slot.date===executionDate && slot.shift===executionShift),
        `${prefix}:release-demand-mismatch:${JSON.stringify(release)}:${executionDate}:${executionShift}`);
      assert.equal(release?.snapshot?.windowStart,executionDate,
        `${prefix}:release-window:${JSON.stringify(release?.snapshot)}`);
      const unauthorized=await fieldStart(prefix,tenant,`${prefix}_admin`,"unauthorized-start");
      assert.equal(unauthorized.error?.code,"42501",`${prefix}:unauthorized:${unauthorized.error?.message}`);
      const cross=await fieldStart(prefix,tenant,`${prefix==="a"?"b":"a"}_ops`,"cross-start");
      assert.equal(cross.error?.code,"42501",`${prefix}:cross:${cross.error?.message}`);
      if(phase2hsGateB) {
        await browserDevelopAction(`${prefix}_ops`,tenant,basis.work.id,
          "Authorize field start",async(page)=>{
            const form=page.locator("form").filter({has:page.getByRole("button",{name:"Authorize field start"})});
            await form.locator("textarea").fill(
              "Qualified crew and current accepted package checked for fictional field work");
          });
      } else {
        const authorized=await fieldStart(prefix,tenant,`${prefix}_ops`,"authorize-start");
        assert(!authorized.error,`${prefix}:field-start:${authorized.error?.message}`);
      }
      const current=await connectedBasis(prefix,tenant);
      const permit=current.deploy.state.permits?.find((item)=>
        item.packageId===current.packageId && item.status==="Authorized");
      assert(permit,`${prefix}:permit-missing`);
      assert.equal(current.work.phaseConfigurationVersionId,versions[`${prefix}_admin`]);
      if(phase2hsGateB) {
        const status=await call(`${prefix}_ops`,"d5o_hosted_phase_status_read_v1",{
          p_workspace_key:tenant.workspaceKey,p_presentation_id:basis.work.id});
        assert(!status.error,`${prefix}:phase-status:${status.error?.message}`);
        assert.equal(status.data.projection.phases.Develop.status,"completed");
        assert.equal(status.data.replayMatches,true);
        const page=designPages.get(`${prefix}_worker`);
        await page.reload();
        await page.getByText("Your next responsibility is Deploy execution",{exact:false})
          .waitFor({timeout:30000});
        const dir=resolve(root,"docs/architecture/evidence/phase2hs-develop-browser");
        await page.screenshot({path:resolve(dir,`${prefix}-deploy-responsibility.png`),fullPage:true});
      }
      outcomes.push({tenant:tenant.workspaceKey,workId:current.work.canonicalWorkId,
        permitId:permit.id,releaseId:permit.releaseId,configurationVersionId:current.work.phaseConfigurationVersionId,
        unauthorizedDenied:true,crossTenantDenied:true});
    }
    return outcomes;
  });
  if(phase2hsGateB) await check("Develop API and direct RPC reject forged, cross-tenant, stale and disabled-feature mutations",async()=>{
    const aBasis=await connectedBasis("a",a);
    const bBasis=await connectedBasis("b",b);
    const bPage=designPages.get("b_ops");
    const aPage=designPages.get("a_ops");
    assert(aPage&&bPage,"authenticated Develop actor pages required");
    const cross=await bPage.evaluate(async({workspace,workId})=>{
      const response=await fetch(`/api/d5o-hosted/customer-develop-action?workspace=${workspace}&workId=${workId}`);
      return {status:response.status,body:await response.json()};
    },{workspace:a.workspaceKey,workId:aBasis.work.id});
    assert.equal(cross.status,403,JSON.stringify(cross));
    const forged=await bPage.evaluate(async({workspace,packageId,revision})=>{
      const response=await fetch(`/api/d5o-hosted/customer-develop-action?workspace=${workspace}`,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({action:"publish-week",workId:"00000000-0000-0000-0000-000000000000",
          packageId,week:0,expectedRevision:revision,commandId:crypto.randomUUID()})});
      return {status:response.status,body:await response.json()};
    },{workspace:b.workspaceKey,packageId:bBasis.packageId,revision:bBasis.schedule.revision});
    assert.equal(forged.status,404,JSON.stringify(forged));
    const wrongPackage=await bPage.evaluate(async({workspace,workId,revision})=>{
      const response=await fetch(`/api/d5o-hosted/customer-develop-action?workspace=${workspace}`,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({action:"publish-week",workId,
          packageId:"00000000-0000-0000-0000-000000000000",week:0,
          expectedRevision:revision,commandId:crypto.randomUUID()})});
      return {status:response.status,body:await response.json()};
    },{workspace:b.workspaceKey,workId:bBasis.work.id,revision:bBasis.schedule.revision});
    assert.equal(wrongPackage.status,409,JSON.stringify(wrongPackage));
    const aScheduleBefore=aBasis.schedule.revision;
    const day=(new Date(`${executionDate}T12:00:00Z`).getUTCDay()+6)%7;
    const week=Math.floor((Date.parse(`${executionDate}T00:00:00Z`)
      -Date.parse(`${aBasis.schedule.state.anchorDate}T00:00:00Z`))/604800000);
    const foreignResource=await crewCommand("a",a,"save-booking",{
      assignment:{id:`cross-tenant-worker-${randomUUID()}`,
        crew:"Forbidden cross-tenant crew",people:["Fictional B Technician"],
        workId:aBasis.work.id,packageId:aBasis.packageId,week,day,
        date:executionDate,shift:executionShift,personHoursPerWorker:2}
    },"foreign-worker-booking");
    assert.equal(foreignResource.error?.code,"23514",JSON.stringify(foreignResource));
    assert.match(foreignResource.error.message,/qualified_bound_worker_required/);
    assert.equal((await connectedBasis("a",a)).schedule.revision,aScheduleBefore);
    const stale=await call("b_admin","d5o_hosted_crew_command_v1",{
      p_workspace_key:b.workspaceKey,p_action:"publish-week",p_input:{week:0},
      p_command_id:randomUUID(),p_expected_revision:bBasis.schedule.revision-1});
    assert.equal(stale.error?.code,"23505",JSON.stringify(stale));
    const permitAction=developActionEvidence.find((item)=>item.actor==="a_ops"
      && item.button==="Authorize field start");
    assert(permitAction?.request,"browser field-start command receipt missing");
    const duplicate=await aPage.evaluate(async({workspace,request})=>{
      const response=await fetch(`/api/d5o-hosted/customer-develop-action?workspace=${workspace}`,{
        method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(request)});
      return {status:response.status,body:await response.json()};
    },{workspace:a.workspaceKey,request:permitAction.request});
    assert.equal(duplicate.status,200,JSON.stringify(duplicate));
    const aAfterReplay=await connectedBasis("a",a);
    assert.equal(aAfterReplay.deploy.revision,aBasis.deploy.revision,
      "duplicate field-start changed authoritative Deploy revision");
    const directory=await call("vendor","d5o_platform_provisioning_directory_v1");
    assert(!directory.error,directory.error?.message);
    const tenant=directory.data.find((item)=>item.workspaceKey===b.workspaceKey);
    const off=await call("vendor","d5o_platform_capability_command_v1",{
      p_workspace_key:b.workspaceKey,p_kind:"flag",p_enabled:false,
      p_expected_revision:tenant.connectedWorkFlagRevision,p_command_id:randomUUID(),
      p_reason:"Deny direct Develop command while synthetic rollout is disabled"});
    assert(!off.error,off.error?.message);
    const workforce=await call("b_admin","d5o_hosted_workforce_read_v1",{
      p_workspace_key:b.workspaceKey});
    assert(!workforce.error,workforce.error?.message);
    const direct=await call("b_admin","d5o_hosted_workforce_impact_command_v1",{
      p_workspace_key:b.workspaceKey,p_action:"save-person",
      p_input:{person:"Forbidden disabled resource",displayName:"Forbidden disabled resource",
        qualifications:["Service technician"],weeklyCapacityHours:40},
      p_command_id:randomUUID(),p_expected_revision:workforce.data.revision,
      p_expected_schedule_revision:bBasis.schedule.revision});
    assert.equal(direct.error?.code,"42501",JSON.stringify(direct));
    const disabled=await bPage.evaluate(async({workspace,workId})=>{
      const response=await fetch(`/api/d5o-hosted/customer-develop-action?workspace=${workspace}&workId=${workId}`);
      return {status:response.status,body:await response.json()};
    },{workspace:b.workspaceKey,workId:bBasis.work.id});
    assert.equal(disabled.status,403,JSON.stringify(disabled));
    const afterWorkforce=await call("b_admin","d5o_hosted_workforce_read_v1",{
      p_workspace_key:b.workspaceKey});
    assert.equal(afterWorkforce.data.revision,workforce.data.revision);
    const on=await call("vendor","d5o_platform_capability_command_v1",{
      p_workspace_key:b.workspaceKey,p_kind:"flag",p_enabled:true,
      p_expected_revision:off.data.revision,p_command_id:randomUUID(),
      p_reason:"Restore synthetic rollout after disabled Develop command test"});
    assert(!on.error,on.error?.message);
    return {crossTenantHttp:cross.status,forgedWorkHttp:forged.status,
      wrongPackageHttp:wrongPackage.status,foreignResourceRpc:foreignResource.error.code,
      staleSchedulingRpc:stale.error.code,duplicateStartHttp:duplicate.status,
      unchangedDeployRevision:aAfterReplay.deploy.revision,
      disabledFeatureRpc:direct.error.code,disabledFeatureHttp:disabled.status,
      unchangedWorkforceRevision:afterWorkforce.data.revision};
  });
  if(!phase2hsGateB) {
  const deployCommand=async(prefix,tenant,actor,action,input,id,
    functionName="d5o_hosted_field_fact_command_v1")=>{
    const basis=await connectedBasis(prefix,tenant);
    return call(actor,functionName,{
      p_workspace_key:tenant.workspaceKey,p_presentation_id:basis.work.id,
      p_package_id:basis.packageId,p_action:action,p_input:input,
      p_command_id:`phase2f-${prefix}-${id}`,
      p_expected_source_revision:basis.source.revision,
      p_expected_design_revision:basis.work.design.authorityRevision,
      p_expected_schedule_revision:basis.schedule.revision,
      p_expected_deploy_revision:basis.deploy.revision});
  };
  await check("Deploy completion enforces reviewed evidence only for the pinned strict tenant",async()=>{
    const outcomes=[];
    for(const [prefix,tenant] of [["a",a],["b",b]]) {
      const first=await connectedBasis(prefix,tenant);
      const booking=first.schedule.state.publications.at(-1).assignments.find((item)=>
        item.packageId===first.packageId && item.workId===first.work.id);
      const release=first.work.design.releases.find((item)=>
        item.packageId===first.packageId && item.status==="Accepted");
      assert(booking && release,`${prefix}:published-execution-basis-missing`);
      const direct=await deployCommand(prefix,tenant,`${prefix}_worker`,"review-completion",{
        note:"Worker cannot authorize an unreviewed fictional completion"},"worker-completion-denied");
      assert.equal(direct.error?.code,"42501",`${prefix}:worker-completion:${direct.error?.message}`);
      const saved=await deployCommand(prefix,tenant,`${prefix}_worker`,"save-report",{
        bookingId:booking.id,quantity:1,unit:"service",laborHours:2,
        summary:"Fictional service restoration completed and tested"},"save-field-report");
      assert(!saved.error,`${prefix}:save-report:${saved.error?.message}`);
      let current=await connectedBasis(prefix,tenant);
      const report=current.deploy.state.reports.find((item)=>item.packageId===current.packageId);
      assert(report,`${prefix}:report-missing`);
      const submitted=await deployCommand(prefix,tenant,`${prefix}_worker`,"submit-report",{
        bookingId:booking.id,reportId:report.id},"submit-field-report");
      assert(!submitted.error,`${prefix}:submit-report:${submitted.error?.message}`);
      const reviewed=await deployCommand(prefix,tenant,`${prefix}_ops`,"review-report",{
        reportId:report.id,decision:"Reviewed",
        note:"Independent review of measured fictional service restoration"},"review-field-report");
      assert(!reviewed.error,`${prefix}:review-report:${reviewed.error?.message}`);
      for(const [index,requirementId] of release.snapshot.requirementIds.entries()) {
        const recorded=await deployCommand(prefix,tenant,`${prefix}_worker`,"record-inspection",{
          bookingId:booking.id,reportId:report.id,requirementId,result:"Pass",
          method:"Functional service restoration check",
          note:`Fictional requirement ${index+1} passed`},`inspection-${index}`);
        assert(!recorded.error,`${prefix}:inspection-${index}:${recorded.error?.message}`);
        current=await connectedBasis(prefix,tenant);
        const inspection=current.deploy.state.inspections.find((item)=>
          item.requirementId===requirementId && item.status==="Submitted");
        assert(inspection,`${prefix}:inspection-${index}-missing`);
        const verified=await deployCommand(prefix,tenant,`${prefix}_ops`,"review-inspection",{
          inspectionId:inspection.id,decision:"Verified",
          note:`Independent verification of fictional requirement ${index+1}`},
          `verify-inspection-${index}`);
        assert(!verified.error,`${prefix}:verify-${index}:${verified.error?.message}`);
      }
      const noEvidence=await deployCommand(prefix,tenant,`${prefix}_ops`,"review-completion",{
        note:"Review complete measured scope before additional photo"},"completion-without-evidence");
      if(prefix==="a") {
        assert.equal(noEvidence.error?.message,"reviewed_evidence_required",
          `${prefix}:policy-denial:${noEvidence.error?.message}`);
        const evidenceId=randomUUID();
        const bytes=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRxkAAAAASUVORK5CYII=","base64");
        const path=`${tenant.workspaceKey}/${createHash("sha256").update(first.work.id).digest("hex")}/${evidenceId}`;
        const uploaded=await admin.storage.from("d5o-deploy-evidence").upload(path,bytes,
          {contentType:"image/png",upsert:false});
        assert(!uploaded.error,`${prefix}:upload:${uploaded.error?.message}`);
        const registered=await deployCommand(prefix,tenant,`${prefix}_worker`,"register-upload",{
          bookingId:booking.id,evidenceId,purpose:"Inspection result",
          caption:"Fictional service completion photograph",filename:"fictional-service.png",
          checksumSha256:createHash("sha256").update(bytes).digest("hex")},
          "register-evidence","d5o_hosted_field_evidence_command_v1");
        assert(!registered.error,`${prefix}:register-evidence:${registered.error?.message}`);
        const reviewedEvidence=await deployCommand(prefix,tenant,`${prefix}_ops`,"review-evidence",{
          evidenceId,decision:"Reviewed",
          note:"Independent review of fictional completion photograph"},
          "review-evidence","d5o_hosted_field_evidence_command_v1");
        assert(!reviewedEvidence.error,`${prefix}:review-evidence:${reviewedEvidence.error?.message}`);
      } else assert(!noEvidence.error,`${prefix}:optional-completion:${noEvidence.error?.message}`);
      const complete=prefix==="a"?await deployCommand(prefix,tenant,`${prefix}_ops`,"review-completion",{
        note:"Measured scope and independently reviewed evidence complete"},"review-completion"):noEvidence;
      assert(!complete.error,`${prefix}:completion:${complete.error?.message}`);
      current=await connectedBasis(prefix,tenant);
      const completion=current.deploy.state.completions.find((item)=>
        item.packageId===current.packageId && item.status==="Reviewed");
      assert(completion,`${prefix}:completion-missing`);
      assert.equal(current.work.phaseConfigurationVersionId,versions[`${prefix}_admin`]);
      outcomes.push({tenant:tenant.workspaceKey,workId:current.work.canonicalWorkId,
        packageId:current.packageId,completionId:completion.id,
        policyRejection:prefix==="a"?noEvidence.error.message:null,
        optionalPolicy:prefix==="b",configurationVersionId:current.work.phaseConfigurationVersionId});
    }
    return outcomes;
  });
  const acceptanceCommand=async(prefix,tenant,actor,action,input,id)=>{
    const basis=await connectedBasis(prefix,tenant);
    return call(actor,"d5o_hosted_acceptance_command_v1",{
      p_workspace_key:tenant.workspaceKey,p_presentation_id:basis.work.id,
      p_package_id:action==="accept-work" || action==="respond-operate-work"?"":basis.packageId,
      p_action:action,p_input:input,p_command_id:`phase2f-${prefix}-${id}`,
      p_expected_source_revision:basis.source.revision,
      p_expected_design_revision:basis.work.design.authorityRevision,
      p_expected_deploy_revision:basis.deploy.revision});
  };
  const registerCustomerEvidence=async(prefix,tenant,purpose,scopeId,scopeRevision,basis)=>{
    const current=await connectedBasis(prefix,tenant);
    const evidenceId=randomUUID();
    const bytes=Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF");
    const path=`${tenant.workspaceKey}/${createHash("sha256").update(current.work.id).digest("hex")}`+
      `/customer-decisions/${evidenceId}`;
    const uploaded=await admin.storage.from("d5o-deploy-evidence").upload(path,bytes,
      {contentType:"application/pdf",upsert:false});
    assert(!uploaded.error,`${prefix}:${purpose}:upload:${uploaded.error?.message}`);
    const registered=await admin.rpc("d5o_hosted_register_customer_decision_evidence_v1",{
      p_workspace_key:tenant.workspaceKey,p_presentation_id:current.work.id,
      p_evidence_id:evidenceId,p_purpose:purpose,p_scope_id:scopeId,
      p_scope_revision:scopeRevision,p_basis:basis,
      p_checksum_sha256:createHash("sha256").update(bytes).digest("hex"),
      p_filename:`synthetic-${purpose}.pdf`,p_uploader_id:users[`${prefix}_ops2`].id});
    assert(!registered.error,`${prefix}:${purpose}:register:${registered.error?.message}`);
    return evidenceId;
  };
  await check("both tenants capture independent customer and Operations acceptance",async()=>{
    const outcomes=[];
    for(const [prefix,tenant] of [["a",a],["b",b]]) {
      const assembled=await acceptanceCommand(prefix,tenant,`${prefix}_pm`,"assemble-turnover",{
        obligations:"Review as-built and inspection documentation for fictional support"},
        "assemble-turnover");
      assert(!assembled.error,`${prefix}:assemble:${assembled.error?.message}`);
      let current=await connectedBasis(prefix,tenant);
      const turnover=current.deploy.state.turnovers.find((item)=>item.packageId===current.packageId);
      assert(turnover,`${prefix}:turnover-missing`);
      const designState=JSON.parse(sql(`select pg_catalog.jsonb_build_object(
        'revision',decision_revision,'state',state)::text from d5o_hosted.connected_design_states
        where workspace_id=${q(tenant.workspaceId)} and work_id=${q(current.work.canonicalWorkId)};`));
      const release=designState.state.releases.find((item)=>
        item.packageId===current.packageId && item.status==="Accepted");
      const packageEvidenceId=await registerCustomerEvidence(prefix,tenant,"package-acceptance",
        turnover.id,turnover.revision,
        {releaseIds:turnover.releaseIds,designRevision:designState.revision});
      const accepted=await acceptanceCommand(prefix,tenant,`${prefix}_ops2`,"accept-client",{
        turnoverId:turnover.id,signerName:"Fictional Customer Representative",
        signerOrganization:"Fictional Customer",authorityBasis:"Isolated fictional customer authority record",
        signerRole:"Fictional customer approver",evidenceId:packageEvidenceId},
        "accept-client-package");
      assert(!accepted.error,`${prefix}:client-accept:${accepted.error?.message}`);
      const receipt=await acceptanceCommand(prefix,tenant,`${prefix}_ops`,"respond-operate",{
        turnoverId:turnover.id,decision:"Accepted",
        note:"Independent Operations receipt of exact fictional package turnover"},
        "receive-package");
      assert(!receipt.error,`${prefix}:package-receipt:${receipt.error?.message}`);
      const workEvidenceId=await registerCustomerEvidence(prefix,tenant,"work-acceptance",
        current.work.id,1,{turnoverIds:[turnover.id],releaseIds:[release.id],
          designRevision:designState.revision});
      const whole=await acceptanceCommand(prefix,tenant,`${prefix}_ops2`,"accept-work",{
        signerName:"Fictional Customer Representative",signerOrganization:"Fictional Customer",
        signerRole:"Fictional site reviewer",authorityBasis:"Isolated fictional customer authority record",
        evidenceId:workEvidenceId},
        "accept-whole-work");
      assert(!whole.error,`${prefix}:whole-work:${whole.error?.message}`);
      const workReceipt=await acceptanceCommand(prefix,tenant,`${prefix}_ops`,
        "respond-operate-work",{decision:"Accepted",
          note:"Independent Operations receipt of fictional accepted Work"},"receive-whole-work");
      assert(!workReceipt.error,`${prefix}:whole-receipt:${workReceipt.error?.message}`);
      current=await connectedBasis(prefix,tenant);
      assert.equal(current.deploy.state.workAcceptance.receipt,"Accepted");
      outcomes.push({tenant:tenant.workspaceKey,workId:current.work.canonicalWorkId,
        turnoverId:turnover.id,workAcceptanceId:current.deploy.state.workAcceptance.id,
        customerRecorderId:users[`${prefix}_ops2`].id,
        independentReceiverId:users[`${prefix}_ops`].id});
    }
    return outcomes;
  });
  const operateCommand=async(prefix,tenant,actor,action,input,id)=>{
    const basis=await connectedBasis(prefix,tenant);
    return call(actor,"d5o_hosted_operate_command_v1",{
      p_workspace_key:tenant.workspaceKey,p_presentation_id:basis.work.id,
      p_action:action,p_input:input,p_command_id:`phase2f-${prefix}-${id}`,
      p_expected_source_revision:basis.source.revision,
      p_expected_deploy_revision:basis.deploy.revision,
      p_expected_operate_revision:basis.operate.revision});
  };
  await check("Operate support acceptance follows exact Deploy receipt and pinned documentation policy",async()=>{
    const outcomes=[];
    for(const [prefix,tenant] of [["a",a],["b",b]]) {
      let current=await connectedBasis(prefix,tenant);
      const acceptance=current.deploy.state.workAcceptance;
      const premature=await operateCommand(prefix,tenant,`${prefix}_ops`,"accept-support",{
        escalation:"Fictional support escalation",intakeRoute:"Fictional service intake"},
        "premature-support");
      assert(premature.error,`${prefix}:premature-support-not-denied`);
      const received=await operateCommand(prefix,tenant,`${prefix}_ops`,"receive-handoff",{
        workAcceptanceId:acceptance.id,workAcceptanceRevision:acceptance.revision,
        note:"Operations receives exact accepted fictional Deploy turnover"},"receive-handoff");
      assert(!received.error,`${prefix}:receive-handoff:${received.error?.message}`);
      const asset=await operateCommand(prefix,tenant,`${prefix}_pm`,"add-asset",{
        name:`Fictional ${prefix.toUpperCase()} restored service asset`,kind:"Service asset",
        location:"Fictional service site",externalId:`SYNTH-PHASE2F-${prefix.toUpperCase()}-ASSET`,
        owner:"Fictional Operations receiver",
        documentation:"Accepted fictional Work turnover and inspection record"},"add-asset");
      assert(!asset.error,`${prefix}:add-asset:${asset.error?.message}`);
      const support={customerContact:"Fictional Customer Representative",
        escalation:"Fictional support escalation queue",intakeRoute:"Fictional service intake route",
        warrantyDisposition:"Warranty subject to separate recorded terms",
        serviceDisposition:"Service coverage requires independent approval",
        residualOwner:"Fictional Operations receiver"};
      const withoutReview=await operateCommand(prefix,tenant,`${prefix}_ops`,"accept-support",
        support,"accept-support-without-review");
      if(prefix==="a") assert.equal(withoutReview.error?.message,"support_document_review_required",
        `${prefix}:documentation-denial:${withoutReview.error?.message}`);
      else assert(!withoutReview.error,`${prefix}:optional-support:${withoutReview.error?.message}`);
      if(prefix==="a") {
        current=await connectedBasis(prefix,tenant);
        const turnover=current.deploy.state.turnovers.find((item)=>
          item.packageId===current.packageId && item.receipt==="Accepted");
        const release=current.work.design.releases.find((item)=>
          item.packageId===current.packageId && item.status==="Accepted");
        assert(turnover && release,`${prefix}:support-document-basis-missing`);
        const documentId=randomUUID();
        const documentBytes=Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF");
        const path=`${tenant.workspaceKey}/${createHash("sha256").update(current.work.id).digest("hex")}`+
          `/customer-decisions/${documentId}`;
        const uploaded=await admin.storage.from("d5o-deploy-evidence").upload(path,documentBytes,
          {contentType:"application/pdf",upsert:false});
        assert(!uploaded.error,`${prefix}:support-upload:${uploaded.error?.message}`);
        const basis={turnoverId:turnover.id,turnoverRevision:turnover.revision,
          packageId:current.packageId,releaseId:release.id,releaseRevision:release.packageRevision,
          workAcceptanceId:acceptance.id,workAcceptanceRevision:acceptance.revision,kind:"as-built"};
        const registered=await admin.rpc("d5o_hosted_register_support_document_v1",{
          p_workspace_key:tenant.workspaceKey,p_presentation_id:current.work.id,
          p_evidence_id:documentId,p_turnover_id:turnover.id,p_kind:"as-built",
          p_basis:basis,p_checksum_sha256:createHash("sha256").update(documentBytes).digest("hex"),
          p_filename:"fictional-as-built.pdf",p_uploader_id:users[`${prefix}_pm`].id});
        assert(!registered.error,`${prefix}:register-support:${registered.error?.message}`);
        const supportDocument=async(actor,action,id,decision=null)=>{
          const fresh=await connectedBasis(prefix,tenant);
          return call(actor,"d5o_hosted_support_document_command_v1",{
            p_workspace_key:tenant.workspaceKey,p_presentation_id:fresh.work.id,
            p_action:action,p_turnover_id:turnover.id,p_kind:"as-built",
            p_evidence_id:documentId,p_decision:decision,
            p_note:"Independent fictional support documentation review",
            p_command_id:`phase2f-${prefix}-${id}`,
            p_expected_source_revision:fresh.source.revision,
            p_expected_deploy_revision:fresh.deploy.revision,
            p_expected_operate_revision:fresh.operate.revision});
        };
        const submitted=await supportDocument(`${prefix}_pm`,"submit","submit-support-document");
        assert(!submitted.error,`${prefix}:submit-support:${submitted.error?.message}`);
        const reviewedDoc=await supportDocument(`${prefix}_ops2`,"review","review-support-document","Reviewed");
        assert(!reviewedDoc.error,`${prefix}:review-support:${reviewedDoc.error?.message}`);
        const reviewed=await operateCommand(prefix,tenant,`${prefix}_ops`,"accept-support",{
          ...support,documentation:"Reviewed exact accepted turnover and fictional inspection documentation"},
          "accept-support-reviewed");
        assert(!reviewed.error,`${prefix}:accept-support:${reviewed.error?.message}`);
      }
      const activated=await operateCommand(prefix,tenant,`${prefix}_ops`,"activate",{
        note:"Fictional support ownership, documentation and asset verified"},"activate-support");
      assert(!activated.error,`${prefix}:activate:${activated.error?.message}`);
      current=await connectedBasis(prefix,tenant);
      assert.equal(current.operate.state.activation.status,"Active");
      assert.equal(current.operate.state.finance.status,"Pending");
      assert.equal(current.work.phaseConfigurationVersionId,versions[`${prefix}_admin`]);
      outcomes.push({tenant:tenant.workspaceKey,workId:current.work.canonicalWorkId,
        workAcceptanceId:acceptance.id,activation:current.operate.state.activation.status,
        financialCloseout:current.operate.state.finance.status,
        documentationPolicyRejection:prefix==="a"?withoutReview.error.message:null,
        configurationVersionId:current.work.phaseConfigurationVersionId});
    }
    return outcomes;
  });
  await check("cross-tenant Deploy and Operate RPCs reject the foreign actor",async()=>{
    const deploy=await deployCommand("a",a,"b_ops","review-completion",{
      note:"Forged foreign tenant completion attempt"},"foreign-completion");
    const operate=await operateCommand("a",a,"b_ops","add-asset",{
      name:"Forged asset",kind:"Service asset",location:"Foreign site"},"foreign-operate");
    assert.equal(deploy.error?.code,"42501",`deploy:${deploy.error?.message}`);
    assert.equal(operate.error?.code,"42501",`operate:${operate.error?.message}`);
    return {tenant:a.workspaceKey,foreignActorId:users.b_ops.id,
      deployError:deploy.error.message,operateError:operate.error.message};
  });
  await check("connected Deploy and Operate events retain exact Work, actor and tenant",async()=>{
    const outcomes=[];
    for(const [prefix,tenant] of [["a",a],["b",b]]) {
      const current=await connectedBasis(prefix,tenant);
      const id=sql(`select id from d5o_hosted.work_records where workspace_id=${q(tenant.workspaceId)}
        and id=${q(current.work.canonicalWorkId)};`);
      assert(id,`${prefix}:canonical-work-missing`);
      const deploy=Number(sql(`select count(*) from d5o_hosted.connected_deploy_events
        where workspace_id=${q(tenant.workspaceId)} and work_id=${q(id)}
          and actor_user_id in (${q(users[`${prefix}_ops`].id)},${q(users[`${prefix}_ops2`].id)},
            ${q(users[`${prefix}_pm`].id)},${q(users[`${prefix}_worker`].id)});`));
      const operate=Number(sql(`select count(*) from d5o_hosted.connected_operate_events
        where workspace_id=${q(tenant.workspaceId)} and work_id=${q(id)}
          and actor_user_id in (${q(users[`${prefix}_ops`].id)},${q(users[`${prefix}_ops2`].id)},
            ${q(users[`${prefix}_pm`].id)});`));
      assert(deploy>=8,`${prefix}:deploy-audit-${deploy}`);
      assert(operate>=3,`${prefix}:operate-audit-${operate}`);
      outcomes.push({tenant:tenant.workspaceKey,workId:id,deployEvents:deploy,operateEvents:operate});
    }
    return outcomes;
  });
  await check("new published tenant policy does not repin completed connected Work",async()=>{
    const prior=versions.a_admin;
    const revision=Number(sql(`select edit_revision from d5o_hosted.configuration_versions
      where id=${q(prior)};`));
    const draft=await config("a_admin",a.workspaceKey,"create-draft",prior,prior,revision,
      {},"phase2f-historical-draft");
    assert(!draft.error,draft.error?.message);
    const next=draft.data.versionId;
    const changed=await config("a_admin",a.workspaceKey,"save-policy",next,prior,1,
      {key:"service-approval",thresholdMinor:1100000,currency:"USD",
        comparison:"greater_than",authorityRole:"admin",unavailableBehavior:"block"},
      "phase2f-historical-threshold");
    assert(!changed.error,changed.error?.message);
    const validated=await config("a_admin",a.workspaceKey,"validate-publish",next,prior,2,
      {},"phase2f-historical-validate");
    assert(!validated.error,validated.error?.message);
    const activated=await config("a_admin",a.workspaceKey,"activate",next,prior,3,
      {},"phase2f-historical-activate");
    assert(!activated.error,activated.error?.message);
    const oldWork=await connectedBasis("a",a);
    assert.equal(oldWork.work.phaseConfigurationVersionId,prior);
    assert.equal(oldWork.operate.state.activation.status,"Active");
    const pinned=sql(`select configuration_version_id from d5o_hosted.work_records
      where id=${q(oldWork.work.canonicalWorkId)};`);
    assert.equal(pinned,prior);
    return {tenant:a.workspaceKey,workId:oldWork.work.canonicalWorkId,
      pinnedVersion:prior,newActiveVersion:next,priorDecisionPreserved:true};
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
  if(phase2g) {
    await check("transactional phase projection matches replay and pinned final outcomes",async()=>{
      const outcomes=[];
      for(const [prefix,tenant] of [["a",a],["b",b]]) {
        const source=await call(`${prefix}_admin`,"d5o_hosted_prototype_read_v1",{
          p_workspace_key:tenant.workspaceKey,p_state_key:"work"});
        assert(!source.error,source.error?.message);
        const work=source.data.state.records.find((item)=>item.title==="Phase 2D policy qualification");
        const status=await call(`${prefix}_admin`,"d5o_hosted_phase_status_read_v1",{
          p_workspace_key:tenant.workspaceKey,p_presentation_id:work.id});
        assert(!status.error,status.error?.message);
        assert.equal(status.data.status,"resolved");
        assert.equal(status.data.replayMatches,true);
        for(const phase of ["Discover","Define","Design","Develop","Deploy"])
          assert.equal(status.data.projection.phases[phase].status,"completed",`${prefix}:${phase}`);
        assert.equal(status.data.projection.phases.Operate.status,"active");
        assert.equal(status.data.projection.currentPhase,"Operate");
        assert.equal(status.data.projection.supportActive,true);
        assert.equal(status.data.projection.financialCloseout,"Pending");
        assert.equal(status.data.configurationVersionId,work.phaseConfigurationVersionId);
        const foreign=await call(prefix==="a"?"b_admin":"a_admin",
          "d5o_hosted_phase_status_read_v1",{
            p_workspace_key:tenant.workspaceKey,p_presentation_id:work.id});
        assert.equal(foreign.error?.code,"42501");
        outcomes.push({tenant:tenant.workspaceKey,workId:work.canonicalWorkId,
          projectionRevision:status.data.projectionRevision,
          currentPhase:status.data.projection.currentPhase,
          statuses:Object.fromEntries(Object.entries(status.data.projection.phases)
            .map(([phase,value])=>[phase,value.status])),
          supportActive:true,financialCloseout:"Pending",replayMatches:true,
          crossTenantDenied:foreign.error.message});
      }
      return outcomes;
    });
    await check("authenticated tenant-neutral Work UI and API isolation",async()=>{
      if(!server)server=await startNext(url,anon,service);
      const browser=await chromium.launch();
      const dir=resolve(root,"docs/architecture/evidence/phase2g-browser");
      mkdirSync(dir,{recursive:true});const outcomes=[];
      try {
        for(const [prefix,tenant,other] of [["a",a,b],["b",b,a]]) {
          const page=await browser.newPage({viewport:{width:1440,height:900}});
          await page.goto(`http://127.0.0.1:${server.port}/auth/sign-in?next=%2Fwork`);
          await page.getByLabel("Email").fill(users[`${prefix}_admin`].email);
          await page.getByLabel("Password").fill(users[`${prefix}_admin`].password);
          await page.getByRole("button",{name:"Continue to your work"}).click();
          await page.getByRole("link",{name:/Open workspace/}).first().waitFor({timeout:30000});
          await page.screenshot({path:resolve(dir,`${prefix}-workspace-selection.png`),fullPage:true});
          await page.locator(`[data-workspace="${tenant.workspaceKey}"]`).click();
          await page.getByRole("heading",{name:"Work lifecycle"}).waitFor({timeout:30000});
          await page.locator('.d5o-customer-work-list a[href*="?work="]:not([href*="#"])')
            .filter({hasText:"Phase 2D policy qualification"}).click();
          await page.getByRole("heading",{name:"Phase 2D policy qualification"}).waitFor({timeout:30000});
          await page.getByText("Financial closeout",{exact:true}).first().waitFor({timeout:30000});
          await page.screenshot({path:resolve(dir,`${prefix}-work-operate.png`),fullPage:true});
          await page.setViewportSize({width:390,height:844});
          await page.screenshot({path:resolve(dir,`${prefix}-work-operate-mobile.png`),fullPage:true});
          await page.setViewportSize({width:1440,height:900});
          await page.reload();
          await page.getByRole("heading",{name:"Phase 2D policy qualification"}).waitFor({timeout:30000});
          const otherSource=await call(`${prefix==="a"?"b":"a"}_admin`,
            "d5o_hosted_prototype_read_v1",{
              p_workspace_key:other.workspaceKey,p_state_key:"work"});
          const otherWork=otherSource.data.state.records.find((item)=>
            item.title==="Phase 2D policy qualification");
          const crossRead=await page.request.get(`http://127.0.0.1:${server.port}`+
            `/api/d5o-hosted/customer-work?workspace=${other.workspaceKey}&workId=${otherWork.id}`);
          assert.equal(crossRead.status(),403);
          const crossWrite=await page.request.post(`http://127.0.0.1:${server.port}`+
            `/api/d5o-hosted/customer-work?workspace=${other.workspaceKey}`,{
              data:{workId:otherWork.id,command:"operate",commandId:randomUUID(),
                arguments:{p_action:"activate",p_input:{note:"Forged cross-tenant activation"},
                  p_expected_source_revision:0,p_expected_deploy_revision:0,
                  p_expected_operate_revision:0}}});
          assert.equal(crossWrite.status(),403);
          await page.goto(`http://127.0.0.1:${server.port}/work/connected-work?workspace=${tenant.workspaceKey}`);
          await page.getByRole("button",{name:"Create connected Work"}).waitFor({timeout:30000});
          const browserWork=`Phase 2G browser Work ${prefix.toUpperCase()}`;
          await page.getByLabel("Work name").fill(browserWork);
          await page.getByLabel("Customer",{exact:true}).fill("Fictional browser customer");
          await page.getByLabel("Site").fill("Fictional browser site");
          await page.getByLabel("Accountable owner").fill("Fictional owner");
          await page.getByLabel("Demand source").fill("Fictional customer request");
          await page.getByLabel("Customer need").fill("A fictional connected service need created through the authenticated application.");
          await page.getByLabel("Procurement route").fill("Customer authorization required");
          const createdResponse=page.waitForResponse((response)=>response.url().includes("/api/d5o-hosted/connected-work")
            && response.request().method()==="POST");
          await page.getByRole("button",{name:"Create connected Work"}).click();
          const createdResult=await createdResponse;
          assert.equal(createdResult.status(),201,"browser-work-create");
          await page.getByRole("status").filter({hasText:"Connected Work created"})
            .waitFor({timeout:30000});
          await page.goto(`http://127.0.0.1:${server.port}/work/customer/${tenant.workspaceKey}`,
            {waitUntil:"domcontentloaded"});
          await page.getByRole("heading",{name:"Work lifecycle"}).waitFor({timeout:30000});
          await page.locator('.d5o-customer-work-list a[href*="?work="]')
            .filter({hasText:browserWork}).click();
          await page.getByRole("heading",{name:browserWork}).waitFor({timeout:30000});
          const browserWorkId=new URL(page.url()).searchParams.get("work");
          assert(browserWorkId,"browser-work-link-basis");
          const createdDetail=await page.request.get(`http://127.0.0.1:${server.port}`+
            `/api/d5o-hosted/customer-work?workspace=${tenant.workspaceKey}`+
            `&workId=${encodeURIComponent(browserWorkId)}`);
          assert.equal(createdDetail.status(),200,"browser-work-detail");
          await page.getByText("Discover",{exact:true}).first().waitFor();
          await page.screenshot({path:resolve(dir,`${prefix}-browser-created-work.png`),fullPage:true});
          outcomes.push({tenant:tenant.workspaceKey,route:`/work/customer/${tenant.workspaceKey}`,
            screenshot:`${prefix}-work-operate.png`,mobileScreenshot:`${prefix}-work-operate-mobile.png`,reloadPersisted:true,
            crossTenantGetStatus:crossRead.status(),crossTenantPostStatus:crossWrite.status(),
            browserCreatedWork:browserWork,creationScreenshot:`${prefix}-browser-created-work.png`});
          await page.close();
        }
      } finally {await browser.close();}
      return outcomes;
    });
  }
  await check("authenticated tenant administration and connected Work entry render",async()=>{
    if(!server) server=await startNext(url,anon,service);
    const browser=await chromium.launch();
    const dir=resolve(root,phase2g
      ? "docs/architecture/evidence/phase2g-browser"
      : "docs/architecture/evidence/phase2f-browser");
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
        await page.goto(`http://127.0.0.1:${server.port}/work?workspace=${tenant.workspaceKey}`);
        await page.getByRole("heading",{name:"Workspace unavailable"}).waitFor({timeout:30000});
        const gateFile=`${prefix}-pilot-work-gate.png`;
        await page.screenshot({path:resolve(dir,gateFile),fullPage:true});
        files.push(gateFile);
        await page.close();
      }
      return {files,ephemeralPreview:`http://127.0.0.1:${server.port}/work/connected-work`};
    } finally {await browser.close();}
  });
  }
  }
  if(phase2hr) await check("Design adapter denies suspended and removed membership, disabled flag and tenant",async()=>{
    const aPage=designPages.get("a_ops"),bPage=designPages.get("b_ops");
    assert(aPage&&bPage,"signed-in Design actor sessions required");
    const source=await call("a_admin","d5o_hosted_prototype_read_v1",{
      p_workspace_key:a.workspaceKey,p_state_key:"work"});
    assert(!source.error,source.error?.message);
    const work=source.data.state.records.find((item)=>item.title==="Phase 2D policy qualification");
    const foreignSource=await call("b_admin","d5o_hosted_prototype_read_v1",{
      p_workspace_key:b.workspaceKey,p_state_key:"work"});
    assert(!foreignSource.error,foreignSource.error?.message);
    const foreignWork=foreignSource.data.state.records.find((item)=>item.title==="Phase 2D policy qualification");
    const probe=async(page,tenant,workId)=>page.evaluate(async({tenant,workId})=>{
      const response=await fetch(`/api/d5o-hosted/customer-design-action?workspace=${tenant}`,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({workId,action:"approve-document",commandId:crypto.randomUUID(),
          sourceRevision:0,designRevision:0,input:{documentId:"invalid-document",
            documentRevision:1,evidenceId:"invalid-evidence",note:"Synthetic denied decision"}})});
      return response.status;
    },{tenant:tenant.workspaceKey,workId});
    const evidenceProbe=async(page,tenant,record)=>page.evaluate(async({workspace,workId,
      documentId,revision})=>{
      const query=new URLSearchParams({workspace,workId,documentId,revision:String(revision)});
      return (await fetch(`/api/d5o-hosted/design-document-evidence?${query}`)).status;
    },{workspace:tenant.workspaceKey,workId:record.id,
      documentId:record.design.documents[0].id,revision:record.design.documents[0].revision});
    assert.notEqual(await probe(aPage,a,work.id),403,"active Operations member reaches business validation");
    assert.notEqual(await probe(bPage,b,foreignWork.id),403,"active Operations member reaches business validation");
    if(phase2hsGateA) assert.equal(await evidenceProbe(aPage,a,work),200);
    const people=await call("a_admin","d5o_hosted_org_admin_read_v1",{
      p_workspace_key:a.workspaceKey,p_kind:"people",p_search:"",p_offset:0,p_limit:25});
    assert(!people.error,people.error?.message);
    const member=people.data.items.find((item)=>item.actor_user_id===users.a_ops.id);
    assert(member,"operations membership required");
    const membershipCommand=(action,revision)=>call("a_admin","d5o_hosted_org_admin_command_v1",{
      p_workspace_key:a.workspaceKey,p_action:action,p_subject_id:member.id,p_input:{},
      p_expected_revision:revision,p_reason:`Phase 2H-R ${action} authorization regression`,
      p_command_id:randomUUID()});
    const suspended=await membershipCommand("member.suspend",member.revision);
    assert(!suspended.error,suspended.error?.message);
    const suspendedHttp=await probe(aPage,a,work.id);
    assert.equal(suspendedHttp,403);
    if(phase2hsGateA) assert.equal(await evidenceProbe(aPage,a,work),403);
    const suspendedRpc=await call("a_ops","d5o_hosted_design_review_command_v1",{
      p_workspace_key:a.workspaceKey,p_presentation_id:work.id,p_action:"approve-document",
      p_input:{},p_command_id:randomUUID(),p_expected_source_revision:source.data.revision,
      p_expected_decision_revision:work.design.authorityRevision});
    assert.equal(suspendedRpc.error?.code,"42501");
    const restored=await membershipCommand("member.reactivate",suspended.data.record.revision);
    assert(!restored.error,restored.error?.message);
    const removed=await membershipCommand("member.remove",restored.data.record.revision);
    assert(!removed.error,removed.error?.message);
    const removedHttp=await probe(aPage,a,work.id);
    assert.equal(removedHttp,403);
    if(phase2hsGateA) assert.equal(await evidenceProbe(aPage,a,work),403);
    const directory=async()=>{
      const result=await call("vendor","d5o_platform_provisioning_directory_v1");
      assert(!result.error,result.error?.message);
      return result.data.find((item)=>item.workspaceKey===b.workspaceKey);
    };
    let tenant=await directory();
    const flagOff=await call("vendor","d5o_platform_capability_command_v1",{
      p_workspace_key:b.workspaceKey,p_kind:"flag",p_enabled:false,
      p_expected_revision:tenant.connectedWorkFlagRevision,p_command_id:randomUUID(),
      p_reason:"Disable synthetic tenant rollout for Design adapter regression"});
    assert(!flagOff.error,flagOff.error?.message);
    const disabledHttp=await probe(bPage,b,foreignWork.id);
    assert.equal(disabledHttp,403);
    if(phase2hsGateA) assert.equal(await evidenceProbe(bPage,b,foreignWork),403);
    let disabledRpcCode=null;
    if(phase2hsGateA) {
      const before=await call("b_admin","d5o_hosted_prototype_read_v1",{
        p_workspace_key:b.workspaceKey,p_state_key:"work"});
      assert(!before.error,before.error?.message);
      const current=before.data.state.records.find((item)=>item.id===foreignWork.id);
      const direct=await call("b_admin","d5o_hosted_design_draft_command_v1",{
        p_workspace_key:b.workspaceKey,p_presentation_id:foreignWork.id,
        p_action:"save-document",p_input:{document:{id:`flag-denial-${randomUUID()}`,
          type:"Method statement",title:"Forbidden disabled-feature Design draft",
          source:"SYNTHETIC-DISABLED-FEATURE",packageIds:[current.design.packages[0].packageId],
          requirementIds:current.definition.scopeControl.requirements
            .filter((item)=>item.state==="Confirmed").map((item)=>item.id),
          dueDate:"2026-12-10"},note:"Direct disabled-feature RPC test"},
        p_command_id:randomUUID(),p_expected_source_revision:before.data.revision,
        p_expected_decision_revision:current.design.authorityRevision});
      disabledRpcCode=direct.error?.code??null;
      assert.equal(disabledRpcCode,"42501",JSON.stringify(direct));
      const after=await call("b_admin","d5o_hosted_prototype_read_v1",{
        p_workspace_key:b.workspaceKey,p_state_key:"work"});
      assert.equal(after.data.state.records.find((item)=>item.id===foreignWork.id)
        .design.authorityRevision,current.design.authorityRevision);
    }
    const flagOn=await call("vendor","d5o_platform_capability_command_v1",{
      p_workspace_key:b.workspaceKey,p_kind:"flag",p_enabled:true,
      p_expected_revision:flagOff.data.revision,p_command_id:randomUUID(),
      p_reason:"Restore synthetic tenant rollout after Design adapter regression"});
    assert(!flagOn.error,flagOn.error?.message);
    tenant=await directory();
    const tenantOff=await call("vendor","d5o_platform_lifecycle_command_v1",{
      p_workspace_key:b.workspaceKey,p_action:"suspend",p_expected_revision:tenant.revision,
      p_command_id:randomUUID(),p_reason:"Suspend synthetic tenant for Design adapter regression"});
    assert(!tenantOff.error,tenantOff.error?.message);
    const tenantHttp=await probe(bPage,b,foreignWork.id);
    assert.equal(tenantHttp,403);
    if(phase2hsGateA) assert.equal(await evidenceProbe(bPage,b,foreignWork),403);
    const tenantOn=await call("vendor","d5o_platform_lifecycle_command_v1",{
      p_workspace_key:b.workspaceKey,p_action:"reactivate",p_expected_revision:tenantOff.data.revision,
      p_command_id:randomUUID(),p_reason:"Restore synthetic tenant after Design adapter regression"});
    assert(!tenantOn.error,tenantOn.error?.message);
    return {suspendedMembershipHttp:suspendedHttp,suspendedMembershipRpc:suspendedRpc.error.code,
      removedMembershipHttp:removedHttp,disabledFlagHttp:disabledHttp,
      disabledFeatureDirectRpc:disabledRpcCode,
      suspendedTenantHttp:tenantHttp,tenantReactivated:tenantOn.data.lifecycle};
  });
} catch(error) {evidence.setupError=String(error.message).slice(-2500);}
finally {
  if(designBrowser) await designBrowser.close();
  if(server) server.handle.kill();
  if(runtime) evidence.cleanup=cleanupP0aRuntime(runtime);
  evidence.finishedAt=new Date().toISOString();
  evidence.summary={passed:evidence.tests.filter((t)=>t.status==="PASS").length,
    failed:evidence.tests.filter((t)=>t.status==="FAIL").length,
    setupError:Boolean(evidence.setupError),cleanupVerified:Boolean(evidence.cleanup?.clean)};
  mkdirSync(resolve(root,"docs/architecture/evidence"),{recursive:true});
  writeFileSync(output,JSON.stringify(evidence,null,2)+"\n");
  console.log(JSON.stringify({...evidence.summary,output:phase2hsGateB
    ? "docs/architecture/evidence/phase2hs-develop-gate-results.json" : phase2hsGateA
    ? "docs/architecture/evidence/phase2hs-design-gate-results.json" : phase2hr
    ? "docs/architecture/evidence/phase2hr-design-browser-results.json"
    : phase2hCompletion
    ? "docs/architecture/evidence/phase2h-completion-define-results.json"
    : phase2h
    ? "docs/architecture/evidence/phase2h-connected-journey-results.json"
    : phase2g ? "docs/architecture/evidence/phase2g-two-tenant-results.json"
    : "docs/architecture/evidence/phase2f-connected-journey-results.json"}));
  if(evidence.summary.failed||evidence.summary.setupError||!evidence.summary.cleanupVerified) process.exitCode=1;
}
