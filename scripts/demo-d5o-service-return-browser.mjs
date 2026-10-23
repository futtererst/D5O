import { readFileSync } from "node:fs";
import { chromium } from "playwright";

if (process.env.D5O_ISOLATED_PILOT !== "1" || !process.env.D5O_PILOT_CREDENTIALS_FILE)
  throw new Error("disposable_pilot_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const partial = process.env.D5O_SERVICE_VARIANT === "partial";
const origin = process.env.D5O_PILOT_ORIGIN || "http://127.0.0.1:61641";
const target = `${origin}/work?workspace=rybex&view=record&section=Operate&record=rybex-a8fd95e7e20d4bb3881c3549459c99e0`;
const jobId = partial ? "43771fac-72f6-4449-ae9a-c9146e7651d9" : "9db34eeb-71e3-4d13-a3fe-68796189a419";
const child = partial ? "rybex-a11c09e603a248359205ec84f0af4ae8" : "rybex-d910a2a58a9c46038fb459436e1839c3";
const requestTitle = partial ? "Synthetic monitoring route fault" : "Synthetic covered monitoring inspection";
const browser = await chromium.launch({ headless: true });
async function signIn(key) {
  const user = users.find((item) => item.key === key);
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("response", async (response) => { if (response.url().includes("prototype-operate-command") && response.request().method() === "POST") { const body = await response.json().catch(() => ({})); console.log(JSON.stringify({ operateResponse:response.status(),error:body.error,message:body.message })); } });
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent(target.slice(origin.length))}`);
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.getByRole("button", { name: "Requests & jobs", exact: true }).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Requests & jobs", exact: true }).click();
  return { context, page };
}
try {
  const quality = await signIn("quality");
  const job = quality.page.locator(`article:has(b:has-text("${child}"))`);
  const link = job.getByRole("button", { name: "Link reviewed execution" });
  if (await link.count()) {
    await link.click();
    await quality.page.getByText(/Execution linked/).waitFor({ timeout: 10000 });
  }
  await quality.context.close();

  const operations = await signIn("operations");
  const completion = operations.page.locator(`article:has(b:has-text("${child}")) form:has(button:has-text("Complete service job"))`);
  if (await completion.count()) {
    await completion.locator('input[name="note"]').fill("Independently reviewed the accepted service completion and linked report evidence.");
    await completion.getByRole("button", { name: "Complete service job" }).click();
    await operations.page.getByText(/Completed/).waitFor({ timeout: 30000 });
  }
  await operations.context.close();

  const pm = await signIn("pm");
  const request = pm.page.locator(`article:has(b:has-text("${requestTitle}"))`);
  const resolution = request.locator('form:has(button:has-text("Record reviewed resolution"))');
  if (await resolution.count()) {
    await resolution.locator('input[name="resolution"]').fill(partial ? "FICTIONAL PILOT: monitoring route fault localized at obstructed entry; continuity confirmed within the authorized revised service visit." : "The monitored panel and alarm inputs were inspected, corrected and verified in the completed service visit.");
    await resolution.locator('input[name="reviewSource"]').fill(partial ? "Reviewed report d1be6c54-c47b-4f8f-bc67-64a11233eafe; verified inspection 1faf2db5-da62-4e81-9ea0-640d577e7202; accepted turnover ca7ce38d-400f-48ba-b1f3-bb926c114e57" : "SYNTHETIC PILOT reviewed service report and passing retest");
    await resolution.getByRole("button", { name: "Record reviewed resolution" }).click();
    await request.getByText(/Resolved/).waitFor({ timeout: 30000 });
  }
  await pm.context.close();

  const closer = await signIn("operations");
  const closedRequest = closer.page.locator(`article:has(b:has-text("${requestTitle}"))`);
  const close = closedRequest.locator('form:has(button:has-text("Close reviewed request"))');
  if (await close.count()) {
    await close.locator('input[name="note"]').fill("Operations independently closes the resolved synthetic service request after asset history review.");
    await close.getByRole("button", { name: "Close reviewed request" }).click();
    await closedRequest.getByText(/Closed/).waitFor({ timeout: 30000 });
  }
  await closer.page.reload();
  await closer.page.getByRole("button", { name: "Requests & jobs", exact: true }).click();
  if (!(await closer.page.locator("body").innerText()).includes(`${requestTitle} · Closed`))
    throw new Error("service_request_close_not_persisted");
  console.log(JSON.stringify({ status: "service_job_completed_request_closed", jobId, variant: partial ? "partially_covered" : "covered" }));
  await closer.context.close();
} finally { await browser.close(); }
