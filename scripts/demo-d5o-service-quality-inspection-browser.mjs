import { readFileSync } from "node:fs";
import { chromium } from "playwright";

if (process.env.D5O_ISOLATED_PILOT !== "1" || !process.env.D5O_PILOT_CREDENTIALS_FILE)
  throw new Error("disposable_pilot_only");
const mode = process.argv[2];
if (!new Set(["fail", "retest", "pass"]).has(mode)) throw new Error("inspection_mode_required");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const quality = users.find((item) => item.key === "quality");
const partial = process.env.D5O_SERVICE_VARIANT === "partial";
const origin = process.env.D5O_PILOT_ORIGIN || "http://127.0.0.1:61641";
const target = `${origin}/work?workspace=rybex&view=record&section=Deploy&record=${partial ? "rybex-a11c09e603a248359205ec84f0af4ae8" : "rybex-d910a2a58a9c46038fb459436e1839c3"}`;
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent(target.slice(origin.length))}`);
  await page.locator('input[name="email"]').fill(quality.email);
  await page.locator('input[name="password"]').fill(quality.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.getByRole("heading", { name: "Deliver and verify the released work" }).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Inspections & issues" }).click();
  const inspection = page.locator('article').filter({ has: page.locator('strong', {
    hasText: new RegExp(`${partial ? "Monitoring route fault located and fiber continuity confirmed" : "Alarm inputs report expected state"}.* · ${mode === "fail" ? "Fail" : "Pass"} · `)
  }) });
  const review = inspection.locator('form:has(button:has-text("Record quality review"))');
  if (await review.count()) {
    await review.locator('input[name="note"]').fill(partial
      ? "Independently verified fictional continuity reading, route-entry fault disposition, current release and linked evidence."
      : mode === "fail"
      ? "Initial failure verified; corrective work and passing retest required before completion."
      : "Corrected alarm input check passed against the exact current service release.");
    await review.getByRole("button", { name: "Record quality review" }).click();
    await inspection.locator('strong', { hasText: /Verified/ }).waitFor({ timeout: 30000 });
  }
  await page.getByRole("button", { name: "Field work" }).click();
  const completionButton = page.getByRole("button", { name: "Record reviewed completion" });
  if (mode === "fail" && !(await completionButton.isDisabled())) throw new Error("failed_inspection_did_not_block_completion");
  await page.reload();
  console.log(JSON.stringify({ status: mode === "fail" ? "failed_inspection_verified_completion_blocked" : mode === "pass" ? "passing_service_inspection_verified" : "passing_retest_verified", variant: partial ? "partially_covered" : "covered" }));
  await context.close();
} finally { await browser.close(); }
