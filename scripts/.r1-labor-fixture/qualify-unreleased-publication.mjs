import {readFileSync} from "node:fs";import {chromium} from "playwright";
const user=JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE,"utf8")).users.find(x=>x.key==="pm");
const browser=await chromium.launch({headless:true});
try{const page=await browser.newPage();await page.goto("http://127.0.0.1:61656/auth/sign-in?next="+
 encodeURIComponent("/work?workspace=rybex&view=crew"));
 await page.locator('input[name="email"]').fill(user.email);await page.locator('input[name="password"]').fill(user.password);
 await page.getByRole("button",{name:"Continue to your work"}).click();await page.getByRole("heading",{name:"Crew schedule"}).waitFor();
 const result=await page.evaluate(async()=>{
  const scheduleUrl='/api/d5o-hosted/prototype-schedule?workspace=rybex';
  const laborUrl='/api/d5o-hosted/labor-authority?workspace=rybex&workId=rybex-fe917921068844f0a9e6116cd76623c5';
  const before=await fetch(scheduleUrl,{cache:'no-store'}).then(r=>r.json());
  const laborBefore=await fetch(laborUrl,{cache:'no-store'}).then(r=>r.json());
  const response=await fetch(scheduleUrl,{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({action:'publish',week:6,expectedRevision:before.schedule.revision,commandId:crypto.randomUUID()})});
  const outcome=await response.json();
  const after=await fetch(scheduleUrl,{cache:'no-store'}).then(r=>r.json());
  const laborAfter=await fetch(laborUrl,{cache:'no-store'}).then(r=>r.json());
  return{http:response.status,error:outcome.error,beforeRevision:before.schedule.revision,
   afterRevision:after.schedule.revision,beforeReservations:laborBefore.reservations.length,
   afterReservations:laborAfter.reservations.length};
 });
 console.log(JSON.stringify(result));
 if(result.http!==409||result.beforeRevision!==result.afterRevision||result.afterReservations!==0)
  throw Error('Unreleased publication unexpectedly committed or changed authority');
}finally{await browser.close();}
