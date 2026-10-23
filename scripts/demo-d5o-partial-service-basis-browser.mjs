import { readFileSync } from "node:fs";
import { chromium } from "playwright";

if (process.env.D5O_ISOLATED_PILOT !== "1" || !process.env.D5O_PILOT_CREDENTIALS_FILE)
  throw new Error("disposable_pilot_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const origin = "http://127.0.0.1:61641";
const parent = "rybex-a8fd95e7e20d4bb3881c3549459c99e0";
const requestId = "abe94af3-bdc5-435b-b6ad-ca810293988e";
const browser = await chromium.launch({ headless: true });
async function signIn(key, record = parent, section = "Operate") {
  const user = users.find((item) => item.key === key);
  const context = await browser.newContext();
  const page = await context.newPage();
  const target = `/work?workspace=rybex&view=record&section=${section}&record=${record}`;
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent(target)}`);
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  return { context, page };
}
async function records(page) {
  return page.evaluate(async () => (await (await fetch("/api/d5o-hosted/prototype-state?workspace=rybex&key=work")).json()).state.records);
}
try {
  const pm = await signIn("pm");
  await pm.page.getByRole("button", { name: "Requests & jobs", exact: true }).click();
  const request = pm.page.locator('article:has(b:has-text("Synthetic monitoring route fault"))');
  const jobBefore = (await records(pm.page)).find((r) => r.id === parent).operate.requests.find((r) => r.id === requestId).currentCycleJobIds;
  if (!jobBefore.length) {
    const create = request.getByRole("button", { name: "Create linked service job" });
    if (await create.isDisabled()) throw new Error("priced_partial_job_creation_disabled");
    await create.click();
    await pm.page.getByText(/In progress/).first().waitFor({ timeout: 30000 });
  }
  const all = await records(pm.page);
  const source = all.find((r) => r.id === parent).operate;
  const requestState = source.requests.find((r) => r.id === requestId);
  const job = source.jobs.find((r) => r.id === requestState.currentCycleJobIds[0]);
  const child = all.find((r) => r.id === job.workId);
  if (!child || child.serviceSource.coverage !== "Partially covered" || child.serviceSource.pricing?.estimateRevision !== 1)
    throw new Error("partial_job_exact_price_missing");
  await pm.context.close();

  const manager = await signIn("pm", child.id, "Design");
  const basis = manager.page.locator('form:has(button:has-text("Save service basis draft"))');
  await basis.locator('input[name="serviceCategory"]').fill("Monitoring fault");
  await basis.locator('textarea[name="coveredScope"]').fill("Warranty inspection of the existing monitoring route and covered basic diagnostics.");
  await basis.locator('textarea[name="uncoveredScope"]').fill("Fiber continuity investigation for monitoring route");
  await basis.locator('textarea[name="scope"]').fill("Inspect the monitoring route, diagnose fiber continuity, and document the current fault disposition.");
  await basis.locator('textarea[name="exclusions"]').fill("No unrelated monitoring expansion or new equipment installation.");
  await basis.locator('textarea[name="coverageRationale"]').fill("Existing inspection is covered; four hours of fiber continuity investigation are separately priced and customer-authorized.");
  await basis.locator('textarea[name="completionCriteria"]').fill("Fault location is recorded and monitoring continuity is confirmed or a controlled corrective recommendation is returned.");
  await basis.locator('textarea[name="verification"]').fill("Document fiber continuity readings with independent quality review.");
  await basis.locator('input[name="safety"]').fill("Apply site electrical and fiber-handling controls.");
  await basis.locator('input[name="access"]').fill("Coordinate data-hall access with the site representative.");
  await basis.locator('input[name="resources"]').fill("Qualified fiber technician for four hours.");
  await basis.getByRole("button", { name: "Save service basis draft" }).click();
  await manager.page.getByText(/draft · revision 1/).waitFor({ timeout: 30000 });
  await manager.page.locator('input[name="reason"]').fill("Submit the exact partial-coverage and priced scope for independent receipt.");
  await manager.page.getByRole("button", { name: "Submit for Operations receipt" }).click();
  await manager.page.getByText(/submitted · revision 1/).waitFor({ timeout: 30000 });
  await manager.context.close();

  const reviewer = await signIn("operations", child.id, "Design");
  const review = reviewer.page.locator('form:has(button:has-text("Accept exact service basis"))');
  await review.locator('textarea[name="reason"]').fill("Independently accept exact covered and separately authorized uncovered scope for this request cycle.");
  await review.getByRole("button", { name: "Accept exact service basis" }).click();
  await reviewer.page.reload();
  const accepted = (await records(reviewer.page)).find((r) => r.id === child.id);
  if (accepted.serviceExecutionBasis?.status !== "accepted" || accepted.serviceExecutionBasis.brief.source.pricing?.estimateRevision !== "1")
    throw new Error("partial_basis_not_accepted_with_price");
  console.log(JSON.stringify({ status: "partial_service_basis_accepted", child: child.id, requestId }));
  await reviewer.context.close();
} finally { await browser.close(); }
