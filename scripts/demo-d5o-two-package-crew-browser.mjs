import { readFileSync } from "node:fs";
import { chromium } from "playwright";
if (process.env.D5O_ISOLATED_PILOT !== "1" || process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:56621" || !process.env.D5O_PILOT_CREDENTIALS_FILE) throw new Error("fresh_disposable_pilot_only");
const user = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users.find((item) => item.key === "pm");
const origin = "http://127.0.0.1:61642";
const slots = [
  { package: "North zone controls installation", crew: "Fictional North controls crew", person: "Jordan Lee" },
  { package: "South zone controls installation", crew: "Fictional South controls crew", person: "Samira Khan" }
];
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext(), page = await context.newPage();
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent("/work?workspace=rybex&view=crew")}`);
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.getByRole("heading", { name: "Crew schedule", exact: true }).waitFor({ timeout: 30000 });
  for (const slot of slots) {
    let demand = page.locator('.d5o-demand-row').filter({ hasText: slot.package });
    for (let week = 0; week < 8 && !(await demand.count()) && !(await page.locator("body").innerText()).includes(slot.crew); week++) await page.getByRole("button", { name: "Next week" }).click();
    if (await demand.getByRole("button", { name: "Schedule crew" }).count()) {
      await demand.getByRole("button", { name: "Schedule crew" }).click();
      const dialog = page.getByRole("dialog", { name: "Schedule crew" });
      await dialog.getByLabel("Crew name").fill(slot.crew);
      await dialog.locator(`label:has-text("${slot.person}") input[type="checkbox"]`).check();
      await dialog.getByRole("button", { name: "Save crew assignment" }).click();
      try { await dialog.waitFor({ state: "hidden", timeout: 7000 }); }
      catch (error) { console.log(JSON.stringify({ bookingError: slot.package, dialog: (await dialog.innerText()).slice(-1900), notices: await page.locator('[role="status"], [role="alert"]').allTextContents() })); throw error; }
    }
    if (!(await page.locator("body").innerText()).includes(slot.crew)) throw new Error(`booking_not_visible:${slot.package}`);
    console.log(JSON.stringify({ step: "crew_booking_ui", package: slot.package, person: slot.person }));
  }
  await page.getByRole("button", { name: "Plan details" }).click();
  await page.getByRole("dialog", { name: "Plan overview" }).getByRole("button", { name: "Responses" }).click();
  const publication = page.getByRole("dialog", { name: "Worker responses" });
  if (await publication.getByRole("button", { name: "Publish this week's bookings" }).count()) {
    await publication.getByRole("button", { name: "Publish this week's bookings" }).click();
    await publication.getByText("Shared with workers").waitFor({ timeout: 30000 });
  }
  console.log(JSON.stringify({ step: "two_package_crew_publication_ui" }));
  await context.close();
} finally { await browser.close(); }
