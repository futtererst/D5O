import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';
const user=JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE,'utf8')).users.find(item=>item.key==='commercial');
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage();
 await page.goto('http://127.0.0.1:61656/auth/sign-in?next='+encodeURIComponent('/work?workspace=rybex&view=my-work'));
 await page.locator('input[name="email"]').fill(user.email);
 await page.locator('input[name="password"]').fill(user.password);
 await page.getByRole('button',{name:'Continue to your work'}).click();
 await page.waitForURL(/\/work\?/);
 const outcome=await page.evaluate(async()=>{
  const url='/api/d5o-hosted/job-finance?workspace=rybex&workId=rybex-fe917921068844f0a9e6116cd76623c5';
  const read=()=>fetch(url,{cache:'no-store'}).then(async r=>({http:r.status,value:await r.json()}));
  const before=await read();
  const response=await fetch('/api/d5o-hosted/job-finance',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({workspace:'rybex',workId:'rybex-fe917921068844f0a9e6116cd76623c5',action:'add-cost',data:{category:'Labor',kind:'Incurred',amountMinor:100,costDate:'2026-10-17',source:'Fictional duplicate-labor boundary probe'},commandId:crypto.randomUUID(),expectedRevision:before.value.revision})});
  const result=await response.json();const after=await read();
  return {beforeHttp:before.http,governedLabor:before.value.governedLabor,attemptHttp:response.status,error:result.error??null,beforeRevision:before.value.revision,afterRevision:after.value.revision,beforeCosts:before.value.costs?.length,afterCosts:after.value.costs?.length};
 });
 console.log(JSON.stringify(outcome));
}finally{await browser.close()}
