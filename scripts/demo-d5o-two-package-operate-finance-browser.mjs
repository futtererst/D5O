import { readFileSync } from "node:fs";
import { chromium } from "playwright";

if (process.env.D5O_ISOLATED_PILOT !== "1" || process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:56621" || !process.env.D5O_PILOT_CREDENTIALS_FILE) throw new Error("fresh_disposable_pilot_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const origin = "http://127.0.0.1:61642";
const workId = "rybex-9e4f1e5f9e6b4e429142d3b01e1825e5";
const browser = await chromium.launch({ headless: true });
async function signIn(key) {
  const user = users.find((item) => item.key === key);
  const context = await browser.newContext(), page = await context.newPage();
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent(`/work?workspace=rybex&view=record&section=Operate&record=${workId}`)}`);
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.getByRole("heading", { name: "Keep accepted work working" }).waitFor({ timeout: 30000 });
  return { context, page };
}
async function submit(page, form, button) {
  const response = page.waitForResponse((item) => item.url().includes("prototype-operate-command") && item.request().method() === "POST", { timeout: 30000 });
  await form.getByRole("button", { name: button }).click();
  const result = await response;
  if (!result.ok()) throw new Error(`${button}:${result.status()}:${(await result.text()).slice(0, 700)}`);
}
try {
  const operations = await signIn("operations");
  await operations.page.getByRole("button", { name: "Handoff & activation", exact: true }).click();
  let form = operations.page.locator('form:has(button:has-text("Link accepted handoff"))');
  if (await form.count()) {
    await form.locator('input[name="note"]').fill("Independently linked the exact accepted two-package turnover and residual support scope.");
    await submit(operations.page, form, "Link accepted handoff");
    await form.waitFor({ state: "detached", timeout: 30000 });
  }
  console.log(JSON.stringify({ step: "accepted_delivery_linked_to_operate_ui" }));
  await operations.page.getByRole("button", { name: "Assets", exact: true }).click();
  form = operations.page.locator('form:has(button:has-text("Add linked asset"))');
  if (!(await operations.page.getByText("North Campus controls system", { exact: false }).count())) {
    await form.locator('input[name="name"]').fill("North Campus controls system");
    await form.locator('input[name="kind"]').fill("Data hall monitoring and controls infrastructure");
    await form.locator('input[name="location"]').fill("Fictional Data Hall B, north and south zones");
    await form.locator('input[name="owner"]').fill("Fictional Operations support team");
    await form.locator('input[name="documentation"]').fill("Exact accepted two-package turnover and verified controls inspections");
    await submit(operations.page, form, "Add linked asset");
    await operations.page.getByText("North Campus controls system", { exact: false }).first().waitFor({ timeout: 30000 });
  }
  await operations.page.getByRole("button", { name: "Handoff & activation", exact: true }).click();
  form = operations.page.locator('form:has(button:has-text("Accept support ownership"))');
  if (await form.count()) {
    for (const [name, value] of Object.entries({ customerContact: "Fictional Casey Customer", escalation: "Rybex Operations on-call lead", intakeRoute: "Rybex support desk", warrantyDisposition: "No warranty entitlement established in this pilot", serviceDisposition: "No paid service agreement established in this pilot", documentation: "Reviewed exact accepted two-package turnover and inspections", residualOwner: "Fictional Operations support team" })) await form.locator(`input[name="${name}"]`).fill(value);
    await submit(operations.page, form, "Accept support ownership");
    await form.waitFor({ state: "detached", timeout: 30000 });
  }
  const activate = operations.page.getByRole("button", { name: "Authorize support activation" });
  if (await activate.count()) {
    if (await activate.isDisabled()) throw new Error(`activation_blocked:${(await operations.page.locator("body").innerText()).slice(-1400)}`);
    const response = operations.page.waitForResponse((item) => item.url().includes("prototype-operate-command") && item.request().method() === "POST", { timeout: 30000 });
    await activate.click();
    const result = await response;
    if (!result.ok()) throw new Error(`activation:${result.status()}:${(await result.text()).slice(0, 700)}`);
    await operations.page.getByRole("button", { name: "Suspend support" }).waitFor({ timeout: 30000 });
  }
  await operations.page.reload();
  await operations.page.getByRole("heading", { name: "Keep accepted work working" }).waitFor({ timeout: 30000 });
  if (!(await operations.page.locator("body").innerText()).includes("Active")) throw new Error("support_activation_not_retained");
  console.log(JSON.stringify({ step: "support_activated_by_operations_with_finance_pending_ui" }));
  await operations.context.close();

  const finance = await signIn("finance");
  await finance.page.getByRole("button", { name: "Finance & lessons", exact: true }).click();
  form = finance.page.locator('form:has(button:has-text("Save Finance position"))');
  await form.locator('select[name="status"]').selectOption("Closed");
  await form.locator('input[name="note"]').fill("Fictional pilot Finance independently reviewed the two-package commercial closeout; no real invoice or cash assertion.");
  await submit(finance.page, form, "Save Finance position");
  await finance.page.reload();
  await finance.page.getByRole("button", { name: "Finance & lessons", exact: true }).click();
  if (!(await finance.page.locator("body").innerText()).includes("Fictional pilot Finance independently reviewed")) throw new Error("finance_closeout_not_retained");
  console.log(JSON.stringify({ step: "separate_finance_closeout_ui" }));
  await finance.context.close();
} finally { await browser.close(); }
