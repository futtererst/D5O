import { readFileSync } from "node:fs";
import { chromium } from "playwright";

if (process.env.D5O_ISOLATED_PILOT !== "1"
  || !process.env.D5O_PILOT_CREDENTIALS_FILE) throw new Error("disposable_pilot_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const base = "http://127.0.0.1:61641";
const target = "/work?workspace=rybex&view=operate&record=rybex-a8fd95e7e20d4bb3881c3549459c99e0";
const browser = await chromium.launch({ headless: true });
const outcomes = [];
try {
  for (const key of ["pm", "operations", "worker", "finance"]) {
    const identity = users.find((item) => item.key === key);
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${base}/auth/sign-in?next=${encodeURIComponent(key === "worker" ? "/work/my-schedule" : target)}`);
    await page.locator('input[name="email"]').fill(identity.email);
    await page.locator('input[name="password"]').fill(identity.password);
    await page.getByRole("button", { name: "Continue to your work" }).click();
    await page.waitForURL((url) => url.pathname.startsWith("/work"), { timeout: 30000 });
    await page.waitForLoadState("networkidle");
    if (key !== "worker") await page.waitForFunction(
      () => document.body.innerText.includes("Synthetic") && document.body.innerText.includes("Operate"),
      null, { timeout: 30000 });
    const body = await page.locator("body").innerText();
    if (key !== "worker" && process.env.D5O_SOURCE_SHA
      && !body.includes(`Build ${process.env.D5O_SOURCE_SHA.slice(0, 12)}`))
      throw new Error("browser_source_identity_mismatch");
    if (key === "worker") {
      if (!body.includes("MY CREW SCHEDULE") || body.includes("System administrator")
        || body.includes("Work Record to confirm with scheduler"))
        throw new Error(`worker_browser_scope_failed:${new URL(page.url()).pathname}:${body.slice(0, 600)}`);
    } else if (key === "finance") {
      if (!body.includes("Finance") || body.includes("System administrator"))
        throw new Error("finance_browser_scope_failed");
    } else if (!body.includes("Synthetic") || !body.includes("Operate"))
      throw new Error(`${key}_browser_work_missing:${new URL(page.url()).pathname}:${body.slice(-460)}`);
    if (key === "pm") {
      await page.goto(`${base}/work?workspace=rybex&view=record&section=Design&record=rybex-d910a2a58a9c46038fb459436e1839c3`);
      await page.waitForLoadState("networkidle");
      await page.waitForFunction(
        () => document.body.innerText.includes("Synthetic covered monitoring inspection"),
        null, { timeout: 30000 });
      const serviceBody = await page.locator("body").innerText();
      if (!serviceBody.includes("Synthetic covered monitoring inspection"))
        throw new Error("service_visit_missing_from_work_browser");
      if (!serviceBody.includes("independently accepted execution basis"))
        throw new Error(`service_design_blocker_missing_from_browser:${serviceBody.slice(-700)}`);
    }
    outcomes.push({ role: key, url: new URL(page.url()).pathname,
      workVisible: body.includes("Synthetic"), financeVisible: body.includes("Finance") });
    await context.close();
  }
  console.log(JSON.stringify({ status: "separate_authenticated_browser_reads", outcomes }));
} finally { await browser.close(); }
