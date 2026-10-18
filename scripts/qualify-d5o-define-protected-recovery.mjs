import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";

const origin = "http://127.0.0.1:61657";
const target = "http://127.0.0.1:58521";
const workId = "rybex-2fad0999a8f24514a7188e98f0720149";
if (process.env.NEXT_PUBLIC_SUPABASE_URL !== target ||
    process.env.D5O_REHEARSAL_TARGET_URL !== target || !process.env.D5O_PILOT_CREDENTIALS_FILE)
  throw new Error("disposable_clone_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const browser = await chromium.launch({ headless: true });
const statePath = "/api/d5o-hosted/prototype-state?workspace=rybex&key=work";
const commandPath = "/api/d5o-hosted/prototype-define-command?workspace=rybex";
async function signIn(key) {
  const user = users.find(item => item.key === key);
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent(`/work?workspace=rybex&view=define&record=${workId}`)}`);
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.getByRole("button", { name: "Investigation", exact: true }).waitFor({ timeout: 30000 });
  return { context, page };
}
async function read(page) {
  return page.evaluate(async path => {
    const response = await fetch(path, { cache: "no-store" });
    const value = await response.json();
    if (!response.ok) throw new Error(`read_${response.status}`);
    return value.state;
  }, statePath);
}
async function command(page, action, state, role) {
  const definition = state.records.find(item => item.id === workId)?.definition;
  const body = { workId, action, role, commandId: randomUUID(), expectedRevision: state.revision,
    expectedDecisionRevision: definition.authorityRevision,
    reason: `Fictional focused UI conflict recovery: ${action} the exact current basis` };
  return page.evaluate(async ({ body, path }) => {
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json();
    return { status: response.status, error: payload.error ?? null };
  }, { body, path: commandPath });
}
try {
  const pm = await signIn("pm");
  const admin = await signIn("admin");
  let state = await read(pm.page);
  if (state.records.find(item => item.id === workId)?.definition?.status === "In review") {
    const returned = await command(admin.page, "return-review", state, "delivery");
    if (returned.status !== 200) throw new Error(`fixture_return_${returned.status}:${returned.error}`);
    state = await read(pm.page);
  }
  const revised = await command(pm.page, "new-revision", state);
  if (revised.status !== 200) throw new Error(`fixture_revision_${revised.status}:${revised.error}`);
  const before = (await read(pm.page)).revision;
  await pm.page.reload();
  await pm.page.getByRole("button", { name: "Investigation", exact: true }).click();
  let intercepted = 0;
  const conflict = async route => {
    if (route.request().method() !== "POST") return route.continue();
    intercepted++;
    await route.fulfill({ status: 409, contentType: "application/json",
      body: JSON.stringify({ error: "protected_state_changed" }) });
  };
  await pm.page.route(/\/api\/d5o-hosted\/prototype-state(?:\?|$)/, conflict);
  const distinctive = `Fictional retained draft ${Date.now().toString(36)}`;
  await pm.page.getByLabel("Customer contact").fill(distinctive);
  await pm.page.getByRole("button", { name: "Save investigation facts" }).click();
  await pm.page.getByRole("alert", { name: "Unsaved Define draft recovery" }).waitFor({ timeout: 15000 });
  const notice = (await pm.page.getByRole("status").allTextContents()).join(" ");
  const retained = await pm.page.getByLabel("Customer contact").inputValue();
  await pm.page.unroute(/\/api\/d5o-hosted\/prototype-state(?:\?|$)/, conflict);
  const after = (await read(pm.page)).revision;
  console.log(JSON.stringify({ build: (await pm.page.locator("body").innerText()).match(/Build\s+[0-9a-f]{12,40}/)?.[0],
    simulatedConflict: true, intercepted, recoveryVisible: true, noticeMentionsChangedBasis: notice.includes("reviewed Define decision changed"),
    draftRetained: retained === distinctive, before, after }));
  if (!intercepted || !notice.includes("reviewed Define decision changed") || retained !== distinctive || before !== after)
    throw new Error("protected_conflict_recovery_failed");
  await pm.context.close(); await admin.context.close();
} finally { await browser.close(); }
