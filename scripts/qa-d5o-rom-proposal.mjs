import { readFileSync } from "node:fs";
import { chromium } from "playwright";

if (process.env.D5O_COMMAND_RUNTIME !== "rehearsal" || process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:58221" || !process.env.D5O_PILOT_CREDENTIALS_FILE) throw new Error("fresh_disposable_pilot_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const workId = "rybex-f85daaed685f4b5b9e113b8a0f5cf33c";
const browser = await chromium.launch({ headless: true });
async function signIn(key) {
  const user = users.find((item) => item.key === key);
  const context = await browser.newContext(), page = await context.newPage();
  const path = `/work?workspace=rybex&view=develop&record=${workId}`;
  await page.goto(`http://127.0.0.1:61643/auth/sign-in?next=${encodeURIComponent(path)}`);
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.waitForURL(/\/work\?workspace=rybex/, { timeout: 30000 });
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
  await page.goto(`http://127.0.0.1:61643/work?workspace=rybex&view=develop&record=${workId}`);
  await page.waitForURL(/\/work\?workspace=rybex/, { timeout: 30000 });
}
async function clickDraft(page, button) {
  await button.click();
  await page.waitForFunction(async (id) => {
    const response = await fetch("/api/d5o-hosted/prototype-state?workspace=rybex&key=work");
    const payload = await response.json();
    return !!payload.state?.records?.find((item) => item.id === id)?.discovery?.proposal?.package;
  }, workId, { timeout: 30000 });
  await page.goto(`http://127.0.0.1:61643/work?workspace=rybex&view=develop&record=${workId}`);
  await page.waitForURL(/\/work\?workspace=rybex/, { timeout: 30000 });
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
  await operations.page.getByText("Loading workspace actions").waitFor({ state: "hidden", timeout: 30000 });
  work = await record(operations.page);
  console.log(JSON.stringify({ pricingQueue: (await operations.page.locator("main").last().innerText()).slice(-3500), estimateStatus: work.discovery.estimate.status }));
  if (work.discovery.estimate.status === "Pricing review") {
    await operations.page.getByRole("button", { name: /Pricing review.*FICTIONAL · Data Center Inside Plant/ }).click();
    await operations.page.getByText("Open exact task →").click();
    await operations.page.getByLabel("Decision basis").waitFor({ timeout: 30000 });
    await operations.page.getByLabel("Decision basis").fill("Fictional pilot: the sourced fiber and copper labor and material cost basis is suitable for this controlled offer.");
    console.log(JSON.stringify({ approvalBefore: { source: work.discovery.estimate.definitionSource, definition: work.definition?.revision, receipt: work.definition?.developHandoff?.status, phaseConfig: work.phaseConfigurationVersionId, definitionConfig: work.definition?.configurationVersion, review: work.discovery.estimate.review, buttonDisabled: await operations.page.getByRole("button", { name: /Approve revision 1/ }).isDisabled(), sourceAlert: await operations.page.locator('[class*="sourceAlert"]').allTextContents() } }));
    await clickCommand(operations.page, operations.page.getByRole("button", { name: /Approve revision 1/ }));
  }
  await operations.context.close();
  const pm2 = await signIn("pm");
  work = await record(pm2.page);
  console.log(JSON.stringify({ commercialState: { estimateStatus: work.discovery.estimate.status, proposalStatus: work.discovery.proposal.status, proposalRevision: work.discovery.proposal.revision, solutionReview: work.develop?.review?.status }, pmPage: (await pm2.page.locator("main").last().innerText()).slice(-1600) }));
  if (!work.discovery.proposal?.package) {
    const form = pm2.page.locator('form:has(button:has-text("Save proposal package"))');
    await form.locator('textarea[name="scope"]').fill("Indicative 48-link Cat6A installation, witnessed certification, labels and as-built schedule; Design will confirm routes and final quantities.");
    await form.locator('textarea[name="assumptions"]').fill("48 links assumed; 1.5/2/3 person-hours per link scenarios. Fictional customer provides escorted access. Detailed Design will confirm routes and productivity.");
    await form.locator('textarea[name="exclusions"]').fill("Active network equipment and customer patching.");
    await form.locator('textarea[name="commercialTerms"]').fill("Indicative ROM only: USD 16,384 low / 18,880 base / 23,872 high. Review by 2026-11-16. No guaranteed price, delivery award or engineering release.");
    await clickDraft(pm2.page, form.getByRole("button", { name: "Save proposal package" }));
  }
  work = await record(pm2.page);
  if (work.discovery.proposal.status === "Draft") {
    await pm2.page.getByLabel("Internal approval due date").fill("2026-10-21");
    await clickCommand(pm2.page, pm2.page.getByRole("button", { name: "Request proposal approval" }));
    await pm2.page.waitForFunction(async (id) => {
      const payload = await fetch("/api/d5o-hosted/prototype-state?workspace=rybex&key=work").then((response) => response.json());
      return payload.state?.records?.find((item) => item.id === id)?.discovery?.proposal?.status === "Internal review";
    }, workId, { timeout: 30000 });
  }
  await pm2.context.close();
  const operations2 = await signIn("operations");
  work = await record(operations2.page);
  if (work.discovery.proposal.status === "Internal review") {
    await operations2.page.getByText("Loading workspace actions").waitFor({ state: "hidden", timeout: 30000 });
    await operations2.page.getByRole("button", { name: /Proposal approval.*FICTIONAL · Data Center Inside Plant/ }).click();
    await operations2.page.getByText("Open exact task →").click();
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
  console.log(JSON.stringify({ step: "rom_communicated", estimate: work.discovery.estimate.status, proposal: work.discovery.proposal.status, outcome: work.discovery.outcome }));
  await pm3.context.close();
} finally { await browser.close(); }
