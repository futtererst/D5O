import { readFileSync } from "node:fs";
import { chromium } from "playwright";
if (process.env.D5O_ISOLATED_PILOT !== "1" || process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:56621" || !process.env.D5O_PILOT_CREDENTIALS_FILE) throw new Error("fresh_disposable_pilot_only");
const mode = process.argv[2];
const modes = {
  "north-fail": { package: "North zone controls installation", result: "Fail", marker: "FICTIONAL NORTH FAILED INITIAL ALARM TEST" },
  "north-retest": { package: "North zone controls installation", result: "Pass", marker: "FICTIONAL NORTH PASSING RETEST AFTER CORRECTION" },
  "north-second": { package: "North zone controls installation", result: "Pass", marker: "FICTIONAL NORTH SECOND REQUIREMENT PASS" },
  "south-second": { package: "South zone controls installation", result: "Pass", marker: "FICTIONAL SOUTH SECOND REQUIREMENT PASS" },
  "south-pass": { package: "South zone controls installation", result: "Pass", marker: "FICTIONAL SOUTH PASSING ACCEPTANCE TEST" }
};
const variant = modes[mode];
if (!variant) throw new Error("quality_mode_required");
const user = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users.find((item) => item.key === "quality");
const origin = "http://127.0.0.1:61642", workId = "rybex-9e4f1e5f9e6b4e429142d3b01e1825e5";
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext(), page = await context.newPage();
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent(`/work?workspace=rybex&view=record&section=Deploy&record=${workId}`)}`);
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.getByRole("heading", { name: "Deliver and verify the released work" }).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: new RegExp(variant.package) }).click();
  await page.getByRole("button", { name: "Inspections & issues" }).click();
  const inspection = page.locator("article").filter({ has: page.locator("strong", { hasText: new RegExp(`Ten installed control points respond.* · ${variant.result} · Submitted`) }) });
  const review = inspection.locator('form:has(button:has-text("Record quality review"))');
  if (await review.count()) {
    await review.locator('input[name="note"]').fill(mode === "north-fail" ? "Fictional pilot initial failure verified; corrective work and retest required." : "Fictional pilot passing test verified against the exact current release.");
    await review.getByRole("button", { name: "Record quality review" }).click();
    await page.locator("strong", { hasText: new RegExp(`Ten installed control points respond.* · ${variant.result} · Verified`) }).waitFor({ timeout: 30000 });
  }
  await page.getByRole("button", { name: "Field work" }).click();
  const completion = page.locator('article:has(h3:text-is("Reviewed package completion"))');
  const button = completion.getByRole("button", { name: "Record reviewed completion" });
  if (mode === "north-fail") {
    if (!(await button.isDisabled())) throw new Error("failed_inspection_did_not_block_completion");
    console.log(JSON.stringify({ step: "verified_failure_blocks_completion_ui", blocker: (await completion.innerText()).slice(0, 1100) }));
  } else console.log(JSON.stringify({ step: "passing_inspection_verified_ui", mode }));
  await context.close();
} finally { await browser.close(); }
