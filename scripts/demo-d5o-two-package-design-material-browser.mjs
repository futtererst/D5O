import { readFileSync } from "node:fs";
import { chromium } from "playwright";
if (process.env.D5O_ISOLATED_PILOT !== "1" || process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:56621" || !process.env.D5O_PILOT_CREDENTIALS_FILE) throw new Error("fresh_disposable_pilot_only");
const user = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users.find((item) => item.key === "pm");
const names = ["North zone controls installation", "South zone controls installation"];
const origin = "http://127.0.0.1:61642", workId = "rybex-9e4f1e5f9e6b4e429142d3b01e1825e5";
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext(), page = await context.newPage();
  const path = `/work?workspace=rybex&view=record&section=Design&record=${workId}`;
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent(path)}`);
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.getByRole("heading", { name: "Prepare executable work for release" }).waitFor({ timeout: 30000 });
  for (let index = 0; index < names.length; index++) {
    const name = names[index];
    await page.getByRole("button", { name: "Packages", exact: true }).click();
    await page.getByRole("button", { name: new RegExp(name) }).click();
    const form = page.locator('form:has(button:has-text("Save new design revision"))');
    if (!(await form.locator('input[name="materialItem"]').count())) await form.getByRole("button", { name: "+ Add material item" }).click();
    if (await form.locator('input[name="materialForecastLine"]').inputValue() === "2026-10-09") continue;
    await form.locator('input[name="materialItem"]').fill(`${index ? "South" : "North"} control panel and sensor kit`);
    await form.locator('input[name="materialQuantity"]').fill("1");
    await form.locator('input[name="materialUnit"]').fill("kit");
    await form.locator('input[name="materialSourceLine"]').fill(`FICTIONAL-STOCK-NC-${index + 1}`);
    await form.locator('select[name="materialConfidence"]').selectOption("Physically counted");
    await form.locator('select[name="materialStatusLine"]').selectOption("Available");
    await form.locator('input[name="materialReceived"]').fill("1");
    await form.locator('input[name="materialAvailable"]').fill("1");
    await form.locator('input[name="materialRequiredLine"]').fill("2026-10-12");
    await form.locator('input[name="materialForecastLine"]').fill("2026-10-09");
    await form.getByRole("button", { name: "Save new design revision" }).click();
    await page.getByRole("heading", { name: `${name} · engineering revision 3` }).waitFor({ timeout: 30000 });
    console.log(JSON.stringify({ step: "design_material_correction_ui", package: name, revision: 3 }));
  }
  await context.close();
} finally { await browser.close(); }
