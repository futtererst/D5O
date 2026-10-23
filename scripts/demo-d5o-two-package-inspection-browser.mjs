import { readFileSync } from "node:fs";
import { chromium } from "playwright";
if (process.env.D5O_ISOLATED_PILOT !== "1" || process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:56621" || !process.env.D5O_PILOT_CREDENTIALS_FILE) throw new Error("fresh_disposable_pilot_only");
const mode = process.argv[2];
const modes = {
  "north-fail": { key: "serviceWorker", crew: "Fictional North controls crew", result: "Fail", marker: "FICTIONAL NORTH FAILED INITIAL ALARM TEST" },
  "north-retest": { key: "serviceWorker", crew: "Fictional North controls crew", result: "Pass", marker: "FICTIONAL NORTH PASSING RETEST AFTER CORRECTION" },
  "north-second": { key: "serviceWorker", crew: "Fictional North controls crew", result: "Pass", marker: "FICTIONAL NORTH SECOND REQUIREMENT PASS" },
  "south-second": { key: "southWorker", crew: "Fictional South controls crew", result: "Pass", marker: "FICTIONAL SOUTH SECOND REQUIREMENT PASS" },
  "south-pass": { key: "southWorker", crew: "Fictional South controls crew", result: "Pass", marker: "FICTIONAL SOUTH PASSING ACCEPTANCE TEST" }
};
const variant = modes[mode];
if (!variant) throw new Error("inspection_mode_required");
const user = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users.find((item) => item.key === variant.key);
const origin = "http://127.0.0.1:61642", browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext(), page = await context.newPage();
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent("/work/my-schedule")}`);
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.locator("article").filter({ hasText: variant.crew }).getByRole("link", { name: "Open assigned work" }).click();
  const inspection = page.locator('section:has(h2:text-is("Inspect and retest"))');
  await inspection.waitFor({ timeout: 30000 });
  if (!(await inspection.innerText()).includes(variant.marker)) {
    const form = inspection.locator("form");
    if (mode === "north-retest") {
      const latestReport = await form.locator('select[name="reportId"] option').last().getAttribute("value");
      if (latestReport) await form.locator('select[name="reportId"]').selectOption(latestReport);
    }
    const requirement = await form.locator('select[name="requirementId"] option').evaluateAll((options) => {
      const values = options.map((item) => item.value).filter(Boolean);
      return values[0];
    });
    const secondRequirement = mode.endsWith("second") ? await form.locator('select[name="requirementId"] option').last().getAttribute("value") : null;
    if (secondRequirement || requirement) await form.locator('select[name="requirementId"]').selectOption(secondRequirement || requirement);
    await form.locator('input[name="requirement"]').fill("Ten installed control points respond to the agreed alarm test");
    await form.locator('input[name="method"]').fill("Fictional pilot measured alarm input simulation and status check");
    await form.locator('select[name="result"]').selectOption(variant.result);
    if (mode === "north-retest") {
      const failed = await form.locator('select[name="supersedesId"] option').last().getAttribute("value");
      if (!failed) throw new Error("north_failed_inspection_reference_missing");
      await form.locator('select[name="supersedesId"]').selectOption(failed);
    }
    await form.locator('textarea[name="note"]').fill(variant.marker);
    const evidence = form.locator('input[name="evidenceId"]');
    if (await evidence.count()) await evidence.first().check();
    const response = page.waitForResponse((item) => item.url().includes("worker-deploy") && item.request().method() === "POST", { timeout: 30000 });
    await form.getByRole("button", { name: "Submit result for quality review" }).click();
    const result = await response;
    if (!result.ok()) console.log(JSON.stringify({ commandFailure: mode, status: result.status(), body: (await result.text()).slice(0, 700) }));
    try { await inspection.getByText(new RegExp(`${variant.result} · Submitted`)).last().waitFor({ timeout: 7000 }); }
    catch (error) { console.log(JSON.stringify({ inspectionError: mode, text: (await inspection.innerText()).slice(-2000), notices: await page.locator('[role="status"], [role="alert"]').allTextContents() })); throw error; }
  }
  await page.reload();
  await page.locator('section:has(h2:text-is("Inspect and retest"))').getByText(new RegExp(`${variant.result} · (Submitted|Verified)`)).last().waitFor({ timeout: 30000 });
  console.log(JSON.stringify({ step: "worker_inspection_ui", mode, worker: user.name }));
  await context.close();
} finally { await browser.close(); }
