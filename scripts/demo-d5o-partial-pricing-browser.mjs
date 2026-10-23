import { readFileSync } from "node:fs";
import { chromium } from "playwright";

if (process.env.D5O_ISOLATED_PILOT !== "1" || !process.env.D5O_PILOT_CREDENTIALS_FILE)
  throw new Error("disposable_pilot_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const origin = "http://127.0.0.1:61641";
const target = "/work?workspace=rybex&view=record&section=Operate&record=rybex-a8fd95e7e20d4bb3881c3549459c99e0";
const browser = await chromium.launch({ headless: true });
async function signIn(key) {
  const user = users.find((item) => item.key === key);
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("response", async (response) => { if (response.url().includes("prototype-operate-command")) { const body = await response.json(); console.log("pricing-response", response.status(), body.error ?? "ok"); } });
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent(target)}`);
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.getByRole("button", { name: "Requests & jobs", exact: true }).click();
  const pricing = page.locator('details:has(summary:has-text("Chargeable service estimate"))').filter({ has: page.locator('p:has-text("partially applicable")') });
  await pricing.locator("summary").click();
  return { context, page, pricing };
}
async function open(pricing) { if (!(await pricing.evaluate((element) => element.open))) await pricing.locator("summary").click(); }
try {
  const pm = await signIn("pm");
  if (!(await pm.pricing.getByText(/Saved estimate r1/).count())) {
    const add = pm.pricing.locator('form:has(button:has-text("Add cost line"))');
    await add.locator('input[name="description"]').fill("Fiber continuity investigation for monitoring route");
    await add.locator('input[name="quantity"]').fill("4");
    await add.locator('input[name="unit"]').fill("hour");
    await add.locator('input[name="rateId"]').fill("fiber-tech-hour");
    await add.locator('input[name="source"]').fill("Isolated published Rybex rate catalog");
    await add.locator('input[name="assumption"]').fill("Four hours of uncovered monitoring-route investigation");
    await add.getByRole("button", { name: "Add cost line" }).click();
    await pm.pricing.locator('label:has-text("Estimate risk") input').fill("Pilot uncertainty is limited to the four quoted investigation hours.");
    await pm.pricing.getByRole("button", { name: "Save new estimate revision" }).click();
    await open(pm.pricing);
  }
  if ((await pm.pricing.innerText()).includes("Saved estimate r1 · Draft")) {
    await pm.pricing.getByRole("button", { name: "Submit exact revision for pricing review" }).click();
    await open(pm.pricing);
  }
  await pm.page.getByText(/Saved estimate r1 · (Pricing review|Approved)/).waitFor({ state: "attached", timeout: 30000 });
  await pm.context.close();

  const ops = await signIn("operations");
  const approval = ops.pricing.locator('form:has(button:has-text("Approve priced service"))');
  if (await approval.count()) {
    await approval.locator('input[name="note"]').fill("Independently reviewed the exact four-hour uncovered scope, configured rate, burden and margin.");
    await approval.getByRole("button", { name: "Approve priced service" }).click();
    await open(ops.pricing);
  }
  await ops.page.getByText(/Saved estimate r1 · Approved/).waitFor({ state: "attached", timeout: 30000 });
  const customer = ops.pricing.locator('form:has(button:has-text("Record exact customer authorization"))');
  if (await customer.count()) {
    await customer.locator('input[name="customerParty"]').fill("Fictional pilot customer representative");
    await customer.locator('input[name="source"]').fill("SYNTHETIC-PILOT-PARTIAL-CUSTOMER-AUTH-NOT-REAL");
    await customer.locator('input[name="note"]').fill("Recorded fictional pilot customer decision for exact approved uncovered estimate revision one.");
    await customer.getByRole("button", { name: "Record exact customer authorization" }).click();
  }
  await ops.page.reload();
  await ops.page.getByRole("button", { name: "Requests & jobs", exact: true }).click();
  await open(ops.pricing);
  if (!(await ops.pricing.innerText()).includes("SYNTHETIC-PILOT-PARTIAL-CUSTOMER-AUTH-NOT-REAL"))
    throw new Error("partial_customer_authorization_not_persisted");
  console.log(JSON.stringify({ status: "partial_pricing_and_customer_authorization_recorded", requestId: "abe94af3-bdc5-435b-b6ad-ca810293988e" }));
  await ops.context.close();
} finally { await browser.close(); }
