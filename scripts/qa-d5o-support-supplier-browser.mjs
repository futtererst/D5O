import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const base = process.env.D5O_LOCAL_PREVIEW;
if (!base?.startsWith("http://127.0.0.1:") ||
  process.env.D5O_RUN_FICTIONAL_SUPPORT_MUTATIONS !== "1")
  throw new Error("explicit_disposable_preview_required");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS, "utf8")).users;
const second = JSON.parse(readFileSync(process.env.D5O_SECOND_SUPERVISOR_CREDENTIALS, "utf8"));
const workId = "rybex-9e4f1e5f9e6b4e429142d3b01e1825e5";
const recordUrl = base + "/work?workspace=rybex&view=record&record=" + workId + "&section=Operate";
const browser = await chromium.launch({ headless: true });
async function login(user) {
  const context = await browser.newContext(), page = await context.newPage();
  await page.goto(base + "/auth/sign-in?next=" + encodeURIComponent("/work?workspace=rybex&view=my-work"));
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.getByRole("heading", { name: "Actions requiring attention" }).waitFor({ timeout: 30000 });
  await page.goto(recordUrl);
  const tab = page.getByText("Handoff & activation", { exact: true });
  await tab.first().click();
  try { await page.getByRole("heading", { name: "Assigned documentation obligations" }).waitFor({ timeout: 12000 }); }
  catch {
    throw new Error("support_panel_unavailable:" + page.url() + ":" +
      JSON.stringify((await page.locator("h1,h2,h3,button").allInnerTexts()).slice(0, 45)));
  }
  return { context, page };
}
try {
  const ops = await login(users.find((item) => item.key === "operations"));
  const build = process.env.D5O_EXPECTED_BUILD;
  if (build && !(await ops.page.locator("body").innerText()).includes("Build " + build))
    throw new Error("displayed_build_mismatch");
  const before = await ops.page.evaluate(async (id) => {
    const payload = await (await fetch("/api/d5o-hosted/prototype-state?workspace=rybex&key=work")).json();
    return payload.state.records.find((record) => record.id === id);
  }, workId);
  const turnover = before.deploy.turnovers.find((item) =>
    item.status === "Client accepted" && item.receipt === "Accepted" &&
    item.obligations.toLowerCase().includes("as-built") &&
    before.operate.supportDocumentAssignments?.filter((entry) => entry.turnoverId === item.id).at(-1)?.email === second.email)
    ?? before.deploy.turnovers.find((item) => item.status === "Client accepted" &&
      item.receipt === "Accepted" && item.obligations.toLowerCase().includes("as-built") &&
      !before.operate.supportDocumentAssignments?.filter((entry) => entry.turnoverId === item.id).at(-1));
  if (!turnover) throw new Error("target_turnover_missing");
  const packageId = before.design.releases.find((item) => turnover.releaseIds.includes(item.id))?.packageId;
  const row = ops.page.locator('section[aria-label="Accepted turnover documentation"] article')
    .filter({ hasText: turnover.id }).filter({ hasText: "As-built controls record" });
  let committedInThisRun = false;
  if (await row.getByRole("button", { name: "Assign document supplier" }).isVisible()) {
    await row.locator('input[name="supervisorEmail"]').fill(second.email);
    await row.locator('input[name="reason"]').fill("Fictional Operations assignment for this accepted package and retained support documents.");
    const response = ops.page.waitForResponse((item) => item.url().includes("prototype-operate-command") && item.request().method() === "POST");
    await row.getByRole("button", { name: "Assign document supplier" }).click();
    const committed = await response;
    if (!committed.ok()) throw new Error("browser_assignment_failed:" + committed.status() + ":" + await committed.text());
    committedInThisRun = true;
  }
  await ops.page.reload();
  await ops.page.getByText("Handoff & activation", { exact: true }).first().click();
  const assignedRow = ops.page.locator('section[aria-label="Accepted turnover documentation"] article')
    .filter({ hasText: turnover.id }).filter({ hasText: "As-built controls record" });
  if (!await assignedRow.getByText("Document supplier: " + second.email + ".").isVisible())
    throw new Error("assignment_not_retained_after_reload");
  await ops.context.close();
  const worker = await login(second);
  const own = worker.page.locator('section[aria-label="Accepted turnover documentation"] article')
    .filter({ hasText: turnover.id }).filter({ hasText: "As-built controls record" });
  if (!await own.locator('input[name="file"]').isVisible())
    throw new Error("assigned_supervisor_cannot_supply");
  const other = worker.page.locator('section[aria-label="Accepted turnover documentation"] article')
    .filter({ hasText: "As-built controls record" }).filter({ hasNotText: turnover.id });
  if (await other.locator('input[name="file"]').count())
    throw new Error("unassigned_supervisor_can_supply_other_package");
  const otherTurnover = before.deploy.turnovers.find((item) => item.id !== turnover.id &&
    item.status === "Client accepted" && item.receipt === "Accepted" &&
    item.obligations.toLowerCase().includes("as-built"));
  const denied = await worker.page.evaluate(async ({ id, scopeId }) => {
    const data = new FormData();
    data.set("workId", id); data.set("scopeId", scopeId); data.set("purpose", "support-as-built");
    data.set("file", new File(["%PDF-1.4\n%%EOF"], "fictional-denied.pdf", { type: "application/pdf" }));
    const response = await fetch("/api/d5o-hosted/customer-decision-evidence?workspace=rybex",
      { method: "POST", body: data });
    return { status: response.status, body: await response.json() };
  }, { id: workId, scopeId: otherTurnover.id });
  if (denied.status !== 403 || denied.body.error !== "support_document_package_assignment_required")
    throw new Error("unassigned_upload_not_denied:" + JSON.stringify(denied));
  const scoped = await worker.page.evaluate(async (id) => {
    const payload = await (await fetch("/api/d5o-hosted/prototype-state?workspace=rybex&key=work")).json();
    return payload.state.records.find((record) => record.id === id).operate;
  }, workId);
  if (scoped.supportDocumentAssignments?.some((entry) => entry.actorId !== second.userId) ||
    scoped.documentationObligations?.some((entry) => entry.uploadedByActorId && entry.uploadedByActorId !== second.userId) ||
    scoped.events?.some((entry) =>
      (entry.action?.startsWith("support-document-") || entry.action?.startsWith("support-supplier-")) &&
      entry.actorId && entry.actorId !== second.userId))
    throw new Error("supervisor_metadata_leaked_in_work_read");
  await worker.context.close();
  console.log(JSON.stringify({ result: "support_supplier_browser_pass",workId,
    turnoverId: turnover.id,packageId,assignedEmail: second.email,
    observed: [committedInThisRun ? "operations_form_committed" : "prior_browser_assignment_retained", "reload_retained_assignment",
      "assigned_supervisor_has_supply_control", "other_package_has_no_supply_control",
      "unassigned_upload_denied_403", "other_supplier_assignment_document_and_event_metadata_redacted"] }));
} finally { await browser.close(); }
