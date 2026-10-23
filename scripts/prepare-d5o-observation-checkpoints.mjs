import { readFileSync } from "node:fs";
import { chromium } from "playwright";

if (process.env.D5O_PREPARE_DISPOSABLE_OBSERVATION !== "1")
  throw new Error("explicit_disposable_observation_setup_required");
const mode = process.env.D5O_OBSERVATION_MODE;
const base = mode === "delivery" ? "http://127.0.0.1:61644" : mode === "support" ? "http://127.0.0.1:61645" : "";
const file = process.env.D5O_PILOT_CREDENTIALS_FILE;
if (!base || !file) throw new Error("observation_target_required");
const users = JSON.parse(readFileSync(file, "utf8")).users;
const workId = "rybex-d86cdd4cd0c04dea97da79c382cf790c";
const north = "wp-989231723062487086804222d598b91f";
const northTurnover = "6cca5386-2805-4482-ab91-4fd6d6879cfe";
const browser = await chromium.launch({ headless: true });
async function login(key, next) {
  const user = users.find((item) => item.key === key);
  if (!user) throw new Error(`missing_fictional_account:${key}`);
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${base}/auth/sign-in?next=${encodeURIComponent(next)}`);
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.waitForURL((url) => !url.pathname.includes("sign-in"), { timeout: 30000, waitUntil: "domcontentloaded" });
  return { context, page };
}
async function committed(page, label, path, click) {
  const pending = page.waitForResponse((response) => response.url().includes(path) && response.request().method() === "POST");
  await click();
  const response = await pending;
  if (!response.ok()) throw new Error(`${label}:${response.status()}:${await response.text()}`);
  return response.json();
}
try {
  if (mode === "delivery") {
    const { context, page } = await login("worker", "/work/my-schedule");
    await page.getByText("Loading your schedule…").waitFor({ state: "hidden", timeout: 30000 });
    const field = page.locator('a[href*="booking=crew-rybex-7"]');
    await field.click();
    await page.getByRole("heading", { name: "Report work performed" }).waitFor({ timeout: 30000 });
    if (!(await page.locator("body").innerText()).includes("Authorized start")) throw new Error("current_field_authorization_missing");
    const form = page.getByRole("heading", { name: "Report work performed" }).locator("..").locator("form");
    await form.locator('input[name="quantity"]').fill("0");
    await form.locator('input[name="unit"]').fill("control points");
    await form.locator('input[name="laborHours"]').fill("0.5");
    await form.locator('textarea[name="summary"]').fill("Fictional follow-up observation: alarm point did not respond on repeat check. No additional installed quantity claimed.");
    await committed(page, "save_report", "/api/d5o-hosted/worker-deploy", () => form.getByRole("button", { name: "Synchronize report" }).click());
    const report = page.getByRole("heading", { name: "My reports" }).locator("..").locator("article").filter({ hasText: "Fictional follow-up observation" });
    await committed(page, "submit_report", "/api/d5o-hosted/worker-deploy", () => report.getByRole("button", { name: "Submit for supervisor review" }).click());
    const inspection = page.getByRole("heading", { name: "Inspect and retest" }).locator("..").locator("form");
    await inspection.locator('select[name="requirementId"]').selectOption({ index: 1 });
    await inspection.locator('input[name="requirement"]').fill("Fictional alarm response must pass the released inspection requirement");
    await inspection.locator('input[name="method"]').fill("Repeat alarm point simulation against accepted North release");
    await inspection.locator('select[name="result"]').selectOption("Fail");
    await inspection.locator('textarea[name="note"]').fill("Fictional failed inspection for observed reviewer task; corrective retest has not been recorded.");
    const response = await committed(page, "failed_inspection", "/api/d5o-hosted/worker-deploy", () =>
      inspection.getByRole("button", { name: "Submit result for quality review" }).click());
    const work = response.state.records.find((item) => item.id === workId);
    const reports = work.deploy.reports.filter((item) => item.packageId === north && item.summary?.includes("Fictional follow-up observation"));
    const inspections = work.deploy.inspections.filter((item) => item.packageId === north && item.note?.includes("Fictional failed inspection"));
    if (reports.length !== 1 || reports[0].status !== "Submitted" || inspections.length !== 1 || inspections[0].result !== "Fail" || inspections[0].status !== "Submitted")
      throw new Error("delivery_pending_fixture_mismatch");
    console.log(JSON.stringify({ result: "delivery_observation_prepared", workId, packageId: north,
      reportId: reports[0].id, reportStatus: reports[0].status, inspectionId: inspections[0].id,
      inspectionResult: inspections[0].result, inspectionStatus: inspections[0].status }));
    await context.close();
  } else {
    const { context, page } = await login("pm", "/work?workspace=rybex&view=my-work");
    await page.getByRole("heading", { name: "Actions requiring attention" }).waitFor({ timeout: 30000 });
    const link = page.locator('a[href*="focus=supply-document"][href*="turnover=' + northTurnover + '"][href*="documentKind=as-built"]');
    await link.waitFor({ timeout: 30000 });
    await link.click();
    const target = page.locator('section[aria-label="Accepted turnover documentation"] article')
      .filter({ hasText: northTurnover }).filter({ hasText: "As-built controls record" });
    await target.locator('input[name="file"]').setInputFiles("output/pdf/d5o-fictional-support/north-as-built.pdf");
    await target.locator('input[name="note"]').fill("Fictional replacement index supplied for user observation; actual route coordinates and physical label schedule remain absent.");
    const response = await committed(page, "replacement_document", "/api/d5o-hosted/prototype-operate-command", () =>
      target.getByRole("button", { name: "Retain and submit document" }).click());
    const work = response.state.records.find((item) => item.id === workId);
    const current = work.operate.documentationObligations.filter((item) => item.turnoverId === northTurnover && item.kind === "as-built").at(-1);
    if (current?.status !== "Submitted") throw new Error("support_pending_fixture_mismatch");
    console.log(JSON.stringify({ result: "support_observation_prepared", workId, turnoverId: northTurnover,
      documentId: current.id, status: current.status, previousId: current.supersedesId }));
    await context.close();
  }
} finally { await browser.close(); }
