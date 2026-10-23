import { readFileSync } from "node:fs";
import { chromium } from "playwright";

if (process.env.D5O_ISOLATED_PILOT !== "1" || !process.env.D5O_PILOT_CREDENTIALS_FILE)
  throw new Error("disposable_pilot_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const finance = users.find((item) => item.key === "finance");
const origin = "http://127.0.0.1:61641";
const target = "/work?workspace=rybex&view=record&section=Operate&record=rybex-a8fd95e7e20d4bb3881c3549459c99e0";
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent(target)}`);
  await page.locator('input[name="email"]').fill(finance.email);
  await page.locator('input[name="password"]').fill(finance.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.getByRole("button", { name: "Finance & lessons", exact: true }).click();
  const form = page.locator('form:has(button:has-text("Save Finance position"))');
  await form.locator('select[name="status"]').selectOption("Closed");
  await form.locator('input[name="note"]').fill("Synthetic pilot Finance closeout reviewed separately from active support and the covered service visit.");
  await form.getByRole("button", { name: "Save Finance position" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Finance & lessons", exact: true }).click();
  const card = page.locator('section:has(h3:has-text("Project financial closeout"))');
  if (!(await page.locator("body").innerText()).includes("Synthetic pilot Finance closeout reviewed separately"))
    throw new Error("finance_closeout_not_persisted");
  console.log(JSON.stringify({ status: "finance_closeout_recorded_by_finance_role", work: target.split("record=")[1] }));
  await context.close();
} finally { await browser.close(); }
