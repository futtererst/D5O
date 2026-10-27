import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createServer } from "node:net";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "@playwright/test";
import { createP0aRuntime, cleanupP0aRuntime } from "./disposable-runtime.mjs";

const root = resolve(process.cwd());
const rc3 = process.env.D5O_RC3_BROWSER === "1";
const phase2hvc = process.env.D5O_PHASE2HVC === "1";
const phase2hvcFinal = process.env.D5O_PHASE2HVC_FINAL === "1";
const phase2hv = rc3 || process.env.D5O_PHASE2HV === "1";
const phase2hu = process.env.D5O_PHASE2HU === "1" || phase2hv;
const rc0DeployIntegrity = phase2hu && process.env.D5O_RC0_DEPLOY_INTEGRITY === "1";
const phase2htd = process.env.D5O_PHASE2HTD === "1";
const phase2hteDiagnostic = process.env.D5O_PHASE2HTE_DIAGNOSTIC === "1";
const phase2hteReloadProbe = process.env.D5O_PHASE2HTE_RELOAD_PROBE === "1";
const phase2htc = rc3 || process.env.D5O_PHASE2HTC === "1" || phase2htd;
const phase2htGateA = rc3 || process.env.D5O_PHASE2HT_GATE_A === "1";
const phase2htGateB = process.env.D5O_PHASE2HT_GATE_B === "1" || phase2htc;
const phase2g = rc3 || process.env.D5O_PHASE2G === "1";
const phase2hsGateB = rc3 || process.env.D5O_PHASE2HS_GATE_B === "1" || phase2htGateA;
const phase2hsGateA = process.env.D5O_PHASE2HS_GATE_A === "1" || phase2hsGateB;
const phase2hr = process.env.D5O_PHASE2HR === "1" || phase2hsGateA;
const phase2hCompletion = process.env.D5O_PHASE2H_COMPLETION === "1" || phase2hr;
const phase2h = process.env.D5O_PHASE2H === "1" || phase2hCompletion;
const output = resolve(root, rc3
  ? "docs/release/evidence/D5O_RC3_TWO_TENANT_BROWSER.json"
  : phase2hvcFinal
  ? "docs/release/evidence/D5O_PHASE2HVC_FINAL_BROWSER.json"
  : phase2hvc
  ? "docs/release/evidence/D5O_PHASE2HVC_OPERATE_INTEGRITY.json"
  : phase2hv
  ? "docs/architecture/evidence/phase2hv-two-tenant-results.json"
  : rc0DeployIntegrity
  ? "docs/release/D5O_RC0_DEPLOY_INTEGRITY.json"
  : phase2hu
  ? "docs/architecture/evidence/phase2hu-two-tenant-results.json"
  : phase2htd
  ? "docs/architecture/evidence/phase2htd-targeted-results.json"
  : phase2htc
  ? "docs/architecture/evidence/phase2htc-two-tenant-results.json"
  : phase2htGateA
  ? "docs/architecture/evidence/phase2ht-gate-a-results.json"
  : phase2htGateB
  ? "docs/architecture/evidence/phase2ht-gate-b-results.json"
  : phase2hsGateB
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
const evidence = { baseline: process.env.D5O_SOURCE_SHA || (rc3 ? "e3396521099a53955f20f7cfa3951fc255b0f662" : phase2hvc || phase2hvcFinal ? "025b1036f6bdae91d72e409fe897e551ca9a6e23" : phase2hv ? "cf781d39e831a6d396f0116326aac59173fd43f4"
  : rc0DeployIntegrity ? "3710ecace04e54769b5761da83f12594562e95b3"
  : phase2hu ? "639308061ff236ac0afb6487088a44c315e9b554"
  : phase2htd ? "88381435a965050402dcd423b4856115246459a3"
  : phase2htc ? "6e28685f44795b1a3f6b19877d575b609be43729"
  : phase2htGateA || phase2htGateB ? "82d9b1c4131d3154da3d0e53e15a8d22365fec35"
  : phase2hsGateA ? "d1537c2070eee6926ad227c69dcdc43418bb381d" : phase2hr ? "f53aa89192b776221067cc6a761248e87259f82e" : phase2g
    ? "dae8e1fa975bc47ef6d1180b512399683e3c9613"
    : "8d536b4ce74282fe6c3a0e2dbb66b1752ca51ec2"),
  startedAt: new Date().toISOString(), tests: [], setupError: null, cleanup: null };
let rc3PrepublicationDraftId=null;
const browserEvidenceDir = (legacyPath) => resolve(root,rc3
  ? "docs/release/evidence/rc3-browser" : phase2htd
  ? "docs/architecture/evidence/phase2htd-browser" : phase2htc
  ? "docs/architecture/evidence/phase2htc-browser" : phase2htGateB
  ? "docs/architecture/evidence/phase2ht-gate-b-browser" : legacyPath);
if(phase2htGateA) evidence.gateASecurity=[];
// Field start checks the real shift clock. The disposable journey uses today's
// local business date so that its schedule is actually eligible for execution.
const useQualificationClock=process.env.D5O_DISPOSABLE_QUALIFICATION_CLOCK==="1" ||
  phase2hu || phase2hsGateB || phase2htGateA || phase2htGateB;
let executionDate = phase2hv ? new Intl.DateTimeFormat("en-CA", {timeZone:"America/New_York",
  year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())
  : useQualificationClock ? "2026-10-26" : new Intl.DateTimeFormat("en-CA", {timeZone:"America/New_York",
  year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const executionDay = new Date(`${executionDate}T12:00:00Z`).getUTCDay();
const executionHour = useQualificationClock ? 10 : Number(new Intl.DateTimeFormat("en-US", {timeZone:"America/New_York",
  hour:"2-digit",hourCycle:"h23"}).format(new Date()));
const currentFridayOvernight = (phase2hsGateB || phase2g || phase2htGateB) && executionDay===6
  && executionHour<11;
if(phase2htGateB && (executionDay===0 || (executionDay===6 && !currentFridayOvernight)))
  throw Error("current_business_shift_unavailable_for_field_start");
if(executionDay===0 || executionDay===6) {
  if(!phase2hu && !phase2hsGateA && !currentFridayOvernight && !phase2htGateB)
    throw Error("business_day_required_for_field_start");
  if(currentFridayOvernight) {
    // A real Friday overnight shift remains current on Saturday morning.
    // The field-start command checks the actual clock and timezone.
    const priorFriday=new Date(`${executionDate}T12:00:00Z`);
    priorFriday.setUTCDate(priorFriday.getUTCDate()-1);
    executionDate=priorFriday.toISOString().slice(0,10);
  } else if(!phase2htGateB) {
    const nextBusinessDay=new Date(`${executionDate}T12:00:00Z`);
    nextBusinessDay.setUTCDate(nextBusinessDay.getUTCDate()+(executionDay===6?2:1));
    executionDate=nextBusinessDay.toISOString().slice(0,10);
  }
}
const executionShift = currentFridayOvernight ? "23:00–10:59"
  : `${String(Math.max(0,executionHour-2)).padStart(2,"0")}:00–${String(Math.min(23,executionHour+6)).padStart(2,"0")}:59`;
// Economic and labor authorities are checked against the database's real
// current_date. Their validity can begin today while the disposable field
// shift is evaluated under its controlled qualification clock.
const authorityValidFrom = useQualificationClock
  ? new Date().toISOString().slice(0,10) : executionDate;
let runtime, server, designBrowser;
const q = (value) => `'${String(value).replaceAll("'", "''")}'`;
function sql(query) {
  const result = spawnSync("docker", ["exec", "-i", runtime.dbContainer, "psql", "-U", "postgres", "-d", "postgres",
    "-X", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: query, encoding: "utf8", shell: false });
  if (result.status !== 0) throw Error(`sql_failed:${result.stderr.slice(-900)}`);
  return result.stdout.trim();
}
function installDisposableQualificationClock() {
  // This seam exists only in the disposable database. No application request or
  // authenticated actor can set it, and production migrations are unchanged.
  sql(`create schema d5o_qualification;
    revoke all on schema d5o_qualification from public,anon,authenticated;
    create table d5o_qualification.clock(fixed_at timestamptz not null);
    revoke all on d5o_qualification.clock from public,anon,authenticated;
    insert into d5o_qualification.clock values ('${phase2hv?executionDate:"2026-10-26"}T14:00:00Z');
    create function d5o_qualification.fixed_now() returns timestamptz
      language sql stable security definer set search_path=''
      as 'select fixed_at from d5o_qualification.clock limit 1';
    revoke all on function d5o_qualification.fixed_now() from public,anon,authenticated;
    do $clock$ declare v_oid oid; v_source text; v_replaced text; begin
      select 'public.d5o_hosted_field_start_command_v1(text,text,text,text,text,text,bigint,integer,integer,integer)'::regprocedure::oid into v_oid;
      v_source:=pg_get_functiondef(v_oid);
      v_replaced:=regexp_replace(v_source,'v_now[[:space:]]+timestamptz[[:space:]]*:=[[:space:]]*now\\(\\)',
        'v_now timestamptz:=d5o_qualification.fixed_now()','i');
      if v_replaced=v_source then raise exception 'field_clock_seam_missing'; end if;
      execute v_replaced;
      select 'public.d5o_hosted_operate_command_internal_v1(text,text,text,jsonb,text,bigint,integer,integer)'::regprocedure::oid into v_oid;
      v_source:=pg_get_functiondef(v_oid);
      v_replaced:=regexp_replace(v_source,'v_now[[:space:]]+timestamptz[[:space:]]*:=[[:space:]]*now\\(\\)',
        'v_now timestamptz:=d5o_qualification.fixed_now()','i');
      if v_replaced=v_source then raise exception 'operate_clock_seam_missing'; end if;
      execute v_replaced;
    end $clock$;`);
  evidence.disposableClock={at:`${phase2hv?executionDate:"2026-10-26"}T14:00:00Z`,scope:"field-start and connected Operate commands in disposable database only"};
}
async function check(name, run) {
  try { evidence.tests.push({ name, status: "PASS", detail: await run() ?? null }); }
  catch (error) { evidence.tests.push({ name, status: "FAIL", detail: String(error.message).slice(0,
    phase2hsGateB || phase2htGateB ? 5000 : 800) }); }
  console.log(JSON.stringify({test:name,status:evidence.tests.at(-1).status,
    ...(evidence.tests.at(-1).status==="FAIL"?{detail:evidence.tests.at(-1).detail}:{})}));
  if(phase2hv && evidence.tests.at(-1).status==="FAIL")
    throw Error(`phase2hv_stopped_after_failed_gate:${name}`);
}
async function rc0Case(name, run) {
  try {
    const detail = await run();
    (evidence.rc0Integrity ??= []).push({ name, status: "PASS", detail });
    console.log(JSON.stringify({ rc0Integrity: name, status: "PASS" }));
    return detail;
  } catch (error) {
    (evidence.rc0Integrity ??= []).push({ name, status: "FAIL", detail: String(error) });
    console.log(JSON.stringify({ rc0Integrity: name, status: "FAIL", detail: String(error) }));
    throw error;
  }
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
    "dev","--webpack","-p",String(port),"-H","127.0.0.1"],{cwd:root,env,stdio:["ignore","pipe","pipe"],shell:false});
  let diagnostics="";
  for(const stream of [handle.stdout,handle.stderr]) stream?.on("data",(chunk)=>{
    diagnostics=(diagnostics+String(chunk)).slice(-5000);
  });
  for(let n=0;n<160;n++) { try { if((await fetch(`http://127.0.0.1:${port}/api/health`)).ok)
    return {handle,port,diagnostics:()=>diagnostics}; } catch { /* startup */ } await new Promise((done)=>setTimeout(done,500)); }
  handle.kill();throw Error("next_start_timeout");
}

try {
  runtime = await createP0aRuntime(root);
  if(useQualificationClock) installDisposableQualificationClock();
  const url = runtime.status.API_URL ?? runtime.status.SUPABASE_URL;
  const anon = runtime.status.ANON_KEY ?? runtime.status.PUBLISHABLE_KEY;
  const service = runtime.status.SERVICE_ROLE_KEY ?? runtime.status.SECRET_KEY;
  assert(url === `http://127.0.0.1:${runtime.ports.api}` && anon && service);
  evidence.environment = { projectId: runtime.projectId, apiPort: runtime.ports.api, loopbackOnly: true };
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const users = {};
  for (const key of ["vendor","a_admin","b_admin","outsider",
    "a_finance","a_ops","a_ops2","a_pm","a_worker",
    "b_finance","b_ops","b_ops2","b_pm","b_worker","b_replacement"]) {
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
  if(rc3) evidence.browserDecisions=[];
  async function rc3SignedInPage(actor) {
    if(!server)server=await startNext(url,anon,service);
    if(!designBrowser)designBrowser=await chromium.launch();
    let page=designPages.get(actor);
    if(page)return page;
    page=await designBrowser.newPage({viewport:{width:1440,height:900}});
    await page.goto(`http://127.0.0.1:${server.port}/auth/sign-in`);
    await page.getByLabel("Email").fill(users[actor].email);
    await page.getByLabel("Password").fill(users[actor].password);
    await page.getByRole("button",{name:"Continue to your work"}).click();
    await page.waitForURL((location)=>!location.pathname.startsWith("/auth/sign-in"),{timeout:30000});
    designPages.set(actor,page);
    return page;
  }
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
    try {
      await page.getByRole("heading",{name:"Design actions"}).waitFor({timeout:30000});
    } catch (firstNavigationError) {
      const detail=await page.evaluate(async({workspace,workId})=>{
        const response=await fetch(`/api/d5o-hosted/customer-work?workspace=${workspace}&workId=${workId}`);
        return {status:response.status,body:await response.json()};
      },{workspace:tenant.workspaceKey,workId});
      assert.equal(detail.status,200,`${actor}:task_detail_after_navigation:${JSON.stringify(detail)}`);
      // A read-only reload repairs an interrupted development-server route render.
      // The business decision is still performed exactly once, after this check.
      await page.reload({waitUntil:"domcontentloaded"});
      await page.getByRole("heading",{name:"Design actions"}).waitFor({timeout:30000})
        .catch(async()=>{throw new Error(`${actor}:task_route_unavailable:${page.url()}:${
          (await page.locator("body").innerText()).slice(0,400)}:${firstNavigationError}`);});
    }
    await page.getByText("Loading current Work and phase decisions…").waitFor({state:"hidden"});
    return page;
  }
  async function rc3PhasePage(actor,tenant,workId,phase) {
    const page=await rc3SignedInPage(actor);
    await page.goto(`http://127.0.0.1:${server.port}/work/customer/${tenant.workspaceKey}?work=${workId}#phase-${phase}`);
    await page.getByText("Loading current Work and phase decisions…").waitFor({state:"hidden",timeout:30000});
    return page;
  }
  async function rc3OpenTask(actor,tenant,workId,title) {
    const page=await rc3SignedInPage(actor);
    await page.goto(`http://127.0.0.1:${server.port}/work/customer/${tenant.workspaceKey}`);
    await page.getByRole("heading",{name:"Work lifecycle"}).waitFor({timeout:30000});
    const task=page.locator('.d5o-customer-work-list a[href*="?work="]')
      .filter({hasText:title}).first();
    await task.waitFor({state:"visible",timeout:30000});
    const href=await task.getAttribute("href");
    assert(href?.includes(workId),`${actor}:wrong_task_work:${href}`);
    await task.click();
    (evidence.browserTasks??=[]).push({tenant:tenant.workspaceKey,actor,workId,title,href,
      origin:"authenticated_my_work_link"});
    return page;
  }
  async function rc3Decision(page,tenant,actor,phase,label,control,endpoint="customer-work",expected=200) {
    await control.waitFor({state:"visible",timeout:30000});
    let response;
    try {
      [response]=await Promise.all([
        page.waitForResponse((item)=>item.url().includes(`/api/d5o-hosted/${endpoint}`)
          && item.request().method()==="POST",{timeout:30000}),control.click()
      ]);
    } catch(error) {
      const diagnostics=await page.evaluate(()=>({alerts:[...document.querySelectorAll('[role="alert"]')]
        .map((item)=>item.textContent),forms:[...document.querySelectorAll("form")]
        .filter((form)=>form.querySelector("button")?.textContent?.includes("Save customer offer revision"))
        .map((form)=>({valid:form.checkValidity(),invalid:[...form.elements]
          .filter((item)=>!item.validity.valid).map((item)=>({name:item.name,value:item.value,
            reason:item.validationMessage}))}))}));
      throw Error(`${tenant.workspaceKey}:${label}:${error.message}:${JSON.stringify(diagnostics)}`);
    }
    const body=await response.json();
    assert.equal(response.status(),expected,`${tenant.workspaceKey}:${label}:${JSON.stringify(body)}`);
    const request=response.request().postDataJSON();
    evidence.browserDecisions.push({tenant:tenant.workspaceKey,actor,phase,label,
      origin:"authenticated_browser_control",status:response.status(),
      commandId:request.commandId??request.command_id??null,
      workId:request.workId??request.p_presentation_id??null,
      result:body.result??body.error??null});
    return {page,body,request,response};
  }
  const serviceTaskEvidence=[];
  if(phase2htc) evidence.serviceTaskNavigation=serviceTaskEvidence;
  if(phase2htd) evidence.tdCases=[];
  const tdCase=(id,actual)=>{if(phase2htd) evidence.tdCases.push({id,status:"PASS",actual});};
  const lastServiceTask=new Map();
  async function openServiceTask(actor,tenant,workId,action) {
    const page=await designPage(actor,tenant,workId);
    const rootUrl=`http://127.0.0.1:${server.port}/work/customer/${tenant.workspaceKey}`;
    await page.goto(rootUrl);
    await page.getByRole("heading",{name:"Work lifecycle"}).waitFor({timeout:30000});
    const queue=async()=>page.evaluate(async(workspace)=>{
      const response=await fetch(`/api/d5o-hosted/customer-work?workspace=${workspace}`);
      return {status:response.status,body:await response.json()};
    },tenant.workspaceKey);
    const current=await queue();
    assert.equal(current.status,200,`${actor}:my_work_read`);
    const actorWorkKey=`${actor}:${workId}`;
    const previous=lastServiceTask.get(actorWorkKey);
    if(previous) {
      assert(!(current.body.tasks??[]).some((item)=>item.id===previous.id),
        `${actor}:stale_my_work_task:${previous.action}`);
      // A later revision can legitimately create a new responsibility with
      // the same plain-language title and Work URL. The task ID is the exact
      // stale-task assertion; link absence applies only if no successor exists.
      if(!(current.body.tasks??[]).some((item)=>item.workId===workId
        && item.title===previous.title))
        assert.equal(await page.locator('.d5o-customer-work-list a')
          .filter({hasText:previous.title}).count(),0,`${actor}:stale_my_work_link`);
      previous.resolved=true;
    }
    const task=(current.body.tasks??[]).find((item)=>item.workId===workId
      && item.action===action && item.status==="available");
    assert(task,`${actor}:my_work_task_missing:${action}`);
    const link=page.locator('.d5o-customer-work-list a[href*="#phase-operate"]')
      .filter({hasText:task.title}).first();
    await link.waitFor({state:"visible",timeout:30000});
    await link.click();
    await page.waitForURL((location)=>location.searchParams.get("work")===workId,
      {timeout:30000});
    assert.equal(new URL(page.url()).searchParams.get("work"),workId,
      `${actor}:my_work_wrong_work`);
    try { await page.getByRole("heading",{name:"Design actions"}).waitFor({timeout:30000}); }
    catch (firstNavigationError) {
      const detail=await page.evaluate(async({workspace,workId})=>{
        const response=await fetch(`/api/d5o-hosted/customer-work?workspace=${workspace}&workId=${workId}`);
        return {status:response.status,body:await response.json()};
      },{workspace:tenant.workspaceKey,workId});
      assert.equal(detail.status,200,`${actor}:my_work_detail_after_navigation:${JSON.stringify(detail)}`);
      await page.reload({waitUntil:"domcontentloaded"});
      await page.getByRole("heading",{name:"Design actions"}).waitFor({timeout:30000})
        .catch(async()=>{throw new Error(`${actor}:my_work_route_unavailable:${page.url()}:${
          (await page.locator("body").innerText()).slice(0,400)}:${firstNavigationError}`);});
    }
    await page.getByText("Loading current Work and phase decisions…")
      .waitFor({state:"hidden"});
    const row={tenant:tenant.workspaceKey,actor,action,id:task.id,title:task.title,
      workId,origin:"my_work_link",url:page.url(),resolved:false};
    serviceTaskEvidence.push(row);
    lastServiceTask.set(actorWorkKey,row);
    return page;
  }
  async function assertServiceTaskResolved(actor,tenant,workId) {
    const prior=lastServiceTask.get(`${actor}:${workId}`);
    assert(prior,`${actor}:service_task_receipt_missing`);
    const page=designPages.get(actor);
    await page.goto(`http://127.0.0.1:${server.port}/work/customer/${tenant.workspaceKey}`);
    await page.getByRole("heading",{name:"Work lifecycle"}).waitFor({timeout:30000});
    const current=await page.evaluate(async(workspace)=>{
      const response=await fetch(`/api/d5o-hosted/customer-work?workspace=${workspace}`);
      return {status:response.status,body:await response.json()};
    },tenant.workspaceKey);
    assert.equal(current.status,200);
    assert(!(current.body.tasks??[]).some((item)=>item.id===prior.id),
      `${actor}:service_task_still_actionable:${prior.action}`);
    if(!(current.body.tasks??[]).some((item)=>item.workId===workId
      && item.title===prior.title))
      assert.equal(await page.locator('.d5o-customer-work-list a')
        .filter({hasText:prior.title}).count(),0,`${actor}:service_task_link_stale`);
    prior.resolved=true;
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
    const dir=resolve(root,phase2htGateA
      ? "docs/architecture/evidence/phase2ht-gate-a-browser"
      : "docs/architecture/evidence/phase2hs-develop-browser");
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
      const work=rc3 ? await (async()=>{
        const page=await rc3SignedInPage(pm);
        await page.goto(`http://127.0.0.1:${server.port}/work/connected-work?workspace=${tenant.workspaceKey}`);
        await page.getByLabel("Work name").fill("Phase 2D policy qualification");
        await page.getByLabel("Customer",{exact:true}).fill("Fictional Customer");
        await page.getByLabel("Site").fill("Test location");
        await page.getByLabel("Accountable owner").fill("Test owner");
        await page.getByLabel("Demand source").fill("Test");
        await page.getByLabel("Customer need").fill("Need service");
        await page.getByLabel("Procurement route").fill("Direct");
        const created=await rc3Decision(page,tenant,pm,"Discover","Create connected Work",
          page.getByRole("button",{name:"Create connected Work"}),"connected-work",201);
        await page.getByRole("status").filter({hasText:"Connected Work created: Phase 2D policy qualification"})
          .waitFor({timeout:30000});
        return {data:{workId:created.body.result?.workId??created.body.workId},error:null};
      })() : await admin.rpc("d5o_hosted_create_connected_work_v1",{
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
      if(rc3 && !work.data.workId) {
        work.data.workId=sql(`select id from d5o_hosted.work_records
          where workspace_id=${q(tenant.workspaceId)}
            and title='Phase 2D policy qualification' limit 1;`);
      }
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
      const owner=rc3?`${prefix}_pm`:`${prefix}_admin`,finance=`${prefix}_finance`,receiver=`${prefix}_ops`;
      const initial=await call(owner,"d5o_hosted_prototype_read_v1",{
        p_workspace_key:tenant.workspaceKey,p_state_key:"work"});
      assert(!initial.error,initial.error?.message);
      const record=initial.data.state.records.find((item)=>item.title==="Phase 2D policy qualification");
      assert(record);
      if(rc3) {
        let page=await rc3OpenTask(owner,tenant,record.id,"Prepare Discover intake");
        for(const [label,value] of Object.entries({
          "Requester":"Fictional customer representative",
          "Intended customer outcome":"Restore inspected service capability",
          "Rough value":"15000","Currency":"USD","Required date":"2026-12-01",
          "Known risk or unknown":"Service outage during inspection"}))
          await page.getByLabel(label,{exact:true}).fill(value);
        await rc3Decision(page,tenant,owner,"Discover","Save intake revision",
          page.getByRole("button",{name:"Save intake revision"}),"prototype-pursuit-command");
        page=await rc3PhasePage(owner,tenant,record.id,"discover");
        await rc3Decision(page,tenant,owner,"Discover","Submit intake for pursuit decision",
          page.getByRole("button",{name:"Submit intake for pursuit decision"}),"prototype-pursuit-command");
        page=await rc3OpenTask(finance,tenant,record.id,"Review Discover intake");
        await page.locator("#phase-discover").getByLabel("Decision basis")
          .fill("Qualified fictional service request for controlled delivery");
        await rc3Decision(page,tenant,finance,"Discover","Qualify pursuit",
          page.getByRole("button",{name:"Qualify pursuit"}),"prototype-pursuit-command");
        page=await rc3OpenTask(owner,tenant,record.id,"Prepare Define handoff");
        await page.getByLabel("Need, scope boundary and open questions").fill(
          "Fictional customer service need with a scoped and inspected handoff to Define");
        await rc3Decision(page,tenant,owner,"Discover","Submit Define handoff",
          page.getByRole("button",{name:"Submit Define handoff"}),"prototype-pursuit-command");
        page=await rc3OpenTask(receiver,tenant,record.id,"Receive Define handoff");
        await page.getByLabel("Receiver response reason").fill(
          "Accepted scoped fictional handoff for Define review");
        await rc3Decision(page,tenant,receiver,"Discover","Accept Define handoff",
          page.getByRole("button",{name:"Accept Define handoff"}),"prototype-pursuit-command");
        const after=await call(owner,"d5o_hosted_prototype_read_v1",{
          p_workspace_key:tenant.workspaceKey,p_state_key:"work"});
        assert(!after.error,after.error?.message);
        const updated=after.data.state.records.find((item)=>item.id===record.id);
        assert.equal(updated.discovery?.pursuitControl?.handoff?.status,"accepted");
        outcomes.push({tenant:tenant.workspaceKey,workId:record.canonicalWorkId,
          sourceRevision:after.data.revision,handoff:"accepted",browser:true});
        continue;
      }
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
      const owner=rc3?`${prefix}_pm`:`${prefix}_admin`;
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
          const dir=browserEvidenceDir("docs/architecture/evidence/phase2h-completion-browser");
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
      const owner=rc3?`${prefix}_pm`:`${prefix}_admin`,finance=`${prefix}_finance`,ops=`${prefix}_ops`;
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
            const dir=browserEvidenceDir("docs/architecture/evidence/phase2h-browser");
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
      const owner=rc3?`${prefix}_pm`:`${prefix}_admin`,ops=`${prefix}_ops`;
      if(rc3) {
        const source=await call(owner,"d5o_hosted_prototype_read_v1",{
          p_workspace_key:tenant.workspaceKey,p_state_key:"work"});
        assert(!source.error,source.error?.message);
        const record=source.data.state.records.find((item)=>item.title==="Phase 2D policy qualification");
        const solutionPage=async()=>{
          const page=await rc3OpenTask(owner,tenant,record.id,"Prepare selected solution");
          await page.getByRole("button",{name:"Solution options"}).click();
          return page;
        };
        let page=await solutionPage();
        const option=page.locator("form").filter({has:page.getByRole("button",{name:"Save option revision"})});
        for(const [label,value] of Object.entries({"Option name":"Controlled repair",
          "Technical approach":"Inspect then repair", "Materials / equipment":"Existing stock",
          "Resource and capacity basis":"Qualified crew", "Schedule and customer windows":"Confirmed window",
          "Safety, quality and operating basis":"Permit and inspection",
          "Dependencies and risks":"Managed outage",
          "Supporting source":"Synthetic inspected option assessment",
          "Assessment owner":"Project manager"}))await option.getByLabel(label).fill(value);
        await option.locator('input[name="requirements"]').first().check();
        await option.locator('select[name="status"]').selectOption("Viable");
        await rc3Decision(page,tenant,owner,"Develop","Save option revision",
          option.getByRole("button",{name:"Save option revision"}),"prototype-state");
        page=await solutionPage();
        await page.getByLabel("Selection rationale").fill("Bounded repair addresses accepted scope");
        await rc3Decision(page,tenant,owner,"Develop","Select with rationale",
          page.getByRole("button",{name:"Select with rationale"}),"prototype-state");
        page=await rc3OpenTask(owner,tenant,record.id,"Prepare selected solution");
        await page.getByRole("button",{name:"Delivery strategy"}).click();
        const strategy=page.locator("form").filter({has:page.getByRole("button",{name:"Save strategy revision"})});
        for(const [label,value] of Object.entries({
          "Roles, skills, hours, supervision and productivity":"Qualified service team",
          "Subcontract, suppliers, quotations and lead times":"Existing stock",
          "Sequence, dependencies, access and outage windows":"Confirmed site window",
          "Safety execution approach":"Permit before work",
          "Verification and quality approach":"Independent inspection",
          "Risks, mitigation and contingency basis":"Rollback plan"}))
          await strategy.getByLabel(label).fill(value);
        await strategy.getByLabel("Target customer date").fill("2026-12-01");
        await rc3Decision(page,tenant,owner,"Develop","Save strategy revision",
          strategy.getByRole("button",{name:"Save strategy revision"}),"prototype-state");
        page=await rc3OpenTask(owner,tenant,record.id,"Prepare selected solution");
        await page.getByLabel("Review due").fill("2026-12-01");
        await rc3Decision(page,tenant,owner,"Develop","Submit solution",
          page.getByRole("button",{name:"Submit solution"}),"prototype-commercial-command");
        page=await rc3OpenTask(ops,tenant,record.id,"Review selected solution");
        await page.getByLabel("Decision basis").fill("Independent review of selected fictional solution");
        await rc3Decision(page,tenant,ops,"Develop","Approve solution",
          page.getByRole("button",{name:"Approve solution"}),"prototype-commercial-command");
        const after=await call(owner,"d5o_hosted_prototype_read_v1",{
          p_workspace_key:tenant.workspaceKey,p_state_key:"work"});
        assert(!after.error,after.error?.message);
        const approved=after.data.state.records.find((item)=>item.id===record.id);
        assert.equal(approved.develop.review.status,"Approved");
        outcomes.push({tenant:tenant.workspaceKey,workId:record.canonicalWorkId,
          versionId:record.phaseConfigurationVersionId,solutionStatus:"Approved",browser:true});
        continue;
      }
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
      const owner=rc3?`${prefix}_pm`:`${prefix}_admin`,ops=`${prefix}_ops`;
      if(rc3) {
        const source=await call(owner,"d5o_hosted_prototype_read_v1",{
          p_workspace_key:tenant.workspaceKey,p_state_key:"work"});
        assert(!source.error,source.error?.message);
        const record=source.data.state.records.find((item)=>item.title==="Phase 2D policy qualification");
        let page=await rc3OpenTask(owner,tenant,record.id,"Prepare detailed estimate");
        await page.getByRole("button",{name:"Detailed estimator"}).click();
        await page.getByLabel("Estimate maturity").selectOption("Budgetary");
        await page.getByLabel("Risk basis").fill("Synthetic bounded repair contingency");
        await page.getByText("+ Add sourced cost line").click();
        const line=page.locator("form").filter({has:page.getByRole("button",{name:"Add cost line"})});
        for(const [label,value] of Object.entries({
          "Scope / solution reference":"service-option","Description":"Controlled service inspection and repair",
          "Quantity or hours":"100","Unit":"hour","Catalog rate ID":"service-hour",
          "Source / quote reference":"Synthetic rate catalog",
          "Quantity, productivity or cost assumption":"Qualified crew completes inspected repair",
          "Calculation basis":"One hundred inspected service hours"}))
          await line.getByLabel(label).fill(value);
        await line.getByLabel("Category").selectOption("labor");
        await line.getByRole("button",{name:"Add cost line"}).click();
        await rc3Decision(page,tenant,owner,"Develop","Save detailed estimate revision",
          page.getByRole("button",{name:"Save detailed estimate revision"}),"prototype-commercial-command");
        page=await rc3OpenTask(owner,tenant,record.id,"Prepare detailed estimate");
        await page.getByLabel("Pricing review due").fill("2026-12-01");
        await rc3Decision(page,tenant,owner,"Develop","Submit revision for pricing review",
          page.getByRole("button",{name:"Submit revision for pricing review"}),"prototype-commercial-command");
        page=await rc3OpenTask(ops,tenant,record.id,"Review detailed pricing");
        await page.getByLabel("Independent pricing decision basis").fill("Independent reviewed price and scope");
        await rc3Decision(page,tenant,ops,"Develop","Approve detailed pricing",
          page.getByRole("button",{name:"Approve detailed pricing"}),"prototype-commercial-command");
        const after=await call(owner,"d5o_hosted_prototype_read_v1",{
          p_workspace_key:tenant.workspaceKey,p_state_key:"work"});
        assert(!after.error,after.error?.message);
        const estimate=after.data.state.records.find((item)=>item.id===record.id).discovery.estimate;
        assert.equal(estimate.status,"Approved");
        outcomes.push({tenant:tenant.workspaceKey,workId:record.canonicalWorkId,
          estimateStatus:"Approved",revision:estimate.revision,browser:true});
        continue;
      }
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
      const owner=rc3?`${prefix}_pm`:`${prefix}_admin`,ops=`${prefix}_ops`;
      if(rc3) {
        const source=await call(owner,"d5o_hosted_prototype_read_v1",{
          p_workspace_key:tenant.workspaceKey,p_state_key:"work"});
        assert(!source.error,source.error?.message);
        const record=source.data.state.records.find((item)=>item.title==="Phase 2D policy qualification");
        let page=await rc3OpenTask(owner,tenant,record.id,"Prepare customer offer");
        await page.getByLabel("Customer-facing scope").fill(
          "Inspect and repair the controlled service component");
        await page.getByLabel("Assumptions").fill("Customer confirms escorted access");
        await page.getByLabel("Exclusions").fill("Unrelated equipment and systems");
        await page.getByLabel("Commercial terms").fill("Synthetic qualification only");
        await rc3Decision(page,tenant,owner,"Develop","Save customer offer draft",
          page.getByRole("button",{name:"Save customer offer draft"}),"prototype-state");
        page=await rc3OpenTask(owner,tenant,record.id,"Prepare customer offer");
        await page.getByLabel("Offer review due").fill("2026-12-01");
        await rc3Decision(page,tenant,owner,"Develop","Request independent offer approval",
          page.getByRole("button",{name:"Request independent offer approval"}),"prototype-commercial-command");
        page=await rc3OpenTask(ops,tenant,record.id,"Review customer offer");
        await page.getByLabel("Independent offer decision basis").fill("Independent review of exact fictional offer and price");
        await rc3Decision(page,tenant,ops,"Develop","Approve customer offer",
          page.getByRole("button",{name:"Approve customer offer"}),"prototype-commercial-command");
        page=await rc3OpenTask(owner,tenant,record.id,"Record customer submission");
        await page.getByLabel("Customer recipient").fill("Fictional customer buyer");
        await page.getByLabel("Submission method").fill("Customer portal");
        await page.getByLabel("Customer response due").fill("2026-12-01");
        await rc3Decision(page,tenant,owner,"Develop","Record exact customer submission",
          page.getByRole("button",{name:"Record exact customer submission"}),"prototype-commercial-command");
        page=await rc3OpenTask(owner,tenant,record.id,"Record customer award");
        await page.getByLabel("Customer award date").fill("2026-10-23");
        await page.getByLabel("Customer decision basis").fill(
          "Synthetic buyer awards the exact reviewed service offer");
        await page.getByLabel("Customer award source").fill(`SYNTHETIC-RC3-AWARD-${prefix.toUpperCase()}`);
        await rc3Decision(page,tenant,owner,"Develop","Record sourced customer award",
          page.getByRole("button",{name:"Record sourced customer award"}),"prototype-commercial-command");
        const after=await call(owner,"d5o_hosted_prototype_read_v1",{
          p_workspace_key:tenant.workspaceKey,p_state_key:"work"});
        assert(!after.error,after.error?.message);
        const updated=after.data.state.records.find((item)=>item.id===record.id);
        assert.equal(updated.discovery.outcome,"Won");
        outcomes.push({tenant:tenant.workspaceKey,workId:record.canonicalWorkId,
          offerStatus:updated.discovery.proposal.status,
          awardSource:updated.discovery.proposal.responseEvents.at(-1).sourceReference,browser:true});
        continue;
      }
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
          if(!(await page.getByLabel("Receipt reason").isVisible())){
            await page.reload({waitUntil:"domcontentloaded"});
            await page.getByRole("heading",{name:"Design actions"}).waitFor({timeout:30000});
            (evidence.navigationRetries??=[]).push({tenant:tenant.workspaceKey,actor:ops,
              action:"Design handoff receipt",kind:"read_only_reload"});
          }
          try {await page.getByLabel("Receipt reason").fill(
            "Independently received the exact fictional award and reviewed scope",{timeout:10000});}
          catch(error){
            const detail=await page.evaluate(async({workspace,workId})=>{
              const response=await fetch(`/api/d5o-hosted/customer-work?workspace=${workspace}&workId=${workId}`);
              const body=await response.json();return {httpStatus:response.status,role:body.role,
                replayMatches:body.phaseStatus?.replayMatches,phaseStatus:body.phaseStatus?.status,
                handoff:{status:body.record?.discovery?.designHandoff?.status,
                  submittedByActorId:body.record?.discovery?.designHandoff?.submittedByActorId,
                  revision:body.record?.discovery?.designHandoff?.revision},rendered:document.querySelector(
                  ".d5o-customer-design-actions")?.textContent};
            },{workspace:tenant.workspaceKey,workId:record.id});
            throw Error(`${prefix}:design_handoff_receipt_unavailable:${error.message}:${JSON.stringify(detail)}`);
          }
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
        const dir=browserEvidenceDir("docs/architecture/evidence/phase2hr-design-browser");
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
        const dir=browserEvidenceDir("docs/architecture/evidence/phase2hr-design-browser");
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
          const dir=browserEvidenceDir("docs/architecture/evidence/phase2h-completion-browser");
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
  let connectedBasis, operateCommand;
  if(!phase2hsGateA || phase2hsGateB) {
  connectedBasis = async (prefix,tenant) => {
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
  const operateSnapshot=async(prefix,tenant)=>{
    const basis=await connectedBasis(prefix,tenant);
    const counts=sql(`select pg_catalog.jsonb_build_object(
      'events',(select count(*) from d5o_hosted.connected_operate_events
        where workspace_id=${q(tenant.workspaceId)} and work_id=${q(basis.work.canonicalWorkId)}),
      'receipts',(select count(*) from d5o_hosted.connected_operate_receipts
        where workspace_id=${q(tenant.workspaceId)} and work_id=${q(basis.work.canonicalWorkId)}))::text;`);
    return {revision:basis.operate.revision,state:basis.operate.state,
      sourceRevision:basis.source.revision,deployRevision:basis.deploy.revision,
      configurationVersionId:basis.work.phaseConfigurationVersionId,counts:JSON.parse(counts)};
  };
  const deniedOperateCase=async(name,prefix,tenant,run,allowedCodes)=>{
    const before=await operateSnapshot(prefix,tenant);
    const result=await run();
    assert(result.error,`${name}:unexpected_success`);
    assert(allowedCodes.includes(result.error.code),`${name}:wrong_error:${JSON.stringify(result.error)}`);
    const after=await operateSnapshot(prefix,tenant);
    assert.deepEqual(after,before,`${name}:protected_state_changed`);
    const item={name,expected:allowedCodes,actual:{code:result.error.code,message:result.error.message},
      operateRevision:after.revision,eventCount:after.counts.events,
      receiptCount:after.counts.receipts,configurationVersionId:after.configurationVersionId,
      evidenceAssociations:after.state.documentationObligations?.length??0,unchanged:true};
    (evidence.operateIntegrity ??= []).push(item);
    return item;
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
            parentCapMinor:"1000000",purchaseCapMinor:"0",validFrom:authorityValidFrom,
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
            validFrom:authorityValidFrom,validUntil
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
        subcontractEnabled:true,validFrom:authorityValidFrom,validUntil,
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
          validFrom:authorityValidFrom,validUntil},
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
      let workforceRevision=bound.data.revision;
      if(phase2htGateA) {
        const priorDate=new Date(Date.parse(`${executionDate}T12:00:00Z`)-86400000)
          .toISOString().slice(0,10);
        const futureDate=new Date(Date.parse(`${executionDate}T12:00:00Z`)+30*86400000)
          .toISOString().slice(0,10);
        const expired=await call(`${prefix}_admin`,"d5o_hosted_workforce_expiry_command_v1",{
          p_workspace_key:tenant.workspaceKey,p_profile_id:profile.data.id,
          p_qualification:"Service technician",p_expires_on:priorDate,
          p_command_id:randomUUID(),p_expected_revision:bound.data.revision});
        assert(!expired.error,`${prefix}:expire-qualification:${expired.error?.message}`);
        const before=await connectedBasis(prefix,tenant);
        const denied=await crewCommand(prefix,tenant,"save-booking",{assignment},"expired-booking");
        assert.equal(denied.error?.code,"23514",`${prefix}:expired:${denied.error?.message}`);
        assert.match(denied.error.message,/worker_qualification_expired/);
        const after=await connectedBasis(prefix,tenant);
        assert.equal(after.schedule.revision,before.schedule.revision);
        assert.equal(after.deploy.revision,before.deploy.revision);
        const page=await developPage(`${prefix}_ops`,tenant,first.work.id);
        assert.equal(await page.locator(`select option[value="${person}"]`).count(),0,
          `${prefix}:expired-worker-visible-as-qualified`);
        const restored=await call(`${prefix}_admin`,"d5o_hosted_workforce_expiry_command_v1",{
          p_workspace_key:tenant.workspaceKey,p_profile_id:profile.data.id,
          p_qualification:"Service technician",p_expires_on:futureDate,
          p_command_id:randomUUID(),p_expected_revision:expired.data.revision});
        assert(!restored.error,`${prefix}:restore-qualification:${restored.error?.message}`);
        workforceRevision=restored.data.revision;
        await page.reload();
        await page.getByRole("heading",{name:"Develop actions"}).waitFor();
        await page.locator(`select option[value="${person}"]`).waitFor();
        evidence.gateASecurity??=[];
        evidence.gateASecurity.push({tenant:tenant.workspaceKey,case:"expired_qualification",
          rpcError:denied.error.code,unchangedScheduleRevision:after.schedule.revision,
          expiredHiddenFromBrowser:true,validWorkerAvailable:true});
      }
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
          p_command_id:randomUUID(),p_expected_revision:workforceRevision,
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
        if(phase2htGateA) {
          const before=await connectedBasis(prefix,tenant);
          const existing=before.schedule.state.assignments.find((item)=>
            item.workId===first.work.id && item.packageId===first.packageId);
          assert(existing,`${prefix}:concurrency-booking-missing`);
          const args=(candidate,id)=>({p_workspace_key:tenant.workspaceKey,
            p_action:"save-booking",p_input:{assignment:candidate},
            p_command_id:id,p_expected_revision:before.schedule.revision});
          const attempts=await Promise.all([
            call(`${prefix}_ops`,"d5o_hosted_crew_command_v1",
              args({...existing,crew:`${existing.crew} reviewed`},randomUUID())),
            call(`${prefix}_ops2`,"d5o_hosted_crew_command_v1",
              args({...existing,id:`conflicting-${randomUUID()}`},randomUUID()))]);
          const accepted=attempts.filter((item)=>!item.error);
          const denied=attempts.filter((item)=>item.error);
          assert.equal(accepted.length,1,`${prefix}:concurrent-accepted:${JSON.stringify(attempts)}`);
          assert.equal(denied.length,1,`${prefix}:concurrent-denied:${JSON.stringify(attempts)}`);
          assert(["23505","23514"].includes(denied[0].error.code),
            `${prefix}:concurrent-error:${JSON.stringify(denied[0])}`);
          const after=await connectedBasis(prefix,tenant);
          assert.equal(after.schedule.state.assignments.filter((item)=>
            item.workId===first.work.id && item.packageId===first.packageId).length,1);
          evidence.gateASecurity.push({tenant:tenant.workspaceKey,case:"concurrent_conflicting_bookings",
            accepted:1,denied:1,losingRpcError:denied[0].error.code,
            finalBookingCount:1,scheduleRevision:after.schedule.revision});
        }
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
      let workerActor=`${prefix}_worker`;
      let effectivePublication=publication;
      let effectiveAssigned=assigned;
      if(phase2htGateA && prefix==="b") {
        const replacement="Fictional B Replacement";
        const workforce=await call("b_admin","d5o_hosted_workforce_read_v1",{
          p_workspace_key:tenant.workspaceKey});
        assert(!workforce.error,workforce.error?.message);
        const profile=await call("b_admin","d5o_hosted_workforce_impact_command_v1",{
          p_workspace_key:tenant.workspaceKey,p_action:"save-person",
          p_input:{person:replacement,displayName:replacement,
            qualifications:["Service technician"],weeklyCapacityHours:40},
          p_command_id:randomUUID(),p_expected_revision:workforce.data.revision,
          p_expected_schedule_revision:current.schedule.revision});
        assert(!profile.error,`replacement-profile:${profile.error?.message}`);
        const bound=await call("b_admin","d5o_hosted_workforce_impact_command_v1",{
          p_workspace_key:tenant.workspaceKey,p_action:"bind-person",
          p_input:{id:profile.data.id,email:users.b_replacement.email},
          p_command_id:randomUUID(),p_expected_revision:profile.data.revision,
          p_expected_schedule_revision:current.schedule.revision});
        assert(!bound.error,`replacement-bind:${bound.error?.message}`);
        const changed=await call("b_ops","d5o_hosted_crew_command_v1",{
          p_workspace_key:tenant.workspaceKey,p_action:"save-booking",
          p_input:{assignment:{...assigned,people:[replacement],
            crew:"Fictional B replacement crew"}},p_command_id:randomUUID(),
          p_expected_revision:current.schedule.revision});
        assert(!changed.error,`replacement-booking:${changed.error?.message}`);
        const published=await call("b_ops","d5o_hosted_crew_command_v1",{
          p_workspace_key:tenant.workspaceKey,p_action:"publish-week",
          p_input:{week},p_command_id:randomUUID(),
          p_expected_revision:changed.data.revision});
        assert(!published.error,`replacement-publication:${published.error?.message}`);
        const after=await connectedBasis(prefix,tenant);
        effectivePublication=after.schedule.state.publications.at(-1);
        effectiveAssigned=effectivePublication.assignments.find((item)=>
          item.id===assigned.id);
        assert(effectiveAssigned?.people.includes(replacement));
        const old=await call("b_worker","d5o_hosted_worker_schedule_read_v1",{
          p_workspace_key:tenant.workspaceKey});
        assert(!old.error,`old-worker-read:${old.error?.message}`);
        assert.equal(old.data.state.publications.length,0,
          "superseded assignment remains actionable for old worker");
        const oldResponse=await call("b_worker","d5o_hosted_crew_command_v1",{
          p_workspace_key:tenant.workspaceKey,p_action:"respond-booking",
          p_input:{publicationId:publication.id,assignmentId:assigned.id,
            response:"acknowledged"},p_command_id:randomUUID(),
          p_expected_revision:after.schedule.revision});
        assert.equal(oldResponse.error?.code,"23514",JSON.stringify(oldResponse));
        assert.match(oldResponse.error.message,/publication_superseded/);
        if(!server) server=await startNext(url,anon,service);
        if(!designBrowser) designBrowser=await chromium.launch();
        const oldPage=await designBrowser.newPage({viewport:{width:390,height:844}});
        await oldPage.goto(`http://127.0.0.1:${server.port}/auth/sign-in`);
        await oldPage.getByLabel("Email").fill(users.b_worker.email);
        await oldPage.getByLabel("Password").fill(users.b_worker.password);
        await oldPage.getByRole("button",{name:"Continue to your work"}).click();
        await oldPage.waitForURL((location)=>!location.pathname.startsWith("/auth/sign-in"),
          {timeout:30000});
        await oldPage.goto(`http://127.0.0.1:${server.port}/work/customer/${tenant.workspaceKey}/assignments`);
        await oldPage.getByText("No published assignment is available.").waitFor({timeout:30000});
        assert.equal(await oldPage.getByRole("button",{name:"Acknowledge assignment"}).count(),0);
        const dir=resolve(root,"docs/architecture/evidence/phase2ht-gate-a-browser");
        mkdirSync(dir,{recursive:true});
        await oldPage.screenshot({path:resolve(dir,"b-reassigned-worker-mobile.png"),fullPage:true});
        designPages.set("b_worker",oldPage);
        workerActor="b_replacement";
        evidence.gateASecurity.push({tenant:tenant.workspaceKey,
          case:"assignment_reassigned",oldWorkerRpc:oldResponse.error.code,
          oldWorkerActionableAssignments:old.data.state.publications.length,
          newWorkerId:users.b_replacement.id});
      }
      if(phase2hsGateB) {
        if(!designBrowser) designBrowser=await chromium.launch();
        const actor=workerActor;
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
        if(phase2htGateA) {
          const member=JSON.parse(sql(`select pg_catalog.jsonb_build_object('id',id,'revision',revision)::text
            from d5o_hosted.memberships where workspace_id=${q(tenant.workspaceId)}
              and actor_user_id=${q(users[actor].id)};`));
          const before=await connectedBasis(prefix,tenant);
          const suspend=await call(`${prefix}_admin`,"d5o_hosted_org_admin_command_v1",{
            p_workspace_key:tenant.workspaceKey,p_action:"member.suspend",
            p_subject_id:member.id,p_input:{},p_expected_revision:member.revision,
            p_reason:"Suspend fictional field access before acknowledgment",
            p_command_id:randomUUID()});
          assert(!suspend.error,`${prefix}:suspend-worker:${suspend.error?.message}`);
          const forged=await page.evaluate(async({workspace,workId,publicationId,assignmentId,revision})=>{
            const response=await fetch(`/api/d5o-hosted/customer-develop-action?workspace=${workspace}`,{
              method:"POST",headers:{"Content-Type":"application/json"},
              body:JSON.stringify({action:"respond-booking",workId,publicationId,assignmentId,
                expectedRevision:revision,commandId:crypto.randomUUID()})});
            return {status:response.status,body:await response.json()};
          },{workspace:tenant.workspaceKey,workId:first.work.id,publicationId:publication.id,
            assignmentId:assigned.id,revision:before.schedule.revision});
          assert.equal(forged.status,403,`${prefix}:suspended-browser:${JSON.stringify(forged)}`);
          const direct=await call(actor,"d5o_hosted_crew_command_v1",{
            p_workspace_key:tenant.workspaceKey,p_action:"respond-booking",
            p_input:{publicationId:publication.id,assignmentId:assigned.id,response:"acknowledged"},
            p_command_id:randomUUID(),p_expected_revision:before.schedule.revision});
          assert.equal(direct.error?.code,"42501",`${prefix}:suspended-rpc:${JSON.stringify(direct)}`);
          const after=await connectedBasis(prefix,tenant);
          assert.equal(after.schedule.revision,before.schedule.revision);
          const reactivate=await call(`${prefix}_admin`,"d5o_hosted_org_admin_command_v1",{
            p_workspace_key:tenant.workspaceKey,p_action:"member.reactivate",
            p_subject_id:member.id,p_input:{},
            p_expected_revision:suspend.data.record.revision,
            p_reason:"Restore fictional field access for the valid assignment",
            p_command_id:randomUUID()});
          assert(!reactivate.error,`${prefix}:reactivate-worker:${reactivate.error?.message}`);
          evidence.gateASecurity.push({tenant:tenant.workspaceKey,case:"suspended_worker_acknowledgment",
            staleBrowserHttp:forged.status,directRpcError:direct.error.code,
            unchangedScheduleRevision:after.schedule.revision});
          await page.reload();
        }
        const control=page.getByRole("button",{name:"Acknowledge assignment"});
        await control.waitFor({state:"visible",timeout:30000});
        const [ackResponse]=await Promise.all([
          page.waitForResponse((item)=>item.url().includes("/api/d5o-hosted/customer-develop-action")
            && item.request().method()==="POST",{timeout:30000}),control.click()]);
        const result=await ackResponse.json();
        assert.equal(ackResponse.status(),200,`${prefix}:browser-ack:${JSON.stringify(result)}`);
        await page.reload();
        await page.getByText("Acknowledged by you").waitFor({timeout:30000});
        const dir=resolve(root,phase2htGateA
          ? "docs/architecture/evidence/phase2ht-gate-a-browser"
          : "docs/architecture/evidence/phase2hs-develop-browser");
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
          p_input:{publicationId:effectivePublication.id,assignmentId:effectiveAssigned.id,response:"acknowledged"},
          p_command_id:`phase2f-${prefix}-acknowledge-booking`,
          p_expected_revision:current.schedule.revision});
        assert(!response.error,`${prefix}:acknowledge:${response.error?.message}`);
      }
      outcomes.push({tenant:tenant.workspaceKey,workId:first.work.canonicalWorkId,
        packageId:first.packageId,bookingId:assigned.id,publicationId:publication.id,
        workerId:users[workerActor].id,unqualifiedDenied:true});
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
      if(phase2hsGateB || phase2hu) {
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
        const page=designPages.get(phase2htGateA&&prefix==="b"?"b_replacement":`${prefix}_worker`);
        await page.reload();
        await page.getByText("Your next responsibility is Deploy execution",{exact:false})
          .waitFor({timeout:30000});
        const dir=resolve(root,phase2htGateA
          ? "docs/architecture/evidence/phase2ht-gate-a-browser"
          : "docs/architecture/evidence/phase2hs-develop-browser");
        await page.screenshot({path:resolve(dir,`${prefix}-deploy-responsibility.png`),fullPage:true});
      }
      outcomes.push({tenant:tenant.workspaceKey,workId:current.work.canonicalWorkId,
        permitId:permit.id,releaseId:permit.releaseId,configurationVersionId:current.work.phaseConfigurationVersionId,
        unauthorizedDenied:true,crossTenantDenied:true});
    }
    return outcomes;
  });
  if(phase2htGateA) await check("unknown, foreign and draft configuration cannot replace the Work pin",async()=>{
    const basis=await connectedBasis("a",a);
    const pinned=basis.work.phaseConfigurationVersionId;
    assert.equal(pinned,versions.a_admin);
    const activeRevision=Number(sql(`select edit_revision from d5o_hosted.configuration_versions
      where id=${q(pinned)};`));
    const draft=await config("a_admin",a.workspaceKey,"create-draft",pinned,pinned,
      activeRevision,{},`invalid-pin-${randomUUID()}`);
    assert(!draft.error,`draft-fixture:${draft.error?.message}`);
    if(rc3)rc3PrepublicationDraftId=draft.data.versionId;
    const cases=[["unknown",randomUUID()], ["foreign",versions.b_admin],
      ["draft",draft.data.versionId]];
    const denied=[];
    for(const [kind,version] of cases) {
      const result=await call("a_pm","d5o_hosted_create_work_v1",{
        p_workspace_key:a.workspaceKey,p_command_id:randomUUID(),
        p_configuration_version_id:version,p_work_type_key:"lifecycle-service",
        p_title:`Forbidden ${kind} policy substitution`});
      assert(result.error,`${kind}:unpublished-or-foreign-version-created-work`);
      denied.push({kind,rpcError:result.error.code,message:result.error.message});
    }
    const page=designPages.get("a_ops");
    assert(page,"authenticated Develop actor required");
    const clientOverride=await page.evaluate(async({workspace,workId,version})=>{
      const response=await fetch(`/api/d5o-hosted/customer-develop-action?workspace=${workspace}`,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({action:"publish-week",workId,configurationVersionId:version,
          expectedRevision:0,commandId:crypto.randomUUID()})});
      return {status:response.status,body:await response.json()};
    },{workspace:a.workspaceKey,workId:basis.work.id,version:versions.b_admin});
    assert.equal(clientOverride.status,400,JSON.stringify(clientOverride));
    assert.equal(clientOverride.body.error,"client_configuration_override_forbidden");
    denied.push({kind:"forged_client_override",httpStatus:clientOverride.status,
      error:clientOverride.body.error});
    const after=await connectedBasis("a",a);
    assert.equal(after.work.phaseConfigurationVersionId,pinned);
    evidence.gateASecurity.push({tenant:a.workspaceKey,case:"invalid_configuration_reference",
      denied,pinnedVersion:pinned,unchanged:true});
    return {denied,pinnedVersion:pinned};
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
    let unrelatedCapabilities=null;
    if(phase2htGateA || phase2htd) {
      const unit=await call("b_admin","d5o_hosted_org_admin_command_v1",{
        p_workspace_key:b.workspaceKey,p_action:"unit.create",p_subject_id:null,
        p_input:{code:`SVC${randomUUID().slice(0,5).toUpperCase()}`,
          name:"Fictional unaffected operations"},p_expected_revision:0,
        p_reason:"Verify organization commands remain available while connected Work is disabled",
        p_command_id:randomUUID()});
      assert(!unit.error,`disabled-feature-org:${unit.error?.message}`);
      const version=versions.b_admin;
      const editRevision=Number(sql(`select edit_revision from d5o_hosted.configuration_versions
        where id=${q(version)};`));
      const draft=await config("b_admin",b.workspaceKey,"create-draft",version,version,
        editRevision,{},`feature-scope-${randomUUID()}`);
      assert(!draft.error,`disabled-feature-config:${draft.error?.message}`);
      const ordinaryType=sql(`select work_type_key from d5o_hosted.configuration_work_types
        where configuration_version_id=${q(version)} and status='active' limit 1;`);
      assert(ordinaryType,`disabled-feature-no-active-work-type:version=${version}`);
      const ordinary=await call("b_admin","d5o_hosted_create_work_v1",{
        p_workspace_key:b.workspaceKey,p_command_id:randomUUID(),
        p_configuration_version_id:version,p_work_type_key:ordinaryType,
        p_title:"Unrelated ordinary Work under disabled connected rollout"});
      assert(!ordinary.error,`disabled-feature-ordinary-work:${ordinary.error?.message}`);
      const provisioned=await call("vendor","d5o_platform_provision_v1",{
        ...bArgs,p_request_id:`feature-scope-${randomUUID()}`,
        p_workspace_key:`feature_scope_${randomUUID().slice(0,8)}`,
        p_display_name:"Fictional feature-scope customer"});
      assert(!provisioned.error,`disabled-feature-provision:${provisioned.error?.message}`);
      const member=JSON.parse(sql(`select pg_catalog.jsonb_build_object('id',id,'revision',revision)::text
        from d5o_hosted.memberships where workspace_id=${q(b.workspaceId)}
          and actor_user_id=${q(users.b_finance.id)};`));
      const suspended=await call("b_admin","d5o_hosted_org_admin_command_v1",{
        p_workspace_key:b.workspaceKey,p_action:"member.suspend",p_subject_id:member.id,
        p_input:{},p_expected_revision:member.revision,
        p_reason:"Verify membership commands remain available while connected Work is disabled",
        p_command_id:randomUUID()});
      assert(!suspended.error,`disabled-feature-member:${suspended.error?.message}`);
      const reactivated=await call("b_admin","d5o_hosted_org_admin_command_v1",{
        p_workspace_key:b.workspaceKey,p_action:"member.reactivate",p_subject_id:member.id,
        p_input:{},p_expected_revision:suspended.data.record.revision,
        p_reason:"Restore fictional finance membership after feature scope test",
        p_command_id:randomUUID()});
      assert(!reactivated.error,`disabled-feature-member-restore:${reactivated.error?.message}`);
      unrelatedCapabilities={organizationMutation:"allowed",configurationDraft:"allowed",
        ordinaryWork:"allowed",vendorProvisioning:"allowed",membershipAdministration:"allowed",
        connectedMutation:"denied",directConnectedRpc:"denied"};
      evidence.gateASecurity??=[];
      evidence.gateASecurity.push({tenant:b.workspaceKey,case:"feature_scope",
        ...unrelatedCapabilities,organizationId:unit.data.id,draftId:draft.data.versionId});
    }
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
      unchangedWorkforceRevision:afterWorkforce.data.revision,unrelatedCapabilities};
  });
  if(!phase2hsGateB || rc3) {
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
  const deployPages=new Map();
  async function deployPage(actor,tenant,path,viewport={width:1440,height:900}) {
    if(!server) server=await startNext(url,anon,service);
    if(!designBrowser) designBrowser=await chromium.launch();
    let page=deployPages.get(actor);
    if(!page) {
      page=await designBrowser.newPage({viewport});
      const workerSignIn=actor.endsWith("_worker") || actor==="b_replacement";
      const firstPath=workerSignIn ? path : "/work";
      await page.goto(`http://127.0.0.1:${server.port}/auth/sign-in?next=${encodeURIComponent(firstPath)}`);
      await page.waitForLoadState("networkidle");
      page.on("response",(response)=>{if(response.request().method()==="POST")
        console.log(JSON.stringify({deployStep:`${actor}:sign-in-response`,status:response.status(),url:response.url()}));});
      page.on("pageerror",(error)=>console.log(JSON.stringify({deployStep:`${actor}:page-error`,message:error.message})));
      await page.getByLabel("Email").fill(users[actor].email);
      await page.getByLabel("Password").fill(users[actor].password);
      const formValid=await page.locator("form").evaluate((form)=>form.checkValidity());
      assert(formValid,`${actor}:sign_in_form_invalid`);
      await page.getByRole("button",{name:"Continue to your work"}).click();
      await (workerSignIn
        ? page.waitForURL((location)=>location.pathname===new URL(path,"http://127.0.0.1").pathname,{timeout:30000})
        : page.getByRole("link",{name:/Open workspace/}).first().waitFor({timeout:30000})).catch(async(error)=>{
        throw Error(`${actor}:sign_in_navigation:${page.url()}:${(await page.locator("body").innerText()).slice(0,500)}:${server.diagnostics().slice(-600)}:${error.message}`);
      });
      if(!workerSignIn) {
        await page.locator(`[data-workspace="${tenant.workspaceKey}"]`).click();
        await page.getByRole("heading",{name:"Work lifecycle"}).waitFor({timeout:30000});
      }
      deployPages.set(actor,page);
      if(page.url()!==`http://127.0.0.1:${server.port}${path}`)
        await page.goto(`http://127.0.0.1:${server.port}${path}`);
      return page;
    }
    await page.goto(`http://127.0.0.1:${server.port}${path}`);
    return page;
  }
  async function browserDeployDecision(page,button,endpoint,expected=200,method="POST") {
    await button.waitFor({state:"visible"});
    // A visible server-rendered submit button can still perform a native GET
    // before Next hydrates its client handler. Wait for the actual React props.
    const hydrated=await button.elementHandle();
    await page.waitForFunction((element)=>element?.isConnected &&
      Object.keys(element).some((key)=>key.startsWith("__reactProps$")),hydrated,
      {timeout:30000});
    console.log(JSON.stringify({deployStep:"submit-decision",endpoint,button:await button.innerText(),url:page.url()}));
    let response;
    try {
      [response]=await Promise.all([
        page.waitForResponse((item)=>item.url().includes(endpoint)&&item.request().method()===method),
        button.click()]);
    } catch(error) {
      const diagnostics=await button.evaluate((control)=>({
        formValid:control.closest("form")?.checkValidity(),
        invalid:[...(control.closest("form")?.elements??[])].filter((item)=>!item.validity.valid)
          .map((item)=>({name:item.name,reason:item.validationMessage})),
        disabled:control.disabled,
        alerts:[...document.querySelectorAll('[role="alert"]')].map((item)=>item.textContent),
        status:[...document.querySelectorAll('[role="status"]')].map((item)=>item.textContent).slice(0,5)
      })).catch(()=>({navigation:page.url()}));
      throw Error(`deploy_decision_no_response:${endpoint}:${await button.innerText().catch(()=>"unknown")}`+
        `:${error.message}:${JSON.stringify(diagnostics)}`);
    }
    const body=await response.text().catch(()=>"response body unavailable after navigation");
    assert.equal(response.status(),expected,`deploy_browser:${endpoint}:${body}`);
    return {status:response.status(),body:body.slice(0,500),
      ...(phase2hvc && endpoint.includes("prototype-operate-command")
        ? {command:response.request().postDataJSON()} : {})};
  }
  async function refreshDeployRead(page) {
    const target=page.url();
    try {
      await page.goto(target,{waitUntil:"domcontentloaded"});
    } catch(error) {
      // Next dev navigation may be interrupted by a route refresh after a
      // successful command. Retrying this read does not replay the decision.
      if(!String(error).includes("ERR_ABORTED")) throw error;
      await page.goto(target,{waitUntil:"domcontentloaded"});
    }
    await page.getByRole("button",{name:"Acceptance & turnover"}).waitFor();
    await page.waitForFunction(() => {
      const button=[...document.querySelectorAll("button")].find((item)=>
        item.textContent?.trim()==="Acceptance & turnover");
      return !!button && Object.keys(button).some((key)=>key.startsWith("__reactProps$"));
    });
  }
  async function openAcceptanceTab(page) {
    await page.getByRole("button",{name:"Acceptance & turnover"}).click();
    await page.getByRole("heading",{name:"Whole Work Record · Client Accepted"}).waitFor()
      .catch(async(error)=>{throw Error(`acceptance_tab_unavailable:${page.url()}:${
        (await page.locator("body").innerText()).slice(0,700)}:${error.message}`);});
  }
  async function phase2huField(prefix,tenant) {
    const basis=await connectedBasis(prefix,tenant);
    if(phase2hvc && prefix==="a") await deniedOperateCase("missing_deploy_completion","a",a,
      ()=>call("a_ops","d5o_hosted_operate_command_v1",{
        p_workspace_key:a.workspaceKey,p_presentation_id:basis.work.id,
        p_action:"receive-handoff",p_input:{workAcceptanceId:randomUUID(),
          workAcceptanceRevision:1,note:"Rejected premature Operations handoff"},
        p_command_id:randomUUID(),p_expected_source_revision:basis.source.revision,
        p_expected_deploy_revision:basis.deploy.revision,
        p_expected_operate_revision:basis.operate.revision}),["23514"]);
    const publication=basis.schedule.state.publications.at(-1);
    const booking=publication?.assignments.find((item)=>item.packageId===basis.packageId&&item.workId===basis.work.id);
    assert(booking,`${prefix}:published_field_booking_missing`);
    const dir=resolve(root,phase2hvcFinal?"docs/release/evidence/phase2hvc-final-browser":phase2hvc?"docs/release/evidence/phase2hvc-browser":phase2hv?"docs/architecture/evidence/phase2hv-browser":"docs/architecture/evidence/phase2hu-browser");mkdirSync(dir,{recursive:true});
    const workerActor=phase2htGateA&&prefix==="b"?"b_replacement":`${prefix}_worker`;
    const worker=await deployPage(workerActor,tenant,
      `/work/customer/${tenant.workspaceKey}/assignments`,{width:390,height:844});
    console.log(JSON.stringify({deployStep:`${prefix}:open-field`,url:worker.url()}));
    await worker.getByRole("link",{name:"Open field execution"}).click();
    await worker.waitForURL((location)=>location.pathname===`/work/customer/${tenant.workspaceKey}/field`,
      {timeout:30000});
    await worker.getByRole("heading",{name:basis.work.title}).waitFor({timeout:30000});
    assert.equal(worker.url().includes(`/work/customer/${tenant.workspaceKey}/field`),true);
    await worker.getByText("Authorized start",{exact:true}).waitFor();
    await worker.screenshot({path:resolve(dir,`${prefix}-field-assigned-mobile.png`),fullPage:true});
    const photo=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRxkAAAAASUVORK5CYII=","base64");
    const evidenceForm=worker.locator("#field-files form");
    await evidenceForm.getByLabel("File").setInputFiles({name:`${prefix}-completion.png`,mimeType:"image/png",buffer:photo});
    await evidenceForm.getByLabel("Purpose").selectOption("Inspection result");
    await evidenceForm.getByLabel("Caption").fill("Fictional completed service condition photograph");
    const upload=await browserDeployDecision(worker,evidenceForm.getByRole("button",{name:"Upload file"}),
      "/api/d5o-hosted/worker-deploy",200,"PUT");
    const reportForm=worker.locator("#report-work form");
    await reportForm.getByLabel("Quantity").fill("1");
    if((await reportForm.getByLabel("Unit").getAttribute("readonly"))===null)
      await reportForm.getByLabel("Unit").fill("service");
    await reportForm.getByLabel("Actual labor hours").fill("2");
    await reportForm.getByLabel("Work and conditions").fill("Fictional restoration performed and service verified");
    await reportForm.locator('input[name="evidenceId"]').first().check();
    await browserDeployDecision(worker,reportForm.getByRole("button",{name:"Synchronize report"}),
      "/api/d5o-hosted/worker-deploy",200);
    await browserDeployDecision(worker,worker.getByRole("button",{name:"Submit for supervisor review"}),
      "/api/d5o-hosted/worker-deploy",200);
    let current=await connectedBasis(prefix,tenant);
    const report=current.deploy.state.reports.find((item)=>item.packageId===current.packageId);
    assert.equal(report?.status,"Submitted",`${prefix}:browser_report_submission`);
    if(rc0DeployIntegrity && prefix==="b") await rc0Case("pending field task rejects suspended worker session",async()=>{
      const people=await call("b_admin","d5o_hosted_org_admin_read_v1",{
        p_workspace_key:tenant.workspaceKey,p_kind:"people",p_search:"",p_offset:0,p_limit:25});
      assert(!people.error,people.error?.message);
      const member=people.data.items.find((item)=>item.actor_user_id===users.b_worker.id);
      assert(member,"pending_worker_membership_missing");
      const suspended=await call("b_admin","d5o_hosted_org_admin_command_v1",{
        p_workspace_key:tenant.workspaceKey,p_action:"member.suspend",p_subject_id:member.id,p_input:{},
        p_expected_revision:member.revision,p_reason:"RC0 pending worker authorization check",p_command_id:randomUUID()});
      assert(!suspended.error,suspended.error?.message);
      try {
        const denied=await deployCommand(prefix,tenant,"b_worker","save-report",{
          bookingId:booking.id,quantity:1,unit:"service",laborHours:2,
          summary:"Stale worker attempts to change submitted report"},`rc0-suspended-${randomUUID()}`);
        assert.equal(denied.error?.code,"42501",JSON.stringify(denied));
      } finally {
        const restored=await call("b_admin","d5o_hosted_org_admin_command_v1",{
          p_workspace_key:tenant.workspaceKey,p_action:"member.reactivate",p_subject_id:member.id,p_input:{},
          p_expected_revision:suspended.data.record.revision,p_reason:"Restore RC0 fictional worker",p_command_id:randomUUID()});
        assert(!restored.error,restored.error?.message);
      }
      const after=await connectedBasis(prefix,tenant);
      assert.equal(after.deploy.revision,current.deploy.revision);
      return {worker:users.b_worker.id,reportId:report.id,unchangedRevision:after.deploy.revision};
    });
    if(rc0DeployIntegrity && prefix==="b") await rc0Case("open assignment rejects removed worker session",async()=>{
      const people=await call("b_admin","d5o_hosted_org_admin_read_v1",{
        p_workspace_key:tenant.workspaceKey,p_kind:"people",p_search:"",p_offset:0,p_limit:25});
      assert(!people.error,people.error?.message);
      const member=people.data.items.find((item)=>item.actor_user_id===users.b_worker.id);
      assert(member,"assigned_worker_membership_missing");
      const before=await connectedBasis(prefix,tenant);
      const removed=await call("b_admin","d5o_hosted_org_admin_command_v1",{
        p_workspace_key:tenant.workspaceKey,p_action:"member.remove",p_subject_id:member.id,p_input:{},
        p_expected_revision:member.revision,p_reason:"RC0 removed assigned worker check",p_command_id:randomUUID()});
      assert(!removed.error,removed.error?.message);
      let denial;
      try {
        denial=await deployCommand(prefix,tenant,"b_worker","save-report",{
          bookingId:booking.id,quantity:1,unit:"service",laborHours:2,
          summary:"Removed worker attempts to use an open assignment"},`rc0-removed-${randomUUID()}`);
        assert.equal(denial.error?.code,"42501",JSON.stringify(denial));
        const evidenceId=before.deploy.state.evidence.find((item)=>item.packageId===before.packageId)?.id;
        assert(evidenceId,"assigned_worker_evidence_missing");
        const http=await worker.evaluate(async({workspace,workId,id})=>{
          const response=await fetch(`/api/d5o-hosted/worker-deploy?workspace=${workspace}`+
            `&workId=${encodeURIComponent(workId)}&evidenceId=${id}`);
          return response.status;
        },{workspace:tenant.workspaceKey,workId:before.work.id,id:evidenceId});
        assert.equal(http,403);
      } finally {
        // Disposable-fixture restoration only: removal is terminal in the product.
        // Restore this synthetic member so subsequent positive browser decisions run.
        sql(`update d5o_hosted.memberships set status='active',revision=revision+1
          where id=${q(member.id)} and status='removed';`);
      }
      const after=await connectedBasis(prefix,tenant);
      assert.equal(after.deploy.revision,before.deploy.revision);
      return {worker:users.b_worker.id,bookingId:booking.id,denial:denial.error.message,
        unchangedRevision:after.deploy.revision,fixtureRestored:true};
    });
    if(prefix==="a") {
      const directory=await call("vendor","d5o_platform_provisioning_directory_v1");
      assert(!directory.error,directory.error?.message);
      const tenantEntry=directory.data.find((item)=>item.workspaceKey===tenant.workspaceKey);
      const disabled=await call("vendor","d5o_platform_capability_command_v1",{
        p_workspace_key:tenant.workspaceKey,p_kind:"flag",p_enabled:false,
        p_expected_revision:tenantEntry.connectedWorkFlagRevision,p_command_id:randomUUID(),
        p_reason:"Verify a pending field review cannot bypass disabled connected Work"});
      assert(!disabled.error,`${prefix}:disable-field-rollout:${disabled.error?.message}`);
      let direct;
      try {
        direct=await call(`${prefix}_ops`,"d5o_hosted_field_fact_command_v1",{
          p_workspace_key:tenant.workspaceKey,p_presentation_id:current.work.id,
          p_package_id:current.packageId,p_action:"review-report",
          p_input:{reportId:report.id,decision:"Reviewed",
            note:"Independent review while connected Work is disabled"},
          p_command_id:`phase2hu-disabled-pending-${randomUUID()}`,
          p_expected_source_revision:current.source.revision,
          p_expected_design_revision:current.work.design.authorityRevision,
          p_expected_schedule_revision:current.schedule.revision,
          p_expected_deploy_revision:current.deploy.revision});
      } finally {
        const enabled=await call("vendor","d5o_platform_capability_command_v1",{
          p_workspace_key:tenant.workspaceKey,p_kind:"flag",p_enabled:true,
          p_expected_revision:disabled.data.revision,p_command_id:randomUUID(),
          p_reason:"Restore connected Work after pending field review denial"});
        assert(!enabled.error,`${prefix}:restore-field-rollout:${enabled.error?.message}`);
      }
      assert.equal(direct.error?.code,"42501",`${prefix}:disabled_pending_rpc:${JSON.stringify(direct)}`);
      const afterDenied=await connectedBasis(prefix,tenant);
      assert.equal(afterDenied.deploy.revision,current.deploy.revision,
        `${prefix}:disabled_pending_rpc_changed_deploy`);
    }
    const ops=await deployPage(`${prefix}_ops`,tenant,
      `/work/customer/${tenant.workspaceKey}`);
    await ops.getByRole("link",{name:/Field report review/}).waitFor();
    console.log(JSON.stringify({deployStep:`${prefix}:open-report-review`,url:ops.url()}));
    console.log(JSON.stringify({deployStep:`${prefix}:report-link`,href:await ops.getByRole("link",{name:/Field report review/}).getAttribute("href")}));
    ops.on("response",(response)=>{if(response.request().resourceType()==="document" || response.url().includes(`/work/customer/${tenant.workspaceKey}/deploy`))
      console.log(JSON.stringify({deployStep:`${prefix}:report-route-response`,status:response.status(),url:response.url()}));});
    ops.on("pageerror",(error)=>console.log(JSON.stringify({deployStep:`${prefix}:page-error`,message:error.message})));
    await ops.getByRole("link",{name:/Field report review/}).click();
    await ops.waitForURL((location)=>location.pathname===`/work/customer/${tenant.workspaceKey}/deploy`).catch(async(error)=>{
      const href=await ops.getByRole("link",{name:/Field report review/}).getAttribute("href");
      const direct=await ops.goto(`http://127.0.0.1:${server.port}${href}`);
      throw Error(`${prefix}:report_navigation:direct_status=${direct?.status()}:direct_url=${ops.url()}:body=${(await ops.locator("body").innerText()).slice(0,500)}:click=${error.message}`);
    });
    const reportReview=ops.locator('[data-task-panel="report-review"] form');
    await reportReview.getByLabel("Review reason").fill("Independent supervisor review of performed field work");
    await browserDeployDecision(ops,reportReview.getByRole("button",{name:"Record independent review"}),
      "/api/d5o-hosted/prototype-deploy-command",200);
    await worker.reload();
    const inspection=worker.getByRole("heading",{name:"Inspect and retest"}).locator("..").locator("form");
    await inspection.getByLabel("Released requirement").selectOption({index:1});
    await inspection.getByLabel("Acceptance requirement").fill("Restored service passes functional check");
    await inspection.getByLabel("Test or inspection method").fill("Observed functional service restoration");
    await inspection.getByLabel("Observed result").selectOption("Pass");
    await browserDeployDecision(worker,inspection.getByRole("button",{name:"Submit result for quality review"}),
      "/api/d5o-hosted/worker-deploy",200);
    current=await connectedBasis(prefix,tenant);
    const inspectionId=current.deploy.state.inspections.find((item)=>item.packageId===basis.packageId&&item.status==="Submitted")?.id;
    assert(inspectionId,`${prefix}:inspection_not_submitted`);
    await ops.goto(`http://127.0.0.1:${server.port}/work/customer/${tenant.workspaceKey}`);
    await ops.getByRole("link",{name:/Inspection verification/}).waitFor();
    console.log(JSON.stringify({deployStep:`${prefix}:open-inspection-review`,url:ops.url()}));
    await ops.getByRole("link",{name:/Inspection verification/}).click();
    await ops.waitForURL((location)=>location.pathname===`/work/customer/${tenant.workspaceKey}/deploy`);
    const quality=ops.locator('[data-task-panel="inspection-review"] form').filter({has:ops.getByRole("button",{name:"Record quality review"})});
    await quality.waitFor({timeout:20000}).catch(async()=>{
      throw Error(`${prefix}:quality_form:${(await ops.locator("body").innerText()).slice(0,700)}`);
    });
    await quality.getByLabel("Reason").fill("Independent verification of passing field inspection");
    await browserDeployDecision(ops,quality.getByRole("button",{name:"Record quality review"}),
      "/api/d5o-hosted/prototype-deploy-command",200);
    await worker.reload();
    const issueForm=worker.locator("form").filter({has:worker.getByRole("button",{name:"Raise condition and hold further start"})});
    await issueForm.getByLabel("Unexpected condition").fill("Fictional cable cover condition");
    await issueForm.getByLabel("Impact and affected scope").fill("Inspect and correct a loose cover before handoff");
    await issueForm.locator('input[name="evidenceId"]').first().check();
    await browserDeployDecision(worker,issueForm.getByRole("button",{name:"Raise condition and hold further start"}),
      "/api/d5o-hosted/field-changes",200);
    let changes=await call(`${prefix}_ops`,"d5o_hosted_field_change_read_v1",{
      p_workspace_key:tenant.workspaceKey,p_presentation_id:basis.work.id});
    assert(!changes.error,`${prefix}:issue_read:${changes.error?.message}`);
    const raised=changes.data.changes.find((item)=>item.status==="Open"&&item.packageId===basis.packageId);
    assert(raised,`${prefix}:browser_issue_missing`);
    const held=await deployCommand(prefix,tenant,`${prefix}_ops`,"review-completion",{
      note:"Attempt completion with unresolved fictional field condition"},`issue-hold-${randomUUID()}`);
    assert(held.error,`${prefix}:issue_hold_not_denied`);
    if(prefix==="b") assert.equal(held.error.message,"open_field_change_blocks_completion",
      `${prefix}:issue_hold:${held.error.message}`);
    await ops.goto(`http://127.0.0.1:${server.port}/work/customer/${tenant.workspaceKey}/deploy?workId=${encodeURIComponent(basis.work.id)}`);
    await ops.getByRole("button",{name:"Inspections & issues"}).click();
    const assess=ops.locator("form").filter({has:ops.getByRole("button",{name:"Assess condition"})});
    await assess.getByLabel("Disposition").selectOption("Correction");
    await assess.getByLabel("Independent assessment").fill("Independent assessment of a correctable field condition");
    await browserDeployDecision(ops,assess.getByRole("button",{name:"Assess condition"}),
      "/api/d5o-hosted/field-changes",200);
    const resolveForm=ops.locator("form").filter({has:ops.getByRole("button",{name:"Resolve against approved basis"})});
    await resolveForm.getByLabel("Resolution and current Design receipt").fill("Corrected cover and retained original approved Design basis");
    await browserDeployDecision(ops,resolveForm.getByRole("button",{name:"Resolve against approved basis"}),
      "/api/d5o-hosted/field-changes",200);
    changes=await call(`${prefix}_ops`,"d5o_hosted_field_change_read_v1",{
      p_workspace_key:tenant.workspaceKey,p_presentation_id:basis.work.id});
    assert.equal(changes.data.changes.find((item)=>item.id===raised.id)?.status,"Resolved");
    current=await connectedBasis(prefix,tenant);
    await ops.goto(`http://127.0.0.1:${server.port}/work/customer/${tenant.workspaceKey}/deploy?workId=${encodeURIComponent(basis.work.id)}`);
    await ops.getByRole("button",{name:"Field work",exact:true}).click();
    const completion=ops.locator('[data-task-panel="completion-review"] form');
    await completion.getByLabel("Independent review reason").fill("Independent quality review of completed fictional package");
    let denied;
    if(rc0DeployIntegrity && prefix==="b") {
      await rc0Case("wrong Work, package and forged field evidence leave state unchanged",async()=>{
        const before=await connectedBasis(prefix,tenant);
        const item=before.deploy.state.evidence.find((entry)=>entry.packageId===before.packageId);
        assert(item,"pending_field_evidence_missing");
        const args={p_workspace_key:tenant.workspaceKey,p_presentation_id:before.work.id,
          p_package_id:before.packageId,p_action:"review-evidence",
          p_input:{evidenceId:item.id,decision:"Reviewed",note:"RC0 scope probe"},
          p_command_id:`rc0-scope-${randomUUID()}`,p_expected_source_revision:before.source.revision,
          p_expected_design_revision:before.work.design.authorityRevision,
          p_expected_schedule_revision:before.schedule.revision,p_expected_deploy_revision:before.deploy.revision};
        const foreign=await connectedBasis("a",a);
        const probes=await Promise.all([
          call("b_ops","d5o_hosted_field_evidence_command_v1",{...args,p_presentation_id:foreign.work.id,p_command_id:`rc0-wrong-work-${randomUUID()}`}),
          call("b_ops","d5o_hosted_field_evidence_command_v1",{...args,p_package_id:randomUUID(),p_command_id:`rc0-wrong-package-${randomUUID()}`}),
          call("b_ops","d5o_hosted_field_evidence_command_v1",{...args,p_input:{...args.p_input,evidenceId:randomUUID()},p_command_id:`rc0-forged-evidence-${randomUUID()}`})]);
        assert(probes.every((item)=>item.error),JSON.stringify(probes));
        const after=await connectedBasis(prefix,tenant);
        assert.equal(after.deploy.revision,before.deploy.revision);
        return {evidenceId:item.id,denials:probes.map((item)=>({code:item.error.code,message:item.error.message})),unchangedRevision:after.deploy.revision};
      });
      await rc0Case("conflicting pending evidence reviews serialize",async()=>{
        const before=await connectedBasis(prefix,tenant);
        const item=before.deploy.state.evidence.find((entry)=>entry.packageId===before.packageId&&entry.state!=="Reviewed");
        assert(item,"unreviewed_evidence_missing");
        const args={p_workspace_key:tenant.workspaceKey,p_presentation_id:before.work.id,
          p_package_id:before.packageId,p_action:"review-evidence",
          p_input:{evidenceId:item.id,decision:"Reviewed",note:"Independent RC0 review"},
          p_command_id:`rc0-evidence-reviewed-${randomUUID()}`,
          p_expected_source_revision:before.source.revision,
          p_expected_design_revision:before.work.design.authorityRevision,
          p_expected_schedule_revision:before.schedule.revision,p_expected_deploy_revision:before.deploy.revision};
        const results=await Promise.all([
          call("b_ops","d5o_hosted_field_evidence_command_v1",args),
          call("b_ops","d5o_hosted_field_evidence_command_v1",{...args,
            p_input:{...args.p_input,decision:"Rejected",note:"Conflicting RC0 review"},
            p_command_id:`rc0-evidence-rejected-${randomUUID()}`})]);
        assert.equal(results.filter((result)=>!result.error).length,1,JSON.stringify(results));
        const after=await connectedBasis(prefix,tenant);
        const terminal=after.deploy.state.evidence.find((entry)=>entry.id===item.id);
        assert(["Reviewed","Rejected"].includes(terminal?.state),JSON.stringify(terminal));
        return {evidenceId:item.id,decisions:results.map((result)=>result.error?.message??"accepted"),
          terminalState:terminal.state,revisionBefore:before.deploy.revision,revisionAfter:after.deploy.revision};
      });
      await rc0Case("concurrent completion and exact/conflicting replay preserve one receipt",async()=>{
        const before=await connectedBasis(prefix,tenant);
        const args={p_workspace_key:tenant.workspaceKey,p_presentation_id:before.work.id,
          p_package_id:before.packageId,p_action:"review-completion",
          p_input:{note:"RC0 independent completion A"},
          p_command_id:`rc0-completion-a-${randomUUID()}`,
          p_expected_source_revision:before.source.revision,
          p_expected_design_revision:before.work.design.authorityRevision,
          p_expected_schedule_revision:before.schedule.revision,p_expected_deploy_revision:before.deploy.revision};
        const other={...args,p_input:{note:"RC0 independent completion B"},
          p_command_id:`rc0-completion-b-${randomUUID()}`};
        const results=await Promise.all([
          call("b_ops","d5o_hosted_field_fact_command_v1",args),
          call("b_ops","d5o_hosted_field_fact_command_v1",other)]);
        assert.equal(results.filter((result)=>!result.error).length,1,JSON.stringify(results));
        const winner=results[0].error?other:args;
        const after=await connectedBasis(prefix,tenant);
        assert.equal(after.deploy.state.completions.filter((item)=>item.packageId===before.packageId&&item.status==="Reviewed").length,1);
        const replay=await call("b_ops","d5o_hosted_field_fact_command_v1",winner);
        assert(!replay.error,JSON.stringify(replay));
        const conflict=await call("b_ops","d5o_hosted_field_fact_command_v1",{...winner,
          p_input:{note:"Conflicting reuse of accepted RC0 command"}});
        assert(conflict.error,JSON.stringify(conflict));
        const final=await connectedBasis(prefix,tenant);
        assert.equal(final.deploy.revision,after.deploy.revision);
        return {winnerCommandId:winner.p_command_id,loserError:results.find((item)=>item.error)?.error?.message,
          replayAccepted:true,conflictError:conflict.error.message,revisionBefore:before.deploy.revision,
          revisionAfter:final.deploy.revision};
      });
      denied={body:null};
    } else denied=await browserDeployDecision(ops,completion.getByRole("button",{name:"Record reviewed completion"}),
      "/api/d5o-hosted/prototype-deploy-command",prefix==="a"?409:200);
    if(prefix==="a") {
      assert.match(denied.body,/reviewed_evidence_required/);
      await ops.getByRole("alert").getByText(/independently reviewed completion photo or document/).waitFor();
      await ops.goto(`http://127.0.0.1:${server.port}/work/customer/${tenant.workspaceKey}/deploy?workId=${encodeURIComponent(basis.work.id)}`);
      await ops.getByRole("button",{name:"Field work",exact:true}).click();
      const fileLink=ops.getByRole("link",{name:"Open actual file"}).first();
      await fileLink.waitFor();
      const fileHref=await fileLink.getAttribute("href");
      const reviewerFile=await ops.evaluate(async(href)=>{
        const response=await fetch(href);
        return {status:response.status,bytes:(await response.arrayBuffer()).byteLength};
      },fileHref);
      assert.equal(reviewerFile.status,200,`${prefix}:reviewer_private_evidence_read`);
      assert(reviewerFile.bytes>0,`${prefix}:reviewer_private_evidence_empty`);
      const evidenceReview=ops.locator('[data-task-panel="evidence-review"] form');
      await evidenceReview.getByLabel("Reason").fill("Independent review of authentic fictional field photograph");
      await browserDeployDecision(ops,evidenceReview.getByRole("button",{name:"Record independent review"}),
        "/api/d5o-hosted/prototype-deploy-command",200);
      const reviewed=await connectedBasis(prefix,tenant);
      assert(reviewed.deploy.state.evidence.some((item)=>item.packageId===basis.packageId&&item.state==="Reviewed"),
        `${prefix}:evidence_not_reviewed`);
      await ops.reload();
      await ops.getByRole("button",{name:"Field work",exact:true}).click();
      const retryCompletion=ops.locator('[data-task-panel="completion-review"] form');
      await retryCompletion.getByLabel("Independent review reason").fill("Measured and evidenced package completion is ready");
      await browserDeployDecision(ops,retryCompletion.getByRole("button",{name:"Record reviewed completion"}),
        "/api/d5o-hosted/prototype-deploy-command",200);
    }
    current=await connectedBasis(prefix,tenant);
    assert(current.deploy.state.completions.some((item)=>item.packageId===basis.packageId&&item.status==="Reviewed"));
    await worker.reload();await ops.reload();
    const evidenceLink=worker.getByRole("link",{name:"View uploaded file"}).first();
    await evidenceLink.waitFor();
    const evidenceHref=await evidenceLink.getAttribute("href");
    const evidenceRead=await worker.evaluate(async(href)=>{
      const response=await fetch(href);
      return {status:response.status,bytes:(await response.arrayBuffer()).byteLength};
    },evidenceHref);
    assert.equal(evidenceRead.status,200,`${prefix}:private_evidence_read`);
    assert(evidenceRead.bytes>0,`${prefix}:private_evidence_empty`);
    await worker.screenshot({path:resolve(dir,`${prefix}-field-complete-mobile.png`),fullPage:true});
    await ops.screenshot({path:resolve(dir,`${prefix}-completion-review.png`),fullPage:true});
    return {tenant:tenant.workspaceKey,workId:basis.work.id,packageId:basis.packageId,
      bookingId:booking.id,reportId:report.id,inspectionId,fieldChangeId:raised.id,upload,
      policyRejection:prefix==="a"?denied.body:null,
      completionId:current.deploy.state.completions.find((item)=>item.packageId===basis.packageId)?.id,
      evidenceRead};
  }
  await check("Deploy completion enforces reviewed evidence only for the pinned strict tenant",async()=>{
    if(phase2hu) return [await phase2huField("a",a),await phase2huField("b",b)];
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
  async function rc0RaceCustomerAcceptance(prefix,tenant,action,purpose,scopeId,input) {
    return rc0Case(`concurrent ${purpose} acceptance and conflicting command replay`,async()=>{
      const before=await connectedBasis(prefix,tenant);
      const evidenceId=sql(`select id::text from d5o_hosted.customer_decision_evidence
        where workspace_id=${q(tenant.workspaceId)} and presentation_id=${q(before.work.id)}
          and purpose=${q(purpose)} and scope_id=${q(scopeId)}
        order by uploaded_at desc limit 1;`);
      assert.match(evidenceId,/^[0-9a-f-]{36}$/i,`${prefix}:${purpose}:evidence_missing`);
      const args={p_workspace_key:tenant.workspaceKey,p_presentation_id:before.work.id,
        p_package_id:action==="accept-work"?"":before.packageId,p_action:action,
        p_input:{...input,evidenceId},p_command_id:`rc0-${purpose}-a-${randomUUID()}`,
        p_expected_source_revision:before.source.revision,
        p_expected_design_revision:before.work.design.authorityRevision,
        p_expected_deploy_revision:before.deploy.revision};
      const other={...args,p_command_id:`rc0-${purpose}-b-${randomUUID()}`,
        p_input:{...args.p_input,signerName:"Conflicting fictional signer"}};
      const results=await Promise.all([
        call(`${prefix}_ops2`,"d5o_hosted_acceptance_command_v1",args),
        call(`${prefix}_ops2`,"d5o_hosted_acceptance_command_v1",other)]);
      assert.equal(results.filter((item)=>!item.error).length,1,JSON.stringify(results));
      const winner=results[0].error?other:args;
      const accepted=await connectedBasis(prefix,tenant);
      const replay=await call(`${prefix}_ops2`,"d5o_hosted_acceptance_command_v1",winner);
      assert(!replay.error,JSON.stringify(replay));
      const conflict=await call(`${prefix}_ops2`,"d5o_hosted_acceptance_command_v1",{...winner,
        p_input:{...winner.p_input,authorityBasis:"Conflicting reused RC0 acceptance"}});
      assert(conflict.error,JSON.stringify(conflict));
      const after=await connectedBasis(prefix,tenant);
      assert.equal(after.deploy.revision,accepted.deploy.revision);
      return {evidenceId,winnerCommandId:winner.p_command_id,
        loserError:results.find((item)=>item.error)?.error?.message,conflictError:conflict.error.message,
        revisionBefore:before.deploy.revision,revisionAfter:after.deploy.revision};
    });
  }
  async function phase2huAcceptance(prefix,tenant) {
    const initial=await connectedBasis(prefix,tenant);
    if(phase2hvc && prefix==="a") await deniedOperateCase("missing_customer_acceptance","a",a,
      ()=>call("a_ops","d5o_hosted_operate_command_v1",{
        p_workspace_key:a.workspaceKey,p_presentation_id:initial.work.id,
        p_action:"receive-handoff",p_input:{workAcceptanceId:randomUUID(),
          workAcceptanceRevision:1,note:"Rejected handoff without customer acceptance"},
        p_command_id:randomUUID(),p_expected_source_revision:initial.source.revision,
        p_expected_deploy_revision:initial.deploy.revision,
        p_expected_operate_revision:initial.operate.revision}),["23514"]);
    const path=`/work/customer/${tenant.workspaceKey}/deploy?workId=${encodeURIComponent(initial.work.id)}`;
    const pm=await deployPage(`${prefix}_pm`,tenant,path);
    await pm.getByRole("button",{name:"Acceptance & turnover"}).click();
    await pm.getByLabel("Continuing obligations").fill(
      "Review as-built and inspection documentation for fictional support");
    await browserDeployDecision(pm,pm.getByRole("button",{name:"Assemble revisioned turnover"}),
      "/api/d5o-hosted/prototype-deploy-command",200);
    let current=await connectedBasis(prefix,tenant);
    const turnover=current.deploy.state.turnovers.find((item)=>item.packageId===current.packageId);
    assert(turnover,`${prefix}:browser_turnover_missing`);
    if(rc0DeployIntegrity && prefix==="b") await rc0Case("deleted customer evidence cannot authorize pending acceptance",async()=>{
      const designState=JSON.parse(sql(`select pg_catalog.jsonb_build_object(
        'revision',decision_revision,'state',state)::text from d5o_hosted.connected_design_states
        where workspace_id=${q(tenant.workspaceId)} and work_id=${q(current.work.canonicalWorkId)};`));
      const evidenceId=await registerCustomerEvidence(prefix,tenant,"package-acceptance",
        turnover.id,turnover.revision,{releaseIds:turnover.releaseIds,designRevision:designState.revision});
      const path=`${tenant.workspaceKey}/${createHash("sha256").update(current.work.id).digest("hex")}`+
        `/customer-decisions/${evidenceId}`;
      const removed=await admin.storage.from("d5o-deploy-evidence").remove([path]);
      assert(!removed.error,removed.error?.message);
      const before=await connectedBasis(prefix,tenant);
      const denied=await acceptanceCommand(prefix,tenant,`${prefix}_ops2`,"accept-client",{
        turnoverId:turnover.id,signerName:"Fictional Customer Representative",
        signerOrganization:"Fictional Customer",signerRole:"Fictional customer approver",
        authorityBasis:"Deleted RC0 signed package",evidenceId},`deleted-evidence-${randomUUID()}`);
      assert(denied.error,JSON.stringify(denied));
      const after=await connectedBasis(prefix,tenant);
      assert.equal(after.deploy.revision,before.deploy.revision);
      return {evidenceId,denial:denied.error.message,unchangedRevision:after.deploy.revision};
    });
    const acceptor=await deployPage(`${prefix}_ops2`,tenant,path);
    await acceptor.getByRole("button",{name:"Acceptance & turnover"}).click();
    const packageForm=acceptor.locator("form").filter({has:acceptor.getByRole("button",{name:"Record scoped Client Accepted"})});
    const pdf=Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF");
    await packageForm.getByLabel("Externally signed acceptance PDF").setInputFiles({
      name:`${prefix}-signed-package.pdf`,mimeType:"application/pdf",buffer:pdf});
    await browserDeployDecision(acceptor,packageForm.getByRole("button",{name:"Retain PDF"}),
      "/api/d5o-hosted/customer-decision-evidence",200);
    await packageForm.getByLabel("Customer signer").fill("Fictional Customer Representative");
    await packageForm.getByLabel("Organization").fill("Fictional Customer");
    await packageForm.getByLabel("Role").fill("Fictional customer approver");
    await packageForm.getByLabel("Authority basis").fill("Fictional signed customer acceptance of the exact package");
    if(rc0DeployIntegrity && prefix==="b") await rc0RaceCustomerAcceptance(prefix,tenant,"accept-client",
      "package-acceptance",turnover.id,{turnoverId:turnover.id,signerName:"Fictional Customer Representative",
        signerOrganization:"Fictional Customer",signerRole:"Fictional customer approver",
        authorityBasis:"Fictional signed customer acceptance of the exact package"});
    else await browserDeployDecision(acceptor,packageForm.getByRole("button",{name:"Record scoped Client Accepted"}),
      "/api/d5o-hosted/prototype-deploy-command",200);
    const ops=await deployPage(`${prefix}_ops`,tenant,path);
    await ops.getByRole("button",{name:"Acceptance & turnover"}).click();
    const packageReceipt=ops.locator("form").filter({has:ops.getByRole("button",{name:"Record independent receipt"})});
    await packageReceipt.getByLabel("Reason").fill("Independent Operations receipt of exact fictional package");
    await browserDeployDecision(ops,packageReceipt.getByRole("button",{name:"Record independent receipt"}),
      "/api/d5o-hosted/prototype-deploy-command",200);
    await refreshDeployRead(acceptor);
    await openAcceptanceTab(acceptor);
    const wholeForm=acceptor.locator("form").filter({has:acceptor.getByRole("button",{name:"Record whole-work Client Accepted"})});
    await wholeForm.getByLabel("Externally signed acceptance PDF").setInputFiles({
      name:`${prefix}-signed-work.pdf`,mimeType:"application/pdf",buffer:pdf});
    await browserDeployDecision(acceptor,wholeForm.getByRole("button",{name:"Retain PDF"}),
      "/api/d5o-hosted/customer-decision-evidence",200);
    await wholeForm.getByLabel("Customer signer").fill("Fictional Customer Representative");
    await wholeForm.getByLabel("Organization").fill("Fictional Customer");
    await wholeForm.getByLabel("Role").fill("Fictional site reviewer");
    await wholeForm.getByLabel("Authority basis").fill("Fictional signed acceptance of all delivered Work");
    if(rc0DeployIntegrity && prefix==="b") await rc0RaceCustomerAcceptance(prefix,tenant,"accept-work",
      "work-acceptance",current.work.id,{signerName:"Fictional Customer Representative",
        signerOrganization:"Fictional Customer",signerRole:"Fictional site reviewer",
        authorityBasis:"Fictional signed acceptance of all delivered Work"});
    else await browserDeployDecision(acceptor,wholeForm.getByRole("button",{name:"Record whole-work Client Accepted"}),
      "/api/d5o-hosted/prototype-deploy-command",200);
    await refreshDeployRead(ops);
    await openAcceptanceTab(ops);
    const workReceipt=ops.locator("form").filter({has:ops.getByRole("button",{name:"Record independent whole-work receipt"})});
    await workReceipt.getByLabel("Reason").fill("Independent Operations receipt of accepted fictional Work");
    await browserDeployDecision(ops,workReceipt.getByRole("button",{name:"Record independent whole-work receipt"}),
      "/api/d5o-hosted/prototype-deploy-command",200);
    current=await connectedBasis(prefix,tenant);
    assert.equal(current.deploy.state.workAcceptance?.receipt,"Accepted");
    const dir=resolve(root,phase2hvcFinal?"docs/release/evidence/phase2hvc-final-browser":phase2hvc?"docs/release/evidence/phase2hvc-browser":phase2hv?"docs/architecture/evidence/phase2hv-browser":"docs/architecture/evidence/phase2hu-browser");mkdirSync(dir,{recursive:true});
    await ops.screenshot({path:resolve(dir,`${prefix}-deploy-accepted.png`),fullPage:true});
    await ops.goto(`http://127.0.0.1:${server.port}/work/customer/${tenant.workspaceKey}`);
    await ops.getByRole("heading",{name:"Work lifecycle"}).waitFor();
    await ops.getByRole("link",{name:/Receive accepted Deploy handoff/}).waitFor();
    await ops.screenshot({path:resolve(dir,`${prefix}-operate-handoff-task.png`),fullPage:true});
    return {tenant:tenant.workspaceKey,workId:current.work.id,turnoverId:turnover.id,
      workAcceptanceId:current.deploy.state.workAcceptance.id,
      configurationVersionId:current.work.phaseConfigurationVersionId};
  }
  await check("both tenants capture independent customer and Operations acceptance",async()=>{
    if(phase2hu) return [await phase2huAcceptance("a",a),await phase2huAcceptance("b",b)];
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
  if(phase2hu) await check("tenant-neutral Deploy adapters reject foreign and wrong-role actors without state change",async()=>{
    const aBasis=await connectedBasis("a",a);
    const bBasis=await connectedBasis("b",b);
    const worker=deployPages.get("a_worker");
    const foreignWorker=deployPages.get(phase2htGateA?"b_replacement":"b_worker");
    const manager=deployPages.get("a_ops");
    assert(worker&&foreignWorker&&manager,"browser_identities_unavailable");
    const report=aBasis.deploy.state.reports.find((item)=>item.packageId===aBasis.packageId);
    assert(report,"field_report_missing");
    const workerManager=await worker.evaluate(async({workspace,workId,evidenceId})=>{
      const response=await fetch(`/api/d5o-hosted/prototype-deploy-command?workspace=${workspace}&workId=${workId}&evidenceId=${evidenceId}`);
      return {status:response.status,body:await response.json()};
    },{workspace:a.workspaceKey,workId:aBasis.work.id,
      evidenceId:aBasis.deploy.state.evidence[0]?.id??randomUUID()});
    const foreignField=await foreignWorker.evaluate(async({workspace,workId,evidenceId})=>{
      const response=await fetch(`/api/d5o-hosted/worker-deploy?workspace=${workspace}&workId=${workId}&evidenceId=${evidenceId}`);
      return {status:response.status,body:await response.json()};
    },{workspace:a.workspaceKey,workId:aBasis.work.id,
      evidenceId:aBasis.deploy.state.evidence[0]?.id??randomUUID()});
    const foreignManager=await manager.evaluate(async({workspace,workId})=>{
      const response=await fetch(`/api/d5o-hosted/prototype-deploy-command?workspace=${workspace}&workId=${workId}&evidenceId=00000000-0000-4000-8000-000000000001`);
      return {status:response.status,body:await response.json()};
    },{workspace:b.workspaceKey,workId:bBasis.work.id});
    const foreignIssue=await worker.evaluate(async({workspace,workId})=>{
      const response=await fetch(`/api/d5o-hosted/field-changes?workspace=${workspace}&workId=${workId}`);
      return {status:response.status,body:await response.json()};
    },{workspace:b.workspaceKey,workId:bBasis.work.id});
    for(const [name,result] of Object.entries({workerManager,foreignField,foreignManager,foreignIssue}))
      assert.equal(result.status,403,`${name}:${JSON.stringify(result)}`);
    const after=await connectedBasis("a",a);
    assert.equal(after.deploy.revision,aBasis.deploy.revision);
    assert.equal(after.deploy.state.evidence.length,aBasis.deploy.state.evidence.length);
    return {workerManager,foreignField,foreignManager,foreignIssue,
      unchangedDeployRevision:after.deploy.revision};
  });
  operateCommand=async(prefix,tenant,actor,action,input,id)=>{
    const basis=await connectedBasis(prefix,tenant);
    return call(actor,"d5o_hosted_operate_command_v1",{
      p_workspace_key:tenant.workspaceKey,p_presentation_id:basis.work.id,
      p_action:action,p_input:input,p_command_id:`phase2f-${prefix}-${id}`,
      p_expected_source_revision:basis.source.revision,
      p_expected_deploy_revision:basis.deploy.revision,
      p_expected_operate_revision:basis.operate.revision});
  };
  async function phase2hvOperate(prefix,tenant) {
    const before=await connectedBasis(prefix,tenant);
    const path=`/work/customer/${tenant.workspaceKey}?work=${encodeURIComponent(before.work.id)}`;
    const queue=await deployPage(`${prefix}_ops`,tenant,`/work/customer/${tenant.workspaceKey}`);
    await queue.getByRole("link",{name:/Receive accepted Deploy handoff/}).waitFor();
    await queue.getByRole("link",{name:/Receive accepted Deploy handoff/}).click();
    await queue.getByRole("heading",{name:"Accepted delivery and support responsibility"}).waitFor();
    const acceptance=queue.getByRole("link",{name:"Open retained customer acceptance"});
    await acceptance.waitFor();
    const fileResponse=await queue.request.get(new URL(await acceptance.getAttribute("href"),queue.url()).href);
    assert.equal(fileResponse.status(),200,`${prefix}:acceptance-file`);
    await queue.getByLabel("Handoff review and remaining conditions").fill(
      "Operations reviewed accepted fictional delivery and continuing obligations");
    const received=await browserDeployDecision(queue,queue.getByRole("button",{name:"Receive accepted handoff"}),
      "/api/d5o-hosted/prototype-operate-command");
    const pm=await deployPage(`${prefix}_pm`,tenant,path);
    await pm.getByRole("heading",{name:"Accepted delivery and support responsibility"}).waitFor();
    await pm.getByLabel("System name").fill(`Fictional ${prefix.toUpperCase()} supported service asset`);
    await pm.getByLabel("Type",{exact:true}).fill("Service asset");
    await pm.getByLabel("Location").fill("Fictional service site");
    await pm.getByLabel("Document reference").fill("Accepted fictional Work turnover and inspection record");
    const asset=await browserDeployDecision(pm,pm.getByRole("button",{name:"Record supported asset identity"}),
      "/api/d5o-hosted/prototype-operate-command");
    if(phase2hvc && prefix==="a") await deniedOperateCase("activation_before_support_acceptance","a",a,
      async()=>{const basis=await connectedBasis("a",a);return call("a_ops","d5o_hosted_operate_command_v1",{
        p_workspace_key:a.workspaceKey,p_presentation_id:basis.work.id,
        p_action:"activate",p_input:{note:"Premature fictional activation"},
        p_command_id:randomUUID(),p_expected_source_revision:basis.source.revision,
        p_expected_deploy_revision:basis.deploy.revision,
        p_expected_operate_revision:basis.operate.revision});},["23514"]);
    await deployPage(`${prefix}_ops`,tenant,path);
    await queue.getByRole("heading",{name:"Accept support responsibility"}).waitFor();
    const fillSupport=async(page,warranty="Warranty subject to recorded terms")=>{
      await page.getByLabel("Customer support contact").fill("Fictional Customer Representative");
      await page.getByLabel("Escalation path").fill("Fictional support escalation queue");
      await page.getByLabel("Request intake route").fill("Fictional service intake route");
      await page.getByLabel("Warranty disposition").fill(warranty);
      await page.getByLabel("Service disposition").fill("Service coverage needs approval");
      await page.getByLabel("Reviewed documentation reference").fill("Accepted turnover and inspection documentation");
      await page.getByLabel("Residual obligation owner").fill("Fictional Operations receiver");
    };
    const support=async(expected=200)=>{
      await fillSupport(queue);
      return browserDeployDecision(queue,queue.getByRole("button",{name:"Accept support ownership"}),
        "/api/d5o-hosted/prototype-operate-command",expected);
    };
    const firstSupport=await support(prefix==="a"?409:200);
    let document=null;
    if(prefix==="a") {
      assert.match(firstSupport.body,/support_document_review_required/);
      await deployPage(`${prefix}_pm`,tenant,path);
      const docForm=pm.locator("form").filter({has:pm.getByRole("button",{name:"Retain and submit document"})}).first();
      await docForm.getByLabel("Fictional PDF").setInputFiles({name:"fictional-as-built.pdf",
        mimeType:"application/pdf",buffer:Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF")});
      await docForm.getByLabel("Supply note").fill("Fictional as-built record for independent support review");
      const upload=await browserDeployDecision(pm,docForm.getByRole("button",{name:"Retain and submit document"}),
        "/api/d5o-hosted/customer-decision-evidence",200);
      await pm.getByText("Retained document submitted for independent review.").waitFor();
      const reviewer=await deployPage(`${prefix}_ops2`,tenant,path);
      await reviewer.getByRole("heading",{name:"Accepted delivery and support responsibility"}).waitFor();
      const reviewForm=reviewer.locator("form").filter({has:reviewer.getByRole("button",{name:"Record independent review"})}).first();
      await reviewForm.getByLabel("Review reason").fill("Independent review of exact fictional as-built record");
      const review=await browserDeployDecision(reviewer,reviewForm.getByRole("button",{name:"Record independent review"}),
        "/api/d5o-hosted/prototype-operate-command",200);
      document={upload,review};
      await deployPage(`${prefix}_ops`,tenant,path);
      await queue.getByRole("heading",{name:"Accept support responsibility"}).waitFor();
      const rivalContext=await designBrowser.newContext({viewport:{width:1440,height:900},
        storageState:await queue.context().storageState()});
      const rival=await rivalContext.newPage();
      try {
        await rival.goto(`http://127.0.0.1:${server.port}${path}`);
        await rival.getByRole("heading",{name:"Accept support responsibility"}).waitFor();
        await fillSupport(queue);
        await fillSupport(rival,"Conflicting fictional warranty disposition");
        const endpoint="/api/d5o-hosted/prototype-operate-command";
        const responseFor=(page)=>page.waitForResponse((response)=>response.url().includes(endpoint)
          && response.request().method()==="POST");
        const pending=[responseFor(queue),responseFor(rival)];
        await Promise.all([queue.getByRole("button",{name:"Accept support ownership"}).click(),
          rival.getByRole("button",{name:"Accept support ownership"}).click()]);
        const responses=await Promise.all(pending);
        const statuses=responses.map((item)=>item.status()).sort();
        assert.deepEqual(statuses,[200,409],`${prefix}:concurrent_support:${statuses}`);
        document.concurrentSupport={statuses,acceptedCommand:responses.find((item)=>item.status()===200)
          ?.request().postDataJSON()};
      } finally { await rivalContext.close(); }
      await deployPage(`${prefix}_ops`,tenant,path);
    }
    await queue.getByRole("button",{name:"Activate support"}).waitFor();
    let activation;
    if(phase2hvc && prefix==="a") {
      const rivalContext=await designBrowser.newContext({viewport:{width:1440,height:900},
        storageState:await queue.context().storageState()});
      try {
        const rival=await rivalContext.newPage();
        await rival.goto(`http://127.0.0.1:${server.port}${path}`);
        await rival.getByRole("button",{name:"Activate support"}).waitFor();
        const endpoint="/api/d5o-hosted/prototype-operate-command";
        const wait=(page)=>page.waitForResponse((response)=>response.url().includes(endpoint)
          && response.request().method()==="POST");
        const pending=[wait(queue),wait(rival)];
        await Promise.all([queue.getByRole("button",{name:"Activate support"}).click(),
          rival.getByRole("button",{name:"Activate support"}).click()]);
        const responses=await Promise.all(pending);
        const statuses=responses.map((item)=>item.status()).sort();
        assert.deepEqual(statuses,[200,409],`${prefix}:concurrent_activation:${statuses}`);
        activation={status:200,concurrentStatuses:statuses,
          acceptedCommand:responses.find((item)=>item.status()===200)?.request().postDataJSON()};
      } finally { await rivalContext.close(); }
      await deployPage(`${prefix}_ops`,tenant,path);
    } else activation=await browserDeployDecision(queue,queue.getByRole("button",{name:"Activate support"}),
      "/api/d5o-hosted/prototype-operate-command",200);
    await queue.getByText("Support Active. Financial closeout remains Pending.").waitFor();
    await deployPage(`${prefix}_ops`,tenant,path);
    await queue.getByText("Support Active. Financial closeout remains Pending.").waitFor();
    await queue.getByText("Replay matched").waitFor();
    const dir=resolve(root,phase2hvcFinal?"docs/release/evidence/phase2hvc-final-browser":phase2hvc?"docs/release/evidence/phase2hvc-browser":"docs/architecture/evidence/phase2hv-browser");mkdirSync(dir,{recursive:true});
    await queue.screenshot({path:resolve(dir,`${prefix}-operate-desktop.png`),fullPage:true});
    await queue.setViewportSize({width:390,height:844});
    await queue.screenshot({path:resolve(dir,`${prefix}-operate-mobile.png`),fullPage:true});
    await queue.setViewportSize({width:1440,height:900});
    await deployPage(`${prefix}_ops`,tenant,`/work/customer/${tenant.workspaceKey}`);
    await queue.getByRole("heading",{name:"Work lifecycle"}).waitFor();
    assert.equal(await queue.getByRole("link",{name:/Accept support responsibility/}).count(),0);
    assert.equal(await queue.getByRole("link",{name:/Activate support/}).count(),0);
    const current=await connectedBasis(prefix,tenant);
    assert.equal(current.operate.state.activation?.status,"Active");
    assert.equal(current.operate.state.finance.status,"Pending");
    assert.equal(current.work.phaseConfigurationVersionId,versions[`${prefix}_admin`]);
    const phase=await call(`${prefix}_ops`,"d5o_hosted_phase_status_read_v1",{
      p_workspace_key:tenant.workspaceKey,p_presentation_id:current.work.id});
    assert(!phase.error,phase.error?.message);
    assert.equal(phase.data.replayMatches,true);
    assert.equal(phase.data.projection.supportActive,true);
    assert.equal(phase.data.projection.financialCloseout,"Pending");
    return {tenant:tenant.workspaceKey,workId:current.work.canonicalWorkId,
      workAcceptanceId:current.deploy.state.workAcceptance.id,configurationVersionId:current.work.phaseConfigurationVersionId,
      documentationPolicyRejection:prefix==="a"?firstSupport.body:null,
      financialCloseout:current.operate.state.finance.status,activation:current.operate.state.activation.status,
      phaseProjectionRevision:phase.data.projectionRevision,reloadAndReplayMatched:true,
      browser:{received,asset,firstSupport,document,activation},
      screenshots:[`${prefix}-operate-desktop.png`,`${prefix}-operate-mobile.png`]};
  }
  await check("Operate support acceptance follows exact Deploy receipt and pinned documentation policy",async()=>{
    if(phase2hv) return [await phase2hvOperate("a",a),await phase2hvOperate("b",b)];
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
  if(phase2hv) await check("Operate API and RPC reject foreign, wrong-role, forged, stale and evidence-conflicting commands",async()=>{
    const before=await connectedBasis("a",a);
    const input={customerContact:"Fictional Customer Representative",
      escalation:"Fictional support escalation queue",intakeRoute:"Fictional service intake route",
      warrantyDisposition:"Conflicting warranty claim",serviceDisposition:"Conflicting service claim",
      documentation:"Unreviewed replacement",residualOwner:"Fictional Operations receiver"};
    const args=(presentationId=before.work.id,operateRevision=before.operate.revision,commandId=randomUUID())=>({
      p_workspace_key:a.workspaceKey,p_presentation_id:presentationId,p_action:"accept-support",
      p_input:input,p_command_id:commandId,p_expected_source_revision:before.source.revision,
      p_expected_deploy_revision:before.deploy.revision,p_expected_operate_revision:operateRevision});
    const wrongRole=await call("a_pm","d5o_hosted_operate_command_v1",args());
    const foreign=await call("b_ops","d5o_hosted_operate_command_v1",args());
    const forged=await call("a_ops","d5o_hosted_operate_command_v1",args(randomUUID()));
    const stale=await call("a_ops","d5o_hosted_operate_command_v1",args(before.work.id,0));
    for(const [name,result] of Object.entries({wrongRole,foreign,forged,stale}))
      assert(result.error,`${name}:unexpected_acceptance`);
    const acceptanceEvidence=before.deploy.state.workAcceptance.source?.replace(/^evidence:/,"");
    const turnover=before.deploy.state.turnovers.find((item)=>item.receipt==="Accepted");
    assert(acceptanceEvidence&&turnover,"support_evidence_basis_missing");
    const wrongEvidence=await call("a_pm","d5o_hosted_support_document_command_v1",{
      p_workspace_key:a.workspaceKey,p_presentation_id:before.work.id,p_action:"submit",
      p_turnover_id:turnover.id,p_kind:"as-built",p_evidence_id:acceptanceEvidence,
      p_decision:null,p_note:"Wrong-purpose customer acceptance document",
      p_command_id:randomUUID(),p_expected_source_revision:before.source.revision,
      p_expected_deploy_revision:before.deploy.revision,
      p_expected_operate_revision:before.operate.revision});
    assert(wrongEvidence.error,"wrong_purpose_evidence_accepted");
    const originalCommand=sql(`select command_id from d5o_hosted.connected_operate_events
      where workspace_id=${q(a.workspaceId)} and work_id=${q(before.work.canonicalWorkId)}
        and action='accept-support' order by decision_revision desc limit 1;`);
    assert(originalCommand,"support_acceptance_receipt_missing");
    const conflictingReplay=await call("a_ops","d5o_hosted_operate_command_v1",
      args(before.work.id,before.operate.revision,originalCommand));
    assert.equal(conflictingReplay.error?.code,"23505",JSON.stringify(conflictingReplay));
    const foreignPage=deployPages.get("b_ops"),managerPage=deployPages.get("a_pm");
    assert(foreignPage&&managerPage,"authenticated_operate_sessions_missing");
    const post=async(page)=>page.evaluate(async({workspace,workId,source,deploy,operate})=>{
      const response=await fetch(`/api/d5o-hosted/prototype-operate-command?workspace=${workspace}`,{
        method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
          workId,action:"accept-support",commandId:crypto.randomUUID(),
          expectedRevision:source,expectedDeployRevision:deploy,expectedDecisionRevision:operate,
          escalation:"Forged support escalation",intakeRoute:"Forged support intake"})});
      return {status:response.status,body:await response.json()};
    },{workspace:a.workspaceKey,workId:before.work.id,source:before.source.revision,
      deploy:before.deploy.revision,operate:before.operate.revision});
    const foreignHttp=await post(foreignPage),wrongRoleHttp=await post(managerPage);
    assert.equal(foreignHttp.status,403,JSON.stringify(foreignHttp));
    assert.equal(wrongRoleHttp.status,403,JSON.stringify(wrongRoleHttp));
    const privateDocument=before.operate.state.documentationObligations?.find((item)=>item.kind==="as-built");
    assert(privateDocument,"reviewed_document_missing");
    const privateProbe=await foreignPage.evaluate(async({workspace,workId,evidenceId})=>{
      const query=new URLSearchParams({workspace,workId,evidenceId});
      return (await fetch(`/api/d5o-hosted/customer-decision-evidence?${query}`)).status;
    },{workspace:a.workspaceKey,workId:before.work.id,evidenceId:privateDocument.id});
    assert.equal(privateProbe,403);
    const receiverPage=deployPages.get("a_ops");
    assert(receiverPage,"receiving_employee_session_missing");
    const people=await call("a_admin","d5o_hosted_org_admin_read_v1",{
      p_workspace_key:a.workspaceKey,p_kind:"people",p_search:"",p_offset:0,p_limit:25});
    assert(!people.error,people.error?.message);
    const receiver=people.data.items.find((item)=>item.actor_user_id===users.a_ops.id);
    assert(receiver,"receiving_membership_missing");
    const membership=(action,revision)=>call("a_admin","d5o_hosted_org_admin_command_v1",{
      p_workspace_key:a.workspaceKey,p_action:action,p_subject_id:receiver.id,p_input:{},
      p_expected_revision:revision,p_reason:"Disposable Operate receiving authority check",
      p_command_id:randomUUID()});
    const suspended=await membership("member.suspend",receiver.revision);
    assert(!suspended.error,suspended.error?.message);
    const suspendedHttp=await post(receiverPage);
    const suspendedRpc=await call("a_ops","d5o_hosted_operate_command_v1",args());
    assert.equal(suspendedHttp.status,403);
    assert.equal(suspendedRpc.error?.code,"42501");
    const restored=await membership("member.reactivate",suspended.data.record.revision);
    assert(!restored.error,restored.error?.message);
    const directory=async()=>{
      const result=await call("vendor","d5o_platform_provisioning_directory_v1");
      assert(!result.error,result.error?.message);
      return result.data.find((item)=>item.workspaceKey===a.workspaceKey);
    };
    let tenant=await directory();
    const disabled=await call("vendor","d5o_platform_capability_command_v1",{
      p_workspace_key:a.workspaceKey,p_kind:"flag",p_enabled:false,
      p_expected_revision:tenant.connectedWorkFlagRevision,p_command_id:randomUUID(),
      p_reason:"Disposable Operate rollout denial"});
    assert(!disabled.error,disabled.error?.message);
    const disabledHttp=await post(receiverPage);
    const disabledRpc=await call("a_ops","d5o_hosted_operate_command_v1",args());
    assert.equal(disabledHttp.status,403);
    assert.equal(disabledRpc.error?.code,"42501");
    const enabled=await call("vendor","d5o_platform_capability_command_v1",{
      p_workspace_key:a.workspaceKey,p_kind:"flag",p_enabled:true,
      p_expected_revision:disabled.data.revision,p_command_id:randomUUID(),
      p_reason:"Restore disposable Operate rollout"});
    assert(!enabled.error,enabled.error?.message);
    tenant=await directory();
    const tenantOff=await call("vendor","d5o_platform_lifecycle_command_v1",{
      p_workspace_key:a.workspaceKey,p_action:"suspend",p_expected_revision:tenant.revision,
      p_command_id:randomUUID(),p_reason:"Disposable Operate tenant suspension"});
    assert(!tenantOff.error,tenantOff.error?.message);
    const tenantHttp=await post(receiverPage);
    const tenantRpc=await call("a_ops","d5o_hosted_operate_command_v1",args());
    assert.equal(tenantHttp.status,403);
    assert.equal(tenantRpc.error?.code,"42501");
    const tenantOn=await call("vendor","d5o_platform_lifecycle_command_v1",{
      p_workspace_key:a.workspaceKey,p_action:"reactivate",p_expected_revision:tenantOff.data.revision,
      p_command_id:randomUUID(),p_reason:"Restore disposable Operate tenant"});
    assert(!tenantOn.error,tenantOn.error?.message);
    const after=await connectedBasis("a",a);
    assert.equal(after.operate.revision,before.operate.revision);
    assert.equal(after.work.phaseConfigurationVersionId,before.work.phaseConfigurationVersionId);
    return {rpc:{wrongRole:wrongRole.error.code,foreign:foreign.error.code,
      forged:forged.error.code,stale:stale.error.code,wrongEvidence:wrongEvidence.error.code,
      conflictingReplay:conflictingReplay.error.code},http:{foreign:foreignHttp.status,
      wrongRole:wrongRoleHttp.status,privateDocument:privateProbe,
      suspendedMember:suspendedHttp.status,disabledFeature:disabledHttp.status,
      suspendedTenant:tenantHttp.status},
      unchangedOperateRevision:after.operate.revision,unchangedConfigurationVersion:after.work.phaseConfigurationVersionId};
  });
  if(phase2htGateB && !evidence.tests.some((item)=>item.status==="FAIL")) await check("both tenants open and triage connected service through authenticated browser controls",async()=>{
    const outcomes=[];
    const screenshotDir=browserEvidenceDir("docs/architecture/evidence/phase2ht-gate-b-browser");
    mkdirSync(screenshotDir,{recursive:true});
    for(const [prefix,tenant] of [["a",a],["b",b]]) {
      const basis=await connectedBasis(prefix,tenant);
      const pm=phase2htc
        ? await openServiceTask(`${prefix}_pm`,tenant,basis.work.id,"open-request")
        : await designPage(`${prefix}_pm`,tenant,basis.work.id);
      const coverage=pm.getByText("Record service coverage terms",{exact:true});
      await coverage.click();
      const agreement=pm.locator("details").filter({has:coverage}).locator("form");
      await agreement.getByLabel("Agreement name").fill(`Fictional ${prefix.toUpperCase()} service coverage`);
      await agreement.getByLabel("Service category").fill("Monitoring fault");
      await agreement.getByLabel("Response calendar").selectOption("Continuous");
      await agreement.getByLabel("Effective from").fill("2026-01-01");
      await agreement.getByLabel("Effective to").fill("2027-12-31");
      await agreement.getByLabel("Included work").fill("Qualified monitoring inspection labor");
      await agreement.getByLabel("Excluded work").fill("Parts and travel require separate authorization");
      await agreement.getByLabel("Customer terms source").fill("Synthetic tenant service terms");
      const [agreementResponse]=await Promise.all([pm.waitForResponse((item)=>item.url().includes("/prototype-operate-command")&&item.request().method()==="POST"),
        agreement.getByRole("button",{name:"Save coverage terms"}).click()]);
      assert.equal(agreementResponse.status(),200,`${prefix}:agreement:${await agreementResponse.text()}`);
      await pm.reload();
      await pm.getByRole("heading",{name:"Open service request"}).waitFor();
      const requestForm=pm.locator("form").filter({has:pm.getByRole("heading",{name:"Open service request"})});
      await requestForm.getByLabel("Issue").fill("Fictional monitoring service fault");
      await requestForm.getByLabel("Observed condition").fill("Intermittent monitoring continuity requires inspected repair");
      await requestForm.getByLabel("Customer contact").fill("Fictional customer representative");
      const [requestResponse]=await Promise.all([pm.waitForResponse((item)=>item.url().includes("/prototype-operate-command")&&item.request().method()==="POST"),
        requestForm.getByRole("button",{name:"Open service request"}).click()]);
      assert.equal(requestResponse.status(),200,`${prefix}:request:${await requestResponse.text()}`);
      const opened=await connectedBasis(prefix,tenant);
      const request=opened.operate.state.requests.at(-1);
      assert(request,`${prefix}:browser-request-missing`);
      const ops=phase2htc
        ? await openServiceTask(`${prefix}_ops`,tenant,basis.work.id,"approve-agreement")
        : await designPage(`${prefix}_ops`,tenant,basis.work.id);
      const approve=ops.getByRole("button",{name:"Approve coverage terms"});
      await ops.getByLabel("Independent review reason").fill("Independent review of fictional tenant coverage terms");
      const [approvalResponse]=await Promise.all([ops.waitForResponse((item)=>item.url().includes("/prototype-operate-command")&&item.request().method()==="POST"),approve.click()]);
      assert.equal(approvalResponse.status(),200,`${prefix}:terms-approval:${await approvalResponse.text()}`);
      if(phase2htc) await openServiceTask(`${prefix}_ops`,tenant,basis.work.id,"triage-request");
      else await ops.reload();
      await ops.getByRole("heading",{name:"Design actions"}).waitFor();
      await ops.getByText("Loading current Work and phase decisions…").waitFor({state:"hidden"});
      await ops.screenshot({path:resolve(screenshotDir,`${prefix}-service-request-open.png`),fullPage:true});
      const triage=ops.locator("form").filter({has:ops.getByRole("button",{name:"Triage request"})});
      await triage.getByLabel("Service category").fill("Monitoring fault");
      const [triageResponse]=await Promise.all([ops.waitForResponse((item)=>item.url().includes("/prototype-operate-command")&&item.request().method()==="POST"),
        triage.getByRole("button",{name:"Triage request"}).click()]);
      assert.equal(triageResponse.status(),200,`${prefix}:triage:${await triageResponse.text()}`);
      const current=await connectedBasis(prefix,tenant);
      assert.equal(current.operate.state.requests.find((item)=>item.id===request.id)?.coverage,"Partially covered");
      await ops.screenshot({path:resolve(screenshotDir,`${prefix}-service-triaged.png`),fullPage:true});
      if(phase2htc) await openServiceTask(`${prefix}_pm`,tenant,basis.work.id,"prepare-estimate");
      else await pm.reload();
      await pm.getByRole("heading",{name:"Design actions"}).waitFor();
      await pm.getByText("Loading current Work and phase decisions…").waitFor({state:"hidden"});
      const pricing=pm.locator("details").filter({has:pm.getByText(/Chargeable service estimate/)});
      await pricing.getByText(/Chargeable service estimate/).first().click();
      try { await pricing.getByLabel("Work performed or supplied").waitFor({state:"visible",timeout:12000}); }
      catch {
        const state=await pm.evaluate(async(workspace)=>{
          const response=await fetch(`/api/d5o-hosted/prototype-state?workspace=${workspace}&key=work&pricing=1`);
          return {status:response.status,body:await response.json()};
        },tenant.workspaceKey);
        throw Error(`${prefix}:pricing_editor_unavailable:${JSON.stringify({panel:await pricing.innerText(),state}).slice(0,2200)}`);
      }
      await pricing.getByLabel("Work performed or supplied").fill("Controlled fictional service inspection");
      await pricing.getByLabel("Quantity or hours").fill("105");
      await pricing.getByLabel("Unit").fill("hour");
      await pricing.getByLabel("Catalog rate ID").fill("service-hour");
      await pricing.getByLabel("Rate or quote source").fill("Synthetic rate catalog");
      await pricing.getByLabel("Quantity / cost assumption").fill("Qualified inspection and repair crew hours");
      await pricing.getByRole("button",{name:"Add cost line"}).click();
      await pricing.getByLabel("Estimate risk and uncertainty basis").fill("Synthetic bounded service repair risk");
      const [estimateResponse]=await Promise.all([pm.waitForResponse((item)=>item.url().includes("/prototype-operate-command")&&item.request().method()==="POST"),
        pricing.getByRole("button",{name:"Save new estimate revision"}).click()]);
      assert.equal(estimateResponse.status(),200,`${prefix}:service-estimate:${await estimateResponse.text()}`);
      await pm.reload();
      await pm.getByRole("heading",{name:"Design actions"}).waitFor();
      await pm.getByText("Loading current Work and phase decisions…").waitFor({state:"hidden"});
      // Reload closes the native <details> disclosure. Its action is present
      // but correctly hidden until an employee opens the estimate again.
      await pm.locator("details").filter({has:pm.getByText(/Chargeable service estimate/)})
        .first().locator("summary").click();
      try { await pm.getByRole("button",{name:"Submit exact revision for pricing review"}).waitFor({timeout:12000}); }
      catch {
        const current=await connectedBasis(prefix,tenant);
        const shown=await pm.evaluate(async({workspace,workId})=>{
          const response=await fetch(`/api/d5o-hosted/customer-work?workspace=${workspace}&workId=${workId}`);
          const body=await response.json();
          return {status:response.status,role:body.role,
            requests:body.record?.operate?.requests?.map((item)=>({id:item.id,status:item.status,
              reportedAt:item.reportedAt,estimateStatus:item.serviceEstimate?.status,
              estimateRevision:item.serviceEstimate?.revision,
              requestCycleAt:item.serviceEstimate?.requestCycleAt,
              currentCycle:item.serviceEstimate?.requestCycleAt===(item.reopenedAt??item.reportedAt)})),
            replayMatches:body.phaseStatus?.replayMatches};
        },{workspace:tenant.workspaceKey,workId:basis.work.id});
        const panel=await pm.locator("details").filter({has:pm.getByText(/Chargeable service estimate/)})
          .first().innerText().catch(()=>"pricing panel unavailable");
        const requestState=current.operate.state.requests.at(-1);
        throw Error(`${prefix}:pricing_submit_unavailable:${JSON.stringify({connected:{
          reportedAt:requestState?.reportedAt,estimateStatus:requestState?.serviceEstimate?.status,
          requestCycleAt:requestState?.serviceEstimate?.requestCycleAt},shown,panel}).slice(0,4200)}`);
      }
      const [submitResponse]=await Promise.all([pm.waitForResponse((item)=>item.url().includes("/prototype-operate-command")&&item.request().method()==="POST"),
        pm.getByRole("button",{name:"Submit exact revision for pricing review"}).click()]);
      assert.equal(submitResponse.status(),200,`${prefix}:service-pricing-submit:${await submitResponse.text()}`);
      if(phase2htc) await openServiceTask(`${prefix}_ops`,tenant,basis.work.id,"approve-pricing");
      else await ops.reload();
      await ops.getByRole("heading",{name:"Design actions"}).waitFor();
      await ops.getByText("Loading current Work and phase decisions…").waitFor({state:"hidden"});
      const opsPricing=ops.locator("details").filter({has:ops.getByText(/Chargeable service estimate/)});
      await opsPricing.getByText(/Chargeable service estimate/).first().click();
      await opsPricing.getByLabel("Independent pricing approval basis").fill("Independent fictional service pricing review");
      const [priceApprovalResponse]=await Promise.all([ops.waitForResponse((item)=>item.url().includes("/prototype-operate-command")&&item.request().method()==="POST"),
        opsPricing.getByRole("button",{name:"Approve priced service"}).click()]);
      assert.equal(priceApprovalResponse.status(),200,`${prefix}:service-pricing-approval:${await priceApprovalResponse.text()}`);
      const priced=await connectedBasis(prefix,tenant);
      const pricedRequest=priced.operate.state.requests.find((item)=>item.id===request.id);
      assert.equal(pricedRequest.serviceEstimate.status,"Approved");
      assert.equal(pricedRequest.serviceEstimate.evaluation.proposedPriceMinor,1500000);
      await ops.screenshot({path:resolve(screenshotDir,`${prefix}-service-priced.png`),fullPage:true});
      outcomes.push({tenant:tenant.workspaceKey,workId:basis.work.id,requestId:request.id,
        agreementHttp:agreementResponse.status(),requestHttp:requestResponse.status(),
        approvalHttp:approvalResponse.status(),triageHttp:triageResponse.status(),
        estimateHttp:estimateResponse.status(),submitHttp:submitResponse.status(),
        pricingApprovalHttp:priceApprovalResponse.status(),
        amountMinor:pricedRequest.serviceEstimate.evaluation.proposedPriceMinor,
        coverage:"Partially covered"});
    }
    evidence.gateB=outcomes;
    return outcomes;
  });
  else if(phase2htGateB) evidence.tests.push({name:"both tenants open and triage connected service through authenticated browser controls",
    status:"BLOCKED",detail:"Connected Work prerequisite did not pass"});
  if(phase2htGateB && evidence.tests.at(-1)?.status==="PASS") await check("both tenants authorize priced service and create one executable job through authenticated browser controls",async()=>{
    const outcomes=[];
    const screenshotDir=browserEvidenceDir("docs/architecture/evidence/phase2ht-gate-b-browser");
    const expandPricing=async(page)=>{
      const details=page.locator("details").filter({has:page.getByText(/Chargeable service estimate/)})
        .first();
      if(await details.getAttribute("open")===null) await details.locator("summary").click();
    };
    for(const [prefix,tenant] of [["a",a],["b",b]]) {
      const basis=await connectedBasis(prefix,tenant);
      const request=basis.operate.state.requests.at(-1);
      assert.equal(request.serviceEstimate.evaluation.proposedPriceMinor,1500000);
      const pm=await designPage(`${prefix}_pm`,tenant,basis.work.id);
      const ops=await designPage(`${prefix}_ops`,tenant,basis.work.id);
      await expandPricing(pm);
      await expandPricing(ops);
      const approvalBefore=await pm.evaluate(async({workspace,workId,requestId})=>{
        const response=await fetch(`/api/d5o-hosted/service-approval?workspace=${workspace}&parentPresentationId=${workId}&requestId=${requestId}`);
        return {status:response.status,body:await response.json()};
      },{workspace:tenant.workspaceKey,workId:basis.work.id,requestId:request.id});
      assert.equal(approvalBefore.status,200);
      assert.equal(approvalBefore.body.result.approvalRequired,prefix==="a");
      assert.equal(approvalBefore.body.result.amountMinor,1500000);
      const beforeDecision=await connectedBasis(prefix,tenant);
      const unauthorizedJob=await pm.evaluate(async({workspace,workId,requestId,sourceRevision,operateRevision})=>{
        const response=await fetch(`/api/d5o-hosted/prototype-operate-command?workspace=${workspace}`,{
          method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({action:"create-job",workId,requestId,
            dueDate:new Date().toISOString().slice(0,10),expectedRevision:sourceRevision,
            expectedDecisionRevision:operateRevision,expectedDeployRevision:0,
            commandId:crypto.randomUUID()})});
        return {status:response.status,body:await response.json()};
      },{workspace:tenant.workspaceKey,workId:basis.work.id,requestId:request.id,
        sourceRevision:beforeDecision.source.revision,operateRevision:beforeDecision.operate.revision});
      assert.equal(unauthorizedJob.status,409,`${prefix}:premature-job:${JSON.stringify(unauthorizedJob)}`);
      assert.equal((await connectedBasis(prefix,tenant)).operate.state.jobs.length,beforeDecision.operate.state.jobs.length);
      let preapprovalAuthorization=null;
      let thresholdApprovalHttp=null;
      let thresholdDecisionCommand=null;
      if(prefix==="a") {
        preapprovalAuthorization=await ops.evaluate(async({workspace,workId,requestId,sourceRevision,operateRevision,estimateRevision})=>{
          const response=await fetch(`/api/d5o-hosted/prototype-operate-command?workspace=${workspace}`,{
            method:"POST",headers:{"Content-Type":"application/json"},
            body:JSON.stringify({action:"record-service-authorization",workId,requestId,
              estimateRevision,expectedRevision:sourceRevision,expectedDecisionRevision:operateRevision,
              expectedDeployRevision:0,commandId:crypto.randomUUID(),customerParty:"Fictional customer",
              customerOrganization:"Fictional customer",customerRole:"Authorized representative",
              authorityBasis:"Signed source",source:"Missing approval probe",note:"Denied probe"})});
          return {status:response.status,body:await response.json()};
        },{workspace:tenant.workspaceKey,workId:basis.work.id,requestId:request.id,
          sourceRevision:beforeDecision.source.revision,operateRevision:beforeDecision.operate.revision,
          estimateRevision:request.serviceEstimate.revision});
        assert.equal(preapprovalAuthorization.status,409,`a:approval-bypass:${JSON.stringify(preapprovalAuthorization)}`);
        if(phase2htc) await openServiceTask(`${prefix}_pm`,tenant,basis.work.id,"request-approval");
        else await pm.reload();
        await pm.getByRole("heading",{name:"Design actions"}).waitFor();
        await pm.getByText("Loading current Work and phase decisions…").waitFor({state:"hidden"});
        await expandPricing(pm);
        const requestApproval=pm.getByRole("button",{name:"Request additional approval"});
        await requestApproval.waitFor({state:"visible"});
        const [requestResponse]=await Promise.all([pm.waitForResponse((item)=>item.url().includes("/service-approval")&&item.request().method()==="POST"),requestApproval.click()]);
        assert.equal(requestResponse.status(),200,`a:approval-request:${await requestResponse.text()}`);
        if(phase2htc) {
          const wrongRole=await call("a_worker","d5o_hosted_connected_service_approval_command_v1",{
            p_workspace_key:tenant.workspaceKey,p_parent_presentation_id:basis.work.id,
            p_request_id:request.id,p_action:"approve",p_command_id:randomUUID()});
          assert.equal(wrongRole.error?.code,"42501",JSON.stringify(wrongRole));
          evidence.serviceWrongRoleDenial=wrongRole.error.code;
        }
        const approver=phase2htc
          ? await openServiceTask("a_admin",tenant,basis.work.id,"decide-approval")
          : await designPage("a_admin",tenant,basis.work.id);
        await approver.getByText("Loading current Work and phase decisions…").waitFor({state:"hidden"});
        await expandPricing(approver);
        const approve=approver.getByRole("button",{name:"Approve service threshold"});
        await approve.waitFor({state:"visible"});
        const [approvalResponse]=await Promise.all([approver.waitForResponse((item)=>item.url().includes("/service-approval")&&item.request().method()==="POST"),approve.click()]);
        assert.equal(approvalResponse.status(),200,`a:threshold-approval:${await approvalResponse.text()}`);
        thresholdApprovalHttp=approvalResponse.status();
        thresholdDecisionCommand=approvalResponse.request().postDataJSON();
        if(phase2htc) await assertServiceTaskResolved("a_admin",tenant,basis.work.id);
      }
      if(phase2htc) await openServiceTask(`${prefix}_ops`,tenant,basis.work.id,"authorize-service");
      else await ops.reload();
      await ops.getByRole("heading",{name:"Design actions"}).waitFor();
      await ops.getByText("Loading current Work and phase decisions…").waitFor({state:"hidden"});
      await expandPricing(ops);
      let forgedEvidenceHttp=null;
      if(phase2htc) {
        const current=await connectedBasis(prefix,tenant);
        const forged=await ops.evaluate(async({workspace,workId,requestId,estimateRevision,
            sourceRevision,operateRevision,evidenceId})=>{
          const response=await fetch(`/api/d5o-hosted/prototype-operate-command?workspace=${workspace}`,{
            method:"POST",headers:{"Content-Type":"application/json"},
            body:JSON.stringify({action:"record-service-authorization",workId,requestId,
              estimateRevision,expectedRevision:sourceRevision,
              expectedDecisionRevision:operateRevision,expectedDeployRevision:0,
              commandId:crypto.randomUUID(),evidenceId,
              customerParty:"Fictional customer",customerOrganization:"Fictional customer",
              customerRole:"Authorized buyer",authorityBasis:"Signed service order authority",
              note:"Forged evidence boundary probe"})});
          return {status:response.status,body:await response.json()};
        },{workspace:tenant.workspaceKey,workId:basis.work.id,requestId:request.id,
          estimateRevision:request.serviceEstimate.revision,sourceRevision:current.source.revision,
          operateRevision:current.operate.revision,
          evidenceId:prefix==="b"?outcomes[0].customerEvidenceId:randomUUID()});
        assert([403,409].includes(forged.status),
          `${prefix}:forged_service_evidence:${JSON.stringify(forged)}`);
        assert.equal((await connectedBasis(prefix,tenant)).operate.revision,current.operate.revision);
        forgedEvidenceHttp=forged.status;
      }
      const authorization=ops.locator("form").filter({has:ops.getByRole("button",{name:"Record exact customer authorization"})});
      await authorization.getByLabel("External customer authority / party").fill("Fictional authorized customer");
      await authorization.getByLabel("Externally signed acceptance PDF").setInputFiles({name:`${prefix}-service-authorization.pdf`,mimeType:"application/pdf",buffer:Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF")});
      const [uploadResponse]=await Promise.all([ops.waitForResponse((item)=>item.url().includes("/customer-decision-evidence")&&item.request().method()==="POST"),authorization.getByRole("button",{name:"Retain PDF"}).click()]);
      assert.equal(uploadResponse.status(),200,`${prefix}:customer-source:${await uploadResponse.text()}`);
      const evidenceBody=await uploadResponse.json();
      assert(evidenceBody.evidenceId);
      await authorization.getByLabel("Customer organization").fill("Fictional customer organization");
      await authorization.getByLabel("Representative role").fill("Authorized buyer");
      await authorization.getByLabel("Stated authority").fill("Signed service order authority");
      await authorization.getByLabel("Internal recording rationale").fill("Reviewed exact service estimate and source");
      const [authorizationResponse]=await Promise.all([ops.waitForResponse((item)=>item.url().includes("/prototype-operate-command")&&item.request().method()==="POST"),authorization.getByRole("button",{name:"Record exact customer authorization"}).click()]);
      assert.equal(authorizationResponse.status(),200,`${prefix}:service-authorization:${await authorizationResponse.text()}`);
      const authorizationCommand=authorizationResponse.request().postDataJSON();
      if(phase2htc) await assertServiceTaskResolved(`${prefix}_ops`,tenant,basis.work.id);
      if(phase2htc) await openServiceTask(`${prefix}_pm`,tenant,basis.work.id,"create-job");
      else await pm.reload();
      await pm.getByRole("heading",{name:"Design actions"}).waitFor();
      await pm.getByText("Loading current Work and phase decisions…").waitFor({state:"hidden"});
      const readyQueue=await pm.evaluate(async(workspace)=>{
        const response=await fetch(`/api/d5o-hosted/customer-work?workspace=${workspace}`);
        return {status:response.status,body:await response.json()};
      },tenant.workspaceKey);
      assert.equal(readyQueue.status,200);
      assert((readyQueue.body.tasks??[]).some((item)=>item.workId===basis.work.id
        && item.id?.includes(request.id) && item.action==="create-job"),
        `${prefix}:job_task_missing`);
      const create=pm.getByRole("button",{name:"Create executable service job"});
      await create.waitFor({state:"visible"});
      const [jobResponse]=await Promise.all([pm.waitForResponse((item)=>item.url().includes("/prototype-operate-command")&&item.request().method()==="POST"),create.click()]);
      assert.equal(jobResponse.status(),200,`${prefix}:service-job:${await jobResponse.text()}`);
      const jobCommand=jobResponse.request().postDataJSON();
      const completed=await connectedBasis(prefix,tenant);
      const job=completed.operate.state.jobs.find((item)=>item.requestId===request.id);
      assert(job,`${prefix}:job-missing`);
      assert.equal(completed.operate.state.jobs.filter((item)=>item.requestId===request.id
        && item.status!=="Cancelled").length,1,`${prefix}:duplicate-executable-job`);
      const approvalRows=Number(sql(`select count(*) from d5o_hosted.service_approval_requests
        where workspace_id=${q(tenant.workspaceId)} and service_request_id=${q(request.id)};`));
      assert.equal(approvalRows,prefix==="a"?1:0,`${prefix}:unexpected-approval-record`);
      assert.equal(completed.work.phaseConfigurationVersionId,basis.work.phaseConfigurationVersionId);
      await pm.reload();
      await pm.getByText(`Service job: ${job.status}`,{exact:false}).waitFor();
      assert.equal(await pm.getByRole("button",{name:"Create executable service job"}).count(),0);
      const completedQueue=await pm.evaluate(async(workspace)=>{
        const response=await fetch(`/api/d5o-hosted/customer-work?workspace=${workspace}`);
        return {status:response.status,body:await response.json()};
      },tenant.workspaceKey);
      assert.equal(completedQueue.status,200);
      assert(!(completedQueue.body.tasks??[]).some((item)=>item.workId===basis.work.id
        && item.id?.includes(request.id) && item.action==="create-job"),
        `${prefix}:stale_job_task`);
      await pm.screenshot({path:resolve(screenshotDir,`${prefix}-service-job.png`),fullPage:true});
      await pm.setViewportSize({width:390,height:844});
      await pm.screenshot({path:resolve(screenshotDir,`${prefix}-service-job-mobile.png`),fullPage:true});
      await pm.setViewportSize({width:1440,height:900});
      if(phase2htc) {
        const completedTask=lastServiceTask.get(`${prefix}_pm:${basis.work.id}`);
        await assertServiceTaskResolved(`${prefix}_pm`,tenant,basis.work.id);
        await pm.goto(completedTask.url);
        await pm.getByText(`Service job: ${job.status}`,{exact:false}).waitFor();
        assert.equal(await pm.getByRole("button",{name:"Create executable service job"}).count(),0,
          `${prefix}:replayed_job_task_actionable`);
        completedTask.urlReplayDenied=true;
      }
      outcomes.push({tenant:tenant.workspaceKey,workId:basis.work.id,requestId:request.id,
        thresholdMinor:approvalBefore.body.result.thresholdMinor,
        approvalRequired:approvalBefore.body.result.approvalRequired,
        thresholdApprovalHttp,thresholdApproverActorId:prefix==="a"?users.a_admin.id:null,
        prematureJobHttp:unauthorizedJob.status,prematureAuthorizationHttp:preapprovalAuthorization?.status??null,
        customerEvidenceId:evidenceBody.evidenceId,authorizationHttp:authorizationResponse.status(),
        jobHttp:jobResponse.status(),jobId:job.id,approvalRows,
        ...(phase2htc?{thresholdDecisionCommand,authorizationCommand,jobCommand,
          forgedEvidenceHttp}:{}),
        myWorkCreationTaskReady:true,myWorkCreationTaskResolved:true,
        configurationVersionId:completed.work.phaseConfigurationVersionId});
    }
    evidence.gateBJobs=outcomes;
    return outcomes;
  });
  else if(phase2htGateB) evidence.tests.push({name:"both tenants authorize priced service and create one executable job through authenticated browser controls",
    status:"BLOCKED",detail:"Triage and pricing browser prerequisite did not pass"});
  if(phase2htGateB && evidence.gateBJobs?.length===2) await check("connected service adapters and job RPC deny cross-tenant actors",async()=>{
    const aJob=evidence.gateBJobs[0],bJob=evidence.gateBJobs[1];
    const aPage=await designPage("a_pm",a,aJob.workId);
    const forbidden=await aPage.evaluate(async({workspace,workId,requestId,evidenceId})=>{
      const approval=await fetch(`/api/d5o-hosted/service-approval?workspace=${workspace}&parentPresentationId=${workId}&requestId=${requestId}`);
      const evidence=await fetch(`/api/d5o-hosted/customer-decision-evidence?workspace=${workspace}&workId=${workId}&evidenceId=${evidenceId}`);
      const mutation=await fetch(`/api/d5o-hosted/service-approval`,{method:"POST",
        headers:{"Content-Type":"application/json"},body:JSON.stringify({workspace,
          parentPresentationId:workId,requestId,action:"request",commandId:crypto.randomUUID()})});
      return {approval:approval.status,evidence:evidence.status,mutation:mutation.status};
    },{workspace:b.workspaceKey,workId:bJob.workId,requestId:bJob.requestId,
      evidenceId:bJob.customerEvidenceId});
    assert.deepEqual(forbidden,{approval:403,evidence:403,mutation:403});
    const directApproval=await call("a_pm","d5o_hosted_connected_service_approval_read_v1",{
      p_workspace_key:b.workspaceKey,p_parent_presentation_id:bJob.workId,
      p_request_id:bJob.requestId});
    assert.equal(directApproval.error?.code,"42501");
    const before=await connectedBasis("b",b);
    const catalog=await call("b_admin","d5o_hosted_prototype_read_v1",{
      p_workspace_key:b.workspaceKey,p_state_key:"catalog"});
    assert(!catalog.error);
    const directJob=await call("a_pm","d5o_hosted_service_job_command_v1",{
      p_workspace_key:b.workspaceKey,p_parent_presentation_id:bJob.workId,
      p_request_id:bJob.requestId,p_due_date:new Date().toISOString().slice(0,10),
      p_owner:"Forged foreign owner",p_command_id:randomUUID(),
      p_expected_work_revision:before.source.revision,
      p_expected_catalog_revision:catalog.data.revision,
      p_expected_operate_revision:before.operate.revision});
    assert.equal(directJob.error?.code,"42501",JSON.stringify(directJob));
    const after=await connectedBasis("b",b);
    assert.equal(after.operate.state.jobs.length,before.operate.state.jobs.length);
    return {api:forbidden,directApproval:directApproval.error.code,
      directJob:directJob.error.code,unchangedJobCount:after.operate.state.jobs.length};
  });
  if(phase2htc && evidence.gateBJobs?.length===2) await check("service adapters reject forgery and replay without additional jobs",async()=>{
    const [aJob,bJob]=evidence.gateBJobs;
    const aPage=await designPage("a_pm",a,aJob.workId);
    const bPage=await designPage("b_pm",b,bJob.workId);
    const aOps=await designPage("a_ops",a,aJob.workId);
    const approver=await designPage("a_admin",a,aJob.workId);
    const anonymous=await designBrowser.newPage();
    const unauth=await anonymous.request.get(`http://127.0.0.1:${server.port}`+
      `/api/d5o-hosted/service-approval?workspace=${a.workspaceKey}`+
      `&parentPresentationId=${aJob.workId}&requestId=${aJob.requestId}`);
    await anonymous.close();
    assert([401,403].includes(unauth.status()),`unauth:${unauth.status()}`);
    const reversed=await bPage.evaluate(async({workspace,workId,requestId,evidenceId})=>{
      const endpoints=[
        `/api/d5o-hosted/service-approval?workspace=${workspace}&parentPresentationId=${workId}&requestId=${requestId}`,
        `/api/d5o-hosted/customer-decision-evidence?workspace=${workspace}&workId=${workId}&evidenceId=${evidenceId}`];
      return Promise.all(endpoints.map(async(url)=>(await fetch(url)).status));
    },{workspace:a.workspaceKey,workId:aJob.workId,requestId:aJob.requestId,
      evidenceId:aJob.customerEvidenceId});
    assert.deepEqual(reversed,[403,403]);
    const forged=await aPage.evaluate(async({workspace,workId,evidenceId})=>{
      const other=crypto.randomUUID();
      const urls=[
        `/api/d5o-hosted/service-approval?workspace=${workspace}&parentPresentationId=${workId}&requestId=${other}`,
        `/api/d5o-hosted/service-approval?workspace=${workspace}&parentPresentationId=${other}&requestId=${other}`,
        `/api/d5o-hosted/customer-decision-evidence?workspace=${workspace}&workId=${workId}&evidenceId=${other}`,
        `/api/d5o-hosted/customer-decision-evidence?workspace=${workspace}&workId=${other}&evidenceId=${evidenceId}`];
      return Promise.all(urls.map(async(url)=>(await fetch(url)).status));
    },{workspace:a.workspaceKey,workId:aJob.workId,evidenceId:aJob.customerEvidenceId});
    assert(forged.every((status)=>status>=400),`forged:${forged}`);
    const outsider=await call("outsider","d5o_hosted_connected_service_approval_read_v1",{
      p_workspace_key:a.workspaceKey,p_parent_presentation_id:aJob.workId,
      p_request_id:aJob.requestId});
    assert.equal(outsider.error?.code,"42501");
    const beforeA=await connectedBasis("a",a),beforeB=await connectedBasis("b",b);
    const send=async(page,path,command)=>page.evaluate(async({path,command})=>{
      const response=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify(command)});
      return {status:response.status,body:await response.json()};
    },{path,command});
    const jobPath=`/api/d5o-hosted/prototype-operate-command?workspace=${a.workspaceKey}`;
    const jobReplay=await send(aPage,jobPath,aJob.jobCommand);
    assert.equal(jobReplay.status,200,JSON.stringify(jobReplay));
    const changedJob={...aJob.jobCommand,dueDate:"2026-12-31"};
    const jobConflict=await send(aPage,jobPath,changedJob);
    assert.equal(jobConflict.status,409,JSON.stringify(jobConflict));
    const parallel=await Promise.all([send(aPage,jobPath,{...aJob.jobCommand,
      commandId:randomUUID()}),send(aPage,jobPath,{...aJob.jobCommand,
      commandId:randomUUID()})]);
    assert(parallel.every((item)=>item.status===409),JSON.stringify(parallel));
    const approvalPath="/api/d5o-hosted/service-approval";
    const approvalReplay=await send(approver,approvalPath,aJob.thresholdDecisionCommand);
    assert.equal(approvalReplay.status,200,JSON.stringify(approvalReplay));
    const approvalConflict=await send(approver,approvalPath,
      {...aJob.thresholdDecisionCommand,action:"reject"});
    assert.equal(approvalConflict.status,409,JSON.stringify(approvalConflict));
    const authPath=`/api/d5o-hosted/prototype-operate-command?workspace=${a.workspaceKey}`;
    const authorizationReplay=await send(aOps,authPath,aJob.authorizationCommand);
    assert.equal(authorizationReplay.status,200,JSON.stringify(authorizationReplay));
    const authConflict=await send(aOps,authPath,{...aJob.authorizationCommand,
      note:"Conflicting decision reuse"});
    assert.equal(authConflict.status,409,JSON.stringify(authConflict));
    const afterA=await connectedBasis("a",a),afterB=await connectedBasis("b",b);
    assert.equal(afterA.operate.state.jobs.length,beforeA.operate.state.jobs.length);
    assert.equal(afterB.operate.state.jobs.length,beforeB.operate.state.jobs.length);
    assert.equal(afterA.operate.revision,beforeA.operate.revision);
    assert.equal(afterB.operate.revision,beforeB.operate.revision);
    return {unauthenticated:unauth.status(),reverseCrossTenant:reversed,forged,
      nonmemberRpc:outsider.error.code,wrongRoleRpc:evidence.serviceWrongRoleDenial,
      exactJobReplay:jobReplay.status,conflictingJobReplay:jobConflict.status,
      concurrentPostJob:parallel.map((item)=>item.status),
      exactApprovalReplay:approvalReplay.status,conflictingApprovalReplay:approvalConflict.status,
      exactAuthorizationReplay:authorizationReplay.status,conflictingAuthorizationReplay:authConflict.status,
      unchangedJobs:[afterA.operate.state.jobs.length,afterB.operate.state.jobs.length]};
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
      const deployEventRefs=JSON.parse(sql(`select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object('revision',decision_revision,'commandId',command_id,
          'action',action,'actor',actor_user_id) order by decision_revision)::text
        from d5o_hosted.connected_deploy_events where workspace_id=${q(tenant.workspaceId)}
          and work_id=${q(id)};`));
      const operateEventRefs=JSON.parse(sql(`select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object('revision',decision_revision,'commandId',command_id,
          'action',action,'actor',actor_user_id) order by decision_revision)::text
        from d5o_hosted.connected_operate_events where workspace_id=${q(tenant.workspaceId)}
          and work_id=${q(id)};`));
      outcomes.push({tenant:tenant.workspaceKey,workId:id,deployEvents:deploy,operateEvents:operate,
        deployEventRefs,operateEventRefs});
    }
    return outcomes;
  });
  await check("new published tenant policy does not repin completed connected Work",async()=>{
    const prior=versions.a_admin;
    const revision=Number(sql(`select edit_revision from d5o_hosted.configuration_versions
      where id=${q(prior)};`));
    const draft=rc3PrepublicationDraftId?null:await config("a_admin",a.workspaceKey,
      "create-draft",prior,prior,revision,{},"phase2f-historical-draft");
    if(draft)assert(!draft.error,draft.error?.message);
    const next=rc3PrepublicationDraftId??draft.data.versionId;
    const draftRevision=Number(sql(`select edit_revision from d5o_hosted.configuration_versions
      where id=${q(next)};`));
    const changed=await config("a_admin",a.workspaceKey,"save-policy",next,prior,draftRevision,
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
      const dir=browserEvidenceDir("docs/architecture/evidence/phase2g-browser");
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
          const diagnostic=phase2hteDiagnostic?{
            actor:users[`${prefix}_admin`].id,tenant:tenant.workspaceKey,
            route:page.url(),title:browserWork,events:[],attempts:[]}:null;
          const responseReads=[];
          if(diagnostic) {
            page.on("request",(request)=>{
              if(!request.url().includes("/api/d5o-hosted/connected-work"))return;
              const body=request.method()==="POST"?request.postDataJSON():null;
              diagnostic.events.push({kind:"request",at:new Date().toISOString(),
                method:request.method(),url:request.url(),body});
            });
            page.on("response",(response)=>{
              if(!response.url().includes("/api/d5o-hosted/connected-work"))return;
              responseReads.push(response.text().then((body)=>diagnostic.events.push({
                kind:"response",at:new Date().toISOString(),status:response.status(),
                method:response.request().method(),url:response.url(),body
              })).catch((error)=>diagnostic.events.push({kind:"response_body_unavailable",
                at:new Date().toISOString(),reason:String(error.message)})));
            });
            page.on("console",(message)=>{if(message.type()==="error")diagnostic.events.push({
              kind:"console_error",at:new Date().toISOString(),message:message.text()});});
            page.on("pageerror",(error)=>diagnostic.events.push({kind:"page_error",
              at:new Date().toISOString(),message:error.message}));
            page.on("framenavigated",(frame)=>{if(frame===page.mainFrame())diagnostic.events.push({
              kind:"navigation",at:new Date().toISOString(),url:frame.url()});});
          }
          const fillBrowserWork=async()=>{
            await page.getByLabel("Work name").fill(browserWork);
            await page.getByLabel("Customer",{exact:true}).fill("Fictional browser customer");
            await page.getByLabel("Site").fill("Fictional browser site");
            await page.getByLabel("Accountable owner").fill("Fictional owner");
            await page.getByLabel("Demand source").fill("Fictional customer request");
            await page.getByLabel("Customer need").fill("A fictional connected service need created through the authenticated application.");
            await page.getByLabel("Procurement route").fill("Customer authorization required");
          };
          let createdResult=null;
          let creationError=null;
          try {for(let attempt=0;attempt<2;attempt++) {
            await fillBrowserWork();
            // Next dev may replace this route during hydration. Retry only when
            // the browser never sent a POST, so no business command can repeat.
            let posted=false;
            const onRequest=(request)=>{if(request.url().includes("/api/d5o-hosted/connected-work")
              && request.method()==="POST")posted=true;};
            page.on("request",onRequest);
            const response=page.waitForResponse((item)=>item.url().includes("/api/d5o-hosted/connected-work")
              && item.request().method()==="POST",{timeout:10000}).catch(()=>null);
            await page.getByRole("button",{name:"Create connected Work"}).click();
            createdResult=await response;
            page.off("request",onRequest);
            if(diagnostic)diagnostic.attempts.push({attempt:attempt+1,postObserved:posted,
              responseStatus:createdResult?.status()??null,url:page.url()});
            if(createdResult && createdResult.status()!==201) {
              const body=await createdResult.text().catch(()=>"response body unavailable");
              assert.equal(createdResult.status(),201,`browser-work-create:${body}`);
            }
            const receipt=page.getByRole("status")
              .filter({hasText:`Connected Work created: ${browserWork}`});
            if(await receipt.isVisible().catch(()=>false))break;
            if(posted) {
              await receipt.waitFor({timeout:30000});
              break;
            }
            else if(attempt===0) {
              await page.goto(`http://127.0.0.1:${server.port}/work/connected-work?workspace=${tenant.workspaceKey}`);
              await page.getByRole("button",{name:"Create connected Work"}).waitFor({timeout:30000});
            } else throw Error(`browser_work_post_not_sent:${page.url()}`);
          }} catch(error) {creationError=error;}
          if(diagnostic) {
            await Promise.allSettled(responseReads);
            diagnostic.failedAssertion=creationError?String(creationError.message):null;
            diagnostic.page=await page.evaluate(()=>{
              const form=document.querySelector("form.connectedStartForm");
              return {url:location.href,readyState:document.readyState,
                statuses:[...document.querySelectorAll('[role="status"]')].map((item)=>item.textContent),
                alerts:[...document.querySelectorAll('[role="alert"]')].map((item)=>item.textContent),
                formPresent:Boolean(form),formValid:form?.checkValidity()??null,
                formValues:form?Object.fromEntries(new FormData(form)):null};
            }).catch((error)=>({unavailable:String(error.message)}));
            diagnostic.database=JSON.parse(sql(`select pg_catalog.jsonb_build_object(
              'work',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                'id',id,'title',title,'createdBy',created_by,'configurationVersionId',configuration_version_id))
                from d5o_hosted.work_records where workspace_id=${q(tenant.workspaceId)}
                  and title=${q(browserWork)}),'[]'::jsonb),
              'receipts',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                'commandId',r.command_id,'actor',r.actor_user_id,'workId',r.work_id,'result',r.result))
                from d5o_hosted.connected_create_receipts r
                join d5o_hosted.work_records w on w.id=r.work_id and w.workspace_id=r.workspace_id
                where r.workspace_id=${q(tenant.workspaceId)} and w.title=${q(browserWork)}),'[]'::jsonb))::text;`));
            const evidenceDir=resolve(root,"docs/architecture/evidence/phase2hte-gate-b-browser");
            mkdirSync(evidenceDir,{recursive:true});
            const screenshot=resolve(evidenceDir,`${prefix}-creation-state.png`);
            await page.screenshot({path:screenshot,fullPage:true}).catch(()=>{});
            diagnostic.screenshot=`${prefix}-creation-state.png`;
            writeFileSync(resolve(root,`docs/architecture/evidence/phase2hte-gate-b-diagnostic-${prefix}.json`),
              JSON.stringify(diagnostic,null,2)+"\n");
          }
          if(creationError)throw creationError;
          if(phase2hteReloadProbe) {
            await page.reload();
            const confirmation=page.getByRole("status")
              .filter({hasText:`Connected Work created: ${browserWork}`});
            const receiptVisible=await confirmation.waitFor({timeout:30000})
              .then(()=>true).catch(()=>false);
            const persisted=JSON.parse(sql(`select pg_catalog.jsonb_build_object(
              'workCount',(select count(*) from d5o_hosted.work_records
                where workspace_id=${q(tenant.workspaceId)} and title=${q(browserWork)}),
              'receiptCount',(select count(*) from d5o_hosted.connected_create_receipts r
                join d5o_hosted.work_records w on w.id=r.work_id and w.workspace_id=r.workspace_id
                where r.workspace_id=${q(tenant.workspaceId)} and w.title=${q(browserWork)}))::text;`));
            const probe={tenant:tenant.workspaceKey,receiptVisible,persisted,
              route:page.url(),expectedTitle:browserWork};
            const probeDir=resolve(root,"docs/architecture/evidence/phase2hte-gate-b-browser");
            mkdirSync(probeDir,{recursive:true});
            await page.screenshot({path:resolve(probeDir,`${prefix}-creation-after-reload.png`),fullPage:true});
            writeFileSync(resolve(root,`docs/architecture/evidence/phase2hte-reload-probe-${prefix}.json`),
              JSON.stringify(probe,null,2)+"\n");
            assert.equal(Number(persisted.workCount),1,"created_work_missing_after_reload");
            assert.equal(Number(persisted.receiptCount),1,"create_receipt_missing_after_reload");
            assert(receiptVisible,"work_creation_receipt_lost_after_reload");
          }
          // Chromium may discard the response body after a successful route
          // transition. Only request it when diagnosing a non-201 response.
          if(createdResult && createdResult.status()!==201) {
            const body=await createdResult.text().catch(()=>"response body unavailable");
            assert.equal(createdResult.status(),201,`browser-work-create:${body}`);
          }
          // The Work list and exact detail read prove that the confirmed create
          // is accessible after leaving the form, not just visible as a receipt.
          const customerUrl=`http://127.0.0.1:${server.port}/work/customer/${tenant.workspaceKey}`;
          try { await page.goto(customerUrl,{waitUntil:"domcontentloaded"}); }
          catch(error) {
            if(!String(error).includes("net::ERR_ABORTED")) throw error;
            // The development server can replace an in-flight route while it
            // compiles. Retry this read-only navigation once, then fail.
            await page.goto(customerUrl,{waitUntil:"domcontentloaded"});
          }
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
    const dir=browserEvidenceDir(phase2g
      ? "docs/architecture/evidence/phase2g-browser"
      : "docs/architecture/evidence/phase2f-browser");
    mkdirSync(dir,{recursive:true});
    const files=[];
    try {
      for(const [prefix,tenant] of [["a",a],["b",b]]) {
        const page=await browser.newPage({viewport:{width:1440,height:900}});
        const configurationPath=`/work/admin/configuration?workspace=${tenant.workspaceKey}`;
        await page.goto(`http://127.0.0.1:${server.port}/auth/sign-in?next=%2Fwork`);
        await page.waitForLoadState("networkidle");
        await page.getByLabel("Email").fill(users[`${prefix}_admin`].email);
        await page.getByLabel("Password").fill(users[`${prefix}_admin`].password);
        await page.getByRole("button",{name:"Continue to your work"}).click();
        await page.getByRole("link",{name:/Open workspace/}).first().waitFor({timeout:30000});
        await page.locator(`[data-workspace="${tenant.workspaceKey}"]`).click();
        await page.getByRole("heading",{name:"Work lifecycle"}).waitFor({timeout:30000});
        await page.goto(`http://127.0.0.1:${server.port}${configurationPath}`);
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
          else await page.getByLabel("Active Discover intake policy")
            .getByRole("heading",{name:"Discover intake"}).waitFor({timeout:30000});
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
  if(phase2hu) await check("field evidence access rechecks membership, rollout and tenant lifecycle",async()=>{
    const worker=deployPages.get("a_worker");
    assert(worker,"signed-in assigned field worker required");
    const before=await connectedBasis("a",a);
    const evidenceId=before.deploy.state.evidence.find((item)=>item.packageId===before.packageId)?.id;
    assert(evidenceId,"private field evidence required");
    const deniedMutation=(id)=>call("a_worker","d5o_hosted_field_fact_command_v1",{
      p_workspace_key:a.workspaceKey,p_presentation_id:before.work.id,
      p_package_id:before.packageId,p_action:"save-report",
      p_input:{summary:"Denied stale field decision"},p_command_id:`phase2hu-${id}-${randomUUID()}`,
      p_expected_source_revision:before.source.revision,
      p_expected_design_revision:before.work.design.authorityRevision,
      p_expected_schedule_revision:before.schedule.revision,
      p_expected_deploy_revision:before.deploy.revision});
    const probe=async(id=evidenceId)=>worker.evaluate(async({workspace,workId,evidenceId})=>{
      const response=await fetch(`/api/d5o-hosted/worker-deploy?workspace=${workspace}`+
        `&workId=${encodeURIComponent(workId)}&evidenceId=${evidenceId}`);
      return response.status;
    },{workspace:a.workspaceKey,workId:before.work.id,evidenceId:id});
    assert.equal(await probe(),200);
    assert.equal(await probe(randomUUID()),404);
    const people=await call("a_admin","d5o_hosted_org_admin_read_v1",{
      p_workspace_key:a.workspaceKey,p_kind:"people",p_search:"",p_offset:0,p_limit:25});
    assert(!people.error,people.error?.message);
    const member=people.data.items.find((item)=>item.actor_user_id===users.a_worker.id);
    assert(member,"assigned worker membership required");
    const membership=async(action,revision)=>call("a_admin","d5o_hosted_org_admin_command_v1",{
      p_workspace_key:a.workspaceKey,p_action:action,p_subject_id:member.id,p_input:{},
      p_expected_revision:revision,p_reason:`Disposable field evidence ${action} qualification`,
      p_command_id:randomUUID()});
    const suspended=await membership("member.suspend",member.revision);
    assert(!suspended.error,suspended.error?.message);
    const suspendedStatus=await probe();assert.equal(suspendedStatus,403);
    const suspendedRpc=await deniedMutation("suspended");
    assert.equal(suspendedRpc.error?.code,"42501",JSON.stringify(suspendedRpc));
    const restored=await membership("member.reactivate",suspended.data.record.revision);
    assert(!restored.error,restored.error?.message);
    assert.equal(await probe(),200);
    const directory=async()=>{
      const result=await call("vendor","d5o_platform_provisioning_directory_v1");
      assert(!result.error,result.error?.message);
      return result.data.find((item)=>item.workspaceKey===a.workspaceKey);
    };
    let tenant=await directory();
    const disabled=await call("vendor","d5o_platform_capability_command_v1",{
      p_workspace_key:a.workspaceKey,p_kind:"flag",p_enabled:false,
      p_expected_revision:tenant.connectedWorkFlagRevision,p_command_id:randomUUID(),
      p_reason:"Disposable field evidence rollout denial"});
    assert(!disabled.error,disabled.error?.message);
    const disabledStatus=await probe();assert.equal(disabledStatus,403);
    const disabledRpc=await deniedMutation("disabled");
    assert.equal(disabledRpc.error?.code,"42501",JSON.stringify(disabledRpc));
    const enabled=await call("vendor","d5o_platform_capability_command_v1",{
      p_workspace_key:a.workspaceKey,p_kind:"flag",p_enabled:true,
      p_expected_revision:disabled.data.revision,p_command_id:randomUUID(),
      p_reason:"Restore disposable field evidence rollout"});
    assert(!enabled.error,enabled.error?.message);
    assert.equal(await probe(),200);
    tenant=await directory();
    const tenantOff=await call("vendor","d5o_platform_lifecycle_command_v1",{
      p_workspace_key:a.workspaceKey,p_action:"suspend",p_expected_revision:tenant.revision,
      p_command_id:randomUUID(),p_reason:"Disposable field evidence tenant suspension"});
    assert(!tenantOff.error,tenantOff.error?.message);
    const tenantStatus=await probe();assert.equal(tenantStatus,403);
    const tenantRpc=await deniedMutation("tenant-off");
    assert.equal(tenantRpc.error?.code,"42501",JSON.stringify(tenantRpc));
    const tenantOn=await call("vendor","d5o_platform_lifecycle_command_v1",{
      p_workspace_key:a.workspaceKey,p_action:"reactivate",p_expected_revision:tenantOff.data.revision,
      p_command_id:randomUUID(),p_reason:"Restore disposable field evidence tenant"});
    assert(!tenantOn.error,tenantOn.error?.message);
    assert.equal(await probe(),200);
    const after=await connectedBasis("a",a);
    assert.equal(after.deploy.revision,before.deploy.revision);
    return {evidenceId,forgedStatus:404,suspendedStatus,
      suspendedRpc:suspendedRpc.error?.message,disabledStatus,
      disabledRpc:disabledRpc.error?.message,tenantStatus,
      tenantRpc:tenantRpc.error?.message,
      unchangedDeployRevision:after.deploy.revision};
  });
  if(phase2hv) await check("Finance receives separate My Work follow-up after support activation",async()=>{
    const outcomes=[];
    for(const [prefix,tenant] of [["a",a],["b",b]]) {
      const page=await deployPage(`${prefix}_finance`,tenant,`/work/customer/${tenant.workspaceKey}`);
      const task=page.getByRole("link",{name:/Review financial closeout obligation/});
      await task.waitFor();await task.click();
      await page.getByRole("heading",{name:"Review financial closeout obligation"}).waitFor();
      await page.getByText("Support Active. Financial closeout remains Pending.").waitFor();
      await page.getByLabel("Finance review and next action").fill("Verify accepted Work and reconcile the outstanding financial obligation");
      const response=await browserDeployDecision(page,page.getByRole("button",{name:"Start Finance review"}),
        "/api/d5o-hosted/prototype-operate-command",200);
      await page.getByText("Support Active. Financial closeout remains In review.").waitFor();
      await deployPage(`${prefix}_finance`,tenant,`/work/customer/${tenant.workspaceKey}`);
      assert.equal(await page.getByRole("link",{name:/Review financial closeout obligation/}).count(),0);
      const basis=await connectedBasis(prefix,tenant);
      assert.equal(basis.operate.state.activation.status,"Active");
      assert.equal(basis.operate.state.finance.status,"In review");
      const phase=await call(`${prefix}_finance`,"d5o_hosted_phase_status_read_v1",{
        p_workspace_key:tenant.workspaceKey,p_presentation_id:basis.work.id});
      assert(!phase.error,phase.error?.message);
      assert.equal(phase.data.projection.financialCloseout,"In review");
      assert.equal(phase.data.replayMatches,true);
      outcomes.push({tenant:tenant.workspaceKey,http:response.status,
        support:basis.operate.state.activation.status,finance:basis.operate.state.finance.status,
        taskResolved:true,replayMatches:true});
    }
    return outcomes;
  });
  if(phase2hvc) await check("finite Operate command, documentation and stale-task integrity",async()=>{
    const aBasis=await connectedBasis("a",a),bBasis=await connectedBasis("b",b);
    const operateTest=evidence.tests.find((item)=>item.name===
      "Operate support acceptance follows exact Deploy receipt and pinned documentation policy");
    const aCommand=operateTest?.detail?.[0]?.browser?.document?.concurrentSupport?.acceptedCommand;
    assert(aCommand?.commandId && aCommand.action==="accept-support","accepted_browser_command_missing");
    const aPage=deployPages.get("a_ops");
    assert(aPage,"receiving_browser_session_missing");
    const post=async(page,workspace,command)=>page.evaluate(async({workspace,command})=>{
      const response=await fetch(`/api/d5o-hosted/prototype-operate-command?workspace=${workspace}`,{
        method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(command)});
      return {status:response.status,body:await response.json()};
    },{workspace,command});
    const exactBefore=await operateSnapshot("a",a);
    const exact=await post(aPage,a.workspaceKey,aCommand);
    assert.equal(exact.status,200,`exact_replay:${JSON.stringify(exact)}`);
    assert.deepEqual(await operateSnapshot("a",a),exactBefore,"exact_replay_mutated_state");
    evidence.operateIntegrity.push({name:"exact_duplicate_support_acceptance",expected:200,
      actual:exact.status,unchanged:true,receiptCount:exactBefore.counts.receipts});
    const conflict=await post(aPage,a.workspaceKey,{...aCommand,
      warrantyDisposition:"Conflicting reused support command"});
    assert.equal(conflict.status,409,`conflicting_replay:${JSON.stringify(conflict)}`);
    assert.deepEqual(await operateSnapshot("a",a),exactBefore,"conflicting_replay_mutated_state");
    evidence.operateIntegrity.push({name:"conflicting_duplicate_command_id",expected:409,
      actual:conflict.status,body:conflict.body,unchanged:true});
    const oldTask=await aPage.goto(`http://127.0.0.1:${server.port}/work/customer/${a.workspaceKey}`+
      `?work=${encodeURIComponent(aBasis.work.id)}#phase-operate`);
    assert.equal(oldTask?.status(),200,"old_task_navigation_failed");
    await aPage.getByRole("heading",{name:"Accepted delivery and support responsibility"}).waitFor();
    assert.equal(await aPage.getByRole("button",{name:"Accept support ownership"}).count(),0);
    const completedTaskReplay=await post(aPage,a.workspaceKey,{...aCommand,
      commandId:randomUUID(),expectedDecisionRevision:aBasis.operate.revision});
    assert.equal(completedTaskReplay.status,409,
      `completed_task_replayed:${JSON.stringify(completedTaskReplay)}`);
    assert.deepEqual(await operateSnapshot("a",a),exactBefore,"completed_task_replay_mutated_state");
    evidence.operateIntegrity.push({name:"completed_my_work_task_replay",expected:409,
      actual:completedTaskReplay.status,body:completedTaskReplay.body,unchanged:true});
    const args=(basis,tenant,action,input,overrides={})=>({
      p_workspace_key:tenant.workspaceKey,p_presentation_id:basis.work.id,
      p_action:action,p_input:input,p_command_id:randomUUID(),
      p_expected_source_revision:basis.source.revision,
      p_expected_deploy_revision:basis.deploy.revision,
      p_expected_operate_revision:basis.operate.revision,...overrides});
    await deniedOperateCase("stale_work_revision","a",a,
      ()=>call("a_ops","d5o_hosted_operate_command_v1",args(aBasis,a,"activate",
        {note:"Reject stale Work basis"},{p_expected_source_revision:aBasis.source.revision-1})),["23505"]);
    await deniedOperateCase("invalid_work_identity","a",a,
      ()=>call("a_ops","d5o_hosted_operate_command_v1",args(aBasis,a,"activate",
        {note:"Reject forged Work identity"},{p_presentation_id:randomUUID()})),["42501"]);
    await deniedOperateCase("foreign_configuration_version_argument","a",a,
      ()=>call("a_ops","d5o_hosted_operate_command_v1",args(aBasis,a,"activate",
        {note:"Reject caller selected configuration"},
        {p_configuration_version_id:bBasis.work.phaseConfigurationVersionId})),["PGRST202"]);
    const aDoc=aBasis.operate.state.documentationObligations.find((item)=>item.kind==="as-built");
    const aTurnover=aBasis.deploy.state.turnovers.find((item)=>item.id===aDoc?.turnoverId);
    const bTurnover=bBasis.deploy.state.turnovers.find((item)=>item.receipt==="Accepted");
    assert(aDoc&&aTurnover&&bTurnover,"support_document_test_basis_missing");
    const docArgs=(basis,tenant,turnoverId,evidenceId,overrides={})=>({
      p_workspace_key:tenant.workspaceKey,p_presentation_id:basis.work.id,p_action:"review",
      p_turnover_id:turnoverId,p_kind:"as-built",p_evidence_id:evidenceId,
      p_decision:"Reviewed",p_note:"Independent review of exact fictional document",
      p_command_id:randomUUID(),p_expected_source_revision:basis.source.revision,
      p_expected_deploy_revision:basis.deploy.revision,
      p_expected_operate_revision:basis.operate.revision,...overrides});
    await deniedOperateCase("forged_document_reference","a",a,
      ()=>call("a_ops2","d5o_hosted_support_document_command_v1",
        docArgs(aBasis,a,aTurnover.id,randomUUID())),["23514"]);
    await deniedOperateCase("wrong_work_documentation","b",b,
      ()=>call("b_ops","d5o_hosted_support_document_command_v1",
        docArgs(bBasis,b,bTurnover.id,aDoc.id)),["23514"]);
    await deniedOperateCase("wrong_package_turnover","a",a,
      ()=>call("a_ops2","d5o_hosted_support_document_command_v1",
        docArgs(aBasis,a,bTurnover.id,aDoc.id)),["23514"]);
    await deniedOperateCase("stale_document_review","a",a,
      ()=>call("a_ops2","d5o_hosted_support_document_command_v1",
        docArgs(aBasis,a,aTurnover.id,aDoc.id,
          {p_expected_operate_revision:aBasis.operate.revision-1})),["23505"]);
    await deniedOperateCase("unauthorized_document_reviewer","a",a,
      ()=>call("a_pm","d5o_hosted_support_document_command_v1",
        docArgs(aBasis,a,aTurnover.id,aDoc.id)),["42501"]);
    const directory=async()=>{const result=await call("vendor","d5o_platform_provisioning_directory_v1");
      assert(!result.error,result.error?.message);return result.data.find((item)=>item.workspaceKey===a.workspaceKey);};
    let tenant=await directory();
    const entitlementOff=await call("vendor","d5o_platform_capability_command_v1",{
      p_workspace_key:a.workspaceKey,p_kind:"entitlement",p_enabled:false,
      p_expected_revision:tenant.connectedWorkEntitlementRevision,p_command_id:randomUUID(),
      p_reason:"Disposable Operate entitlement denial"});
    assert(!entitlementOff.error,entitlementOff.error?.message);
    await deniedOperateCase("revoked_entitlement","a",a,
      ()=>call("a_ops","d5o_hosted_operate_command_v1",
        args(aBasis,a,"activate",{note:"Reject revoked entitlement"})),["42501"]);
    const entitlementOn=await call("vendor","d5o_platform_capability_command_v1",{
      p_workspace_key:a.workspaceKey,p_kind:"entitlement",p_enabled:true,
      p_expected_revision:entitlementOff.data.revision,p_command_id:randomUUID(),
      p_reason:"Restore disposable Operate entitlement"});
    assert(!entitlementOn.error,entitlementOn.error?.message);
    const objectPath=sql(`select object_path from d5o_hosted.customer_decision_evidence
      where id=${q(aDoc.id)}::uuid and workspace_id=${q(a.workspaceId)};`);
    assert(objectPath,"as_built_storage_path_missing");
    const removedObject=await admin.storage.from("d5o-deploy-evidence").remove([objectPath]);
    assert(!removedObject.error,removedObject.error?.message);
    await deniedOperateCase("deleted_as_built_document","a",a,
      ()=>call("a_ops2","d5o_hosted_support_document_command_v1",
        docArgs(aBasis,a,aTurnover.id,aDoc.id)),["23514"]);
    const people=await call("a_admin","d5o_hosted_org_admin_read_v1",{
      p_workspace_key:a.workspaceKey,p_kind:"people",p_search:"",p_offset:0,p_limit:25});
    assert(!people.error,people.error?.message);
    const receiver=people.data.items.find((item)=>item.actor_user_id===users.a_ops.id);
    assert(receiver,"receiving_membership_missing");
    const removed=await call("a_admin","d5o_hosted_org_admin_command_v1",{
      p_workspace_key:a.workspaceKey,p_action:"member.remove",p_subject_id:receiver.id,p_input:{},
      p_expected_revision:receiver.revision,p_reason:"Disposable stale receiver denial",
      p_command_id:randomUUID()});
    assert(!removed.error,removed.error?.message);
    const removedSession=await post(aPage,a.workspaceKey,{...aCommand,commandId:randomUUID(),
      expectedDecisionRevision:aBasis.operate.revision});
    assert.equal(removedSession.status,403,JSON.stringify(removedSession));
    const removedRpc=await call("a_ops","d5o_hosted_operate_command_v1",
      args(aBasis,a,"activate",{note:"Reject removed receiver"}));
    assert.equal(removedRpc.error?.code,"42501",JSON.stringify(removedRpc));
    assert.deepEqual(await operateSnapshot("a",a),exactBefore,"removed_receiver_mutated_state");
    evidence.operateIntegrity.push({name:"removed_receiver_stale_session",expected:{http:403,rpc:"42501"},
      actual:{http:removedSession.status,rpc:removedRpc.error.code},unchanged:true});
    return {cases:evidence.operateIntegrity.length,configurationVersionId:exactBefore.configurationVersionId,
      sourcePinUnchanged:true,removedSessionDenied:true};
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
    if(phase2htGateA) {
      const actor="b_replacement";
      const workerPage=designPages.get(actor);
      assert(workerPage,"bound worker browser required for tenant suspension check");
      const schedule=JSON.parse(sql(`select pg_catalog.jsonb_build_object(
        'revision',decision_revision,'state',state)::text
        from d5o_hosted.connected_schedule_states where workspace_id=${q(b.workspaceId)};`));
      const publication=schedule.state.publications.at(-1);
      const assignment=publication.assignments.find((item)=>item.workId===foreignWork.id);
      assert(assignment);
      const denied=await workerPage.evaluate(async({workspace,workId,publicationId,assignmentId,revision})=>{
        const read=await fetch(`/api/d5o-hosted/customer-develop-action?workspace=${workspace}&worker=1`);
        const write=await fetch(`/api/d5o-hosted/customer-develop-action?workspace=${workspace}`,{
          method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({action:"respond-booking",workId,publicationId,assignmentId,
            expectedRevision:revision,commandId:crypto.randomUUID()})});
        return {read:read.status,write:write.status};
      },{workspace:b.workspaceKey,workId:foreignWork.id,publicationId:publication.id,
        assignmentId:assignment.id,revision:schedule.revision});
      assert.equal(denied.read,403);assert.equal(denied.write,403);
      const direct=await call(actor,"d5o_hosted_crew_command_v1",{
        p_workspace_key:b.workspaceKey,p_action:"respond-booking",
        p_input:{publicationId:publication.id,assignmentId:assignment.id,response:"acknowledged"},
        p_command_id:randomUUID(),p_expected_revision:schedule.revision});
      assert.equal(direct.error?.code,"42501",JSON.stringify(direct));
      assert.equal(sql(`select decision_revision from d5o_hosted.connected_schedule_states
        where workspace_id=${q(b.workspaceId)};`),String(schedule.revision));
      evidence.gateASecurity.push({tenant:b.workspaceKey,case:"suspended_tenant_worker",
        staleBrowserRead:denied.read,staleBrowserWrite:denied.write,
        directRpc:direct.error.code,unchangedRevision:schedule.revision});
    }
    const tenantOn=await call("vendor","d5o_platform_lifecycle_command_v1",{
      p_workspace_key:b.workspaceKey,p_action:"reactivate",p_expected_revision:tenantOff.data.revision,
      p_command_id:randomUUID(),p_reason:"Restore synthetic tenant after Design adapter regression"});
    assert(!tenantOn.error,tenantOn.error?.message);
    return {suspendedMembershipHttp:suspendedHttp,suspendedMembershipRpc:suspendedRpc.error.code,
      removedMembershipHttp:removedHttp,disabledFlagHttp:disabledHttp,
      disabledFeatureDirectRpc:disabledRpcCode,
      suspendedTenantHttp:tenantHttp,tenantReactivated:tenantOn.data.lifecycle};
  });
  if(phase2htGateA) await check("removed field worker loses stale-session API and direct RPC authority",async()=>{
    const actor="a_worker";
    const [source,schedule]=await Promise.all([
      call("a_admin","d5o_hosted_prototype_read_v1",{
        p_workspace_key:a.workspaceKey,p_state_key:"work"}),
      call("a_admin","d5o_hosted_prototype_read_v1",{
        p_workspace_key:a.workspaceKey,p_state_key:"schedule"})]);
    assert(!source.error&&!schedule.error,`removed-worker-basis:${source.error?.message??schedule.error?.message}`);
    const work=source.data.state.records.find((item)=>item.title==="Phase 2D policy qualification");
    const basis={work,packageId:work.design.packages[0].packageId,schedule:schedule.data};
    const publication=basis.schedule.state.publications.at(-1);
    const assignment=publication.assignments.find((item)=>item.workId===basis.work.id
      && item.packageId===basis.packageId);
    assert(assignment);
    const member=JSON.parse(sql(`select pg_catalog.jsonb_build_object('id',id,'revision',revision)::text
      from d5o_hosted.memberships where workspace_id=${q(a.workspaceId)}
        and actor_user_id=${q(users[actor].id)};`));
    const removed=await call("a_admin","d5o_hosted_org_admin_command_v1",{
      p_workspace_key:a.workspaceKey,p_action:"member.remove",p_subject_id:member.id,
      p_input:{},p_expected_revision:member.revision,
      p_reason:"Revoke fictional field access while preserving historical assignment",
      p_command_id:randomUUID()});
    assert(!removed.error,`remove-worker:${removed.error?.message}`);
    const page=designPages.get(actor);
    assert(page,"stale authenticated worker browser required");
    const http=await page.evaluate(async({workspace,workId,publicationId,assignmentId,revision})=>{
      const read=await fetch(`/api/d5o-hosted/customer-develop-action?workspace=${workspace}&worker=1`);
      const write=await fetch(`/api/d5o-hosted/customer-develop-action?workspace=${workspace}`,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({action:"respond-booking",workId,publicationId,assignmentId,
          expectedRevision:revision,commandId:crypto.randomUUID()})});
      return {read:read.status,write:write.status};
    },{workspace:a.workspaceKey,workId:basis.work.id,publicationId:publication.id,
      assignmentId:assignment.id,revision:basis.schedule.revision});
    assert.equal(http.read,403);assert.equal(http.write,403);
    const direct=await call(actor,"d5o_hosted_crew_command_v1",{
      p_workspace_key:a.workspaceKey,p_action:"respond-booking",
      p_input:{publicationId:publication.id,assignmentId:assignment.id,response:"acknowledged"},
      p_command_id:randomUUID(),p_expected_revision:basis.schedule.revision});
    assert.equal(direct.error?.code,"42501",JSON.stringify(direct));
    const attemptedReactivate=await call("a_admin","d5o_hosted_org_admin_command_v1",{
      p_workspace_key:a.workspaceKey,p_action:"member.reactivate",p_subject_id:member.id,
      p_input:{},p_expected_revision:removed.data.record.revision,
      p_reason:"Verify removed membership cannot be reactivated by stale assignment",
      p_command_id:randomUUID()});
    assert.equal(attemptedReactivate.error?.code,"23505");
    const after=await call("a_admin","d5o_hosted_prototype_read_v1",{
      p_workspace_key:a.workspaceKey,p_state_key:"schedule"});
    assert(!after.error,after.error?.message);
    assert.equal(after.data.revision,basis.schedule.revision);
    evidence.gateASecurity.push({tenant:a.workspaceKey,case:"removed_worker_acknowledgment",
      staleBrowserRead:http.read,staleBrowserWrite:http.write,directRpc:direct.error.code,
      reactivationDenied:attemptedReactivate.error.code,
      unchangedScheduleRevision:after.data.revision});
    return http;
  });
  if(phase2htd && evidence.gateBJobs?.length===2) await check(
    "TD pending threshold approval race leaves one terminal decision",async()=>{
    const workId=evidence.gateBJobs[0].workId;
    const prior=await connectedBasis("a",a);
    const asset=prior.operate.state.assets[0];
    const opened=await operateCommand("a",a,"a_pm","open-request",{
      assetId:asset.id,title:"Synthetic approval race incident",
      description:"Fictional monitored equipment requires inspected service repair",
      contact:"Fictional customer representative",impact:"Standard",
      note:"Open pending approval concurrency fixture"},`td-approval-race-${randomUUID()}`);
    assert(!opened.error,opened.error?.message);
    let basis=await connectedBasis("a",a);
    const request=basis.operate.state.requests.at(-1);
    const triaged=await operateCommand("a",a,"a_ops2","triage-request",{
      requestId:request.id,serviceCategory:"Monitoring fault"},
      `td-approval-race-triage-${randomUUID()}`);
    assert(!triaged.error,triaged.error?.message);
    basis=await connectedBasis("a",a);
    const original=basis.operate.state.requests.find((item)=>item.id===evidence.gateBJobs[0].requestId);
    const pricingInput=structuredClone(original.serviceEstimate.input);
    pricingInput.lines[0].scopeRef=request.id;
    const pricing=(actor,action,input,at)=>call(actor,
      "d5o_hosted_service_pricing_command_v1",{
        p_workspace_key:a.workspaceKey,p_parent_presentation_id:workId,
        p_request_id:request.id,p_action:action,p_input:input,
        p_command_id:randomUUID(),p_expected_work_revision:at.source.revision,
        p_expected_operate_revision:at.operate.revision});
    let result=await pricing("a_pm","save-service-estimate",{
      pricingInput,note:"Save exact race estimate"},basis);
    assert(!result.error,result.error?.message);
    basis=await connectedBasis("a",a);
    const estimate=basis.operate.state.requests.at(-1).serviceEstimate;
    result=await pricing("a_pm","submit-service-pricing",{
      estimateRevision:estimate.revision,note:"Submit race estimate"},basis);
    assert(!result.error,result.error?.message);
    basis=await connectedBasis("a",a);
    result=await pricing("a_ops","approve-service-pricing",{
      estimateRevision:estimate.revision,note:"Independent approval of race estimate"},basis);
    assert(!result.error,result.error?.message);
    const approval=(action,commandId)=>call("a_admin",
      "d5o_hosted_connected_service_approval_command_v1",{
        p_workspace_key:a.workspaceKey,p_parent_presentation_id:workId,
        p_request_id:request.id,p_action:action,p_command_id:commandId});
    const requested=await call("a_pm","d5o_hosted_connected_service_approval_command_v1",{
      p_workspace_key:a.workspaceKey,p_parent_presentation_id:workId,
      p_request_id:request.id,p_action:"request",p_command_id:randomUUID()});
    assert(!requested.error,requested.error?.message);
    assert.equal(requested.data.status,"pending");
    const approveId=randomUUID(),rejectId=randomUUID();
    const [approved,rejected]=await Promise.all([
      approval("approve",approveId),approval("reject",rejectId)]);
    const accepted=[approved,rejected].filter((item)=>!item.error);
    const denied=[approved,rejected].filter((item)=>item.error);
    assert.equal(accepted.length,1,JSON.stringify({approved,rejected}));
    assert.equal(denied.length,1);
    assert.equal(denied[0].error.code,"23514");
    const rows=JSON.parse(sql(`select pg_catalog.jsonb_build_object(
      'status',(select status from d5o_hosted.service_approval_requests
        where workspace_id=${q(a.workspaceId)} and service_request_id=${q(request.id)}),
      'terminalEvents',(select count(*) from d5o_hosted.service_approval_events e
        join d5o_hosted.service_approval_requests r on r.approval_id=e.approval_id
        where r.workspace_id=${q(a.workspaceId)} and r.service_request_id=${q(request.id)}
          and e.action in ('approve','reject')),
      'jobs',(select count(*) from d5o_hosted.connected_operate_states o,
        lateral pg_catalog.jsonb_array_elements(o.state->'jobs') j
        where o.workspace_id=${q(a.workspaceId)} and o.work_id=${q(basis.work.canonicalWorkId)}
          and j->>'requestId'=${q(request.id)}))::text;`));
    assert(["approved","rejected"].includes(rows.status));
    assert.equal(rows.terminalEvents,1);
    assert.equal(rows.jobs,0);
    tdCase("C03",{acceptedStatus:rows.status,deniedCode:denied[0].error.code,
      terminalEvents:rows.terminalEvents,jobs:rows.jobs,
      approvalId:requested.data.approvalId});
    return {requestId:request.id,acceptedStatus:rows.status,
      rejectedCode:denied[0].error.code,terminalEvents:rows.terminalEvents};
  });
  if(phase2htd && evidence.gateBJobs?.length===2) await check(
    "TD open approval tasks invalidate on amount and scope revision",async()=>{
    const race=evidence.tests.find((item)=>item.name===
      "TD pending threshold approval race leaves one terminal decision"&&item.status==="PASS");
    assert(race?.detail?.requestId,"approval_race_request_required");
    const requestId=race.detail.requestId,workId=evidence.gateBJobs[0].workId;
    const pricing=(actor,action,input,at)=>call(actor,
      "d5o_hosted_service_pricing_command_v1",{
        p_workspace_key:a.workspaceKey,p_parent_presentation_id:workId,
        p_request_id:requestId,p_action:action,p_input:input,
        p_command_id:randomUUID(),p_expected_work_revision:at.source.revision,
        p_expected_operate_revision:at.operate.revision});
    const updateEstimate=async(change)=>{
      let current=await connectedBasis("a",a);
      const old=current.operate.state.requests.find((item)=>item.id===requestId).serviceEstimate;
      const pricingInput=structuredClone(old.input);
      change(pricingInput);
      let result=await pricing("a_pm","save-service-estimate",{
        pricingInput,note:"Update exact synthetic approval basis"},current);
      assert(!result.error,result.error?.message);
      current=await connectedBasis("a",a);
      const next=current.operate.state.requests.find((item)=>item.id===requestId).serviceEstimate;
      result=await pricing("a_pm","submit-service-pricing",{
        estimateRevision:next.revision,note:"Submit revised synthetic estimate"},current);
      assert(!result.error,result.error?.message);
      current=await connectedBasis("a",a);
      result=await pricing("a_ops","approve-service-pricing",{
        estimateRevision:next.revision,note:"Independent revised estimate review"},current);
      assert(!result.error,result.error?.message);
      current=await connectedBasis("a",a);
      const approved=current.operate.state.requests.find((item)=>item.id===requestId).serviceEstimate;
      assert.equal(approved.status,"Approved");
      return {basis:current,estimate:approved};
    };
    const requestApproval=()=>call("a_pm","d5o_hosted_connected_service_approval_command_v1",{
      p_workspace_key:a.workspaceKey,p_parent_presentation_id:workId,
      p_request_id:requestId,p_action:"request",p_command_id:randomUUID()});
    const staleDecision=(page)=>page.evaluate(async({workspace,workId,requestId})=>{
      const response=await fetch("/api/d5o-hosted/service-approval",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({workspace,parentPresentationId:workId,requestId,
          action:"approve",commandId:crypto.randomUUID()})});
      return {status:response.status,body:await response.json()};
    },{workspace:a.workspaceKey,workId,requestId});
    const revisionOne=await updateEstimate((input)=>{input.lines[0].quantity="106";});
    let requested=await requestApproval();
    assert(!requested.error,requested.error?.message);
    const page=await openServiceTask("a_admin",a,workId,"decide-approval");
    const amountTaskUrl=page.url();
    const amountTaskId=lastServiceTask.get(`a_admin:${workId}`)?.id;
    const revisionTwo=await updateEstimate((input)=>{input.lines[0].quantity="107";});
    assert.notEqual(revisionTwo.estimate.evaluation.proposedPriceMinor,
      revisionOne.estimate.evaluation.proposedPriceMinor);
    const amountDenied=await staleDecision(page);
    assert.equal(amountDenied.status,409,JSON.stringify(amountDenied));
    const oldAmount=sql(`select status from d5o_hosted.service_approval_requests
      where workspace_id=${q(a.workspaceId)} and service_request_id=${q(requestId)}
        and estimate_revision=${revisionOne.estimate.revision};`);
    assert.equal(oldAmount,"pending");
    const queue=await page.evaluate(async(workspace)=>{
      const response=await fetch(`/api/d5o-hosted/customer-work?workspace=${workspace}`);
      return {status:response.status,body:await response.json()};
    },a.workspaceKey);
    assert.equal(queue.status,200);
    assert(!(queue.body.tasks??[]).some((item)=>item.id===amountTaskId));
    tdCase("B02",{oldAmount:revisionOne.estimate.evaluation.proposedPriceMinor,
      newAmount:revisionTwo.estimate.evaluation.proposedPriceMinor,
      staleApprovalHttp:amountDenied.status,oldDecisionRetained:oldAmount});
    tdCase("D06",{taskId:amountTaskId,taskRemoved:true,
      staleApprovalHttp:amountDenied.status,oldTaskUrl:amountTaskUrl});
    requested=await requestApproval();
    assert(!requested.error,requested.error?.message);
    await openServiceTask("a_admin",a,workId,"decide-approval");
    const scopeTaskId=lastServiceTask.get(`a_admin:${workId}`)?.id;
    const scopeBefore=revisionTwo.estimate.evaluation.proposedPriceMinor;
    const revisionThree=await updateEstimate((input)=>{
      input.lines[0].description="Revised synthetic scope with identical quantity";
    });
    assert.equal(revisionThree.estimate.evaluation.proposedPriceMinor,scopeBefore);
    const scopeDenied=await staleDecision(page);
    assert.equal(scopeDenied.status,409,JSON.stringify(scopeDenied));
    const scopeQueue=await page.evaluate(async(workspace)=>{
      const response=await fetch(`/api/d5o-hosted/customer-work?workspace=${workspace}`);
      return {status:response.status,body:await response.json()};
    },a.workspaceKey);
    assert.equal(scopeQueue.status,200);
    assert(!(scopeQueue.body.tasks??[]).some((item)=>item.id===scopeTaskId));
    tdCase("B03",{amountUnchanged:scopeBefore,
      oldScopeRevision:revisionTwo.estimate.revision,
      newScopeRevision:revisionThree.estimate.revision,
      staleApprovalHttp:scopeDenied.status});
    tdCase("D07",{taskId:scopeTaskId,taskRemoved:true,
      staleApprovalHttp:scopeDenied.status});
    requested=await requestApproval();
    assert(!requested.error,requested.error?.message);
    await openServiceTask("a_admin",a,workId,"decide-approval");
    const currentTaskId=lastServiceTask.get(`a_admin:${workId}`)?.id;
    const otherPage=await designBrowser.newPage({viewport:{width:1440,height:900}});
    await otherPage.goto(`http://127.0.0.1:${server.port}/auth/sign-in`);
    await otherPage.getByLabel("Email").fill(users.a_admin.email);
    await otherPage.getByLabel("Password").fill(users.a_admin.password);
    await otherPage.getByRole("button",{name:"Continue to your work"}).click();
    await otherPage.waitForURL((location)=>!location.pathname.startsWith("/auth/sign-in"));
    const approvedOther=await staleDecision(otherPage);
    assert.equal(approvedOther.status,200,JSON.stringify(approvedOther));
    const duplicate=await staleDecision(page);
    assert.equal(duplicate.status,409,JSON.stringify(duplicate));
    await assertServiceTaskResolved("a_admin",a,workId);
    tdCase("D08",{otherSessionHttp:approvedOther.status,
      originalSessionStaleHttp:duplicate.status,taskId:currentTaskId,
      taskRemoved:true});
    await otherPage.close();
    const historic=JSON.parse(sql(`select pg_catalog.jsonb_build_object(
      'rows',count(*),'events',(select count(*) from d5o_hosted.service_approval_events
        where workspace_id=${q(a.workspaceId)} and work_id=${q(revisionThree.basis.work.canonicalWorkId)}
          and approval_id in (select approval_id from d5o_hosted.service_approval_requests
            where workspace_id=${q(a.workspaceId)} and service_request_id=${q(requestId)})))::text
      from d5o_hosted.service_approval_requests
      where workspace_id=${q(a.workspaceId)} and service_request_id=${q(requestId)};`));
    assert(historic.rows>=4 && historic.events>=4);
    assert.equal(revisionThree.basis.work.phaseConfigurationVersionId,
      evidence.gateBJobs[0].configurationVersionId);
    tdCase("B06",{approvalRows:historic.rows,approvalEvents:historic.events,
      configurationVersionId:revisionThree.basis.work.phaseConfigurationVersionId});
    return {amountDenied:amountDenied.status,scopeDenied:scopeDenied.status,
      otherSessionApproved:approvedOther.status,duplicate:duplicate.status,
      historicalApprovalRows:historic.rows};
  });
  if(phase2htd && evidence.gateBJobs?.length===2) await check(
    "TD approval and customer evidence cannot cross child or parent Work",async()=>{
    const race=evidence.tests.find((item)=>item.name===
      "TD pending threshold approval race leaves one terminal decision"&&item.status==="PASS");
    const stale=evidence.tests.find((item)=>item.name===
      "TD open approval tasks invalidate on amount and scope revision"&&item.status==="PASS");
    assert(race?.detail?.requestId && stale,"approved additional request required");
    const primaryWorkId=evidence.gateBJobs[0].workId;
    let basis=await connectedBasis("a",a);
    const raceRequest=basis.operate.state.requests.find((item)=>item.id===race.detail.requestId);
    assert.equal(raceRequest.serviceEstimate.status,"Approved");
    const raceApproval=sql(`select status from d5o_hosted.service_approval_requests
      where workspace_id=${q(a.workspaceId)} and service_request_id=${q(raceRequest.id)}
        and estimate_revision=${raceRequest.serviceEstimate.revision};`);
    assert.equal(raceApproval,"approved");
    const catalog=await call("a_admin","d5o_hosted_prototype_read_v1",{
      p_workspace_key:a.workspaceKey,p_state_key:"catalog"});
    assert(!catalog.error,catalog.error?.message);
    const activeVersion=evidence.tests.find((item)=>item.name===
      "new published tenant policy does not repin completed connected Work"&&item.status==="PASS")
      ?.detail?.newActiveVersion;
    assert(activeVersion,"active_configuration_version_required");
    const second=await admin.rpc("d5o_hosted_create_connected_work_v1",{
      p_workspace_key:a.workspaceKey,p_command_id:`td-second-work-${randomUUID()}`,
      p_expected_work_revision:basis.source.revision,
      p_expected_catalog_revision:catalog.data.revision,
      p_configuration_version_id:activeVersion,p_work_type_key:"lifecycle-service",
      p_title:"Synthetic second parent Work",p_customer:"Fictional Customer",
      p_site:"Test location",p_owner:"Test owner",p_actor_user_id:users.a_pm.id,
      p_membership_id:sql(`select id from d5o_hosted.memberships
        where workspace_id=${q(a.workspaceId)} and actor_user_id=${q(users.a_pm.id)};`),
      p_initial_discovery:{source:"Test",need:"Need service",procurement:"Direct",closeDate:""}});
    assert(!second.error,second.error?.message);
    const secondWorkId=sql(`select presentation_id from d5o_hosted.work_identity_links
      where workspace_id=${q(a.workspaceId)} and work_id=${q(second.data.workId)};`);
    assert(secondWorkId);
    const wrongParent=await call("a_admin","d5o_hosted_connected_service_approval_command_v1",{
      p_workspace_key:a.workspaceKey,p_parent_presentation_id:secondWorkId,
      p_request_id:raceRequest.id,p_action:"approve",p_command_id:randomUUID()});
    assert.equal(wrongParent.error?.code,"23514",JSON.stringify(wrongParent));
    tdCase("B05",{wrongParentRpc:wrongParent.error.code,
      originalWorkId:primaryWorkId,otherWorkId:secondWorkId});
    basis=await connectedBasis("a",a);
    const asset=basis.operate.state.assets[0];
    const opened=await operateCommand("a",a,"a_pm","open-request",{
      assetId:asset.id,title:"Synthetic other child approval probe",
      description:"Fictional monitored equipment requires inspected service repair",
      contact:"Fictional customer representative",impact:"Standard",
      note:"Open other child approval isolation fixture"},`td-other-child-${randomUUID()}`);
    assert(!opened.error,opened.error?.message);
    basis=await connectedBasis("a",a);
    const child=basis.operate.state.requests.at(-1);
    const triaged=await operateCommand("a",a,"a_ops2","triage-request",{
      requestId:child.id,serviceCategory:"Monitoring fault"},
      `td-other-child-triage-${randomUUID()}`);
    assert(!triaged.error,triaged.error?.message);
    basis=await connectedBasis("a",a);
    const pricingInput=structuredClone(raceRequest.serviceEstimate.input);
    pricingInput.lines[0].scopeRef=child.id;
    const pricing=(actor,action,input,requestId,at)=>call(actor,
      "d5o_hosted_service_pricing_command_v1",{
        p_workspace_key:a.workspaceKey,p_parent_presentation_id:primaryWorkId,
        p_request_id:requestId,p_action:action,p_input:input,
        p_command_id:randomUUID(),p_expected_work_revision:at.source.revision,
        p_expected_operate_revision:at.operate.revision});
    let result=await pricing("a_pm","save-service-estimate",{
      pricingInput,note:"Save other child exact estimate"},child.id,basis);
    assert(!result.error,result.error?.message);
    basis=await connectedBasis("a",a);
    const estimate=basis.operate.state.requests.find((item)=>item.id===child.id).serviceEstimate;
    result=await pricing("a_pm","submit-service-pricing",{
      estimateRevision:estimate.revision,note:"Submit other child estimate"},child.id,basis);
    assert(!result.error,result.error?.message);
    basis=await connectedBasis("a",a);
    result=await pricing("a_ops","approve-service-pricing",{
      estimateRevision:estimate.revision,note:"Independent other child estimate review"},child.id,basis);
    assert(!result.error,result.error?.message);
    basis=await connectedBasis("a",a);
    const authInput=(evidenceId,revision)=>({estimateRevision:revision,evidenceId,
      customerParty:"Fictional authorized customer",
      customerOrganization:"Fictional customer organization",
      customerRole:"Authorized buyer",authorityBasis:"Signed service order authority",
      outcome:"Authorized",note:"Reviewed exact synthetic customer decision source"});
    const wrongChild=await pricing("a_ops","record-service-authorization",
      authInput(evidence.gateBJobs[0].customerEvidenceId,estimate.revision),child.id,basis);
    assert.equal(wrongChild.error?.code,"23514",JSON.stringify(wrongChild));
    assert.equal(Number(sql(`select count(*) from d5o_hosted.service_approval_requests
      where workspace_id=${q(a.workspaceId)} and service_request_id=${q(child.id)};`)),0);
    tdCase("B04",{wrongChildRpc:wrongChild.error.code,
      approvedChild:raceRequest.id,unapprovedChild:child.id,
      approvalRowsForUnapprovedChild:0});
    const requestedChild=await call("a_pm","d5o_hosted_connected_service_approval_command_v1",{
      p_workspace_key:a.workspaceKey,p_parent_presentation_id:primaryWorkId,
      p_request_id:child.id,p_action:"request",p_command_id:randomUUID()});
    assert(!requestedChild.error,requestedChild.error?.message);
    const rejectedChild=await call("a_admin","d5o_hosted_connected_service_approval_command_v1",{
      p_workspace_key:a.workspaceKey,p_parent_presentation_id:primaryWorkId,
      p_request_id:child.id,p_action:"reject",p_command_id:randomUUID()});
    assert(!rejectedChild.error,rejectedChild.error?.message);
    const rejectedAuthorization=await pricing("a_ops","record-service-authorization",
      authInput(evidence.gateBJobs[0].customerEvidenceId,estimate.revision),child.id,basis);
    assert.equal(rejectedAuthorization.error?.code,"23514",JSON.stringify(rejectedAuthorization));
    assert.equal(sql(`select status from d5o_hosted.service_approval_requests
      where workspace_id=${q(a.workspaceId)} and service_request_id=${q(child.id)};`),"rejected");
    tdCase("B15",{rejectedApprovalId:requestedChild.data.approvalId,
      authorizationRpc:rejectedAuthorization.error.code,rejectedHistoryRetained:true});
    const foreignEvidenceId=randomUUID();
    const foreignPdf=Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF");
    const foreignPath=`${a.workspaceKey}/${createHash("sha256").update(secondWorkId).digest("hex")}/customer-decisions/${foreignEvidenceId}`;
    const uploaded=await admin.storage.from("d5o-deploy-evidence").upload(
      foreignPath,foreignPdf,{contentType:"application/pdf",upsert:false});
    assert(!uploaded.error,uploaded.error?.message);
    const estimateBasis=raceRequest.serviceEstimate;
    const registered=await admin.rpc("d5o_hosted_register_customer_decision_evidence_v1",{
      p_workspace_key:a.workspaceKey,p_presentation_id:secondWorkId,
      p_evidence_id:foreignEvidenceId,p_purpose:"service-authorization",
      p_scope_id:raceRequest.id,p_scope_revision:estimateBasis.revision,
      p_basis:{estimateRevision:estimateBasis.revision,
        amountMinor:estimateBasis.evaluation.proposedPriceMinor,
        currency:estimateBasis.evaluation.currency,
        requestCycleAt:raceRequest.reopenedAt??raceRequest.reportedAt},
      p_checksum_sha256:createHash("sha256").update(foreignPdf).digest("hex"),
      p_filename:"synthetic-other-work.pdf",p_uploader_id:users.a_ops.id});
    assert(!registered.error,registered.error?.message);
    basis=await connectedBasis("a",a);
    const wrongWorkEvidence=await pricing("a_ops","record-service-authorization",
      authInput(foreignEvidenceId,estimateBasis.revision),raceRequest.id,basis);
    assert.equal(wrongWorkEvidence.error?.code,"23514",JSON.stringify(wrongWorkEvidence));
    const final=await connectedBasis("a",a);
    assert.equal(final.operate.revision,basis.operate.revision);
    assert.equal(final.operate.state.jobs.filter((item)=>item.requestId===raceRequest.id).length,0);
    tdCase("B10",{otherWorkEvidenceRpc:wrongWorkEvidence.error.code,
      evidenceId:foreignEvidenceId,otherWorkId:secondWorkId,
      targetWorkId:primaryWorkId,unchangedOperateRevision:final.operate.revision});
    return {wrongParent:wrongParent.error.code,wrongChild:wrongChild.error.code,
      otherWorkEvidence:wrongWorkEvidence.error.code,
      originalApprovalRetained:true};
  });
  if(phase2htd && evidence.gateBJobs?.length===2) await check(
    "TD revoking the exact approver invalidates new authorization without deleting history",async()=>{
    const race=evidence.tests.find((item)=>item.name===
      "TD pending threshold approval race leaves one terminal decision"&&item.status==="PASS");
    const requestId=race?.detail?.requestId;
    assert(requestId,"approved_child_request_required");
    const basis=await connectedBasis("a",a);
    const request=basis.operate.state.requests.find((item)=>item.id===requestId);
    assert.equal(request.serviceEstimate.status,"Approved");
    const approval=JSON.parse(sql(`select pg_catalog.jsonb_build_object(
      'status',status,'decidedBy',decided_by,'id',approval_id)::text
      from d5o_hosted.service_approval_requests
      where workspace_id=${q(a.workspaceId)} and service_request_id=${q(requestId)}
        and estimate_revision=${request.serviceEstimate.revision};`));
    assert.equal(approval.status,"approved");
    assert.equal(approval.decidedBy,users.a_admin.id);
    // The customer admin command deliberately forbids suspending the sole
    // initial administrator. Model that external revocation as a disposable
    // membership-state fixture; the business attempt remains a real RPC.
    sql(`update d5o_hosted.memberships set status='suspended',revision=revision+1
      where workspace_id=${q(a.workspaceId)} and actor_user_id=${q(users.a_admin.id)};`);
    let denied;
    try {
      denied=await call("a_ops","d5o_hosted_service_pricing_command_v1",{
        p_workspace_key:a.workspaceKey,p_parent_presentation_id:basis.work.id,
        p_request_id:requestId,p_action:"record-service-authorization",
        p_input:{estimateRevision:request.serviceEstimate.revision,
          evidenceId:evidence.gateBJobs[0].customerEvidenceId,
          customerParty:"Fictional authorized customer",
          customerOrganization:"Fictional customer organization",
          customerRole:"Authorized buyer",authorityBasis:"Signed service order authority",
          outcome:"Authorized",note:"Revoked approver denial probe"},
        p_command_id:randomUUID(),p_expected_work_revision:basis.source.revision,
        p_expected_operate_revision:basis.operate.revision});
      assert.equal(denied.error?.code,"23514",JSON.stringify(denied));
      const during=JSON.parse(sql(`select pg_catalog.jsonb_build_object(
        'revision',decision_revision,
        'jobs',pg_catalog.jsonb_array_length(state->'jobs'))::text
        from d5o_hosted.connected_operate_states
        where workspace_id=${q(a.workspaceId)} and work_id=${q(basis.work.canonicalWorkId)};`));
      assert.equal(during.revision,basis.operate.revision);
      assert.equal(during.jobs,basis.operate.state.jobs.length);
    } finally {
      sql(`update d5o_hosted.memberships set status='active',revision=revision+1
        where workspace_id=${q(a.workspaceId)} and actor_user_id=${q(users.a_admin.id)};`);
    }
    const preserved=sql(`select status from d5o_hosted.service_approval_requests
      where approval_id=${q(approval.id)};`);
    assert.equal(preserved,"approved");
    tdCase("B14",{approvalId:approval.id,approverSuspendedFixture:true,
      authorizationRpc:denied.error.code,approvedHistoryRetained:true,
      unchangedOperateRevision:basis.operate.revision});
    return {authorizationRpc:denied.error.code,approvalId:approval.id,
      approvedHistoryRetained:true};
  });
  if(phase2htd && evidence.gateBJobs?.length===2) await check(
    "TD pending pricing decisions and command receipts serialize",async()=>{
    const workId=evidence.gateBJobs[1].workId;
    const beforeOpen=await connectedBasis("b",b);
    const asset=beforeOpen.operate.state.assets[0];
    const opened=await operateCommand("b",b,"b_pm","open-request",{
      assetId:asset.id,title:"Synthetic concurrent pricing request",
      description:"Fictional monitored equipment requires inspected service repair",
      contact:"Fictional customer representative",impact:"Standard",
      note:"Open a pending pricing concurrency fixture"},`td-concurrent-${randomUUID()}`);
    assert(!opened.error,opened.error?.message);
    const afterOpen=await connectedBasis("b",b);
    const request=afterOpen.operate.state.requests.at(-1);
    assert(request?.id && request.id!==beforeOpen.operate.state.requests.at(-1)?.id);
    const triaged=await operateCommand("b",b,"b_ops2","triage-request",{
      requestId:request.id,serviceCategory:"Monitoring fault"},
      `td-concurrent-triage-${randomUUID()}`);
    assert(!triaged.error,triaged.error?.message);
    let basis=await connectedBasis("b",b);
    const original=basis.operate.state.requests.find((item)=>item.id===evidence.gateBJobs[1].requestId);
    assert(original?.serviceEstimate?.input?.lines?.length===1);
    const pricingInput=structuredClone(original.serviceEstimate.input);
    pricingInput.lines[0].scopeRef=request.id;
    const pricing=(actor,action,input,commandId,at=basis)=>call(actor,
      "d5o_hosted_service_pricing_command_v1",{
        p_workspace_key:b.workspaceKey,p_parent_presentation_id:workId,
        p_request_id:request.id,p_action:action,p_input:input,
        p_command_id:commandId,p_expected_work_revision:at.source.revision,
        p_expected_operate_revision:at.operate.revision});
    const wrongCurrency=await pricing("b_pm","save-service-estimate",{
      pricingInput:{...pricingInput,currency:"EUR"},note:"Wrong currency denied"},randomUUID());
    assert.equal(wrongCurrency.error?.code,"23514",JSON.stringify(wrongCurrency));
    assert.equal((await connectedBasis("b",b)).operate.revision,basis.operate.revision);
    tdCase("B01",{rpc:wrongCurrency.error.code,unchangedOperateRevision:basis.operate.revision});
    const sameId=randomUUID();
    const saveInput={pricingInput,note:"Concurrent identical estimate save"};
    const [saveOne,saveTwo]=await Promise.all([
      pricing("b_pm","save-service-estimate",saveInput,sameId),
      pricing("b_pm","save-service-estimate",saveInput,sameId)]);
    assert(!saveOne.error,JSON.stringify(saveOne));
    assert(!saveTwo.error,JSON.stringify(saveTwo));
    assert.deepEqual(saveOne.data,saveTwo.data);
    const saved=await connectedBasis("b",b);
    assert.equal(saved.operate.revision,basis.operate.revision+1);
    const conflicting=await pricing("b_pm","save-service-estimate",{
      pricingInput:{...pricingInput,riskBasis:"Different assumption for same command ID"},
      note:"Conflicting idempotency payload"},sameId,basis);
    assert.equal(conflicting.error?.code,"23505",JSON.stringify(conflicting));
    assert.equal((await connectedBasis("b",b)).operate.revision,saved.operate.revision);
    tdCase("C06",{sameCommandId:sameId,identicalReceipts:true,revision:saved.operate.revision});
    tdCase("C07",{sameCommandId:sameId,conflict:conflicting.error.code,
      unchangedRevision:saved.operate.revision});
    basis=saved;
    const estimate=basis.operate.state.requests.find((item)=>item.id===request.id).serviceEstimate;
    const submitted=await pricing("b_pm","submit-service-pricing",{
      estimateRevision:estimate.revision,note:"Submit pending concurrency review"},randomUUID());
    assert(!submitted.error,submitted.error?.message);
    basis=await connectedBasis("b",b);
    const pending=basis.operate.state.requests.find((item)=>item.id===request.id).serviceEstimate;
    assert.equal(pending.status,"Pricing review");
    const [approve,returnDecision]=await Promise.all([
      pricing("b_ops","approve-service-pricing",{
        estimateRevision:pending.revision,note:"Independent approval of concurrent estimate"},randomUUID(),basis),
      pricing("b_ops2","return-service-pricing",{
        estimateRevision:pending.revision,note:"Independent return of concurrent estimate"},randomUUID(),basis)]);
    const successes=[approve,returnDecision].filter((item)=>!item.error);
    const rejected=[approve,returnDecision].filter((item)=>item.error);
    assert.equal(successes.length,1,JSON.stringify({approve,returnDecision}));
    assert.equal(rejected.length,1);
    assert.equal(rejected[0].error.code,"23505",JSON.stringify(rejected[0]));
    const final=await connectedBasis("b",b);
    assert.equal(final.operate.revision,basis.operate.revision+1);
    const finalRequest=final.operate.state.requests.find((item)=>item.id===request.id);
    assert(["Approved","Returned"].includes(finalRequest.serviceEstimate.status));
    const finalDecisions=finalRequest.history.filter((item)=>
      ["approve-service-pricing","return-service-pricing"].includes(item.action));
    assert.equal(finalDecisions.length,1);
    const receiptCount=Number(sql(`select count(*) from d5o_hosted.connected_operate_receipts
      where workspace_id=${q(b.workspaceId)} and work_id=${q(final.work.canonicalWorkId)}
      and command_id=${q(sameId)};`));
    assert.equal(receiptCount,1);
    tdCase("C01",{accepted:finalRequest.serviceEstimate.status,
      rejectedCode:rejected[0].error.code,decisionEvents:finalDecisions.length,
      finalOperateRevision:final.operate.revision});
    return {wrongCurrency:wrongCurrency.error.code,identicalReplay:true,
      conflictingReuse:conflicting.error.code,acceptedDecision:finalRequest.serviceEstimate.status,
      rejectedDecision:rejected[0].error.code,receiptCount};
  });
  if(phase2htd && evidence.gateBJobs?.length===2) await check(
    "TD pending customer evidence is exact, retained and independently accepted",async()=>{
    const workId=evidence.gateBJobs[1].workId;
    const prior=await connectedBasis("b",b);
    const asset=prior.operate.state.assets[0];
    const opened=await operateCommand("b",b,"b_pm","open-request",{
      assetId:asset.id,title:"Synthetic evidence integrity incident",
      description:"Fictional monitored equipment requires inspected service repair",
      contact:"Fictional customer representative",impact:"Standard",
      note:"Open pending evidence integrity fixture"},`td-evidence-${randomUUID()}`);
    assert(!opened.error,opened.error?.message);
    let basis=await connectedBasis("b",b);
    const request=basis.operate.state.requests.at(-1);
    const triaged=await operateCommand("b",b,"b_ops2","triage-request",{
      requestId:request.id,serviceCategory:"Monitoring fault"},
      `td-evidence-triage-${randomUUID()}`);
    assert(!triaged.error,triaged.error?.message);
    basis=await connectedBasis("b",b);
    const original=basis.operate.state.requests.find((item)=>item.id===evidence.gateBJobs[1].requestId);
    const pricingInput=structuredClone(original.serviceEstimate.input);
    pricingInput.lines[0].scopeRef=request.id;
    const pricing=(actor,action,input,at)=>call(actor,
      "d5o_hosted_service_pricing_command_v1",{
        p_workspace_key:b.workspaceKey,p_parent_presentation_id:workId,
        p_request_id:request.id,p_action:action,p_input:input,
        p_command_id:randomUUID(),p_expected_work_revision:at.source.revision,
        p_expected_operate_revision:at.operate.revision});
    let result=await pricing("b_pm","save-service-estimate",{
      pricingInput,note:"Save exact evidence estimate"},basis);
    assert(!result.error,result.error?.message);
    basis=await connectedBasis("b",b);
    const estimate=basis.operate.state.requests.at(-1).serviceEstimate;
    result=await pricing("b_pm","submit-service-pricing",{
      estimateRevision:estimate.revision,note:"Submit evidence estimate"},basis);
    assert(!result.error,result.error?.message);
    basis=await connectedBasis("b",b);
    result=await pricing("b_ops2","approve-service-pricing",{
      estimateRevision:estimate.revision,note:"Independent approval of evidence estimate"},basis);
    assert(!result.error,result.error?.message);
    basis=await connectedBasis("b",b);
    const stableRevision=basis.operate.revision;
    const authInput=(evidenceId)=>({estimateRevision:estimate.revision,
      evidenceId,customerParty:"Fictional authorized customer",
      customerOrganization:"Fictional customer organization",
      customerRole:"Authorized buyer",authorityBasis:"Signed service order authority",
      outcome:"Authorized",note:"Reviewed exact synthetic customer decision source"});
    const authorize=(evidenceId)=>pricing("b_ops2","record-service-authorization",
      authInput(evidenceId),basis);
    const absent=await authorize(null);
    assert.equal(absent.error?.code,"23514",JSON.stringify(absent));
    const wrongChild=await authorize(evidence.gateBJobs[1].customerEvidenceId);
    assert.equal(wrongChild.error?.code,"23514",JSON.stringify(wrongChild));
    const foreign=await authorize(evidence.gateBJobs[0].customerEvidenceId);
    assert.equal(foreign.error?.code,"23514",JSON.stringify(foreign));
    const forged=await authorize(randomUUID());
    assert.equal(forged.error?.code,"23514",JSON.stringify(forged));
    assert.equal((await connectedBasis("b",b)).operate.revision,stableRevision);
    for(const id of ["B08","B09","B11","B12"]) tdCase(id,{
      rpc:"23514",requestId:request.id,unchangedOperateRevision:stableRevision});
    const page=await designPage("b_ops2",b,workId);
    const uploaded=await page.evaluate(async({workspace,workId,requestId})=>{
      const form=new FormData();
      form.append("workId",workId);form.append("purpose","service-authorization");
      form.append("scopeId",requestId);
      form.append("file",new File(["%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF"],
        "synthetic-unaccepted-service.pdf",{type:"application/pdf"}));
      const response=await fetch(`/api/d5o-hosted/customer-decision-evidence?workspace=${workspace}`,
        {method:"POST",body:form});
      return {status:response.status,body:await response.json()};
    },{workspace:b.workspaceKey,workId,requestId:request.id});
    assert.equal(uploaded.status,200,JSON.stringify(uploaded));
    assert(uploaded.body.evidenceId);
    const stillPending=await connectedBasis("b",b);
    assert(!stillPending.operate.state.requests.find((item)=>item.id===request.id)
      .serviceAuthorization);
    const pmPage=await designPage("b_pm",b,workId);
    const prematureJob=await pmPage.evaluate(async({workspace,workId,requestId,sourceRevision,
      operateRevision,deployRevision})=>{
      const response=await fetch(`/api/d5o-hosted/prototype-operate-command?workspace=${workspace}`,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({action:"create-job",workId,requestId,
          dueDate:new Date().toISOString().slice(0,10),expectedRevision:sourceRevision,
          expectedDecisionRevision:operateRevision,expectedDeployRevision:deployRevision,
          commandId:crypto.randomUUID()})});
      return {status:response.status,body:await response.json()};
    },{workspace:b.workspaceKey,workId,requestId:request.id,
      sourceRevision:basis.source.revision,operateRevision:stableRevision,
      deployRevision:basis.deploy.revision});
    assert.equal(prematureJob.status,409,JSON.stringify(prematureJob));
    tdCase("B13",{pdfRetained:true,authorizationAbsent:true,
      prematureJobHttp:prematureJob.status});
    const path=sql(`select object_path from d5o_hosted.customer_decision_evidence
      where id=${q(uploaded.body.evidenceId)} and workspace_id=${q(b.workspaceId)};`);
    assert(path);
    const deleted=await admin.storage.from("d5o-deploy-evidence").remove([path]);
    assert(!deleted.error,deleted.error?.message);
    const deletedDecision=await authorize(uploaded.body.evidenceId);
    assert.equal(deletedDecision.error?.code,"23514",JSON.stringify(deletedDecision));
    const final=await connectedBasis("b",b);
    assert.equal(final.operate.revision,stableRevision);
    assert.equal(final.operate.state.jobs.length,basis.operate.state.jobs.length);
    tdCase("B07",{deletedEvidenceId:uploaded.body.evidenceId,
      rpc:deletedDecision.error.code,unchangedOperateRevision:stableRevision});
    const validUpload=await page.evaluate(async({workspace,workId,requestId})=>{
      const form=new FormData();
      form.append("workId",workId);form.append("purpose","service-authorization");
      form.append("scopeId",requestId);
      form.append("file",new File(["%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF"],
        "synthetic-accepted-service.pdf",{type:"application/pdf"}));
      const response=await fetch(`/api/d5o-hosted/customer-decision-evidence?workspace=${workspace}`,
        {method:"POST",body:form});
      return {status:response.status,body:await response.json()};
    },{workspace:b.workspaceKey,workId,requestId:request.id});
    assert.equal(validUpload.status,200,JSON.stringify(validUpload));
    const [authorizationOne,authorizationTwo]=await Promise.all([
      pricing("b_ops","record-service-authorization",authInput(validUpload.body.evidenceId),basis),
      pricing("b_ops2","record-service-authorization",authInput(validUpload.body.evidenceId),basis)]);
    const accepted=[authorizationOne,authorizationTwo].filter((item)=>!item.error);
    const denied=[authorizationOne,authorizationTwo].filter((item)=>item.error);
    assert.equal(accepted.length,1,JSON.stringify({authorizationOne,authorizationTwo}));
    assert.equal(denied.length,1);
    assert(["23505","23514"].includes(denied[0].error.code));
    const authorized=await connectedBasis("b",b);
    const exact=authorized.operate.state.requests.find((item)=>item.id===request.id);
    assert.equal(exact.serviceAuthorization?.estimateRevision,estimate.revision);
    assert.equal(exact.history.filter((item)=>item.action==="record-service-authorization").length,1);
    tdCase("C02",{accepted:1,denied:denied[0].error.code,
      authorizationEvents:1,operateRevision:authorized.operate.revision});
    tdCase("C04",{accepted:1,denied:denied[0].error.code,
      authorizationEvents:1,requestId:request.id});
    const catalog=await call("b_admin","d5o_hosted_prototype_read_v1",{
      p_workspace_key:b.workspaceKey,p_state_key:"catalog"});
    assert(!catalog.error,catalog.error?.message);
    const job=(commandId)=>call("b_pm","d5o_hosted_service_job_command_v1",{
      p_workspace_key:b.workspaceKey,p_parent_presentation_id:workId,
      p_request_id:request.id,p_due_date:executionDate,p_owner:"Fictional service owner",
      p_command_id:commandId,p_expected_work_revision:authorized.source.revision,
      p_expected_catalog_revision:catalog.data.revision,
      p_expected_operate_revision:authorized.operate.revision});
    const [jobOne,jobTwo]=await Promise.all([job(randomUUID()),job(randomUUID())]);
    const created=[jobOne,jobTwo].filter((item)=>!item.error);
    const refused=[jobOne,jobTwo].filter((item)=>item.error);
    assert.equal(created.length,1,JSON.stringify({jobOne,jobTwo}));
    assert.equal(refused.length,1);
    assert(["23505","23514"].includes(refused[0].error.code));
    const afterJobs=await connectedBasis("b",b);
    const executable=afterJobs.operate.state.jobs.filter((item)=>item.requestId===request.id
      && item.status!=="Cancelled");
    assert.equal(executable.length,1);
    tdCase("C05",{accepted:1,denied:refused[0].error.code,
      requestId:request.id,jobId:executable[0].id,executableJobs:1});
    return {requestId:request.id,missing:absent.error.code,
      wrongChild:wrongChild.error.code,foreign:foreign.error.code,
      forged:forged.error.code,deleted:deletedDecision.error.code,
      prematureJob:prematureJob.status,unchangedOperateRevision:stableRevision,
      authorizationRace:[accepted.length,denied[0].error.code],
      concurrentJob:[created.length,refused[0].error.code]};
  });
  if(phase2htd && evidence.gateBJobs?.length===2) await check(
    "TD bidirectional service authorization adapters deny foreign tenants",async()=>{
    const [aJob,bJob]=evidence.gateBJobs;
    const aPage=await designPage("a_ops",a,aJob.workId);
    const bPage=await designPage("b_ops",b,bJob.workId);
    const beforeA=await connectedBasis("a",a),beforeB=await connectedBasis("b",b);
    const probe=(page,workspace,command)=>page.evaluate(async({workspace,command})=>{
      const response=await fetch(`/api/d5o-hosted/prototype-operate-command?workspace=${workspace}`,{
        method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(command)});
      return {status:response.status,body:await response.json()};
    },{workspace,command:{...command,commandId:randomUUID()}});
    const [aToB,bToA]=await Promise.all([
      probe(aPage,b.workspaceKey,bJob.authorizationCommand),
      probe(bPage,a.workspaceKey,aJob.authorizationCommand)]);
    assert.equal(aToB.status,403,JSON.stringify(aToB));
    assert.equal(bToA.status,403,JSON.stringify(bToA));
    const scoped=[];
    for(const [actor,page,foreign,job,foreignBasis] of [
      ["a_ops",aPage,b,bJob,beforeB],["b_ops",bPage,a,aJob,beforeA]]) {
      const api=await page.evaluate(async({workspace,workId,requestId,evidenceId,jobCommand})=>{
        const send=async(path,body)=>{
          const response=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},
            body:JSON.stringify(body)});
          return response.status;
        };
        const approval=await send("/api/d5o-hosted/service-approval",{
          workspace,parentPresentationId:workId,requestId,action:"approve",
          commandId:crypto.randomUUID()});
        const pricing=await send(`/api/d5o-hosted/prototype-operate-command?workspace=${workspace}`,{
          action:"approve-service-pricing",workId,requestId,estimateRevision:1,
          note:"Foreign tenant pricing denial probe",expectedRevision:1,
          expectedDecisionRevision:1,expectedDeployRevision:1,
          commandId:crypto.randomUUID()});
        const job=await send(`/api/d5o-hosted/prototype-operate-command?workspace=${workspace}`,{
          ...jobCommand,commandId:crypto.randomUUID()});
        const evidence=await fetch(`/api/d5o-hosted/customer-decision-evidence?workspace=${workspace}`+
          `&workId=${encodeURIComponent(workId)}&evidenceId=${evidenceId}`);
        return {approval,pricing,job,evidence:evidence.status};
      },{workspace:foreign.workspaceKey,workId:job.workId,requestId:job.requestId,
        evidenceId:job.customerEvidenceId,jobCommand:job.jobCommand});
      for(const code of Object.values(api)) assert.equal(code,403,JSON.stringify(api));
      const approvalRpc=await call(actor,"d5o_hosted_connected_service_approval_command_v1",{
        p_workspace_key:foreign.workspaceKey,p_parent_presentation_id:job.workId,
        p_request_id:job.requestId,p_action:"approve",p_command_id:randomUUID()});
      const pricingRpc=await call(actor,"d5o_hosted_service_pricing_command_v1",{
        p_workspace_key:foreign.workspaceKey,p_parent_presentation_id:job.workId,
        p_request_id:job.requestId,p_action:"approve-service-pricing",
        p_input:{estimateRevision:1,note:"Foreign pricing denial probe"},
        p_command_id:randomUUID(),p_expected_work_revision:foreignBasis.source.revision,
        p_expected_operate_revision:foreignBasis.operate.revision});
      const jobRpc=await call(actor,"d5o_hosted_service_job_command_v1",{
        p_workspace_key:foreign.workspaceKey,p_parent_presentation_id:job.workId,
        p_request_id:job.requestId,p_due_date:executionDate,p_owner:"Foreign test owner",
        p_command_id:randomUUID(),p_expected_work_revision:foreignBasis.source.revision,
        p_expected_catalog_revision:1,
        p_expected_operate_revision:foreignBasis.operate.revision});
      for(const result of [approvalRpc,pricingRpc,jobRpc])
        assert.equal(result.error?.code,"42501",JSON.stringify(result));
      scoped.push({actor,foreignTenant:foreign.workspaceKey,api,
        rpc:{approval:approvalRpc.error.code,pricing:pricingRpc.error.code,
          job:jobRpc.error.code}});
    }
    const afterA=await connectedBasis("a",a),afterB=await connectedBasis("b",b);
    assert.equal(afterA.operate.revision,beforeA.operate.revision);
    assert.equal(afterB.operate.revision,beforeB.operate.revision);
    assert.equal(afterA.operate.state.jobs.filter((item)=>item.requestId===aJob.requestId
      && item.status!=="Cancelled").length,1);
    assert.equal(afterB.operate.state.jobs.filter((item)=>item.requestId===bJob.requestId
      && item.status!=="Cancelled").length,1);
    tdCase("CROSS-TENANT-AUTH-BOTH-WAYS",{aToB:aToB.status,bToA:bToA.status,
      scoped,unchangedRevisions:[afterA.operate.revision,afterB.operate.revision]});
    return {aToB:aToB.status,bToA:bToA.status,scoped,unchanged:true};
  });
  if(phase2htd && evidence.gateBJobs?.length===2) await check(
    "TD stale service task enforces membership, tenant and feature authority",async()=>{
    const workId=evidence.gateBJobs[1].workId;
    const newRequest=async(label)=>{
      const before=await connectedBasis("b",b);
      const asset=before.operate.state.assets[0];
      assert(asset?.id,"service_asset_missing");
      const opened=await operateCommand("b",b,"b_pm","open-request",{
        assetId:asset.id,title:`Synthetic ${label} service incident`,
        description:"Fictional monitored equipment requires inspected service repair",
        contact:"Fictional customer representative",impact:"Standard",
        note:`Open ${label} service security fixture`},`td-open-${label}-${randomUUID()}`);
      assert(!opened.error,`open_request:${opened.error?.message}`);
      const after=await connectedBasis("b",b);
      const request=after.operate.state.requests.at(-1);
      assert(request?.id && request.id!==before.operate.state.requests.at(-1)?.id);
      return request;
    };
    const request=await newRequest("stale task");
    const page=await openServiceTask("b_ops",b,workId,"triage-request");
    const openedUrl=page.url();
    const basis=await connectedBasis("b",b);
    const staleCommand={action:"triage-request",workId,requestId:request.id,
      serviceCategory:"Monitoring fault",expectedRevision:basis.source.revision,
      expectedDeployRevision:basis.deploy.revision,
      expectedDecisionRevision:basis.operate.revision,commandId:randomUUID()};
    const post=async(command)=>page.evaluate(async({workspace,command})=>{
      const response=await fetch(`/api/d5o-hosted/prototype-operate-command?workspace=${workspace}`,{
        method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(command)});
      return {status:response.status,body:await response.json()};
    },{workspace:b.workspaceKey,command});
    const readQueue=()=>page.evaluate(async(workspace)=>(await fetch(
      `/api/d5o-hosted/customer-work?workspace=${workspace}`)).status,b.workspaceKey);
    const unchanged=async()=>{
      const now=JSON.parse(sql(`select pg_catalog.jsonb_build_object(
        'revision',decision_revision,'jobs',pg_catalog.jsonb_array_length(state->'jobs'))::text
        from d5o_hosted.connected_operate_states where workspace_id=${q(b.workspaceId)}
          and work_id=${q(basis.work.canonicalWorkId)};`));
      assert.equal(now.revision,basis.operate.revision);
      assert.equal(now.jobs,basis.operate.state.jobs.length);
    };
    const people=await call("b_admin","d5o_hosted_org_admin_read_v1",{
      p_workspace_key:b.workspaceKey,p_kind:"people",p_search:"",p_offset:0,p_limit:25});
    assert(!people.error,people.error?.message);
    const member=people.data.items.find((item)=>item.actor_user_id===users.b_ops.id);
    assert(member,"b_ops_membership_missing");
    const memberCommand=(action,revision)=>call("b_admin","d5o_hosted_org_admin_command_v1",{
      p_workspace_key:b.workspaceKey,p_action:action,p_subject_id:member.id,p_input:{},
      p_expected_revision:revision,p_reason:`TD ${action} stale service responsibility check`,
      p_command_id:randomUUID()});
    const suspended=await memberCommand("member.suspend",member.revision);
    assert(!suspended.error,suspended.error?.message);
    const suspendedHttp=await post(staleCommand);
    assert.equal(suspendedHttp.status,403,JSON.stringify(suspendedHttp));
    assert.equal(await readQueue(),403);
    const direct=await call("b_ops","d5o_hosted_operate_command_v1",{
      p_workspace_key:b.workspaceKey,p_presentation_id:workId,p_action:"triage-request",
      p_input:{requestId:request.id,serviceCategory:"Monitoring fault"},
      p_command_id:randomUUID(),p_expected_source_revision:basis.source.revision,
      p_expected_deploy_revision:basis.deploy.revision,
      p_expected_operate_revision:basis.operate.revision});
    assert.equal(direct.error?.code,"42501",JSON.stringify(direct));
    await unchanged();
    tdCase("ID-SUSPENDED-SESSION",{api:suspendedHttp.status,rpc:direct.error.code,
      queue:403,unchangedOperateRevision:basis.operate.revision});
    const restored=await memberCommand("member.reactivate",suspended.data.record.revision);
    assert(!restored.error,restored.error?.message);
    const directory=async()=>{
      const result=await call("vendor","d5o_platform_provisioning_directory_v1");
      assert(!result.error,result.error?.message);
      return result.data.find((item)=>item.workspaceKey===b.workspaceKey);
    };
    const feature=(kind,enabled,revision)=>call("vendor","d5o_platform_capability_command_v1",{
      p_workspace_key:b.workspaceKey,p_kind:kind,p_enabled:enabled,
      p_expected_revision:revision,p_command_id:randomUUID(),
      p_reason:`TD ${kind} ${enabled?"restore":"disable"} service authority check`});
    let info=await directory();
    const flagOff=await feature("flag",false,info.connectedWorkFlagRevision);
    assert(!flagOff.error,flagOff.error?.message);
    const flagHttp=await post({...staleCommand,commandId:randomUUID()});
    assert.equal(flagHttp.status,403,JSON.stringify(flagHttp));
    const flagAuthorization=await post({...evidence.gateBJobs[1].authorizationCommand,
      commandId:randomUUID()});
    assert.equal(flagAuthorization.status,403,JSON.stringify(flagAuthorization));
    assert.equal(await readQueue(),403);
    const flagRpc=await call("b_ops","d5o_hosted_operate_command_v1",{
      p_workspace_key:b.workspaceKey,p_presentation_id:workId,p_action:"triage-request",
      p_input:{requestId:request.id,serviceCategory:"Monitoring fault"},
      p_command_id:randomUUID(),p_expected_source_revision:basis.source.revision,
      p_expected_deploy_revision:basis.deploy.revision,
      p_expected_operate_revision:basis.operate.revision});
    assert.equal(flagRpc.error?.code,"42501",JSON.stringify(flagRpc));
    const flagPricing=await call("b_pm","d5o_hosted_service_pricing_command_v1",{
      p_workspace_key:b.workspaceKey,p_parent_presentation_id:workId,
      p_request_id:request.id,p_action:"submit-service-pricing",
      p_input:{estimateRevision:1,note:"Disabled feature pricing probe"},
      p_command_id:randomUUID(),p_expected_work_revision:basis.source.revision,
      p_expected_operate_revision:basis.operate.revision});
    const flagApproval=await call("b_admin","d5o_hosted_connected_service_approval_command_v1",{
      p_workspace_key:b.workspaceKey,p_parent_presentation_id:workId,
      p_request_id:request.id,p_action:"request",p_command_id:randomUUID()});
    const flagJob=await call("b_pm","d5o_hosted_service_job_command_v1",{
      p_workspace_key:b.workspaceKey,p_parent_presentation_id:workId,
      p_request_id:request.id,p_due_date:executionDate,p_owner:"Synthetic owner",
      p_command_id:randomUUID(),p_expected_work_revision:basis.source.revision,
      p_expected_catalog_revision:1,p_expected_operate_revision:basis.operate.revision});
    for(const result of [flagPricing,flagApproval,flagJob])
      assert.equal(result.error?.code,"42501",JSON.stringify(result));
    const privilegedJob=await admin.rpc("d5o_hosted_create_related_work_v1",{
      p_workspace_key:b.workspaceKey,p_command_id:randomUUID(),p_action:"create-job",
      p_parent_presentation_id:workId,p_expected_work_revision:basis.source.revision,
      p_expected_catalog_revision:1,p_parent_after:{},p_child:{},
      p_actor_user_id:users.b_pm.id,p_membership_id:sql(`select id
        from d5o_hosted.memberships where workspace_id=${q(b.workspaceId)}
          and actor_user_id=${q(users.b_pm.id)};`)});
    assert.equal(privilegedJob.error?.code,"42501",JSON.stringify(privilegedJob));
    const org=await call("b_admin","d5o_hosted_org_admin_read_v1",{
      p_workspace_key:b.workspaceKey,p_kind:"people",p_search:"",p_offset:0,p_limit:25});
    assert(!org.error,org.error?.message);
    const vendor=await call("vendor","d5o_platform_provisioning_directory_v1");
    assert(!vendor.error,vendor.error?.message);
    await unchanged();
    tdCase("FLAG-DIRECT-API-RPC",{api:flagHttp.status,
      authorizationApi:flagAuthorization.status,rpc:flagRpc.error.code,
      pricingRpc:flagPricing.error.code,approvalRpc:flagApproval.error.code,
      jobRpc:flagJob.error.code,privilegedJobRpc:privilegedJob.error.code,
      unrelatedOrgRead:true,vendorDirectory:true});
    const flagOn=await feature("flag",true,flagOff.data.revision);
    assert(!flagOn.error,flagOn.error?.message);
    info=await directory();
    const entitlementOff=await feature("entitlement",false,info.connectedWorkEntitlementRevision);
    assert(!entitlementOff.error,entitlementOff.error?.message);
    const entitlementHttp=await post({...staleCommand,commandId:randomUUID()});
    assert.equal(entitlementHttp.status,403,JSON.stringify(entitlementHttp));
    const entitlementAuthorization=await post({...evidence.gateBJobs[1].authorizationCommand,
      commandId:randomUUID()});
    assert.equal(entitlementAuthorization.status,403,JSON.stringify(entitlementAuthorization));
    assert.equal(await readQueue(),403);
    await unchanged();
    tdCase("ENTITLEMENT-SERVICE-API",{api:entitlementHttp.status,
      authorizationApi:entitlementAuthorization.status,
      unchangedOperateRevision:basis.operate.revision});
    const entitlementOn=await feature("entitlement",true,entitlementOff.data.revision);
    assert(!entitlementOn.error,entitlementOn.error?.message);
    info=await directory();
    const tenantOff=await call("vendor","d5o_platform_lifecycle_command_v1",{
      p_workspace_key:b.workspaceKey,p_action:"suspend",p_expected_revision:info.revision,
      p_command_id:randomUUID(),p_reason:"TD suspend fictional tenant during open service task"});
    assert(!tenantOff.error,tenantOff.error?.message);
    const tenantHttp=await post({...staleCommand,commandId:randomUUID()});
    assert.equal(tenantHttp.status,403,JSON.stringify(tenantHttp));
    const tenantAuthorization=await post({...evidence.gateBJobs[1].authorizationCommand,
      commandId:randomUUID()});
    assert.equal(tenantAuthorization.status,403,JSON.stringify(tenantAuthorization));
    assert.equal(await readQueue(),403);
    await unchanged();
    tdCase("TENANT-SUSPENDED-SERVICE",{api:tenantHttp.status,
      authorizationApi:tenantAuthorization.status,
      unchangedOperateRevision:basis.operate.revision});
    const tenantOn=await call("vendor","d5o_platform_lifecycle_command_v1",{
      p_workspace_key:b.workspaceKey,p_action:"reactivate",
      p_expected_revision:tenantOff.data.revision,p_command_id:randomUUID(),
      p_reason:"TD restore fictional tenant after denied service action"});
    assert(!tenantOn.error,tenantOn.error?.message);
    const resolved=await operateCommand("b",b,"b_ops2","triage-request",{
      requestId:request.id,serviceCategory:"Monitoring fault"},
      `td-other-actor-triage-${randomUUID()}`);
    assert(!resolved.error,resolved.error?.message);
    const triagedCurrent=await connectedBasis("b",b);
    assert.equal(triagedCurrent.operate.state.requests.find((item)=>item.id===request.id)?.status,
      "Triaged");
    const replay=await post({...staleCommand,commandId:randomUUID()});
    assert.equal(replay.status,409,JSON.stringify(replay));
    await page.goto(openedUrl);
    await page.getByRole("heading",{name:"Design actions"}).waitFor();
    await page.getByText("Loading current Work and phase decisions…")
      .waitFor({state:"hidden"});
    const completedRequest=page.getByRole("heading",{
      name:`${request.title} · Triaged`,exact:true}).locator("..");
    assert.equal(await completedRequest.getByRole("button",{name:"Triage request"}).count(),0);
    await assertServiceTaskResolved("b_ops",b,workId);
    tdCase("TASK-OTHER-ACTOR-COMPLETED",{staleApi:replay.status,
      taskRemoved:true,oldUrlNotActionable:true});
    const removedRequest=await newRequest("removed member");
    await openServiceTask("b_ops",b,workId,"triage-request");
    const beforeRemoval=await connectedBasis("b",b);
    const removed=await memberCommand("member.remove",restored.data.record.revision);
    assert(!removed.error,removed.error?.message);
    const removedHttp=await post({action:"triage-request",workId,
      requestId:removedRequest.id,serviceCategory:"Monitoring fault",
      expectedRevision:beforeRemoval.source.revision,
      expectedDeployRevision:beforeRemoval.deploy.revision,
      expectedDecisionRevision:beforeRemoval.operate.revision,commandId:randomUUID()});
    assert.equal(removedHttp.status,403,JSON.stringify(removedHttp));
    assert.equal(await readQueue(),403);
    const afterRemoval=await connectedBasis("b",b);
    assert.equal(afterRemoval.operate.revision,beforeRemoval.operate.revision);
    const successor=await operateCommand("b",b,"b_ops2","triage-request",{
      requestId:removedRequest.id,serviceCategory:"Monitoring fault"},
      `td-successor-triage-${randomUUID()}`);
    assert(!successor.error,successor.error?.message);
    tdCase("ID-REMOVED-STALE-SESSION",{api:removedHttp.status,queue:403,
      successorActor:users.b_ops2.id,unchangedOnDenial:true});
    return {openedTaskUrl:openedUrl,suspended:suspendedHttp.status,
      disabledFlag:flagHttp.status,disabledEntitlement:entitlementHttp.status,
      suspendedTenant:tenantHttp.status,otherActorReplay:replay.status,
      removedMember:removedHttp.status,initialJobCount:basis.operate.state.jobs.length,
      finalJobCount:afterRemoval.operate.state.jobs.length};
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
  mkdirSync(dirname(output),{recursive:true});
  writeFileSync(output,JSON.stringify(evidence,null,2)+"\n");
  console.log(JSON.stringify({...evidence.summary,output:phase2hv
    ? "docs/architecture/evidence/phase2hv-two-tenant-results.json" : rc0DeployIntegrity
    ? "docs/release/D5O_RC0_DEPLOY_INTEGRITY.json" : phase2hu
    ? "docs/architecture/evidence/phase2hu-two-tenant-results.json" : phase2htd
    ? "docs/architecture/evidence/phase2htd-targeted-results.json" : phase2htc
    ? "docs/architecture/evidence/phase2htc-two-tenant-results.json" : phase2htGateA
    ? "docs/architecture/evidence/phase2ht-gate-a-results.json" : phase2htGateB
    ? "docs/architecture/evidence/phase2ht-gate-b-results.json" : phase2hsGateB
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
