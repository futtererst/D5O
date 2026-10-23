import { readFileSync } from "node:fs";
import { chromium } from "playwright";

if (process.env.D5O_ISOLATED_PILOT !== "1" || !process.env.D5O_PILOT_CREDENTIALS_FILE)
  throw new Error("disposable_pilot_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const partial = process.env.D5O_SERVICE_VARIANT === "partial";
if (process.env.D5O_SERVICE_VARIANT && !partial) throw new Error("unsupported_service_variant");
const supervisor = users.find((item) => item.key === "supervisor");
const origin = process.env.D5O_PILOT_ORIGIN || "http://127.0.0.1:61641";
const child = partial ? "rybex-a11c09e603a248359205ec84f0af4ae8" : "rybex-d910a2a58a9c46038fb459436e1839c3";
const target = `${origin}/work?workspace=rybex&view=record&section=Deploy&record=${child}`;
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("response", async (response) => { if (response.url().includes("prototype-deploy-command") && response.request().method() === "POST") { const body = await response.json().catch(() => ({})); console.log(JSON.stringify({ deployResponse: response.status(), error: body.error, message: body.message })); } });
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent(target.slice(origin.length))}`);
  await page.locator('input[name="email"]').fill(supervisor.email);
  await page.locator('input[name="password"]').fill(supervisor.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.getByRole("heading", { name: "Deliver and verify the released work" }).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Crew & readiness" }).click();
  const body = await page.locator("body").innerText();
  if (!body.includes("Ready for authorized start")) {
    console.log(JSON.stringify({ status: "blocked", text: body.slice(body.indexOf("Field readiness"), body.indexOf("Field readiness") + 1800) }));
    throw new Error("service_field_not_ready");
  }
  const start = page.locator('form:has(button:has-text("Authorize field start"))');
  if (await start.count()) {
    await start.locator('input[name="note"]').fill("Confirmed current accepted service basis, crew acknowledgment, access and safety controls.");
    await start.getByRole("button", { name: "Authorize field start" }).click();
    try { await page.getByText("Field start authorized").waitFor({ timeout: 30000 }); } catch (error) { console.log(JSON.stringify({ fieldText: (await page.locator("body").innerText()).slice(-4000) })); throw error; }
  }
  await page.reload();
  await page.getByText("Field start authorized").waitFor({ timeout: 30000 });
  console.log(JSON.stringify({ status: "service_field_start_authorized", workId: child }));
  await context.close();
} finally { await browser.close(); }
