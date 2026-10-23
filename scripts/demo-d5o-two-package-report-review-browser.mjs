import { readFileSync } from "node:fs";
import { chromium } from "playwright";
if (process.env.D5O_ISOLATED_PILOT !== "1" || process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:56621" || !process.env.D5O_PILOT_CREDENTIALS_FILE) throw new Error("fresh_disposable_pilot_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const origin = "http://127.0.0.1:61642", workId = "rybex-9e4f1e5f9e6b4e429142d3b01e1825e5";
const pairs = [
  ["North zone controls installation", "Fictional pilot North zone: five of ten control points installed", "synthetic-north-partial-controls.png"],
  ["North zone controls installation", "Fictional pilot North zone: final five control points installed", "synthetic-north-correction-controls.png"],
  ["South zone controls installation", "Fictional pilot South zone: ten control points installed", "synthetic-south-full-controls.png"]
];
const browser = await chromium.launch({ headless: true });
async function signIn(key) {
  const user = users.find((item) => item.key === key);
  const context = await browser.newContext(), page = await context.newPage();
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent(`/work?workspace=rybex&view=record&section=Deploy&record=${workId}`)}`);
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.getByRole("heading", { name: "Deliver and verify the released work" }).waitFor({ timeout: 30000 });
  return { context, page };
}
try {
  const supervisor = await signIn("supervisor");
  for (const [name, summary] of pairs) {
    await supervisor.page.getByRole("button", { name: new RegExp(name) }).click();
    await supervisor.page.getByRole("button", { name: "Field work" }).click();
    const report = supervisor.page.locator("article").filter({ hasText: summary }).last();
    const form = report.locator('form:has(button:has-text("Record independent review"))');
    if (!(await report.count())) throw new Error(`report_not_visible:${name}:${summary}`);
    if ((await report.innerText()).includes("Submitted") && !(await form.count())) throw new Error(`submitted_report_review_action_missing:${name}:${summary}`);
    if (await form.count()) {
      await form.locator('input[name="note"]').fill(`Fictional pilot: measured actuals and labor checked against ${name} crew record.`);
      await form.getByRole("button", { name: "Record independent review" }).click();
      await report.getByText(/Reviewed/).first().waitFor({ timeout: 30000 });
    }
    console.log(JSON.stringify({ step: "supervisor_report_review_ui", package: name }));
  }
  await supervisor.context.close();
  const quality = await signIn("quality");
  for (const [name, , filename] of pairs) {
    await quality.page.getByRole("button", { name: new RegExp(name) }).click();
    await quality.page.getByRole("button", { name: "Field work" }).click();
    const evidence = quality.page.locator("article").filter({ hasText: filename }).last();
    const form = evidence.locator('form:has(button:has-text("Record independent review"))');
    if (!(await evidence.count())) throw new Error(`evidence_not_visible:${name}:${filename}`);
    if (await form.count()) {
      await form.locator('input[name="note"]').fill(`Fictional pilot: inspected retained image and exact ${name} release link.`);
      await form.getByRole("button", { name: "Record independent review" }).click();
      await evidence.locator("strong", { hasText: "Reviewed" }).first().waitFor({ timeout: 30000 });
    }
    console.log(JSON.stringify({ step: "quality_image_review_ui", package: name }));
  }
  await quality.context.close();
} finally { await browser.close(); }
