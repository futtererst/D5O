import { readFileSync } from "node:fs";
import { chromium } from "playwright";

if (process.env.D5O_ISOLATED_PILOT !== "1" || process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:56621" || !process.env.D5O_PILOT_CREDENTIALS_FILE) throw new Error("fresh_disposable_pilot_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const origin = "http://127.0.0.1:61642";
const workId = "rybex-9e4f1e5f9e6b4e429142d3b01e1825e5";
const path = `/work?workspace=rybex&view=record&section=Design&record=${workId}`;
const names = ["North zone controls installation", "South zone controls installation"];
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
  const pm = await signIn("pm"), page = pm.page;
  for (const name of names) {
    await tab(page, "Packages");
    if (!(await page.locator("body").innerText()).includes(name)) {
      await page.locator('input[name="package"]').fill(name);
      await page.getByRole("button", { name: "Create shared package" }).click();
      await page.getByRole("button", { name: new RegExp(name) }).waitFor({ timeout: 30000 });
    }
  }
  for (let index = 0; index < names.length; index++) {
    const name = names[index], doc = `${index ? "South" : "North"} zone installation and test method`;
    await select(page, name);
    await tab(page, "Documents");
    if (!(await page.locator("body").innerText()).includes(doc)) {
      const form = page.locator('form:has(button:has-text("Save draft for selected package"))');
      await form.locator('select[name="type"]').selectOption("Method of procedure");
      await form.locator('input[name="title"]').fill(doc);
      await form.locator('input[name="source"]').fill(`SYNTHETIC-PILOT-NC-${index + 1}-MOP-001`);
      const refs = await form.locator('select[name="requirements"] option').evaluateAll((options) => options.map((item) => item.value));
      if (refs.length) await form.locator('select[name="requirements"]').selectOption(refs);
      await form.locator('input[name="due"]').fill(date(2));
      await form.getByRole("button", { name: "Save draft for selected package" }).click();
      await page.getByText(`${doc} · rev 1`).waitFor({ timeout: 30000 });
    }
    await select(page, name);
    const form = page.locator('form:has(button:has-text("Save new design revision"))');
    if (await form.count() !== 1) throw new Error(`design_form_missing:${name}`);
    await form.locator('textarea[name="scope"]').fill(`Install and independently verify the ${index ? "South" : "North"} controls zone against the accepted two-zone delivery scope.`);
    await form.locator('input[name="location"]').fill(`Data Hall B ${index ? "South" : "North"} zone`);
    await form.locator('input[name="systems"]').fill("Control panel, sensors and alarm interface");
    const reqs = await form.locator('select[name="requirementIds"] option').evaluateAll((options) => options.map((item) => item.value));
    if (reqs.length) await form.locator('select[name="requirementIds"]').selectOption(reqs);
    const docRefs = await form.locator('select[name="documentRefs"] option').evaluateAll((options) => options.map((item) => item.value));
    if (!docRefs.length) throw new Error(`document_reference_missing:${name}`);
    await form.locator('select[name="documentRefs"]').selectOption(docRefs);
    await form.locator('input[name="plannedQuantity"]').fill("10");
    await form.locator('input[name="plannedUnit"]').fill("control points");
    await form.locator('select[name="materialStatus"]').selectOption("Available");
    await form.locator('input[name="materialSource"]').fill("Fictional pilot stock confirmation NC-2026-01");
    await form.locator('input[name="access"]').fill("Customer-approved Data Hall B outage window");
    await form.locator('input[name="permit"]').fill("Fictional site access permit confirmed");
    await form.locator('textarea[name="safetyControls"]').fill("Site briefing, energized-circuit check and controlled isolation");
    await form.locator('input[name="equipment"]').fill("Calibrated meter and certified access equipment");
    await form.locator('textarea[name="method"]').fill(`Install and test ten ${index ? "South" : "North"} zone control points, record every measured result.`);
    await form.locator('textarea[name="rollback"]').fill("Restore original control state and notify site operator on failed checks");
    await form.locator('textarea[name="verification"]').fill("Independent inspection of installed points and alarm functionality");
    await form.locator('input[name="proof"]').fill("Timestamped images and signed inspection results");
    await form.locator('input[name="acceptingAuthority"]').fill("Fictional customer site representative");
    await form.locator('input[name="windowStart"]').fill(date(3));
    await form.locator('input[name="windowEnd"]').fill(date(6));
    await form.locator('input[name="targetReleaseDate"]').fill(date(2));
    await form.getByRole("button", { name: "Save new design revision" }).click();
    await page.getByRole("heading", { name: `${name} · engineering revision 1` }).waitFor({ timeout: 30000 });
    console.log(JSON.stringify({ step: "design_package_draft_ui", package: name }));
  }
  await pm.context.close();
} finally { await browser.close(); }
