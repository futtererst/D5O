import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';
const users=JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE,'utf8')).users;
const browser=await chromium.launch({headless:true});
try {
 for(const key of ['pm','admin']) {
  const user=users.find(item=>item.key===key);
  const page=await browser.newPage();
  await page.goto('http://127.0.0.1:61656/auth/sign-in?next='+encodeURIComponent('/work?workspace=rybex&view=my-work'));
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole('button',{name:'Continue to your work'}).click();
  await page.waitForURL(/\/work\?/);
  await page.getByText('Loading workspace actions…').waitFor({state:'hidden',timeout:30000});
  const body=await page.locator('body').innerText();
  console.log(JSON.stringify({role:key,url:page.url(),buildPresent:body.includes('e0800a18a74c'),myWork:body.includes('My work'),laborTask:body.toLowerCase().includes('field labor authority')}));
  if(key==='pm') {
   const finance=await page.evaluate(async()=>{
    const response=await fetch('/api/d5o-hosted/job-finance?workspace=rybex&workId=rybex-fe917921068844f0a9e6116cd76623c5',{cache:'no-store'});
    const value=await response.json();
    return {http:response.status,governedLabor:value.governedLabor,laborReservations:value.laborReservations?.length};
   });
   console.log(JSON.stringify({role:key,finance}));
   await page.goto('http://127.0.0.1:61656/work?workspace=rybex&view=crew');
   await page.waitForTimeout(1800); const crew=await page.locator('body').innerText();
   console.log(JSON.stringify({role:key,crewLoaded:crew.includes('Crew schedule')}));
  }
  await page.close();
 }
} finally {await browser.close();}
