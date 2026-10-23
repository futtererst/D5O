import { readFileSync } from "node:fs";
import { chromium } from "playwright";
if (process.env.D5O_QUEUE_TARGET_URL !== "http://127.0.0.1:56821" ||
  process.env.D5O_QUEUE_ORIGIN !== "http://127.0.0.1:61645")
  throw new Error("disposable_invoice_fixture_only");
const users=JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE,"utf8")).users;
const finance=users.find(item=>item.key==="finance");
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage(),origin=process.env.D5O_QUEUE_ORIGIN;
  await page.goto(origin+"/auth/sign-in?next="+encodeURIComponent("/work?workspace=rybex&view=my-work"));
  await page.locator('input[name="email"]').fill(finance.email);
  await page.locator('input[name="password"]').fill(finance.password);
  await page.getByRole("button",{name:"Continue to your work"}).click();
  await page.getByRole("heading",{name:"Actions requiring attention"}).waitFor();
  await page.locator('section[aria-label="Service commercial and Finance actions"]')
    .getByRole("link",{name:/Synthetic monitoring route fault · Service payment recording/}).click();
  const panel=page.locator('section[aria-label="Service invoice and receivable"]');
  await panel.getByText(/outstanding \$424\.65/).waitFor();
  const amount=panel.locator('input[name="amount"]');
  await amount.fill("100.00");
  let captured;
  await page.route("**/api/d5o-hosted/service-invoice?workspace=rybex",async route=>{
    if(route.request().method()==="POST"){
      captured=JSON.parse(route.request().postData());
      await route.fulfill({status:409,contentType:"application/json",body:'{"error":"intercepted_probe_no_write"}'});
    } else await route.continue();
  });
  await panel.locator('input[name="source"]').fill("FICTIONAL-INTERCEPT-ONLY-NO-WRITE");
  await panel.getByRole("button",{name:"Record payment fact"}).click();
  await panel.getByText(/intercepted_probe_no_write/).waitFor();
  if(captured?.amountMinor!=="10000")throw Error("decimal_conversion_wrong");
  const text=await page.locator("body").innerText();
  if(!text.includes("f529eae"))throw Error("displayed_build_identity_missing");
  console.log(JSON.stringify({build:"f529eae",balance:"USD 424.65",
    input:"USD 100.00",commandMinor:"10000",write:"intercepted; none"}));
}finally{await browser.close()}
