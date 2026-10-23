import { readFileSync } from "node:fs";
import { chromium } from "playwright";

if (process.env.D5O_ISOLATED_PILOT !== "1" || process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:56621" || !process.env.D5O_PILOT_CREDENTIALS_FILE) throw new Error("fresh_disposable_pilot_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const workId = "rybex-9e4f1e5f9e6b4e429142d3b01e1825e5";
const browser = await chromium.launch({ headless: true });
async function signIn(key) {
  const user = users.find((item) => item.key === key);
  const context = await browser.newContext(), page = await context.newPage();
  const path = `/work?workspace=rybex&view=develop&record=${workId}`;
  await page.goto(`http://127.0.0.1:61642/auth/sign-in?next=${encodeURIComponent(path)}`);
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.getByText("Build a credible solution and price").waitFor({ timeout: 30000 });
  return { context, page };
}
async function record(page) {
  return page.evaluate(async (id) => {
    const response = await fetch("/api/d5o-hosted/prototype-state?workspace=rybex&key=work");
    const payload = await response.json();
    return payload.state?.records?.find((item) => item.id === id);
  }, workId);
}
async function clickCommand(page, button) {
  const response = page.waitForResponse((item) => item.url().includes("/api/d5o-hosted/prototype-commercial-command") && item.request().method() === "POST", { timeout: 30000 });
  await button.click();
  const result = await response;
  if (!result.ok()) throw new Error(`commercial_command:${result.status()}:${(await result.text()).slice(0, 500)}`);
  await page.goto(`http://127.0.0.1:61642/work?workspace=rybex&view=develop&record=${workId}`);
  await page.getByText("Build a credible solution and price").waitFor({ timeout: 30000 });
}
async function clickDraft(page, button) {
  await button.click();
  await page.waitForFunction(async (id) => {
    const response = await fetch("/api/d5o-hosted/prototype-state?workspace=rybex&key=work");
    const payload = await response.json();
    return !!payload.state?.records?.find((item) => item.id === id)?.discovery?.proposal?.package;
  }, workId, { timeout: 30000 });
  await page.goto(`http://127.0.0.1:61642/work?workspace=rybex&view=develop&record=${workId}`);
  await page.getByText("Build a credible solution and price").waitFor({ timeout: 30000 });
}
try {
  const pm = await signIn("pm");
  let work = await record(pm.page);
  if (work.discovery.estimate.status === "Draft") {
    await pm.page.getByLabel("Pricing decision due date").fill("2026-10-20");
    console.log(JSON.stringify({ pricingBefore: { status: work.discovery.estimate.status, source: work.discovery.estimate.definitionSource, definition: work.definition?.revision, receipt: work.discovery.developHandoff?.status, buttonDisabled: await pm.page.getByRole("button", { name: /Submit revision 1 for pricing review/ }).isDisabled() } }));
    await clickCommand(pm.page, pm.page.getByRole("button", { name: /Submit revision 1 for pricing review/ }));
  }
  await pm.context.close();
  const operations = await signIn("operations");
  work = await record(operations.page);
  if (work.discovery.estimate.status === "Pricing review") {
    await operations.page.locator('article:has(h3:has-text("Cost, price and margin"))').getByLabel("Decision basis").fill("Fictional pilot: the two-zone labor and material cost basis is suitable for this controlled offer.");
    console.log(JSON.stringify({ approvalBefore: { source: work.discovery.estimate.definitionSource, definition: work.definition?.revision, receipt: work.definition?.developHandoff?.status, phaseConfig: work.phaseConfigurationVersionId, definitionConfig: work.definition?.configurationVersion, review: work.discovery.estimate.review, buttonDisabled: await operations.page.getByRole("button", { name: /Approve revision 1/ }).isDisabled(), sourceAlert: await operations.page.locator('[class*="sourceAlert"]').allTextContents() } }));
    await clickCommand(operations.page, operations.page.getByRole("button", { name: /Approve revision 1/ }));
  }
  await operations.context.close();
  const pm2 = await signIn("pm");
  work = await record(pm2.page);
  if (!work.discovery.proposal?.package) {
    const form = pm2.page.locator('form:has(button:has-text("Save proposal package"))');
    await form.locator('textarea[name="scope"]').fill("Deliver and verify separate North and South control-zone packages at the fictional Data Hall B site.");
    await form.locator('textarea[name="assumptions"]').fill("Fictional customer provides outage access and site escorts; the approved Define scope remains controlling.");
    await form.locator('textarea[name="exclusions"]').fill("Upstream utility equipment, unrelated facility controls and post-acceptance maintenance.");
    await form.locator('textarea[name="commercialTerms"]').fill("Fictional fixed-price offer in USD; acceptance per the approved Define criteria, subject to recorded customer award.");
    await clickDraft(pm2.page, form.getByRole("button", { name: "Save proposal package" }));
  }
  work = await record(pm2.page);
  if (work.discovery.proposal.status === "Draft") {
    await pm2.page.getByLabel("Internal approval due date").fill("2026-10-21");
    await clickCommand(pm2.page, pm2.page.getByRole("button", { name: "Request proposal approval" }));
  }
  await pm2.context.close();
  const operations2 = await signIn("operations");
  work = await record(operations2.page);
  if (work.discovery.proposal.status === "Internal review") {
    await operations2.page.getByLabel("Decision basis").last().fill("Fictional pilot: the scoped offer matches the approved estimate and Define baseline.");
    await clickCommand(operations2.page, operations2.page.getByRole("button", { name: /Approve proposal revision/ }));
  }
  await operations2.context.close();
  const pm3 = await signIn("pm");
  work = await record(pm3.page);
  if (work.discovery.proposal.status === "Approved") {
    const card = pm3.page.getByLabel("Customer submission details");
    await card.getByLabel("Customer recipient").fill("fictional.procurement@example.test");
    await card.getByLabel("Customer response due").fill("2026-10-25");
    await clickCommand(pm3.page, card.getByRole("button", { name: "Record customer submission" }));
  }
  work = await record(pm3.page);
  if (!work.discovery.outcome && work.discovery.proposal.status === "Submitted") {
    await pm3.page.getByRole("button", { name: "Record customer outcome" }).click();
    const dialog = pm3.page.getByRole("dialog");
    await dialog.locator('select[name="responseStatus"]').selectOption("Awarded");
    await dialog.locator('textarea[name="details"]').fill("Fictional pilot customer awarded the exact submitted two-zone offer.");
    await dialog.locator('input[name="sourceReference"]').fill("FICTIONAL-AWARD-NC-2026-01");
    await clickCommand(pm3.page, dialog.getByRole("button", { name: "Save customer response" }));
  }
  work = await record(pm3.page);
  if (work.discovery.outcome === "Won" && work.discovery.designHandoff?.status !== "submitted" && work.discovery.designHandoff?.status !== "accepted") {
    await pm3.page.getByRole("button", { name: "Prepare Design handoff" }).click();
    const dialog = pm3.page.getByRole("dialog");
    await dialog.locator('input[name="handoffDueDate"]').fill("2026-10-26");
    await clickCommand(pm3.page, dialog.getByRole("button", { name: "Submit Design handoff" }));
  }
  console.log(JSON.stringify({ step: "develop_offer_and_award_ui", estimate: work.discovery.estimate.status, proposal: work.discovery.proposal.status, outcome: work.discovery.outcome }));
  await pm3.context.close();
  const operations3 = await signIn("operations");
  work = await record(operations3.page);
  if (work.discovery.designHandoff?.status === "submitted") {
    await operations3.page.getByRole("button", { name: "Review Design handoff" }).click();
    const dialog = operations3.page.getByRole("dialog");
    await dialog.getByLabel("Receiver decision basis").fill("Fictional pilot: received the exact approved two-zone offer and Define scope for Design preparation.");
    await clickCommand(operations3.page, dialog.getByRole("button", { name: "Accept Design handoff" }));
  }
  work = await record(operations3.page);
  console.log(JSON.stringify({ step: "design_handoff_receipt_ui", handoff: work.discovery.designHandoff?.status, revision: work.discovery.designHandoff?.revision }));
  await operations3.context.close();
} finally { await browser.close(); }
