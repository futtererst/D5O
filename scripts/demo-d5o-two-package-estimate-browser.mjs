import { readFileSync } from "node:fs";
import { chromium } from "playwright";
if (process.env.D5O_ISOLATED_PILOT !== "1" || process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:56621" ||
  !process.env.D5O_PILOT_CREDENTIALS_FILE) throw new Error("fresh_disposable_pilot_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const workId = "rybex-9e4f1e5f9e6b4e429142d3b01e1825e5";
const browser = await chromium.launch({ headless: true });
async function signIn(key) {
  const user = users.find((item) => item.key === key);
  const context = await browser.newContext(), page = await context.newPage();
  const path = `/work?workspace=rybex&view=develop&record=${workId}`;
  await page.goto(`http://127.0.0.1:61642/auth/sign-in?next=${encodeURIComponent(path)}`);
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.getByText("Build a credible solution and price").waitFor({ timeout: 30000 });
  return { context, page };
}
const read = async (page) => page.evaluate(async (id) => {
  const response = await fetch("/api/d5o-hosted/prototype-state?workspace=rybex&key=work");
  const payload = await response.json();
  return payload.state?.records?.find((item) => item.id === id);
}, workId);
try {
  const pm = await signIn("pm");
  await pm.page.getByRole("button", { name: "Detailed estimator", exact: true }).click();
  console.log(JSON.stringify({ beforeEstimate: (await read(pm.page))?.discovery?.estimate }));
  if (!(await read(pm.page))?.discovery?.estimate?.detailed) {
    const add = async (fields) => {
      const form = pm.page.locator('form:has(button:has-text("Add cost line"))');
      if (!await form.isVisible()) await pm.page.getByText("+ Add sourced cost line").click();
      for (const [key, value] of Object.entries(fields)) {
        const field = form.locator(`[name="${key}"]`);
        if (key === "category") await field.selectOption(value); else await field.fill(value);
      }
      await form.getByRole("button", { name: "Add cost line" }).click();
    };
    await add({ scopeRef: "North and south control zones", category: "labor", description: "Certified controls technician labor", quantity: "160", unit: "hour", rateId: "pilot-controls-labor-hour", source: "Fictional internal cost catalog 2026-10-09", assumption: "80 hours per zone for install and test" });
    await add({ scopeRef: "North and south control zones", category: "material", description: "Two control panel and sensor kits", quantity: "2", unit: "each", manualRate: "25000", source: "Fictional supplier quote NC-2026-01", validUntil: "2026-11-30", assumption: "One kit per zone; procurement timing remains a separate delivery-strategy assumption" });
    await pm.page.getByLabel("Estimate maturity").selectOption("Budgetary");
    await pm.page.getByLabel("Risk basis").fill("Outage-window uncertainty covered by policy contingency; customer access to be confirmed.");
    const button = pm.page.getByRole("button", { name: "Save detailed estimate revision" });
    const response = pm.page.waitForResponse((item) => item.url().includes("/api/d5o-hosted/prototype-commercial-command") && item.request().method() === "POST", { timeout: 30000 });
    await button.click();
    const saved = await response;
    if (!saved.ok()) throw new Error(`estimate_command:${saved.status()}:${(await saved.text()).slice(0,500)}`);
    await pm.page.waitForFunction(async (id) => {
      const response = await fetch("/api/d5o-hosted/prototype-state?workspace=rybex&key=work");
      const payload = await response.json();
      return !!payload.state?.records?.find((item) => item.id === id)?.discovery?.estimate?.detailed;
    }, workId, { timeout: 30000 });
  }
  console.log(JSON.stringify({ step: "develop_detailed_estimate_ui", revision: (await read(pm.page))?.discovery?.estimate?.revision }));
  await pm.context.close();
} finally { await browser.close(); }
