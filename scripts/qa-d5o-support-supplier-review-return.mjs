import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

if (process.env.D5O_RUN_FICTIONAL_SUPPORT_MUTATIONS !== "1" ||
  process.env.D5O_LOCAL_PREVIEW !== "http://127.0.0.1:61650")
  throw new Error("explicit_supplier_clone_mutation_required");
const base = process.env.D5O_LOCAL_PREVIEW;
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS, "utf8")).users;
const second = JSON.parse(readFileSync(process.env.D5O_SECOND_SUPERVISOR_CREDENTIALS, "utf8"));
const workId = "rybex-9e4f1e5f9e6b4e429142d3b01e1825e5";
const turnoverId = "26241096-02c1-4699-8bdc-759f5d83a426";
const evidenceId = "ae4bdd50-1a34-4ebd-bdf3-3e1bfebdf62f";
const reason = "Fictional index lacks verified installed route coordinates and label schedule; provide the actual as-built record for this accepted package.";
const expectedBytes = readFileSync("output/pdf/d5o-fictional-support/north-as-built.pdf");
const browser = await chromium.launch({ headless: true });
async function session(user) {
  const context = await browser.newContext(), page = await context.newPage();
  await page.goto(base + "/auth/sign-in?next=" + encodeURIComponent("/work?workspace=rybex&view=my-work"));
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.getByRole("heading", { name: "Actions requiring attention" }).waitFor({ timeout: 30000 });
  if (!(await page.locator("body").innerText()).includes("Build 717cc0f9aece"))
    throw new Error("displayed_build_mismatch");
  return { context, page };
}
const reviewLink = `a[href*="focus=review-document"][href*="record=${workId}"][href*="turnover=${turnoverId}"][href*="documentKind=as-built"]`;
const supplyLink = `a[href*="focus=supply-document"][href*="record=${workId}"][href*="turnover=${turnoverId}"][href*="documentKind=as-built"]`;
try {
  const ops = await session(users.find((item) => item.key === "operations"));
  const link = ops.page.locator(reviewLink);
  await link.waitFor({ timeout: 30000 });
  if (await link.count() !== 1) throw new Error("independent_review_task_not_unique");
  const savedLink = new URL(await link.getAttribute("href"), base).href;
  await link.click();
  const panel = ops.page.locator('section[aria-label="Accepted turnover documentation"] article')
    .filter({ hasText: turnoverId }).filter({ hasText: "As-built controls record" });
  const retained = panel.locator(`a[href*="evidenceId=${evidenceId}"]`);
  const document = await ops.page.request.get(new URL(await retained.getAttribute("href"), base).href);
  if (!document.ok()) throw new Error("reviewer_retrieval_rejected:" + document.status());
  const actualBytes = Buffer.from(await document.body());
  if (!actualBytes.equals(expectedBytes)) throw new Error("retained_pdf_bytes_changed");
  await panel.locator('select[name="decision"]').selectOption("Returned");
  await panel.locator('input[name="note"]').fill(reason);
  const responsePromise = ops.page.waitForResponse((response) => response.url().includes("prototype-operate-command") && response.request().method() === "POST", { timeout: 30000 });
  await panel.getByRole("button", { name: "Record independent review" }).click();
  const response = await responsePromise;
  if (!response.ok()) throw new Error("review_command_failed:" + response.status() + ":" + await response.text());
  await ops.page.goto(base + "/work?workspace=rybex&view=my-work");
  await ops.page.getByRole("heading", { name: "Actions requiring attention" }).waitFor({ timeout: 30000 });
  await ops.page.waitForTimeout(1500);
  if (await ops.page.locator(reviewLink).count()) throw new Error("decided_review_still_actionable");
  await ops.page.goto(savedLink);
  await ops.page.getByRole("heading", { name: "This support action changed or was decided" }).waitFor({ timeout: 30000 });
  await ops.page.getByRole("link", { name: /Return to refreshed My Work/ }).waitFor();
  const scoped = await ops.page.evaluate(async (id) => {
    const response = await fetch("/api/d5o-hosted/prototype-state?workspace=rybex&key=work");
    const body = await response.json();
    return body.state.records.find((item) => item.id === id);
  }, workId);
  const history = scoped.operate.documentationObligations.filter((item) =>
    item.turnoverId === turnoverId && item.kind === "as-built");
  if (history.length < 3 || history.at(-1).id !== evidenceId || history.at(-1).status !== "Returned" ||
    history.at(-1).reviewReason !== reason || history.at(-2).status !== "Returned" ||
    history.at(-3).status !== "Reviewed") throw new Error("returned_document_history_mismatch");
  if (scoped.operate.activation?.status !== "Active") throw new Error("support_activation_changed");
  await ops.context.close();

  const supplier = await session(users.find((item) => item.key === "supervisor"));
  await supplier.page.locator(supplyLink).waitFor({ timeout: 30000 });
  if (await supplier.page.locator(supplyLink).count() !== 1) throw new Error("supplier_correction_task_not_unique");
  await supplier.page.reload();
  await supplier.page.locator(supplyLink).waitFor({ timeout: 30000 });
  await supplier.context.close();
  const other = await session(second);
  await other.page.waitForTimeout(1500);
  if (await other.page.locator(supplyLink).count()) throw new Error("foreign_supplier_correction_task_visible");
  await other.context.close();
  console.log(JSON.stringify({ result: "support_supplier_return_browser_pass", workId, turnoverId,
    evidenceId, sha256: createHash("sha256").update(actualBytes).digest("hex"), reason,
    observed: ["operations_review_returned", "retained_pdf_bytes_match", "saved_review_link_stale",
      "named_supplier_correction_visible_after_reload", "other_supervisor_excluded",
      "prior_review_history_retained", "support_still_active"] }));
} finally { await browser.close(); }
