import { readFileSync } from "node:fs";
import { chromium } from "playwright";
if (process.env.D5O_ISOLATED_PILOT !== "1" || process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:56621" || !process.env.D5O_PILOT_CREDENTIALS_FILE) throw new Error("fresh_disposable_pilot_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const origin = "http://127.0.0.1:61642";
const browser = await chromium.launch({ headless: true });
try {
  for (const [key, crew] of [["serviceWorker", "Fictional North controls crew"], ["southWorker", "Fictional South controls crew"]]) {
    const user = users.find((item) => item.key === key);
    const context = await browser.newContext(), page = await context.newPage();
    await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent("/work/my-schedule")}`);
    await page.locator('input[name="email"]').fill(user.email);
    await page.locator('input[name="password"]').fill(user.password);
    await page.getByRole("button", { name: "Continue to your work" }).click();
    await page.getByRole("heading", { name: "My schedule and assigned work" }).waitFor({ timeout: 30000 });
    const booking = page.locator("article").filter({ hasText: crew });
    await booking.waitFor({ timeout: 30000 });
    if (await booking.getByRole("button", { name: "Accept booking" }).count()) {
      await booking.getByRole("button", { name: "Accept booking" }).click();
      await page.getByRole("dialog", { name: "Confirm schedule response" }).getByRole("button", { name: "Confirm response" }).click();
      await booking.getByText("Accepted by you").waitFor({ timeout: 30000 });
    }
    await page.reload();
    await booking.getByText("Accepted by you").waitFor({ timeout: 30000 });
    console.log(JSON.stringify({ step: "worker_acknowledgment_ui", worker: user.name, crew }));
    await context.close();
  }
} finally { await browser.close(); }
