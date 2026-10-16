import { readFileSync } from "node:fs";
import { chromium } from "playwright";
if (process.env.D5O_COMMAND_RUNTIME !== "rehearsal" || process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:58221" || !process.env.D5O_PILOT_CREDENTIALS_FILE) throw new Error("disposable_pilot_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const workId = "rybex-f85daaed685f4b5b9e113b8a0f5cf33c", origin = "http://127.0.0.1:61643";
const browser = await chromium.launch({ headless: true });
async function signIn(key, path = `/work?workspace=rybex&view=develop&record=${workId}`) {
  const user = users.find((item) => item.key === key), context = await browser.newContext(), page = await context.newPage();
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent(path)}`);
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.waitForURL(/\/work\?workspace=rybex/, { timeout: 30000 });
  return { context, page };
}
const inspect = (page) => page.evaluate(async (id) => {
  const response = await fetch("/api/d5o-hosted/prototype-state?workspace=rybex&key=work"), payload = await response.json();
  const work = payload.state?.records?.find((item) => item.id === id);
  return { estimate: work?.discovery?.estimate, proposal: work?.discovery?.proposal };
}, workId);
try {
  const pm = await signIn("pm"), page = pm.page;
  const before = await inspect(page);
  console.log(JSON.stringify({ step: "before_review", status: before.estimate?.status, revision: before.estimate?.revision, buttons: (await page.locator("button").allInnerTexts()).filter((item) => /pricing|revision|estimate/i.test(item)).slice(0, 20) }));
  if (before.estimate?.status === "Draft") {
    await page.getByLabel("Pricing decision due date").fill("2026-10-21");
    const response = page.waitForResponse((item) => item.url().includes("/api/d5o-hosted/prototype-commercial-command") && item.request().method() === "POST", { timeout: 30000 });
    await page.getByRole("button", { name: /Submit revision 1 for pricing review/ }).click();
    const submitted = await response;
    console.log(JSON.stringify({ step: "submit_pricing", http: submitted.status(), response: (await submitted.text()).slice(0, 450) }));
  }
  await pm.context.close();
  const reviewer = await signIn("operations", `/work?workspace=rybex&view=my-work`), rp = reviewer.page;
  await rp.getByText("Loading workspace actions…").waitFor({ state: "hidden", timeout: 30000 });
  console.log(JSON.stringify({ step: "reviewer_queue", row: (await rp.locator("main").last().innerText()).slice(0, 1300) }));
  const task = rp.locator("a,button").filter({ hasText: /Pricing review/ }).filter({ hasText: /Data Center Inside Plant/ }).first();
  if (await task.count()) await task.click();
  console.log(JSON.stringify({ step: "reviewer_task", url: rp.url(), body: (await rp.locator("main").last().innerText()).slice(-1800) }));
  await rp.getByRole("link", { name: /Open exact task/ }).click();
  await rp.getByRole("button", { name: "Approve revision 1" }).waitFor({ timeout: 30000 });
  await rp.getByPlaceholder("Reason, conditions, or requested changes").fill("Independent commercial review accepts the exact Define, solution, coverage, four sourced lines and installation-effort scenarios; no award or final engineering approval.");
  const response = rp.waitForResponse((item) => item.url().includes("/api/d5o-hosted/prototype-commercial-command") && item.request().method() === "POST", { timeout: 30000 });
  await rp.getByRole("button", { name: "Approve revision 1" }).click();
  const approved = await response;
  const after = await inspect(rp);
  console.log(JSON.stringify({ step: "pricing_approved", http: approved.status(), response: (await approved.text()).slice(-650), status: after.estimate?.status, scenarios: after.estimate?.detailed?.romScenarios }));
  await reviewer.context.close();
} finally { await browser.close(); }
