import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";

if (process.env.D5O_ISOLATED_PILOT !== "1" || !process.env.D5O_PILOT_CREDENTIALS_FILE) throw new Error("disposable_pilot_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE,"utf8")).users;
const origin = "http://127.0.0.1:61644";
const parent = "rybex-a8fd95e7e20d4bb3881c3549459c99e0", child = "rybex-a11c09e603a248359205ec84f0af4ae8";
const requestId = "abe94af3-bdc5-435b-b6ad-ca810293988e", jobId = "43771fac-72f6-4449-ae9a-c9146e7651d9";
const originalCompleteId = "6cf78434-1a11-422a-a7ab-3bfd0bc9cc3a";
const browser = await chromium.launch({ headless: true });
async function signIn(key) {
  const user = users.find((item) => item.key === key);
  const context = await browser.newContext(), page = await context.newPage();
  const target = key === "southWorker" ? "/work/my-schedule" : `/work?workspace=rybex&view=record&section=Operate&record=${parent}`;
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent(target)}`);
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.waitForURL((url)=>url.pathname.startsWith("/work"),{timeout:30000});
  return { context,page };
}
async function state(page) {
  return page.evaluate(async (ids) => {
    const response = await fetch("/api/d5o-hosted/prototype-state?workspace=rybex&key=work",{cache:"no-store"});
    const body = await response.json();
    const parent = body.state.records.find((record)=>record.id===ids.parent);
    const child = body.state.records.find((record)=>record.id===ids.child);
    const request = parent.operate.requests.find((item)=>item.id===ids.requestId);
    const job = parent.operate.jobs.find((item)=>item.id===ids.jobId);
    const asset = parent.operate.assets.find((item)=>item.id===request.assetId);
    return { revision:body.revision??body.state.revision, operateRevision:parent.operate.authorityRevision, deployRevision:child.deploy.authorityRevision,
      requestStatus:request.status,coverage:request.coverage,jobStatus:job.status,assetHistory:asset.history.filter((event)=>event.source===ids.child).length,
      eventCount:parent.operate.events.length };
  },{parent,child,requestId,jobId});
}
async function post(page,workspace,command) {
  return page.evaluate(async ({workspace,command})=>{
    const response=await fetch(`/api/d5o-hosted/prototype-operate-command?workspace=${workspace}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(command)});
    const body=await response.json(); return {status:response.status,error:body.error??null};
  },{workspace,command});
}
try {
  const ops=await signIn("operations");
  const before=await state(ops.page);
  if (before.requestStatus!=="Closed" || before.coverage!=="Partially covered" || before.jobStatus!=="Completed" || before.assetHistory!==1) throw new Error(`completed_partial_basis_missing:${JSON.stringify(before)}`);
  const base={workId:parent,id:jobId,requestId,expectedRevision:before.revision,expectedDecisionRevision:before.operateRevision,expectedServiceDeployRevision:before.deployRevision};
  const replay=await post(ops.page,"rybex",{...base,action:"complete-job",note:"Independently reviewed the accepted service completion and linked report evidence.",commandId:originalCompleteId,expectedDecisionRevision:31});
  console.log(JSON.stringify({probe:"identical_replay",...replay}));
  const conflict=await post(ops.page,"rybex",{...base,action:"complete-job",note:"Conflicting replacement reason",commandId:originalCompleteId,expectedDecisionRevision:31});
  console.log(JSON.stringify({probe:"conflicting_replay",...conflict}));
  const stale=await post(ops.page,"rybex",{...base,action:"complete-job",note:"Stale child revision probe",commandId:randomUUID(),expectedServiceDeployRevision:before.deployRevision-1});
  console.log(JSON.stringify({probe:"stale_child",...stale}));
  const duplicate=await post(ops.page,"rybex",{...base,action:"link-execution",commandId:randomUUID()});
  console.log(JSON.stringify({probe:"duplicate_asset_return",...duplicate}));
  const tenant=await post(ops.page,"rotork",{...base,action:"complete-job",note:"Cross-tenant probe",commandId:randomUUID()});
  console.log(JSON.stringify({probe:"cross_tenant",...tenant}));
  const worker=await signIn("southWorker");
  const role=await post(worker.page,"rybex",{...base,action:"complete-job",note:"Worker role probe",commandId:randomUUID()});
  console.log(JSON.stringify({probe:"wrong_role",...role}));
  await worker.context.close();
  const after=await state(ops.page);
  if (JSON.stringify(before)!==JSON.stringify(after)) throw new Error(`rejected_probe_mutated_state:${JSON.stringify({before,after})}`);
  if (replay.status!==200 || conflict.status!==409 || stale.status!==409 || duplicate.status!==409 || ![403,404].includes(tenant.status) || role.status!==403) throw new Error("service_return_integrity_probe_failed");
  console.log(JSON.stringify({status:"partial_service_return_integrity_passed",before,after}));
  await ops.context.close();
} finally { await browser.close(); }
