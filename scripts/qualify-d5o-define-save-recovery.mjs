import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const origin = "http://127.0.0.1:61657";
const target = "http://127.0.0.1:58521";
const workId = "rybex-2fad0999a8f24514a7188e98f0720149";
const otherWorkId = "rybex-348c608416464b748b48f2c75ab0127a";
const runToken = Date.now().toString(36);
if (process.env.NEXT_PUBLIC_SUPABASE_URL !== target ||
    process.env.D5O_REHEARSAL_TARGET_URL !== target ||
    !process.env.D5O_PILOT_CREDENTIALS_FILE) throw new Error("disposable_clone_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const browser = await chromium.launch({ headless: true });
const log = (caseId, data) => console.log(JSON.stringify({ caseId, ...data }));
const workUrl = (recordId) => `${origin}/work?workspace=rybex&view=define&record=${recordId}`;

async function signIn(key, recordId = workId) {
  const user = users.find((item) => item.key === key);
  if (!user) throw new Error(`missing_fictional_user:${key}`);
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent(`/work?workspace=rybex&view=define&record=${recordId}`)}`);
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.getByRole("button", { name: "Investigation", exact: true }).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Investigation", exact: true }).click();
  return { context, page };
}

async function revision(page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/d5o-hosted/prototype-state?workspace=rybex&key=work", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || !data.state) throw new Error(`read_${response.status}`);
    return data.state.revision;
  });
}

async function editProject(page, { contact, site, systems, access }) {
  await page.getByLabel("Customer contact").fill(contact);
  await page.getByLabel("Site and affected area").fill(site);
  await page.getByLabel("Affected systems").fill(systems);
  await page.getByLabel("Access and operating constraints").fill(access);
  await page.getByRole("button", { name: "Save investigation facts" }).click();
}

try {
  const a = await signIn("pm");
  log("pm-signed-in", { url: a.page.url() });
  const b = await signIn("admin");
  log("admin-signed-in", { url: b.page.url() });
  const initial = await revision(a.page);
  let releaseA;
  const holdA = new Promise((resolve) => { releaseA = resolve; });
  let requestA;
  const seenA = new Promise((resolve) => { requestA = resolve; });
  await a.page.route(/\/api\/d5o-hosted\/prototype-state(?:\?|$)/, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    requestA();
    await holdA;
    await route.continue();
  });
  const aDraft = { contact: `Fictional Avery Contact — local draft ${runToken}`, site: "Fictional west bay — proposed by A", systems: "Fictional paired monitoring controls", access: "Fictional escort required" };
  const bDraft = { contact: `Fictional Blair Contact — shared update ${runToken}`, site: "Fictional east bay — verified by B", systems: "Fictional paired monitoring controls", access: "Fictional escort required" };
  await editProject(a.page, aDraft);
  log("a-edited", { notice: (await a.page.locator("body").innerText()).slice(-180) });
  await Promise.race([seenA, new Promise((_, reject) => setTimeout(() => reject(new Error("a_post_not_sent")), 12000))]);
  const bResponsePromise = b.page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/api/d5o-hosted/prototype-state"));
  await editProject(b.page, bDraft);
  const bResponse = await bResponsePromise;
  const afterB = await revision(b.page);
  const aResponsePromise = a.page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/api/d5o-hosted/prototype-state"));
  releaseA();
  const aResponse = await aResponsePromise;
  const staleResponse = { status: aResponse.status(), body: (await aResponse.json()).error };
  log("race-responses", { bStatus: bResponse.status(), aStatus: staleResponse.status, aError: staleResponse.body, afterB });
  await a.page.getByRole("alert", { name: "Unsaved Define draft recovery" }).waitFor();
  await a.page.getByRole("alert", { name: "Unsaved Define draft recovery" }).locator("summary").first().click();
  const retainedText = await a.page.getByRole("alert", { name: "Unsaved Define draft recovery" }).innerText();
  log("stale-save", { initial, bStatus: bResponse.status(), afterB, aStatus: staleResponse.status, aError: staleResponse.body,
    retainedA: retainedText.includes(aDraft.contact), currentLabel: retainedText.includes("Current shared value") });
  await a.page.goto(workUrl(otherWorkId));
  log("other-work-isolation", { recoveryVisible: await a.page.getByRole("alert", { name: "Unsaved Define draft recovery" }).count() });
  await a.page.goto(workUrl(workId));
  await a.page.getByRole("alert", { name: "Unsaved Define draft recovery" }).waitFor();
  await a.page.getByRole("button", { name: "Check and load current shared basis" }).click();
  await a.page.getByText(`Loaded shared revision ${afterB}.`, { exact: false }).waitFor({ timeout: 15000 });
  await a.page.getByRole("alert", { name: "Unsaved Define draft recovery" }).locator("summary").first().click();
  const comparison = await a.page.getByRole("alert", { name: "Unsaved Define draft recovery" }).innerText();
  log("comparison", { currentB: comparison.includes(bDraft.site), retainedA: comparison.includes(aDraft.contact), currentLabel: comparison.includes("Current shared value") });
  await a.page.getByRole("button", { name: "Investigation", exact: true }).click();
  log("loaded-form", { contact: await a.page.getByLabel("Customer contact").inputValue(), site: await a.page.getByLabel("Site and affected area").inputValue() });
  const reconciled = { ...bDraft, contact: aDraft.contact };
  const saveResponsePromise = a.page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/api/d5o-hosted/prototype-state"));
  await editProject(a.page, reconciled);
  const saveResponse = await saveResponsePromise;
  await a.page.reload();
  await a.page.getByRole("button", { name: "Investigation", exact: true }).click();
  log("reconciled", { status: saveResponse.status(), revision: await revision(a.page), contact: await a.page.getByLabel("Customer contact").inputValue(), site: await a.page.getByLabel("Site and affected area").inputValue() });
  await a.context.close();
  await b.context.close();
} finally { await browser.close(); }
