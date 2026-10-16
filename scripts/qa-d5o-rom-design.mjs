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
  await page.getByText("Loading workspace actions…").waitFor({ state: "hidden", timeout: 30000 }).catch(() => undefined);
  return { context, page };
}
async function position(page) {
  return page.evaluate(async (id) => {
    const response = await fetch(`/api/d5o-hosted/rom-design?workspace=rybex&workId=${encodeURIComponent(id)}`);
    return { http: response.status, data: await response.json() };
  }, workId);
}
try {
  const pm = await signIn("pm"), p = pm.page;
  const panel = p.locator('section[aria-label="ROM communication and Design authorization"]');
  await panel.waitFor({ timeout: 30000 });
  console.log(JSON.stringify({ step: "before_ack", position: await position(p), panel: (await panel.innerText()).slice(0, 750) }));
  if ((await position(p)).data?.decisionRevision === 0) {
    const form = panel.locator('form:has(button:has-text("Record acknowledgment"))');
    await form.locator('[name="representative"]').fill("FICTIONAL · North Campus facilities director");
    await form.locator('[name="statement"]').fill("The indicative 48-link Cat6A ROM budget is acceptable for planning. Proceed with detailed Design assessment only; no delivery award or field authorization is given.");
    await form.locator('[name="source"]').fill("FICTIONAL-ROM-BUDGET-ACK-2026-10-16");
    const response = p.waitForResponse((item) => item.url().includes("/api/d5o-hosted/rom-design") && item.request().method() === "POST");
    await form.getByRole("button", { name: "Record acknowledgment" }).click();
    const result = await response;
    console.log(JSON.stringify({ step: "budget_ack", http: result.status(), result: (await result.text()).slice(0, 650) }));
  }
  await pm.context.close();
  const ops = await signIn("operations", "/work?workspace=rybex&view=my-work"), o = ops.page;
  await o.getByText("Loading workspace actions…").waitFor({ state: "hidden", timeout: 30000 });
  console.log(JSON.stringify({ step: "operations_queue", text: (await o.locator("main").last().innerText()).slice(-1800), api: await o.evaluate(async () => { const response = await fetch("/api/d5o-hosted/prototype-search?workspace=rybex&view=actions"); const data = await response.json(); return { http: response.status, matches: data.roleActions?.filter((item) => item.workId === "rybex-f85daaed685f4b5b9e113b8a0f5cf33c") }; }) }));
  const task = o.getByRole("button", { name: /Authorize detailed Design.*Data Center Inside Plant.*Hall R/ });
  await task.click();
  await o.getByRole("link", { name: /Open exact task/ }).click();
  const op = o.locator('section[aria-label="ROM communication and Design authorization"]');
  await op.waitFor({ timeout: 30000 });
  console.log(JSON.stringify({ step: "before_design_authority", position: await position(o), buttons: await op.locator("button").allInnerTexts() }));
  if ((await position(o)).data?.status === "Acknowledged") {
    const form = op.locator('form:has(button:has-text("Authorize Design only"))');
    await form.locator('[name="extent"]').fill("Detailed Design and validation of the 48-link Cat6A ROM scope, route quantities and installation method only");
    await form.locator('[name="funding"]').fill("FICTIONAL internal Design study budget");
    await form.locator('[name="cap"]').fill("2500.00");
    await form.locator('[name="source"]').fill("FICTIONAL-INTERNAL-DESIGN-AUTH-2026-10-16");
    const response = o.waitForResponse((item) => item.url().includes("/api/d5o-hosted/rom-design") && item.request().method() === "POST");
    await form.getByRole("button", { name: "Authorize Design only" }).click();
    const result = await response;
    console.log(JSON.stringify({ step: "design_only_authorized", http: result.status(), result: (await result.text()).slice(0, 750) }));
  }
  await ops.context.close();
  const pm2 = await signIn("pm"), p2 = pm2.page;
  const pp = p2.locator('section[aria-label="ROM communication and Design authorization"]');
  await pp.waitFor({ timeout: 30000 });
  const form = pp.locator('form:has(button:has-text("Retain difference"))');
  if (await form.count()) {
    const line = await form.locator('[name="line"] option').filter({ hasText: "Cat6A cable, jacks, panels and labels" }).first().getAttribute("value");
    await form.locator('[name="line"]').selectOption(line);
    await form.locator('[name="quantity"]').fill("52");
    await form.locator('[name="unit"]').fill("link");
    await form.locator('[name="cause"]').selectOption("Estimating assumption resolved");
    await form.locator('[name="explanation"]').fill("Detailed route and outlet layout indicates 52 links versus the original 48-link ROM assumption; four added links remain unpriced pending governed scope decision.");
    await form.locator('[name="source"]').fill("FICTIONAL-DESIGN-LAYOUT-52-LINKS");
    const response = p2.waitForResponse((item) => item.url().includes("/api/d5o-hosted/rom-design") && item.request().method() === "POST");
    await form.getByRole("button", { name: "Retain difference" }).click();
    const result = await response;
    console.log(JSON.stringify({ step: "design_difference", http: result.status(), result: (await result.text()).slice(0, 650) }));
  }
  console.log(JSON.stringify({ step: "final_rom_design_position", position: await position(p2) }));
  await pm2.context.close();
} finally { await browser.close(); }
