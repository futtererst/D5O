import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

// Mutates only the verified, disposable clone on port 61650. The preserved
// support pilot and observation checkpoints must never be used for this run.
if (process.env.D5O_RUN_FICTIONAL_SUPPORT_MUTATIONS !== "1" ||
  process.env.D5O_LOCAL_PREVIEW !== "http://127.0.0.1:61650")
  throw new Error("explicit_supplier_clone_required");
const base = process.env.D5O_LOCAL_PREVIEW;
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS, "utf8")).users;
const byKey = (key) => {
  const user = users.find((item) => item.key === key);
  if (!user?.email || !user?.password) throw new Error("fictional_account_missing:" + key);
  return user;
};
const file = "output/pdf/d5o-fictional-support/north-as-built.pdf";
const bytes = readFileSync(file), sha256 = createHash("sha256").update(bytes).digest("hex");
const workId = "rybex-9e4f1e5f9e6b4e429142d3b01e1825e5";
const turnoverId = "26241096-02c1-4699-8bdc-759f5d83a426";
const landing = base + "/work?workspace=rybex&view=my-work";
const browser = await chromium.launch({ headless: true });
async function signIn(user) {
  const context = await browser.newContext(), page = await context.newPage();
  await page.goto(base + "/auth/sign-in?next=" + encodeURIComponent("/work?workspace=rybex&view=my-work"));
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  try { await page.getByRole("heading", { name: "Actions requiring attention" }).waitFor({ timeout: 30000 }); }
  catch { throw new Error("fictional_signin_landing_unavailable:" + page.url() + ":" +
    (await page.locator("body").innerText()).slice(0, 500)); }
  if (!process.env.D5O_EXPECTED_BUILD ||
    !(await page.locator("body").innerText()).includes("Build " + process.env.D5O_EXPECTED_BUILD))
    throw new Error("displayed_build_mismatch");
  return { context, page };
}
async function current(page) {
  return page.evaluate(async (id) => {
    const response = await fetch("/api/d5o-hosted/prototype-state?workspace=rybex&key=work");
    if (!response.ok) throw new Error("scoped_work_read_failed");
    const body = await response.json();
    return body.state.records.find((item) => item.id === id);
  }, workId);
}
async function exactLink(page, kind) {
  await page.goto(landing);
  await page.getByRole("heading", { name: "Actions requiring attention" }).waitFor({ timeout: 30000 });
  const links = page.locator(`a[href*="focus=${kind}"][href*="record=${workId}"][href*="turnover=${turnoverId}"][href*="documentKind=as-built"]`);
  if (await links.count() !== 1) throw new Error("exact_queue_link_missing_or_duplicate:" + kind);
  return links.first();
}
function row(page) {
  return page.locator('section[aria-label="Accepted turnover documentation"] article')
    .filter({ hasText: turnoverId }).filter({ hasText: "As-built controls record" });
}
async function submit(page, note) {
  const target = row(page);
  await target.locator('input[name="file"]').setInputFiles(file);
  await target.locator('input[name="note"]').fill(note);
  const command = page.waitForResponse((response) => response.url().includes("prototype-operate-command") &&
    response.request().method() === "POST", { timeout: 30000 });
  command.catch(() => {});
  const upload = page.waitForResponse((response) => response.url().includes("customer-decision-evidence") &&
    response.request().method() === "POST", { timeout: 30000 });
  await target.getByRole("button", { name: "Retain and submit document" }).click();
  const uploaded = await upload;
  if (!uploaded.ok()) throw new Error("support_upload_rejected:" + uploaded.status() + ":" + (await uploaded.json()).error);
  const response = await command;
  if (!response.ok()) throw new Error("support_submission_rejected:" + response.status() + ":" + (await response.json()).error);
  return (await current(page)).operate.documentationObligations.filter((item) =>
    item.turnoverId === turnoverId && item.kind === "as-built").at(-1);
}
try {
  const pm = await signIn(byKey("pm"));
  const initial = await current(pm.page);
  const assignment = initial.operate.supportDocumentAssignments.filter((item) => item.turnoverId === turnoverId).at(-1);
  const original = initial.operate.documentationObligations.filter((item) =>
    item.turnoverId === turnoverId && item.kind === "as-built").at(-1);
  if (assignment?.status !== "Assigned" || assignment.email !== byKey("supervisor").email ||
    original?.status !== "Reviewed") throw new Error("disposable_clone_start_position_changed");
  await pm.page.goto(base + `/work?workspace=rybex&view=record&record=${workId}&section=Operate`);
  await pm.page.getByText("Handoff & activation", { exact: true }).first().click();
  await row(pm.page).getByRole("button", { name: "Retain and submit document" }).waitFor();
  const pmSubmitted = await submit(pm.page, "Fictional replacement index submitted for a scope-specific return and supplier queue check.");
  if (pmSubmitted?.status !== "Submitted" || pmSubmitted.supersedesId !== original.id)
    throw new Error("pm_replacement_not_retained");
  console.log(JSON.stringify({ stage: "pm_submitted_fictional_replacement", evidenceId: pmSubmitted.id }));
  await pm.context.close();

  const operations = await signIn(byKey("operations"));
  await (await exactLink(operations.page, "review-document")).click();
  await row(operations.page).locator('select[name="decision"]').selectOption("Returned");
  await row(operations.page).locator('input[name="note"]').fill(
    "Fictional index lacks verified route and label detail; assigned supplier must supply a corrected record.");
  const review = operations.page.waitForResponse((response) => response.url().includes("prototype-operate-command") &&
    response.request().method() === "POST", { timeout: 30000 });
  await row(operations.page).getByRole("button", { name: "Record independent review" }).click();
  const returned = await review;
  if (!returned.ok()) throw new Error("independent_return_rejected:" + returned.status());
  const afterReturn = await current(operations.page);
  const returnedDocument = afterReturn.operate.documentationObligations.filter((item) =>
    item.turnoverId === turnoverId && item.kind === "as-built").at(-1);
  if (returnedDocument?.id !== pmSubmitted.id || returnedDocument.status !== "Returned")
    throw new Error("returned_document_not_current");
  console.log(JSON.stringify({ stage: "operations_returned_document", evidenceId: returnedDocument.id }));
  await operations.context.close();

  const supervisor = await signIn(byKey("supervisor"));
  const supplyLink = await exactLink(supervisor.page, "supply-document");
  const savedHref = await supplyLink.getAttribute("href");
  if (!(await supplyLink.innerText()).includes("North") || !(await supplyLink.innerText()).includes("Assigned field supervisor"))
    throw new Error("supplier_card_missing_readable_scope_or_owner");
  await supplyLink.click();
  await row(supervisor.page).locator('input[name="file"]').waitFor();
  const second = await signIn(JSON.parse(readFileSync(process.env.D5O_SECOND_SUPERVISOR_CREDENTIALS, "utf8")));
  if (await second.page.locator(`a[href*="focus=supply-document"][href*="turnover=${turnoverId}"]`).count())
    throw new Error("foreign_supervisor_received_supplier_task");
  await second.context.close();
  const submitted = await submit(supervisor.page,
    "Fictional assigned-supervisor correction submitted for independent Operations assessment only.");
  if (submitted?.status !== "Submitted" || submitted.supersedesId !== returnedDocument.id)
    throw new Error("supervisor_replacement_not_retained");
  await supervisor.page.goto(base + savedHref);
  await supervisor.page.getByRole("heading", { name: "This support action changed or was decided" }).waitFor({ timeout: 15000 });
  await supervisor.page.getByRole("link", { name: "Return to refreshed My Work" }).click();
  if (await supervisor.page.locator(`a[href*="focus=supply-document"][href*="turnover=${turnoverId}"]`).count())
    throw new Error("submitted_supplier_task_still_current");
  await supervisor.context.close();

  const reviewer = await signIn(byKey("operations"));
  await (await exactLink(reviewer.page, "review-document")).click();
  const retained = row(reviewer.page).getByRole("link", { name: "Open retained " + submitted.filename });
  const response = await reviewer.page.request.get(new URL(await retained.getAttribute("href"), base));
  if (!response.ok() || !Buffer.from(await response.body()).equals(bytes)) throw new Error("reviewer_pdf_bytes_mismatch");
  await reviewer.page.reload();
  await reviewer.page.getByRole("heading", { name: "Assigned documentation obligations" }).waitFor({ timeout: 15000 });
  if (!await row(reviewer.page).getByText("Awaiting independent review").count())
    throw new Error("independent_review_not_pending_after_reload");
  await reviewer.context.close();
  console.log(JSON.stringify({ result: "support_supplier_queue_positive_browser_pass", workId, turnoverId,
    originalEvidenceId: original.id, returnedEvidenceId: pmSubmitted.id, pendingEvidenceId: submitted.id,
    sha256, observed: ["pm_submitted_replacement", "operations_returned", "named_supervisor_opened_my_work_task",
      "other_supervisor_excluded", "supervisor_submitted", "stale_supply_link_rejected",
      "independent_operations_review_pending", "reviewer_downloaded_exact_bytes"] }));
} finally { await browser.close(); }
