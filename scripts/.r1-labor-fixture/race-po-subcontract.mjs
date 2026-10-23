import { readFileSync } from "node:fs";
import { chromium } from "playwright";
const admin = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE,"utf8"))
  .users.find((item) => item.key === "admin");
const workId = "rybex-fe917921068844f0a9e6116cd76623c5";
const origin = "http://127.0.0.1:61656";
const browser = await chromium.launch({ headless: true });
async function session(path) {
  const context = await browser.newContext(); const page = await context.newPage();
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent(path)}`);
  await page.locator('input[name="email"]').fill(admin.email);
  await page.locator('input[name="password"]').fill(admin.password);
  await page.getByRole("button",{name:"Continue to your work"}).click();
  await page.waitForURL(/\/work\//);
  return { context,page };
}
async function read(page,kind) {
  return page.evaluate(async ({ work,kind }) => {
    const response = await fetch(`/api/d5o-hosted/${kind}?workspace=rybex&workId=${work}`,{cache:"no-store"});
    return response.json();
  },{work:workId,kind});
}
async function decide(page,kind,body) {
  return page.evaluate(async ({work,kind,body}) => {
    const response = await fetch(`/api/d5o-hosted/${kind}?workspace=rybex&workId=${work}`,{
      method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)
    });
    const value=await response.json();
    return {http:response.status,error:value.error??null,revision:value.revision??null};
  },{work:workId,kind,body});
}
try {
  const [poSession,subSession]=await Promise.all([
    session(`/work/procurement?workspace=rybex&workId=${workId}&step=po`),
    session(`/work/subcontracts?workspace=rybex&workId=${workId}`)
  ]);
  const [po,sub]=await Promise.all([read(poSession.page,"graybar"),read(subSession.page,"subcontract")]);
  const order=po.state.orders.find((item)=>item.status==="Prepared"&&Number(item.amountMinor)===90000);
  const agreement=sub.state.agreements.find((item)=>item.status==="Prepared"&&Number(item.amountMinor)===700000);
  if(!order||!agreement||po.state.orders.some((item)=>item.status==="Approved")||
    sub.state.agreements.some((item)=>item.status==="Approved")||90000+700000<=750000)
    throw Error("Independent eligible PO and subcontract candidates required");
  const poCommand=crypto.randomUUID(),subCommand=crypto.randomUUID();
  const poBody={action:"approve-po",input:{orderId:order.id,authorityBasis:"Active fictional workspace administrator"},
    expectedRevision:po.revision,commandId:poCommand};
  const subBody={action:"review-agreement",input:{agreementId:agreement.id,decision:"Approved",reason:"Independent fictional off-site subcontract review under shared Work authority."},
    expectedRevision:sub.revision,expectedSourceDigest:sub.source.digest,
    expectedFinanceRevision:sub.financeRevision,commandId:subCommand};
  const [poResult,subResult]=await Promise.all([
    decide(poSession.page,"graybar",poBody),decide(subSession.page,"subcontract",subBody)
  ]);
  const [afterPo,afterSub]=await Promise.all([read(poSession.page,"graybar"),read(subSession.page,"subcontract")]);
  const poWon=afterPo.state.orders.some((item)=>item.id===order.id&&item.status==="Approved");
  const subWon=afterSub.state.agreements.some((item)=>item.id===agreement.id&&item.status==="Approved");
  const losingRetry=poWon
    ? await decide(subSession.page,"subcontract",{...subBody,expectedRevision:afterSub.revision,commandId:crypto.randomUUID()})
    : await decide(poSession.page,"graybar",{...poBody,expectedRevision:afterPo.revision,commandId:crypto.randomUUID()});
  const replay=poWon?await decide(poSession.page,"graybar",poBody):await decide(subSession.page,"subcontract",subBody);
  const [finalPo,finalSub]=await Promise.all([read(poSession.page,"graybar"),read(subSession.page,"subcontract")]);
  console.log(JSON.stringify({fixture:"Hall L PO versus subcontract",workId,orderId:order.id,agreementId:agreement.id,
    poAmount:order.amountMinor,subAmount:agreement.amountMinor,poResult,subResult,poWon,subWon,
    losingRetry,replay,final:{poRevision:finalPo.revision,subRevision:finalSub.revision,
      poStatus:finalPo.state.orders.find((item)=>item.id===order.id)?.status,
      subStatus:finalSub.state.agreements.find((item)=>item.id===agreement.id)?.status}}));
  if(poWon===subWon||losingRetry.http===200||replay.http!==200) throw Error("Cross-type cap assertion failed");
  await Promise.all([poSession.context.close(),subSession.context.close()]);
}finally{await browser.close()}
