import { readFileSync } from "node:fs";
import { chromium } from "playwright";
if (process.env.D5O_ISOLATED_PILOT !== "1" ||
  process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:56621" ||
  !process.env.D5O_PILOT_CREDENTIALS_FILE) throw new Error("fresh_disposable_pilot_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const workId = "rybex-9e4f1e5f9e6b4e429142d3b01e1825e5";
const browser = await chromium.launch({ headless: true });
async function signIn(key) {
  const user = users.find((item) => item.key === key);
  if (!user) throw new Error(`pilot_user_missing:${key}`);
  const context = await browser.newContext(); const page = await context.newPage();
  const path = `/work?workspace=rybex&view=develop&record=${workId}`;
  await page.goto(`http://127.0.0.1:61642/auth/sign-in?next=${encodeURIComponent(path)}`);
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.getByText("Rybex Delivery").first().waitFor({ timeout: 30000 });
  await page.getByText("Develop", { exact: true }).first().waitFor({ timeout: 30000 });
  return { context, page };
}
try {
  const { context, page } = await signIn("pm");
  await page.getByText("Build a credible solution and price").waitFor({ timeout: 30000 });
  const save = async (action) => {
    const response = page.waitForResponse((item) => item.request().method() === "POST" &&
      item.url().includes("/api/d5o-hosted/prototype-state") && !item.url().includes("pricing=1"), { timeout: 30000 });
    await action(); const result = await response;
    if (!result.ok()) throw new Error(`develop_draft_save:${result.status()}:${(await result.text()).slice(0,300)}`);
  };
  const current = async () => page.evaluate(async (id) => {
    const response = await fetch("/api/d5o-hosted/prototype-state?workspace=rybex&key=work");
    const payload = await response.json();
    return payload.state?.records?.find((item) => item.id === id);
  }, workId);
  await page.getByRole("button", { name: "Solution options", exact: true }).click();
  const addOption = async (name, status, rejection = "") => {
    const form = page.locator('form:has(button:has-text("Save option revision"))');
    if (!await form.isVisible()) await page.getByText("+ Add solution alternative").click();
    await form.locator('input[name="name"]').fill(name);
    await form.locator('textarea[name="approach"]').fill(status === "Viable" ?
      "Independent panel per zone, staged cutover and witnessed monitoring tests." :
      "Single shared controller for both zones, one outage window.");
    await form.locator('input[name="requirements"]').first().check();
    for (const [key, value] of Object.entries({ materials: "Two standard panels and sensors", resourceBasis: "Two qualified controls technicians and a lead", scheduleBasis: "Separate customer outage windows", safetyQuality: "Isolation and witnessed commissioning", risks: "Customer access window", evidence: "Fictional Define baseline and survey note", owner: "Pilot Project Manager" }))
      await form.locator(`input[name="${key}"]`).fill(value);
    await form.locator('select[name="status"]').selectOption(status);
    if (rejection) await form.locator('input[name="rejectionReason"]').fill(rejection);
    await save(() => form.getByRole("button", { name: "Save option revision" }).click());
  };
  if (!(await current())?.develop?.options?.length) {
    await addOption("Two-zone independent controls", "Viable");
    await addOption("Shared controller single cutover", "Rejected", "Requires one shared outage and weakens independent acceptance.");
  }
  if (!(await current())?.develop?.selectedOptionId) {
    const viable = page.locator('article:has(h4:has-text("Two-zone independent controls"))');
    await viable.getByRole("button", { name: "Edit" }).click();
    const optionForm = page.locator('form:has(button:has-text("Save option revision"))');
    for (const checkbox of await optionForm.locator('input[name="requirements"]').all()) await checkbox.check();
    await save(() => optionForm.getByRole("button", { name: "Save option revision" }).click());
    await page.getByPlaceholder("Why this option best meets the approved requirements").fill("Only the independent-zone option meets the confirmed requirement and permits partial release.");
    await save(() => viable.getByRole("button", { name: "Select with rationale" }).click());
  }
  await page.getByRole("button", { name: "Delivery strategy", exact: true }).click();
  if (!(await current())?.develop?.laborStrategy) {
    const strategy = page.locator('form:has(button:has-text("Save strategy revision"))');
    for (const [key, value] of Object.entries({ laborStrategy: "Two certified controls technicians, one lead, 80 planned hours per zone.", procurementStrategy: "Two panel kits sourced under pilot quoted rates; customer provides network access.", scheduleStrategy: "North then south; separate outage windows and customer witness.", safetyStrategy: "Isolation permits, escorted access and prestart briefing.", qualityStrategy: "Independent point tests, witnessed alarm tests, reviewed evidence.", riskMitigation: "Retain rollback route and contingency for changed access." }))
      await strategy.locator(`textarea[name="${key}"]`).fill(value);
    await strategy.locator('input[name="targetDate"]').fill("2026-11-20");
    await strategy.locator('input[name="designOwner"]').fill("Pilot Operations Reviewer");
    await save(() => strategy.getByRole("button", { name: "Save strategy revision" }).click());
  }
  console.log(JSON.stringify({ step: "develop_options_and_strategy_ui", revision: (await current())?.develop?.revision,
    selected: (await current())?.develop?.selectedOptionId, review: (await current())?.develop?.review }));
  if ((await current())?.develop?.review?.status !== "Approved" && (await current())?.develop?.review?.status !== "Submitted") {
    await page.getByLabel("Review due").fill("2026-10-21");
    const command = page.waitForResponse((item) => item.url().includes("/api/d5o-hosted/prototype-commercial-command") && item.request().method() === "POST", { timeout: 30000 });
    await page.getByRole("button", { name: "Submit solution" }).click();
    const response = await command;
    if (!response.ok()) throw new Error(`solution_submit:${response.status()}:${(await response.text()).slice(0,500)}`);
    await page.waitForFunction(async (id) => {
      const response = await fetch("/api/d5o-hosted/prototype-state?workspace=rybex&key=work");
      const payload = await response.json();
      return payload.state?.records?.find((item) => item.id === id)?.develop?.review?.status === "Submitted";
    }, workId, { timeout: 30000 });
  }
  await context.close();
  const reviewer = await signIn("operations");
  await reviewer.page.getByText("Build a credible solution and price").waitFor({ timeout: 30000 });
  if (await reviewer.page.getByRole("button", { name: "Approve solution" }).count()) {
    await reviewer.page.getByPlaceholder("Reason for approval or return").fill("Independent Operations review accepts the two-zone solution and staged delivery basis.");
    await reviewer.page.getByRole("button", { name: "Approve solution" }).click();
    await reviewer.page.waitForFunction(async (id) => {
      const response = await fetch("/api/d5o-hosted/prototype-state?workspace=rybex&key=work");
      const payload = await response.json();
      return payload.state?.records?.find((item) => item.id === id)?.develop?.review?.status === "Approved";
    }, workId, { timeout: 30000 });
  }
  await reviewer.page.reload();
  await reviewer.page.getByText("Build a credible solution and price").waitFor({ timeout: 30000 });
  console.log(JSON.stringify({ step: "develop_solution_independent_approval" }));
  await reviewer.context.close();
} finally { await browser.close(); }
