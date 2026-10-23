import { readFileSync } from "node:fs";
import { chromium } from "playwright";
if (process.env.D5O_ISOLATED_PILOT !== "1" || process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:56621" || !process.env.D5O_PILOT_CREDENTIALS_FILE) throw new Error("fresh_disposable_pilot_only");
const user = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users.find((item) => item.key === "quality");
const origin = "http://127.0.0.1:61642", workId = "rybex-9e4f1e5f9e6b4e429142d3b01e1825e5";
const names = ["North zone controls installation", "South zone controls installation"];
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext(), page = await context.newPage();
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent(`/work?workspace=rybex&view=record&section=Deploy&record=${workId}`)}`);
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.getByRole("heading", { name: "Deliver and verify the released work" }).waitFor({ timeout: 30000 });
  for (const name of names) {
    await page.getByRole("button", { name: new RegExp(name) }).click();
    await page.getByRole("button", { name: "Field work" }).click();
    const completion = page.locator('article:has(h3:text-is("Reviewed package completion"))');
    const before = (await completion.innerText()).slice(0, 1500);
    const button = completion.getByRole("button", { name: "Record reviewed completion" });
    if (await button.count()) {
      if (await button.isDisabled()) throw new Error(`completion_still_blocked:${name}:${before}`);
      await completion.locator('input[name="reason"]').fill(`Fictional pilot: reviewed full ten-point ${name} quantity, both verified requirement tests and corrected North failure where applicable.`);
      const response = page.waitForResponse((item) => item.url().includes("prototype-deploy-command") && item.request().method() === "POST", { timeout: 30000 });
      await button.click();
      const result = await response;
      if (!result.ok()) throw new Error(`completion_command:${result.status()}:${(await result.text()).slice(0, 600)}`);
      await completion.getByText(/Completion decision/).waitFor({ timeout: 30000 });
    }
    console.log(JSON.stringify({ step: "independent_measured_completion_ui", package: name, before }));
  }
  await context.close();
} finally { await browser.close(); }
