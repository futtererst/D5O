import { readFileSync } from "node:fs";
import { chromium } from "playwright";
const base = "http://127.0.0.1:61643", id = "rybex-d86cdd4cd0c04dea97da79c382cf790c";
const users = JSON.parse(readFileSync(process.env.TEMP + "/d5o-fresh-replay-final2-20261009/pilot/pilot-credentials.json", "utf8")).users;
const items = [
  { turnover: "6cca5386-2805-4482-ab91-4fd6d6879cfe", file: "north-as-built.pdf" },
  { turnover: "8a8fd746-0c2f-4039-b2a2-5feb177045ef", file: "south-as-built.pdf" }
];
if (process.env.D5O_RUN_FICTIONAL_SUPPORT_MUTATIONS !== "1") throw new Error("explicit_disposable_fixture_mutation_required");
const browser = await chromium.launch({ headless: true });
async function login(key) {
  const user = users.find((item) => item.key === key);
  const context = await browser.newContext(), page = await context.newPage();
  await page.goto(base + "/auth/sign-in?next=" + encodeURIComponent("/work?workspace=rybex&view=my-work"));
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.getByRole("heading", { name: "Actions requiring attention" }).waitFor({ timeout: 30000 });
  return { context, page };
}
function row(page, item) {
  return page.locator('section[aria-label="Accepted turnover documentation"] article')
    .filter({ hasText: item.turnover }).filter({ hasText: "As-built controls record" });
}
try {
  const pm = await login("pm");
  for (const item of items) {
    await pm.page.goto(base + "/work?workspace=rybex&view=record&record=" + id + "&section=Operate");
    await pm.page.getByRole("button", { name: "Handoff & activation" }).click();
    const target = row(pm.page, item);
    await target.locator('input[name="file"]').setInputFiles("output/pdf/d5o-fictional-support/" + item.file);
    await target.locator('input[name="note"]').fill("Correction review: index lacks actual route coordinates and physical label schedule.");
    const response = pm.page.waitForResponse((r) => r.url().includes("prototype-operate-command") && r.request().method() === "POST");
    await target.getByRole("button", { name: "Retain and submit document" }).click();
    if (!(await response).ok()) throw new Error("correction_submit_failed:" + item.file);
  }
  await pm.context.close();
  const quality = await login("quality");
  for (const item of items) {
    await quality.page.goto(base + "/work?workspace=rybex&view=my-work");
    const link = quality.page.locator('a[href*="focus=review-document"][href*="turnover=' +
      item.turnover + '"][href*="documentKind=as-built"]');
    await link.waitFor({ timeout: 30000 });
    await link.click();
    const target = row(quality.page, item);
    await target.locator('select[name="decision"]').selectOption("Returned");
    await target.locator('input[name="note"]').fill(
      "Index reviewed, but no actual installed route coordinates or physical label schedule is retained; as-built obligation remains outstanding.");
    const response = quality.page.waitForResponse((r) => r.url().includes("prototype-operate-command") && r.request().method() === "POST");
    await target.getByRole("button", { name: "Record independent review" }).click();
    if (!(await response).ok()) throw new Error("return_decision_failed:" + item.file);
  }
  await quality.page.goto(base + "/work?workspace=rybex&view=handoff");
  const board = await quality.page.locator("button").filter({ hasText: "Synthetic Production UI Command Trial F" }).first().innerText();
  if (!board.includes("Reviewed support documents: 2/4") ||
    !board.includes("assigned documentation remains outstanding"))
    throw new Error("truthful_obligation_projection_missing");
  await quality.context.close();
  console.log(JSON.stringify({ result: "as_built_correction_returned",
    reviewedInspectionRetention: 2, outstandingAsBuilt: 2 }));
} finally { await browser.close(); }
