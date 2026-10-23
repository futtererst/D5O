import { readFileSync } from "node:fs";
import { chromium } from "playwright";

if (process.env.D5O_ISOLATED_PILOT !== "1" || !process.env.D5O_PILOT_CREDENTIALS_FILE)
  throw new Error("disposable_pilot_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const partial = process.env.D5O_SERVICE_VARIANT === "partial";
if (process.env.D5O_SERVICE_VARIANT && !partial) throw new Error("unsupported_service_variant");
const packageName = partial ? "Partially covered monitoring route diagnostic" : "Covered monitoring inspection and alarm test";
const crewName = partial ? "Synthetic partial monitoring crew" : "Synthetic controls service crew";
const person = partial ? "Samira Khan" : "Jordan Lee";
const pm = users.find((item) => item.key === "pm");
const origin = "http://127.0.0.1:61641";
const target = `${origin}/work?workspace=rybex&view=crew`;
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent(target.slice(origin.length))}`);
  await page.locator('input[name="email"]').fill(pm.email);
  await page.locator('input[name="password"]').fill(pm.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.getByRole("heading", { name: "Crew schedule", exact: true }).waitFor({ timeout: 30000 });
  const demand = page.locator(".d5o-demand-row").filter({ hasText: packageName });
  for (let index = 0; index < 8 && !(await demand.count()) && !(await page.locator("body").innerText()).includes(crewName); index++)
    await page.getByRole("button", { name: "Next week" }).click();
  if (await demand.getByRole("button", { name: "Schedule crew" }).count()) {
    await demand.getByRole("button", { name: "Schedule crew" }).click();
    const dialog = page.getByRole("dialog", { name: "Schedule crew" });
    await dialog.getByLabel("Crew name").fill(crewName);
    if (await dialog.locator("label").filter({ hasText: person }).locator('input[type="checkbox"]').isDisabled()) throw new Error(`qualified_person_unavailable:${(await dialog.innerText()).slice(0, 2700)}`);
    await dialog.locator("label").filter({ hasText: person }).locator('input[type="checkbox"]').check();
    await dialog.getByRole("button", { name: "Save crew assignment" }).click();
    await dialog.waitFor({ state: "hidden", timeout: 30000 });
  }
  await page.reload();
  await page.getByRole("heading", { name: "Crew schedule", exact: true }).waitFor({ timeout: 30000 });
  for (let index = 0; index < 8 && !(await page.locator("body").innerText()).includes(crewName); index++)
    await page.getByRole("button", { name: "Next week" }).click();
  if (!(await page.locator("body").innerText()).includes(crewName))
    throw new Error("service_crew_booking_not_persisted");
  await page.getByRole("button", { name: "Plan details" }).click();
  const details = page.getByRole("dialog", { name: "Plan overview" });
  await details.getByRole("button", { name: "Responses" }).click();
  const publication = page.getByRole("dialog", { name: "Worker responses" });
  if (await publication.getByRole("button", { name: "Publish this week's bookings" }).count()) {
    await publication.getByRole("button", { name: "Publish this week's bookings" }).click();
    await publication.getByText("Shared with workers").waitFor({ timeout: 30000 });
  }
  console.log(JSON.stringify({ status: "service_crew_published", person }));
  await context.close();
} finally { await browser.close(); }
