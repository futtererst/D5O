import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";

const users=JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE,"utf8")).users;
const worker=JSON.parse(readFileSync(process.env.D5O_WORKER_CREDENTIALS_FILE,"utf8"));
const work="rybex-fe917921068844f0a9e6116cd76623c5";
const sql=`select jsonb_build_object('commandId',e.command_id,'expectedRevision',e.revision-1,
 'input',e.basis->'input','sourceDigest',e.basis#>>'{source,digest}',
 'authorityId',e.subject_id)::text from d5o_hosted.labor_authority_events e
 where e.work_id='fe917921-0688-44f0-a9e6-116cd76623c5' and e.action='approve'
 order by e.revision desc limit 1`;
const basis=JSON.parse(execFileSync("docker",["exec","supabase_db_d5o-candidate-89-replay-20261015",
 "psql","-U","postgres","-d","postgres","-Atc",sql],{encoding:"utf8"}).trim());
const browser=await chromium.launch({headless:true});
async function session(user) {
 const context=await browser.newContext(),page=await context.newPage();
 await page.goto("http://127.0.0.1:61656/auth/sign-in?next="+
  encodeURIComponent("/work?workspace=rybex&view=my-work"));
 await page.locator('input[name="email"]').fill(user.email);
 await page.locator('input[name="password"]').fill(user.password);
 await page.getByRole("button",{name:"Continue to your work"}).click();
 await page.waitForURL(/\/work/);
 return{page,context};
}
async function call(page,workspace="rybex",body) {
 return page.evaluate(async ({workspace,work,body})=>{
  const response=await fetch(`/api/d5o-hosted/labor-authority?workspace=${workspace}&workId=${work}`,
   body?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:{cache:"no-store"});
  const result=await response.json();return{http:response.status,error:result.error??null,revision:result.revision??null};
 },{workspace,work,body});
}
const body={action:"approve",input:basis.input,commandId:basis.commandId,
 expectedRevision:basis.expectedRevision,expectedSourceDigest:basis.sourceDigest};
try{
 const admin=await session(users.find((item)=>item.key==="admin"));
 const operations=await session(users.find((item)=>item.key==="operations"));
 const field=await session(worker);
 const results={
  identicalReplay:await call(admin.page,"rybex",body),
  conflictingReplay:await call(admin.page,"rybex",{...body,input:{...basis.input,reason:"Conflicting replay reason"}}),
  stale:await call(admin.page,"rybex",{...body,commandId:crypto.randomUUID()}),
  wrongRole:await call(operations.page,"rybex",{...body,commandId:crypto.randomUUID(),expectedRevision:2}),
  crossTenant:await call(admin.page,"rotork"),
  workerSensitiveRead:await call(field.page,"rybex")
 };
 console.log(JSON.stringify(results));
 if(results.identicalReplay.http!==200||results.conflictingReplay.http!==409||
   results.stale.http!==409||results.wrongRole.http!==403||
   results.crossTenant.http!==403||results.workerSensitiveRead.http!==403)
   throw Error("Labor authority boundary result differs from expected");
 await Promise.all([admin.context.close(),operations.context.close(),field.context.close()]);
}finally{await browser.close();}
