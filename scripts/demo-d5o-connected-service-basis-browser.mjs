import { readFileSync } from "node:fs";
import { chromium } from "playwright";

if (process.env.D5O_ISOLATED_PILOT !== "1" || !process.env.D5O_PILOT_CREDENTIALS_FILE)
  throw new Error("disposable_pilot_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const base = "http://127.0.0.1:61641";
const child = "rybex-d910a2a58a9c46038fb459436e1839c3";
const path = `/work?workspace=rybex&view=record&section=Design&record=${child}`;
const browser = await chromium.launch({ headless: true });
async function signIn(key) {
  const identity = users.find((item) => item.key === key);
  if (!identity) throw new Error(`pilot_identity_missing:${key}`);
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${base}/auth/sign-in?next=${encodeURIComponent(path)}`);
  await page.locator('input[name="email"]').fill(identity.email);
  await page.locator('input[name="password"]').fill(identity.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.getByRole("heading", { name: "Receive the service execution basis" }).waitFor({ timeout: 30000 });
  return { context, page };
}
try {
  const pm = await signIn("pm");
  let body = await pm.page.locator("body").innerText();
  if (!body.includes("Synthetic covered monitoring inspection")) throw new Error("service_work_missing");
  const alreadyAccepted = body.includes("accepted · revision 1");
  if (!alreadyAccepted && !body.includes("Basis required")) throw new Error("basis_unexpectedly_exists");
  const response = await pm.page.evaluate(async () => {
    const result = await fetch("/api/d5o-hosted/prototype-state?workspace=rybex&key=work");
    return result.json();
  });
  const records = response.state?.records ?? [];
  const work = records.find((item) => item.id === child);
  const parent = records.find((item) => item.id === work?.serviceSource?.parentWorkId);
  const request = parent?.operate?.requests.find((item) => item.id === work?.serviceSource?.requestId);
  if (!request?.serviceCategory) throw new Error("service_category_unavailable");
  if (!alreadyAccepted) {
  await pm.page.locator('input[name="serviceCategory"]').fill(request.serviceCategory);
  await pm.page.locator('textarea[name="scope"]').fill("Inspect the covered monitoring panel, validate alarm reporting, and restore its documented operation.");
  await pm.page.locator('textarea[name="exclusions"]').fill("No replacement equipment or unrelated network modifications.");
  await pm.page.locator('textarea[name="coverageRationale"]').fill(`The approved service agreement covers ${request.serviceCategory} including labor, parts, and travel for this asset.`);
  await pm.page.locator('textarea[name="completionCriteria"]').fill("Panel reports normal status and all recorded alarm checks pass.");
  await pm.page.locator('textarea[name="verification"]').fill("Record alarm input tests, observed status, and an independent quality review.");
  await pm.page.locator('input[name="safety"]').fill("Isolate affected circuits under the site safety procedure.");
  await pm.page.locator('input[name="access"]').fill("Customer confirms data hall access before the visit.");
  await pm.page.locator('input[name="resources"]').fill("One qualified controls technician with test equipment.");
  await pm.page.getByRole("button", { name: "Save service basis draft" }).click();
  await pm.page.getByText("draft · revision 1").waitFor({ timeout: 30000 });
  await pm.page.locator('input[name="reason"]').fill("Submit the exact covered scope and verification plan for Operations review.");
  await pm.page.getByRole("button", { name: "Submit for Operations receipt" }).click();
  await pm.page.getByText("submitted · revision 1").waitFor({ timeout: 30000 });
  }
  await pm.context.close();

  const operations = await signIn("operations");
  if (!alreadyAccepted) {
    await operations.page.getByText("submitted · revision 1").waitFor({ timeout: 30000 });
  await operations.page.locator('textarea[name="reason"]').fill("Reviewed the current request, supported asset, agreement scope, exclusions, and independent verification requirements.");
  await operations.page.getByRole("button", { name: "Accept exact service basis" }).click();
  }
  await operations.page.getByText("accepted · revision 1").waitFor({ timeout: 30000 });
  await operations.page.reload();
  await operations.page.getByText("accepted · revision 1").waitFor({ timeout: 30000 });
  body = await operations.page.locator("body").innerText();
  if (!body.includes("Panel reports normal status") || !body.includes("Operations must accept") && !body.includes("accepted · revision 1"))
    throw new Error("accepted_basis_projection_missing");
  await operations.context.close();
  console.log(JSON.stringify({ status: "service_basis_accepted_in_separate_browsers", workId: child, revision: 1, performedNow: !alreadyAccepted }));
} finally { await browser.close(); }
