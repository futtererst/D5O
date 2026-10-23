import { readFileSync } from "node:fs";
import { chromium } from "playwright";

if (process.env.D5O_ISOLATED_PILOT !== "1" || !process.env.D5O_PILOT_CREDENTIALS_FILE)
  throw new Error("disposable_pilot_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const origin = process.env.D5O_PILOT_ORIGIN || "http://127.0.0.1:61644";
const parent = "rybex-a8fd95e7e20d4bb3881c3549459c99e0";
const requestId = "abe94af3-bdc5-435b-b6ad-ca810293988e";
const target = `/work?workspace=rybex&view=record&section=Operate&record=${parent}&focus=finance`;
const browser = await chromium.launch({ headless: true });

async function session(key) {
  const user = users.find((entry) => entry.key === key);
  if (!user) throw new Error(`missing_pilot_user:${key}`);
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent(target)}`);
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.getByRole("button", { name: "Finance & lessons" }).waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: "Finance & lessons" }).click();
  const panel = page.locator('section[aria-label="Service financial disposition"]');
  await panel.getByText("Partially covered · Closed").waitFor({ timeout: 30_000 });
  return { context, page, panel };
}

try {
  const pm = await session("pm");
  const prepared = pm.panel.locator('form:has(button:has-text("Prepare Finance review"))');
  await prepared.locator('input[name="note"]').fill(
    "FICTIONAL PILOT: approved uncovered amount is retained; billing terms are absent, so Finance must hold pending documented terms."
  );
  await prepared.getByRole("button", { name: "Prepare Finance review" }).click();
  await pm.panel.getByText("Prepared", { exact: true }).waitFor({ timeout: 20_000 });
  await pm.page.reload();
  await pm.page.getByRole("button", { name: "Finance & lessons" }).click();
  await pm.panel.getByText("Prepared", { exact: true }).waitFor({ timeout: 20_000 });
  console.log(JSON.stringify({ role: "project_manager", action: "prepared", retainedAfterReload: true }));
  await pm.context.close();

  const finance = await session("finance");
  const hold = finance.panel.locator('form:has(button:has-text("Hold billing"))');
  await hold.locator('input[name="note"]').fill(
    "FICTIONAL PILOT: customer authorization supports USD 524.65 of uncovered scope, but does not establish billing terms. Obtain retained agreed terms before billing."
  );
  await hold.getByRole("button", { name: "Hold billing" }).click();
  await finance.panel.getByText("Hold", { exact: true }).waitFor({ timeout: 20_000 });
  await finance.page.reload();
  await finance.page.getByRole("button", { name: "Finance & lessons" }).click();
  await finance.panel.getByText("Hold", { exact: true }).waitFor({ timeout: 20_000 });
  const read = await finance.page.evaluate(async ({ parent, requestId }) => {
    const response = await fetch(`/api/d5o-hosted/service-finance?workspace=rybex&workId=${parent}&requestId=${requestId}`);
    return { status: response.status, body: await response.json() };
  }, { parent, requestId });
  if (read.status !== 200 || read.body.decision?.status !== "Hold" ||
    read.body.basis?.coverage !== "Partially covered" ||
    read.body.basis?.uncoveredAmountMinor !== "52465" ||
    read.body.basis?.reviewedHours !== 4 || read.body.history?.length !== 2)
    throw new Error(`unexpected_service_finance_position:${JSON.stringify(read)}`);
  console.log(JSON.stringify({ role: "billing_commercial_lead", action: "held",
    retainedAfterReload: true, revision: read.body.revision,
    amountMinor: read.body.basis.uncoveredAmountMinor, currency: read.body.basis.currency,
    reviewedHours: read.body.basis.reviewedHours, history: read.body.history.length }));
  await finance.context.close();
} finally { await browser.close(); }
