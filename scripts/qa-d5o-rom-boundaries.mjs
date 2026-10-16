import { readFileSync } from "node:fs";
import { chromium } from "playwright";
if (process.env.D5O_COMMAND_RUNTIME !== "rehearsal" || process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:58221" || !process.env.D5O_PILOT_CREDENTIALS_FILE) throw new Error("disposable_pilot_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const workId = "rybex-f85daaed685f4b5b9e113b8a0f5cf33c", origin = "http://127.0.0.1:61643";
const browser = await chromium.launch({ headless: true });
async function session(key) {
  const user = users.find((item) => item.key === key), context = await browser.newContext(), page = await context.newPage();
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent("/work?workspace=rybex&view=my-work")}`);
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  try { await page.waitForURL(/\/work\?workspace=rybex/, { timeout: 30000 }); }
  catch (error) { console.log(JSON.stringify({ signInRole: key, currentUrl: page.url(), message: (await page.locator("body").innerText()).slice(0, 450) })); throw error; }
  return { context, page };
}
async function read(page) {
  return page.evaluate(async (id) => { const response = await fetch(`/api/d5o-hosted/rom-design?workspace=rybex&workId=${id}`); return await response.json(); }, workId);
}
const intent = (state, overrides = {}) => ({ action: "record-reconciliation", basis: { sourceReference: "FICTIONAL-BOUNDARY-PROBE", differences: [{ romLineId: "6f3dd15b-0c2d-4682-bcd0-776ca5335811", designQuantity: "52", designUnit: "link", cause: "Estimating assumption resolved", explanation: "Fictional bounded review probe, not a new design decision." }] }, commandId: crypto.randomUUID(), expectedSourceRevision: state.sourceRevision, expectedDecisionRevision: state.decisionRevision, estimateRevision: 1, offerRevision: 1, ...overrides });
try {
  const pm = await session("pm"), commercial = await session("commercial");
  const before = await read(pm.page);
  const probe = async (page, workspace, body) => page.evaluate(async ({ workspace, body, id }) => { const response = await fetch(`/api/d5o-hosted/rom-design?workspace=${workspace}&workId=${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); return { http: response.status, result: await response.json() }; }, { workspace, body, id: workId });
  const wrongRole = await probe(commercial.page, "rybex", intent(before));
  const crossTenant = await probe(pm.page, "rotork", intent(before));
  const stale = await probe(pm.page, "rybex", intent(before, { expectedSourceRevision: before.sourceRevision - 1 }));
  const wrongEstimate = await probe(pm.page, "rybex", intent(before, { estimateRevision: 2 }));
  const execution = await pm.page.evaluate(async (id) => { const response = await fetch("/api/d5o-hosted/prototype-catalog?workspace=rybex", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create-package", workId: id, name: "Unauthorized ROM execution package", owner: "Pilot Project Manager" }) }); return { http: response.status, result: await response.json() }; }, workId);
  const after = await read(pm.page);
  console.log(JSON.stringify({ wrongRole, crossTenant, stale, wrongEstimate, execution, unchangedDecisionRevision: before.decisionRevision === after.decisionRevision, unchangedReconciliationCount: before.reconciliation?.length === after.reconciliation?.length }));
  await pm.context.close(); await commercial.context.close();
} finally { await browser.close(); }
