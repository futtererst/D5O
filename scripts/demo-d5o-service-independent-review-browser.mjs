import { readFileSync } from "node:fs";
import { chromium } from "playwright";

if (process.env.D5O_ISOLATED_PILOT !== "1" || !process.env.D5O_PILOT_CREDENTIALS_FILE)
  throw new Error("disposable_pilot_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const partial = process.env.D5O_SERVICE_VARIANT === "partial";
const origin = process.env.D5O_PILOT_ORIGIN || "http://127.0.0.1:61641";
const child = partial ? "rybex-a11c09e603a248359205ec84f0af4ae8" : "rybex-d910a2a58a9c46038fb459436e1839c3";
const target = `${origin}/work?workspace=rybex&view=record&section=Deploy&record=${child}`;
const browser = await chromium.launch({ headless: true });
async function signIn(key) {
  const user = users.find((item) => item.key === key);
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent(target.slice(origin.length))}`);
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.getByRole("heading", { name: "Deliver and verify the released work" }).waitFor({ timeout: 30000 });
  return { context, page };
}
try {
  const supervisor = await signIn("supervisor");
  await supervisor.page.getByRole("button", { name: "Field work" }).click();
  const report = supervisor.page.locator(`article:has-text("${partial ? "FICTIONAL PILOT: inspected the existing monitoring route" : "Panel inspection and alarm inputs completed"}")`);
  const reviewForm = report.locator('form:has(button:has-text("Record independent review"))');
  if (await reviewForm.count()) {
    await reviewForm.locator('input[name="note"]').fill("Actual completed service visit and four labor hours checked against the crew record.");
    await reviewForm.getByRole("button", { name: "Record independent review" }).click();
    await report.getByText(/Reviewed/).waitFor({ timeout: 30000 });
  }
  await supervisor.context.close();

  const quality = await signIn("quality");
  await quality.page.getByRole("button", { name: "Field work" }).click();
  const evidence = quality.page.locator(`article:has-text("${partial ? "FICTIONAL-route-entry-diagnostic.png" : "synthetic-monitoring-panel.png"}")`);
  const evidenceForm = evidence.locator('form:has(button:has-text("Record independent review"))');
  if (await evidenceForm.count()) {
    await evidenceForm.locator('input[name="note"]').fill("Inspected synthetic pilot panel image and confirmed its package and revision link.");
    await evidenceForm.getByRole("button", { name: "Record independent review" }).click();
    await evidence.locator("strong", { hasText: "Reviewed" }).first().waitFor({ timeout: 30000 });
  }
  await quality.context.close();
  console.log(JSON.stringify({ status: "service_report_and_evidence_independently_reviewed", workId: child }));
} finally { await browser.close(); }
