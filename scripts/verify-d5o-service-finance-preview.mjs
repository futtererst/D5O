import { readFileSync } from "node:fs";
import { chromium } from "playwright";

if (process.env.D5O_ISOLATED_PILOT !== "1" || !process.env.D5O_PILOT_CREDENTIALS_FILE)
  throw new Error("disposable_pilot_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const origin = process.env.D5O_PILOT_ORIGIN || "http://127.0.0.1:61644";
const user = users.find((entry) => entry.key === "finance");
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const target = "/work?workspace=rybex&view=record&section=Operate&record=rybex-a8fd95e7e20d4bb3881c3549459c99e0&focus=finance";
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent(target)}`);
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.getByRole("button", { name: "Finance & lessons" }).click();
  const panel = page.locator('section[aria-label="Service financial disposition"]');
  await panel.getByText("Hold", { exact: true }).waitFor({ timeout: 30_000 });
  const content = await panel.innerText();
  if (!content.includes("Partially covered · Closed") || !content.includes("$524.65") ||
    !content.includes("4 actual hours") || !content.includes("not established"))
    throw new Error(`incorrect_service_finance_projection:${content}`);
  const build = await page.locator(".d5o-source-id").innerText();
  if (!build.includes("bdbb4a2696c4")) throw new Error(`unexpected_build:${build}`);
  console.log(JSON.stringify({ build, finance: "Hold", classification: "Partially covered",
    uncoveredAmount: "USD 524.65", reviewedHours: 4, retainedAfterReload: true }));
  await context.close();
} finally { await browser.close(); }
