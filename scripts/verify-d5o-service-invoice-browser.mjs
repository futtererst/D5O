import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
if (process.env.D5O_QUEUE_TARGET_URL !== "http://127.0.0.1:56821" ||
  process.env.D5O_QUEUE_ORIGIN !== "http://127.0.0.1:61645")
  throw new Error("disposable_invoice_fixture_only");
const users=JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE,"utf8")).users;
const origin=process.env.D5O_QUEUE_ORIGIN;
const requestId="abe94af3-bdc5-435b-b6ad-ca810293988e";
const workId="rybex-a8fd95e7e20d4bb3881c3549459c99e0";
const paymentCommandId="995fcc12-cb54-4b4d-a037-b433a7ae0b98";
const browser=await chromium.launch({headless:true});
async function session(key) {
  const user=users.find(x=>x.key===key);
  const context=await browser.newContext(),page=await context.newPage();
  await page.goto(origin+"/auth/sign-in?next="+encodeURIComponent("/work?workspace=rybex&view=my-work"));
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button",{name:"Continue to your work"}).click();
  await page.getByRole("heading",{name:"Actions requiring attention"}).waitFor();
  return {context,page};
}
async function read(page,route,workspace="rybex") {
  return page.evaluate(async ({route,workspace,workId,requestId})=>{
    const r=await fetch("/api/d5o-hosted/"+route+"?workspace="+workspace+
      "&workId="+encodeURIComponent(workId)+"&requestId="+requestId,{cache:"no-store"});
    return {status:r.status,body:await r.json()};
  },{route,workspace,workId,requestId});
}
async function command(page,role,finance,invoice,changes={}) {
  return page.evaluate(async ({role,finance,invoice,changes,workId,requestId})=>{
    const body={workId,requestId,action:"record-payment",commandId:crypto.randomUUID(),
      expectedWorkRevision:finance.workRevision,
      expectedOperateRevision:finance.operateRevision,
      expectedDesignRevision:finance.basis.designRevision,
      expectedDeployRevision:finance.basis.deployRevision,
      expectedFinanceRevision:finance.revision,basisDigest:finance.basisDigest,
      expectedInvoiceRevision:invoice.invoice.revision,
      expectedLedgerRevision:invoice.invoice.ledger_revision,
      note:"",source:"FICTIONAL-RECEIPT-20261010-100",
      invoiceDate:"",paymentDate:new Date().toISOString().slice(0,10),
      amountMinor:"10000",...changes};
    const r=await fetch("/api/d5o-hosted/service-invoice?workspace="+role,{
      method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    return {status:r.status,body:await r.json()};
  },{role,finance,invoice,changes,workId,requestId});
}
function expected(label,result,message) {
  if(result.body.error!==message)throw Error(label+": "+JSON.stringify(result));
  return {label,status:result.status,error:result.body.error};
}
try {
  const fin=await session("finance"),pm=await session("pm");
  const finance=(await read(fin.page,"service-finance")).body;
  const original=(await read(fin.page,"service-invoice")).body;
  if(original.outstandingMinor!==42465)throw Error("fixture_balance_changed");
  const results=[];
  const duplicate=await pm.page.evaluate(async ({finance,invoice,workId,requestId})=>{
    const r=await fetch("/api/d5o-hosted/service-invoice?workspace=rybex",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({workId,requestId,action:"draft",commandId:crypto.randomUUID(),
        expectedWorkRevision:finance.workRevision,
        expectedOperateRevision:finance.operateRevision,
        expectedDesignRevision:finance.basis.designRevision,
        expectedDeployRevision:finance.basis.deployRevision,
        expectedFinanceRevision:finance.revision,basisDigest:finance.basisDigest,
        expectedInvoiceRevision:invoice.invoice.revision,
        expectedLedgerRevision:invoice.invoice.ledger_revision,
        note:"Duplicate full-scope USD 524.65 reservation probe."})});
    return {status:r.status,body:await r.json()};
  },{finance,invoice:original,workId,requestId});
  results.push(expected("duplicate_full_scope_invoice",duplicate,"service_invoice_already_reserved_or_invalid"));
  results.push(expected("overpayment",await command(fin.page,"rybex",finance,original,
    {amountMinor:"42466",source:"FICTIONAL-OVERPAY-PROBE"}),"service_invoice_overpayment"));
  results.push(expected("wrong_role",await command(pm.page,"rybex",finance,original,
    {amountMinor:"100",source:"FICTIONAL-WRONG-ROLE-PROBE"}),"service_invoice_role_required"));
  const financeUser=users.find(x=>x.key==="finance");
  const direct=createClient(process.env.D5O_QUEUE_TARGET_URL,process.env.D5O_LOCAL_ANON_KEY);
  const signed=await direct.auth.signInWithPassword({email:financeUser.email,password:financeUser.password});
  if(signed.error)throw signed.error;
  const cross=await direct.rpc("d5o_hosted_service_invoice_command_v1",{
    p_workspace_key:"rotork",p_parent_presentation_id:workId,p_request_id:requestId,
    p_action:"record-payment",p_input:{amountMinor:"100",paymentDate:new Date().toISOString().slice(0,10),source:"FICTIONAL-CROSS-TENANT-PROBE"},
    p_command_id:crypto.randomUUID(),p_expected_work_revision:finance.workRevision,
    p_expected_operate_revision:finance.operateRevision,
    p_expected_design_revision:finance.basis.designRevision,
    p_expected_deploy_revision:finance.basis.deployRevision,
    p_expected_finance_revision:finance.revision,p_expected_basis_digest:finance.basisDigest,
    p_expected_invoice_revision:original.invoice.revision,p_expected_ledger_revision:original.invoice.ledger_revision});
  if(cross.error?.message!=="workspace_forbidden")throw Error("cross_tenant_db:"+JSON.stringify(cross.error));
  results.push({label:"cross_tenant_database",error:cross.error.message});
  results.push(expected("stale_ledger",await command(fin.page,"rybex",finance,original,
    {expectedLedgerRevision:0,source:"FICTIONAL-STALE-PROBE"}),"stale_service_invoice_revision"));
  const replay=await command(fin.page,"rybex",finance,original,{
    commandId:paymentCommandId,expectedLedgerRevision:0});
  if(replay.body.paymentMinor!==10000||replay.body.outstandingMinor!==42465)
    throw Error("identical_replay_failed:"+JSON.stringify(replay));
  results.push(expected("conflicting_replay",await command(fin.page,"rybex",finance,original,{
    commandId:paymentCommandId,expectedLedgerRevision:0,amountMinor:"20000"}),"command_reuse_conflict"));
  const after=(await read(fin.page,"service-invoice")).body;
  if(JSON.stringify(after)!==JSON.stringify(original))throw Error("rejected_commands_mutated_invoice");
  await fin.page.goto(origin+"/work?workspace=rybex&view=my-work");
  const financeQueue=fin.page.locator('section[aria-label="Service commercial and Finance actions"]');
  const financeLink=financeQueue.getByRole("link",{name:/Synthetic monitoring route fault · Service payment recording/});
  await financeLink.waitFor();
  if(!(await financeLink.innerText()).includes("Available to your role"))throw Error("finance_collection_not_actionable");
  await pm.page.goto(origin+"/work?workspace=rybex&view=my-work");
  const pmQueue=pm.page.locator('section[aria-label="Service commercial and Finance actions"]');
  const pmLink=pmQueue.getByRole("link",{name:/Synthetic monitoring route fault · Service payment recording/});
  await pmLink.waitFor();
  if(!(await pmLink.innerText()).includes("Waiting on another role"))throw Error("pm_collection_wrong_owner");
  await financeLink.click();
  const retainedPanel=fin.page.locator('section[aria-label="Service invoice and receivable"]');
  await retainedPanel.getByText(/outstanding \$424\.65/).waitFor();
  results.push({label:"queue_to_exact_receivable",finance:"actionable",pm:"waiting"});
  const crossRead=await direct.rpc("d5o_hosted_service_invoice_read_v1",{
    p_workspace_key:"rotork",p_parent_presentation_id:workId,p_request_id:requestId});
  if(crossRead.error?.message!=="service_invoice_scope_forbidden")throw Error("cross_tenant_read:"+JSON.stringify(crossRead.error));
  results.push({label:"cross_tenant_read_database",error:crossRead.error.message});
  console.log(JSON.stringify({checks:results,replay:"original receipt",unchanged:true,
    invoiceId:original.invoice.invoice_id,paidMinor:after.paidMinor,outstandingMinor:after.outstandingMinor}));
  await fin.context.close();await pm.context.close();
}finally{await browser.close()}
