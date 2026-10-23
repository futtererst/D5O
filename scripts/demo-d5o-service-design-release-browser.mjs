import { readFileSync } from "node:fs";
import { chromium } from "playwright";

if (process.env.D5O_ISOLATED_PILOT !== "1" || !process.env.D5O_PILOT_CREDENTIALS_FILE)
  throw new Error("disposable_pilot_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const partial = process.env.D5O_SERVICE_VARIANT === "partial";
if (process.env.D5O_SERVICE_VARIANT && !partial) throw new Error("unsupported_service_variant");
const actor = (key) => {
  const user = users.find((item) => item.key === key);
  if (!user) throw new Error(`pilot_actor_missing:${key}`);
  return user;
};
const origin = "http://127.0.0.1:61641";
const child = partial ? "rybex-a11c09e603a248359205ec84f0af4ae8" : "rybex-d910a2a58a9c46038fb459436e1839c3";
const documentTitle = partial ? "Monitoring route diagnostic and continuity test method" : "Covered monitoring inspection method and alarm test";
const target = `${origin}/work?workspace=rybex&view=record&section=Design&record=${child}`;
const date = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const browser = await chromium.launch({ headless: true });
async function signIn(key) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const user = actor(key);
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent(target.slice(origin.length))}`);
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.getByRole("heading", { name: "Receive the service execution basis" }).waitFor({ timeout: 30000 });
  return { context, page };
}
try {
  const pm = await signIn("pm");
  const page = pm.page;
  await page.getByRole("button", { name: "Documents", exact: true }).click();
  const document = page.locator("article").filter({ hasText: documentTitle });
  if (await document.getByRole("button", { name: "Submit review" }).count()) {
    await document.getByRole("button", { name: "Submit review" }).click();
    await document.getByRole("button", { name: "Approve revision" }).waitFor({ timeout: 30000 });
  }
  await page.getByRole("button", { name: "Packages", exact: true }).click();
  const demand = page.locator('form:has(button:has-text("Make schedulable"))');
  if (await demand.count()) {
    await demand.locator('input[name="requiredDate"]').fill(date(3));
    await demand.locator('select[name="qualification"]').selectOption({ label: "Controls service" });
    await demand.locator('input[name="minimumPeople"]').fill("1");
    await demand.locator('input[name="estimatedPersonHours"]').fill("8");
    await demand.getByRole("button", { name: "Make schedulable" }).click();
    await page.getByText("Schedulable").waitFor({ timeout: 30000 });
  }
  await page.reload();
  await page.getByRole("button", { name: "Reviews", exact: true }).click();
  const requestForm = page.locator('form:has(button:has-text("Request exact-revision review"))');
  for (const discipline of ["Engineering", "Delivery", "Safety", "Quality"]) {
    if ((await page.locator("body").innerText()).includes(`${discipline} · rev 1 · Requested`) ||
        (await page.locator("body").innerText()).includes(`${discipline} · rev 1 · Approved`)) continue;
    await requestForm.locator('select[name="discipline"]').selectOption(discipline);
    await requestForm.locator('input[name="dueDate"]').fill(date(2));
    await requestForm.getByRole("button", { name: "Request exact-revision review" }).click();
    try {
      await page.getByText(`${discipline} · rev 1 · Requested`).waitFor({ timeout: 5000 });
    } catch (error) {
      console.log(JSON.stringify({ failedAction: `request-${discipline}`, pageText: (await page.locator("body").innerText()).slice(-2500) }));
      throw error;
    }
  }
  await pm.context.close();

  const ops = await signIn("operations");
  await ops.page.getByRole("button", { name: "Documents", exact: true }).click();
  const opsDocument = ops.page.locator("article").filter({ hasText: documentTitle });
  if (await opsDocument.getByRole("button", { name: "Approve revision" }).count()) {
    await opsDocument.getByLabel("Document review rationale").fill("Reviewed the covered method and alarm test against the accepted service scope.");
    await opsDocument.getByRole("button", { name: "Approve revision" }).click();
    await opsDocument.getByRole("button", { name: "Issue for use" }).waitFor({ timeout: 30000 });
  }
  await ops.page.getByRole("button", { name: "Reviews", exact: true }).click();
  for (const discipline of ["Engineering", "Delivery", "Safety", "Quality"]) {
    const review = ops.page.locator(`article:has(strong:text-is("${discipline} · rev 1 · Requested"))`);
    if (!(await review.count())) continue;
    await review.getByLabel("Review rationale").fill(`${discipline} review accepts the recorded covered visit design and verification basis.`);
    await review.getByRole("button", { name: "Approve", exact: true }).click();
    await ops.page.getByText(`${discipline} · rev 1 · Approved`).waitFor({ timeout: 30000 });
  }
  await ops.context.close();

  const issuing = await signIn("pm");
  await issuing.page.getByRole("button", { name: "Documents", exact: true }).click();
  const issuedDocument = issuing.page.locator("article").filter({ hasText: documentTitle });
  if (await issuedDocument.getByRole("button", { name: "Issue for use" }).count()) {
    await issuedDocument.getByRole("button", { name: "Issue for use" }).click();
    await issuedDocument.getByRole("button", { name: "Use in package" }).waitFor({ timeout: 30000 });
  }
  await issuing.page.getByRole("button", { name: "Readiness & release" }).click();
  const body = await issuing.page.locator("body").innerText();
  if (!body.includes("Ready for release")) {
    console.log(JSON.stringify({ status: "blocked", findings: body.slice(body.indexOf("Deployment readiness"), body.indexOf("Release manifest")) }));
    throw new Error("service_design_release_not_ready");
  }
  const releaseForm = issuing.page.locator('form:has(button:has-text("Release this package to Deploy"))');
  if (await releaseForm.count()) {
    await releaseForm.locator('input[name="owner"]').fill("Operations receiving queue");
    await releaseForm.locator('input[name="due"]').fill(date(2));
    await releaseForm.getByRole("button", { name: "Release this package to Deploy" }).click();
    await issuing.page.getByText(/rev 1 · Awaiting receipt/).waitFor({ timeout: 30000 });
  }
  console.log(JSON.stringify({ status: "service_design_released", workId: child }));
  await issuing.context.close();
} finally {
  await browser.close();
}
