import { readFileSync } from "node:fs";
import { chromium } from "playwright";
if (process.env.D5O_ISOLATED_PILOT !== "1" || process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:56621" ||
  !process.env.D5O_PILOT_CREDENTIALS_FILE) throw new Error("fresh_disposable_pilot_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const admin = users.find((item) => item.key === "admin");
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext(), page = await context.newPage();
  const path = "/work?workspace=rybex&view=develop&record=rybex-9e4f1e5f9e6b4e429142d3b01e1825e5";
  await page.goto(`http://127.0.0.1:61642/auth/sign-in?next=${encodeURIComponent(path)}`);
  await page.locator('input[name="email"]').fill(admin.email);
  await page.locator('input[name="password"]').fill(admin.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  const policy = page.getByRole("group", { name: "Tenant pricing configuration" });
  await policy.waitFor({ timeout: 30000 });
  await policy.locator("summary").click();
  if (await policy.getByRole("button", { name: "Create draft policy" }).count()) {
    await policy.getByRole("button", { name: "Create draft policy" }).click();
    const rate = policy.locator('form:has(button:has-text("Add rate to draft"))');
    await rate.locator('input[name="id"]').fill("pilot-controls-labor-hour");
    await rate.locator('input[name="label"]').fill("Pilot controls technician hour");
    await rate.locator('input[name="unit"]').fill("hour");
    await rate.locator('input[name="amount"]').fill("80");
    await rate.locator('input[name="source"]').fill("Fictional internal cost catalog 2026-10-09");
    await rate.locator('input[name="burdenPercent"]').fill("20");
    await rate.getByRole("button", { name: "Add rate to draft" }).click();
    const draft = policy.locator('form:has(button:has-text("Save draft and rate catalog"))');
    await draft.locator('input[name="name"]').fill("Fictional Rybex controls delivery policy");
    await draft.locator('input[name="targetMarginPercent"]').fill("30");
    await draft.locator('input[name="floorMarginPercent"]').fill("20");
    await draft.locator('input[name="overheadPercent"]').fill("10");
    await draft.locator('input[name="contingencyPercent"]').fill("5");
    await draft.locator('input[name="maxDiscountPercent"]').fill("5");
    await draft.getByRole("button", { name: "Save draft and rate catalog" }).click();
    await policy.getByRole("button", { name: "Validate & publish" }).waitFor({ timeout: 30000 });
  }
  await policy.getByRole("button", { name: "Validate & publish" }).click();
  await policy.getByRole("button", { name: "Activate" }).waitFor({ timeout: 30000 });
  await policy.getByRole("button", { name: "Activate" }).click();
  await policy.getByText(/Active policy v1/).waitFor({ timeout: 30000 });
  await page.reload();
  await policy.waitFor({ timeout: 30000 });
  console.log(JSON.stringify({ step: "admin_published_pricing_policy", active: await policy.locator("summary").innerText() }));
  await context.close();
} finally { await browser.close(); }
