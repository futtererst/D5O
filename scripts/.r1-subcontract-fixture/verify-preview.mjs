import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';
const creds=JSON.parse(readFileSync(process.env.D5O_FINANCE_CREDENTIALS_FILE,'utf8'));
const user=creds.users.find((item)=>item.key==='finance');
const browser=await chromium.launch({headless:true});
try {
 const context=await browser.newContext(); const page=await context.newPage();
 const target='http://127.0.0.1:61656/work/subcontracts?workspace=rybex&workId=rybex-a19c324a519d413da82304cbb0ac3547';
 await page.goto('http://127.0.0.1:61656/auth/sign-in?next='+encodeURIComponent(target));
 await page.locator('input[name="email"]').fill(user.email);
 await page.locator('input[name="password"]').fill(user.password);
 await page.getByRole('button',{name:'Continue to your work'}).click();
 await page.waitForURL((url)=>url.pathname==='/work'); await page.goto(target);
 await page.waitForFunction(() => document.body.innerText.includes('15,000.00'), {timeout:15000});
 console.log(JSON.stringify({url:page.url(),build:(await page.locator('header').first().innerText()).match(/Build [a-f0-9]{12}/)?.[0],economic:(await page.getByRole('heading',{name:'Economic position'}).locator('..').innerText()).slice(0,650),title:await page.title()}));
 await page.reload(); await page.waitForFunction(() => document.body.innerText.includes('15,000.00'), {timeout:15000});
 console.log(JSON.stringify({reloaded:true,agreement:(await page.getByRole('heading',{name:'Economic position'}).locator('..').innerText()).includes('$5,000.00')}));
 await context.close();
} finally {await browser.close()}
