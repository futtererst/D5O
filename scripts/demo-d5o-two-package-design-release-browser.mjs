import { readFileSync } from "node:fs";
import { chromium } from "playwright";

if (process.env.D5O_ISOLATED_PILOT !== "1" || process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:56621" || !process.env.D5O_PILOT_CREDENTIALS_FILE) throw new Error("fresh_disposable_pilot_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const origin = "http://127.0.0.1:61642", workId = "rybex-9e4f1e5f9e6b4e429142d3b01e1825e5";
const path = `/work?workspace=rybex&view=record&section=Design&record=${workId}`;
const names = ["North zone controls installation", "South zone controls installation"];
const docs = ["North zone installation and test method", "South zone installation and test method"];
const date = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const browser = await chromium.launch({ headless: true });
async function signIn(key) {
  const user = users.find((item) => item.key === key);
  const context = await browser.newContext(), page = await context.newPage();
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent(path)}`);
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.getByRole("heading", { name: "Prepare executable work for release" }).waitFor({ timeout: 30000 });
  return { context, page };
}
async function tab(page, name) { await page.getByRole("button", { name, exact: true }).click(); }
async function select(page, name) { await tab(page, "Packages"); await page.getByRole("button", { name: new RegExp(name) }).click(); }
try {
  const pm = await signIn("pm");
  for (let index = 0; index < names.length; index++) {
    const page = pm.page;
    await select(page, names[index]);
    await tab(page, "Documents");
    const document = page.locator(`article:has-text("${docs[index]}")`);
    if (await document.getByRole("button", { name: "Submit review" }).count()) {
      await document.getByRole("button", { name: "Submit review" }).click();
      await document.getByRole("button", { name: "Approve revision" }).waitFor({ timeout: 30000 });
    }
    await select(page, names[index]);
    const demand = page.locator('.d5o-package-demand-card').filter({ hasText: names[index] }).locator('form:has(button:has-text("Make schedulable"))');
    if (await demand.count()) {
      await demand.locator('input[name="requiredDate"]').fill(date(3));
      await demand.locator('select[name="qualification"]').selectOption({ label: "Controls service" });
      await demand.locator('input[name="minimumPeople"]').fill("1");
      await demand.locator('input[name="estimatedPersonHours"]').fill("16");
      await demand.getByRole("button", { name: "Make schedulable" }).click();
      await page.locator('.d5o-package-demand-card').filter({ hasText: names[index] }).getByText("Schedulable", { exact: true }).waitFor({ timeout: 30000 });
    }
    const existingDemand = page.locator('.d5o-package-demand-card').filter({ hasText: names[index] }).locator('form:has(button:has-text("Save crew requirement"))');
    if (await existingDemand.count()) {
      const response = page.waitForResponse((item) => item.url().includes("prototype-design-command") && item.request().method() === "POST", { timeout: 30000 });
      await existingDemand.getByRole("button", { name: "Save crew requirement" }).click();
      const result = await response;
      if (!result.ok()) throw new Error(`crew_demand:${result.status()}:${(await result.text()).slice(0, 600)}`);
    }
    await tab(page, "Reviews");
    const request = page.locator('form:has(button:has-text("Request exact-revision review"))');
    for (const discipline of ["Engineering", "Delivery", "Safety", "Quality", "Procurement"]) {
      if ((await page.locator("body").innerText()).includes(`${discipline} · rev 3 · Requested`) || (await page.locator("body").innerText()).includes(`${discipline} · rev 3 · Approved`)) continue;
      await request.locator('select[name="discipline"]').selectOption(discipline);
      await request.locator('input[name="dueDate"]').fill(date(2));
      await request.getByRole("button", { name: "Request exact-revision review" }).click();
      await page.getByText(`${discipline} · rev 3 · Requested`).waitFor({ timeout: 30000 });
    }
  }
  await pm.context.close();
  const ops = await signIn("operations");
  for (let index = 0; index < names.length; index++) {
    const page = ops.page;
    await select(page, names[index]);
    await tab(page, "Documents");
    const document = page.locator(`article:has-text("${docs[index]}")`);
    if (await document.getByRole("button", { name: "Approve revision" }).count()) {
      await document.getByLabel("Document review rationale").fill("Fictional pilot: reviewed the zone method against the accepted scope and planned inspection.");
      await document.getByRole("button", { name: "Approve revision" }).click();
      await document.getByRole("button", { name: "Issue for use" }).waitFor({ timeout: 30000 });
    }
    await tab(page, "Reviews");
    for (const discipline of ["Engineering", "Delivery", "Safety", "Quality", "Procurement"]) {
      const review = page.locator(`article:has(strong:text-is("${discipline} · rev 3 · Requested"))`);
      if (!(await review.count())) continue;
      await review.getByLabel("Review rationale").fill(`Fictional pilot ${discipline} review accepts the exact zone design and verification basis.`);
      await review.getByRole("button", { name: "Approve", exact: true }).click();
      await page.getByText(`${discipline} · rev 3 · Approved`).waitFor({ timeout: 30000 });
    }
    console.log(JSON.stringify({ step: "design_independent_review_ui", package: names[index] }));
  }
  await ops.context.close();
  const issuing = await signIn("pm");
  for (let index = 0; index < names.length; index++) {
    const page = issuing.page;
    await select(page, names[index]);
    await tab(page, "Documents");
    const document = page.locator(`article:has-text("${docs[index]}")`);
    if (await document.getByRole("button", { name: "Issue for use" }).count()) {
      await document.getByRole("button", { name: "Issue for use" }).click();
      await document.getByRole("button", { name: "Use in package" }).waitFor({ timeout: 30000 });
    }
    await tab(page, "Readiness & release");
    const body = await page.locator("body").innerText();
    console.log(JSON.stringify({ step: "design_readiness_ui", package: names[index], ready: body.includes("Ready for release"), tail: body.slice(body.indexOf("Deployment readiness"), body.indexOf("Release manifest")).slice(0, 1500) }));
    const release = page.locator('form:has(button:has-text("Release this package to Deploy")), form:has(button:has-text("Release complete set to Deploy"))');
    if (await release.count()) {
      await release.locator('input[name="owner"]').fill("Fictional Operations receiving queue");
      await release.locator('input[name="due"]').fill(date(2));
      const response = page.waitForResponse((item) => item.url().includes("prototype-design-command") && item.request().method() === "POST", { timeout: 30000 });
      await release.locator("button").click();
      const result = await response;
      if (!result.ok()) throw new Error(`design_release:${result.status()}:${(await result.text()).slice(0, 900)}`);
      await page.getByText(/rev 3 · Awaiting receipt/).first().waitFor({ timeout: 30000 });
      console.log(JSON.stringify({ step: "design_release_ui", package: names[index] }));
    }
  }
  await issuing.context.close();
} finally { await browser.close(); }
