import { readFileSync } from "node:fs";
import { chromium } from "playwright";

if (process.env.D5O_ISOLATED_PILOT !== "1" || !process.env.D5O_PILOT_CREDENTIALS_FILE)
  throw new Error("disposable_pilot_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const partial = process.env.D5O_SERVICE_VARIANT === "partial";
if (process.env.D5O_SERVICE_VARIANT && !partial) throw new Error("unsupported_service_variant");
const crewName = partial ? "Synthetic partial monitoring crew" : "Synthetic controls service crew";
const worker = users.find((item) => item.key === (partial ? "southWorker" : "serviceWorker"));
const origin = "http://127.0.0.1:61641";
const target = `${origin}/work/my-schedule`;
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent(target.slice(origin.length))}`);
  await page.locator('input[name="email"]').fill(worker.email);
  await page.locator('input[name="password"]').fill(worker.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  try { await page.getByRole("heading", { name: "My schedule and assigned work" }).waitFor({ timeout: 8000 }); }
  catch (error) { console.log(JSON.stringify({ url: page.url(), text: (await page.locator("body").innerText()).slice(0, 1200) })); throw error; }
  const booking = page.locator("article").filter({ hasText: crewName });
  await booking.waitFor({ timeout: 30000 });
  if (await booking.getByRole("button", { name: "Accept booking" }).count()) {
    await booking.getByRole("button", { name: "Accept booking" }).click();
    await page.getByRole("dialog", { name: "Confirm schedule response" }).getByRole("button", { name: "Confirm response" }).click();
    await booking.getByText("Accepted by you").waitFor({ timeout: 30000 });
  }
  await page.reload();
  await booking.getByText("Accepted by you").waitFor({ timeout: 30000 });
  console.log(JSON.stringify({ status: "worker_acknowledged_service_booking", person: partial ? "Samira Khan" : "Jordan Lee" }));
  await context.close();
} finally { await browser.close(); }
