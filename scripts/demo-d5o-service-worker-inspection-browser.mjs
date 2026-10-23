import { readFileSync } from "node:fs";
import { chromium } from "playwright";

if (process.env.D5O_ISOLATED_PILOT !== "1" || !process.env.D5O_PILOT_CREDENTIALS_FILE)
  throw new Error("disposable_pilot_only");
const mode = process.argv[2];
if (!new Set(["fail", "retest", "pass"]).has(mode)) throw new Error("inspection_mode_required");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const partial = process.env.D5O_SERVICE_VARIANT === "partial";
const worker = users.find((item) => item.key === (partial ? "southWorker" : "serviceWorker"));
const origin = process.env.D5O_PILOT_ORIGIN || "http://127.0.0.1:61641";
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent("/work/my-schedule")}`);
  await page.locator('input[name="email"]').fill(worker.email);
  await page.locator('input[name="password"]').fill(worker.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.locator(`article:has-text("${partial ? "Synthetic partial monitoring crew" : "Synthetic controls service crew"}")`).getByRole("link", { name: "Open assigned work" }).click();
  const inspection = page.locator('section:has(h2:text-is("Inspect and retest"))');
  await inspection.waitFor({ timeout: 30000 });
  const existing = await inspection.locator("article").allInnerTexts();
  const already = mode === "fail" ? existing.some((value) => value.includes("Fail")) : existing.some((value) => value.includes("Pass") && (mode === "pass" || value.includes("retest")));
  if (!already) {
    const form = inspection.locator("form");
    await form.locator('select[name="requirementId"]').selectOption("service-scope");
    await form.locator('input[name="requirement"]').fill(partial ? "Monitoring route fault located and fiber continuity confirmed" : "Alarm inputs report expected state after service inspection");
    await form.locator('input[name="method"]').fill(partial ? "FICTIONAL PILOT continuity measurement across the controlled route-entry diagnostic" : "Synthetic recorded input simulation and panel status check");
    await form.locator('select[name="result"]').selectOption(mode === "fail" ? "Fail" : "Pass");
    if (mode === "retest") {
      const failed = await form.locator('select[name="supersedesId"] option').last().getAttribute("value");
      if (!failed) throw new Error("failed_inspection_reference_missing");
      await form.locator('select[name="supersedesId"]').selectOption(failed);
    }
    await form.locator('textarea[name="note"]').fill(partial
      ? "FICTIONAL PILOT continuity reading 0.3 dB after safe access; fault at route entry recorded, no equipment replacement."
      : mode === "fail" ? "SYNTHETIC PILOT initial alarm input check did not return expected status; correction required."
      : "SYNTHETIC PILOT corrected terminal connection and repeated alarm input check successfully.");
    const evidence = form.locator('input[name="evidenceId"]');
    if (await evidence.count()) await evidence.first().check();
    await form.getByRole("button", { name: "Submit result for quality review" }).click();
    await inspection.getByText(mode === "fail" ? /Fail · Submitted/ : /Pass · Submitted/).waitFor({ timeout: 30000 });
  }
  await page.reload();
  await page.locator('section:has(h2:text-is("Inspect and retest"))').getByText(mode === "fail" ? /Fail · (Submitted|Verified)/ : /Pass · (Submitted|Verified)/).waitFor({ timeout: 30000 });
  console.log(JSON.stringify({ status: mode === "fail" ? "service_failed_inspection_recorded" : mode === "pass" ? "service_passing_inspection_recorded" : "service_passing_retest_recorded", variant: partial ? "partially_covered" : "covered" }));
  await context.close();
} finally { await browser.close(); }
