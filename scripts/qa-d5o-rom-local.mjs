import { readFileSync } from "node:fs";
import { chromium } from "playwright";

if (process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:58221" ||
    process.env.D5O_COMMAND_RUNTIME !== "rehearsal" || !process.env.D5O_PILOT_CREDENTIALS_FILE)
  throw new Error("disposable_rom_target_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const origin = "http://127.0.0.1:61643";
const workId = "rybex-f85daaed685f4b5b9e113b8a0f5cf33c";
const browser = await chromium.launch({ headless: true });
async function signIn(key, view = "develop") {
  const user = users.find((item) => item.key === key);
  if (!user) throw new Error(`fictional_role_missing:${key}`);
  const context = await browser.newContext();
  const page = await context.newPage();
  const path = `/work?workspace=rybex&view=${view}&record=${workId}`;
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent(path)}`);
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.waitForURL(/\/work\?workspace=rybex/, { timeout: 30000 }).catch(async () => { throw new Error(`sign_in_navigation:${page.url()}:${(await page.locator("body").innerText()).slice(-350)}`); });
  return { page, context };
}
const state = async (page) => page.evaluate(async (id) => {
  const response = await fetch("/api/d5o-hosted/prototype-state?workspace=rybex&key=work");
  const payload = await response.json();
  return payload.state?.records?.find((item) => item.id === id);
}, workId);
const post = async (page, button, marker = "prototype-state") => {
  const wait = page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes(marker), { timeout: 30000 });
  await button.click();
  const response = await wait;
  if (!response.ok()) throw new Error(`${marker}:${response.status()}:${(await response.text()).slice(0, 350)}`);
  return response;
};

try {
  const step = process.argv[2];
  if (step === "policy") {
    const { page, context } = await signIn("admin");
    await page.getByText("Pricing policies and rates").click();
    const policy = page.locator('details[aria-label="Tenant pricing configuration"]');
    const active = policy.locator("article").filter({ hasText: "ACTIVE" }).first();
    await active.getByRole("button", { name: "New version" }).click();
    const form = policy.locator('form:has(button:has-text("Save draft and rate catalog"))');
    await form.locator('input[name="name"]').fill("Fictional 48-link Cat6A ROM policy · isolated pilot");
    await form.locator('input[name="targetMarginPercent"]').fill("25");
    await form.locator('input[name="floorMarginPercent"]').fill("15");
    await form.locator('input[name="overheadPercent"]').fill("10");
    await form.locator('input[name="contingencyPercent"]').fill("10");
    await form.locator('input[name="maxDiscountPercent"]').fill("0");
    await post(page, form.getByRole("button", { name: "Save draft and rate catalog" }));
    const draft = policy.locator("article").filter({ hasText: "Fictional 48-link Cat6A ROM policy" }).first();
    await post(page, draft.getByRole("button", { name: "Validate & publish" }));
    const published = policy.locator("article").filter({ hasText: "Fictional 48-link Cat6A ROM policy" }).first();
    await post(page, published.getByRole("button", { name: "Activate" }));
    console.log(JSON.stringify({ step, result: "published and activated through administrator UI", policy: (await policy.innerText()).match(/Fictional 48-link Cat6A ROM policy[^\n]*/)?.[0] }));
    await context.close();
  } else if (step === "inspect") {
    const { page, context } = await signIn("pm");
    const item = await state(page);
    console.log(JSON.stringify({ step, workId, define: { status: item?.definition?.status, revision: item?.definition?.revision, receipt: item?.definition?.developHandoff?.status, requirements: item?.definition?.scopeControl?.requirements?.map((x) => ({ id: x.id, need: x.need, state: x.state })), acceptance: item?.definition?.registers?.acceptance_criteria?.map((x) => ({ id: x.id, result: x.result })), interfaces: item?.definition?.scopeControl?.interfaces?.map((x) => ({ id: x.id, boundary: x.boundary })) }, solution: { revision: item?.develop?.revision, status: item?.develop?.review?.status }, estimate: { revision: item?.discovery?.estimate?.revision, status: item?.discovery?.estimate?.status }, offer: item?.discovery?.proposal?.status }));
    await context.close();
  } else if (step === "define-inspect") {
    const { page, context } = await signIn("pm", "define");
    await page.getByRole("button", { name: "Scope & acceptance", exact: true }).waitFor({ timeout: 30000 });
    await page.getByRole("button", { name: "Review & handoff", exact: true }).click();
    console.log(JSON.stringify({ step, body: (await page.locator("main").last().innerText()).slice(0, 2600), buttons: await page.getByRole("button").allTextContents() }));
    await context.close();
  } else if (step === "create") {
    const { page, context } = await signIn("pm", "my-work");
    const title = "FICTIONAL · Data Center Inside Plant and Structured Cabling · Hall R · 48-link ROM";
    let item = await page.evaluate(async (name) => {
      const payload = await fetch("/api/d5o-hosted/prototype-state?workspace=rybex&key=work").then((response) => response.json());
      return payload.state?.records?.find((record) => record.title === name);
    }, title);
    if (!item) {
      await page.getByRole("button", { name: "+ Start work" }).click();
      await page.locator('input[name="title"]').fill(title);
      await page.locator('input[name="customer"]').fill("Fictional North Campus Properties");
      await page.locator('input[name="site"]').fill("Data Hall R · Manassas, VA");
      await page.locator('input[name="owner"]').fill("Fictional ROM Project Manager");
      await page.locator('textarea[name="need"]').fill("Install and certify 48 Cat6A structured cabling links, with testing records, labels and as-builts in a fictional data center hall. Route length and exact pathways remain estimating assumptions until detailed Design.");
      await page.locator('input[name="value"]').fill("Indicative budget pending ROM; no customer award");
      await page.getByRole("button", { name: "Create Work Record" }).click();
      await page.waitForFunction(async (name) => {
        const payload = await fetch("/api/d5o-hosted/prototype-state?workspace=rybex&key=work").then((response) => response.json());
        return payload.state?.records?.some((record) => record.title === name && record.canonicalWorkId);
      }, title, { timeout: 30000 });
      item = await page.evaluate(async (name) => {
        const payload = await fetch("/api/d5o-hosted/prototype-state?workspace=rybex&key=work").then((response) => response.json());
        return payload.state?.records?.find((record) => record.title === name);
      }, title);
    }
    console.log(JSON.stringify({ step, workId: item.id, canonicalWorkId: item.canonicalWorkId, title }));
    await context.close();
  } else if (step === "discover-handoff") {
    const pm = await signIn("pm", "my-work");
    const prepare = pm.page.getByRole("button", { name: /Prepare Define handoff.*FICTIONAL · Data Center Inside Plant.*48-link ROM/ });
    await prepare.waitFor({ timeout: 30000 });
    await prepare.click();
    await pm.page.getByText("Open exact task →").click();
    await pm.page.locator('textarea[name="brief"]').fill("Define 48 Cat6A permanent links, labels, certification and reporting for Data Hall R. Verify exact routes, access and productivity during Design. The customer provides escorted access and outage windows; this brief carries no award or field authority.");
    await post(pm.page, pm.page.getByRole("button", { name: "Submit Define handoff" }), "prototype-pursuit-command");
    await pm.context.close();
    const ops = await signIn("operations", "my-work");
    const receive = ops.page.getByRole("button", { name: /Receive Define handoff.*FICTIONAL · Data Center Inside Plant.*48-link ROM/ });
    await receive.waitFor({ timeout: 30000 });
    await receive.click();
    await ops.page.getByText("Open exact task →").click();
    await ops.page.getByLabel("Receiver response reason").fill("Operations independently receives the exact fictional 48-link Cat6A brief for requirements definition; routes and productivity remain unknown.");
    await post(ops.page, ops.page.getByRole("button", { name: "Accept Define handoff" }), "prototype-pursuit-command");
    await ops.page.reload();
    console.log(JSON.stringify({ step, result: "PM submitted; Operations independently accepted current Discover-to-Define handoff", persisted: (await state(ops.page))?.discovery?.pursuitControl?.handoff?.status }));
    await ops.context.close();
  } else if (step === "dependency-inspect") {
    const { page, context } = await signIn("pm", "define");
    await page.getByRole("button", { name: "Delivery basis", exact: true }).click();
    console.log(JSON.stringify({ step, buttons: await page.getByRole("button").allTextContents(), body: (await page.locator("main").last().innerText()).slice(-1400) }));
    await page.getByRole("region", { name: "Dependencies" }).getByRole("button", { name: /\+ Add/ }).click();
    console.log(JSON.stringify({ step, form: await page.getByRole("dialog").locator("form").evaluate((element) => ({ text: element.innerText, controls: [...element.querySelectorAll("input,select,textarea")].map((control) => ({ name: control.name, required: control.required, type: control.type })) })) }));
    await context.close();
  } else if (step === "dependency-save") {
    const { page, context } = await signIn("pm", "define");
    await page.getByRole("button", { name: "Delivery basis", exact: true }).click();
    await page.getByRole("region", { name: "Dependencies" }).getByRole("button", { name: /\+ Add/ }).click();
    const form = page.getByRole("dialog").locator("form");
    await form.getByLabel("Dependency").fill("Customer confirms escorted access and pathway availability");
    await form.getByLabel("Owner").fill("Fictional facilities director");
    await form.getByLabel("Needed by").fill("2026-11-05");
    console.log(JSON.stringify({ step, valid: await form.evaluate((element) => element.checkValidity()), fields: await form.locator("input").evaluateAll((items) => items.map((item) => ({ value: item.value, valid: item.checkValidity(), message: item.validationMessage }))) }));
    const wait = page.waitForResponse((response) => response.url().includes("prototype-state") && response.request().method() === "POST", { timeout: 10000 }).catch(() => null);
    await form.getByRole("button", { name: "Save item" }).click();
    const response = await wait;
    console.log(JSON.stringify({ step: "dependency-save-result", response: response?.status() ?? null, body: (await page.locator("main").last().innerText()).slice(-500) }));
    await context.close();
  } else throw new Error(`unknown_step:${step}`);
} finally { await browser.close(); }
