import {readFileSync} from "node:fs";import {chromium} from "playwright";
const user=JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE,"utf8")).users.find(x=>x.key==="pm");
const browser=await chromium.launch({headless:true});
try{const page=await browser.newPage();await page.goto("http://127.0.0.1:61656/auth/sign-in?next="+
 encodeURIComponent("/work?workspace=rybex&view=crew"));
 await page.locator('input[name="email"]').fill(user.email);await page.locator('input[name="password"]').fill(user.password);
 await page.getByRole("button",{name:"Continue to your work"}).click();await page.getByRole("heading",{name:"Crew schedule"}).waitFor();
 const result=await page.evaluate(async()=>{
  const url='/api/d5o-hosted/prototype-schedule?workspace=rybex';
  const before=await fetch(url,{cache:'no-store'}).then(r=>r.json());
  const assignment=before.schedule.assignments.find(x=>x.id==='crew-rybex-20');
  const body={action:'save-booking',assignment,expectedRevision:before.schedule.revision,commandId:crypto.randomUUID()};
  async function send(data){const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
   const value=await response.json();return{http:response.status,error:value.error??null,revision:value.schedule?.revision??null};}
  const saved=await send(body),replay=await send(body);
  const conflict=await send({...body,assignment:{...assignment,personHoursPerWorker:5}});
  const stale=await send({...body,commandId:crypto.randomUUID()});
  const after=await fetch(url,{cache:'no-store'}).then(r=>r.json());
  return{saved,replay,conflict,stale,afterRevision:after.schedule.revision,
   currentHours:after.schedule.assignments.find(x=>x.id==='crew-rybex-20').personHoursPerWorker};
 });
 console.log(JSON.stringify(result));
 if(result.saved.http!==200||result.replay.http!==200||result.saved.revision!==result.replay.revision||
   result.conflict.http!==409||result.stale.http!==409||result.afterRevision!==result.saved.revision||result.currentHours!==4)
  throw Error('Booking replay, conflict or stale assertion failed');
}finally{await browser.close();}
