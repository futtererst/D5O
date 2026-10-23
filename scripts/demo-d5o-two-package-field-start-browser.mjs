import { readFileSync } from "node:fs";
import { chromium } from "playwright";
if (process.env.D5O_ISOLATED_PILOT !== "1" || process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:56621" || !process.env.D5O_PILOT_CREDENTIALS_FILE) throw new Error("fresh_disposable_pilot_only");
const user = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users.find((item) => item.key === "supervisor");
const origin = "http://127.0.0.1:61642", workId = "rybex-9e4f1e5f9e6b4e429142d3b01e1825e5";
const names = ["North zone controls installation", "South zone controls installation"];
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext(), page = await context.newPage();
  const path = `/work?workspace=rybex&view=record&section=Deploy&record=${workId}`;
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent(path)}`);
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.getByRole("heading", { name: "Deliver and verify the released work" }).waitFor({ timeout: 30000 });
  for (const name of names) {
    await page.getByRole("button", { name: new RegExp(name) }).click();
    await page.getByRole("button", { name: "Crew & readiness" }).click();
    const body = await page.locator("body").innerText();
    if (!body.includes("Ready for authorized start") && !body.includes("Field start authorized")) {
      console.log(JSON.stringify({ blocker: name, text: body.slice(body.indexOf("Field readiness"), body.indexOf("Field readiness") + 1800) }));
      throw new Error(`field_start_not_ready:${name}`);
    }
    const start = page.locator('form:has(button:has-text("Authorize field start"))');
    if (await start.count()) {
      await start.locator('input[name="note"]').fill(`Fictional pilot: confirmed accepted revision, acknowledged crew and site controls for ${name}.`);
      const response = page.waitForResponse((item) => item.url().includes("prototype-deploy-command") && item.request().method() === "POST", { timeout: 30000 });
      await start.getByRole("button", { name: "Authorize field start" }).click();
      const result = await response;
      if (!result.ok()) throw new Error(`field_start:${result.status()}:${(await result.text()).slice(0, 650)}`);
      await page.getByText("Field start authorized").first().waitFor({ timeout: 30000 });
    }
    console.log(JSON.stringify({ step: "field_start_authorized_ui", package: name }));
  }
  await context.close();
} finally { await browser.close(); }
