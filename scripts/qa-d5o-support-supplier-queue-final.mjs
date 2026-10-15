import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

if (process.env.D5O_LOCAL_PREVIEW !== "http://127.0.0.1:61650")
  throw new Error("supplier_clone_preview_required");
const base = process.env.D5O_LOCAL_PREVIEW;
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS, "utf8")).users;
const second = JSON.parse(readFileSync(process.env.D5O_SECOND_SUPERVISOR_CREDENTIALS, "utf8"));
const workId = "rybex-9e4f1e5f9e6b4e429142d3b01e1825e5";
const turnoverId = "26241096-02c1-4699-8bdc-759f5d83a426";
const pendingId = "ae4bdd50-1a34-4ebd-bdf3-3e1bfebdf62f";
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
try {
  const worker = await session(users.find((item) => item.key === "supervisor"));
  if (await worker.page.locator(`a[href*="focus=supply-document"][href*="turnover=${turnoverId}"]`).count())
    throw new Error("submitted_supplier_task_still_actionable");
  await worker.context.close();
  const other = await session(second);
  if (await other.page.locator(`a[href*="focus=supply-document"][href*="turnover=${turnoverId}"]`).count())
    throw new Error("foreign_supplier_task_visible");
  await other.context.close();
  const ops = await session(users.find((item) => item.key === "operations"));
  const link = ops.page.locator(`a[href*="focus=review-document"][href*="record=${workId}"][href*="turnover=${turnoverId}"][href*="documentKind=as-built"]`);
  await link.waitFor({ timeout: 30000 });
  if (await link.count() !== 1) throw new Error("independent_review_task_not_unique");
  await link.click();
  const panel = ops.page.locator('section[aria-label="Accepted turnover documentation"] article')
    .filter({ hasText: turnoverId }).filter({ hasText: "As-built controls record" });
  const retained = panel.locator(`a[href*="evidenceId=${pendingId}"]`);
  const response = await ops.page.request.get(new URL(await retained.getAttribute("href"), base).href);
  if (!response.ok()) throw new Error("reviewer_retrieval_rejected:" + response.status());
  const actualBytes = Buffer.from(await response.body());
  if (!actualBytes.equals(expectedBytes)) throw new Error("retained_pdf_bytes_changed");
  await ops.page.reload();
  await panel.getByText("Awaiting independent review").waitFor({ timeout: 30000 });
  const scoped = await ops.page.evaluate(async (id) => {
    const response = await fetch("/api/d5o-hosted/prototype-state?workspace=rybex&key=work");
    const body = await response.json();
    return body.state.records.find((item) => item.id === id);
  }, workId);
  const history = scoped.operate.documentationObligations.filter((item) =>
    item.turnoverId === turnoverId && item.kind === "as-built");
  if (history.length < 3 || history.at(-1).id !== pendingId || history.at(-1).status !== "Submitted" ||
    history.at(-2).status !== "Returned" || history.at(-3).status !== "Reviewed")
    throw new Error("document_decision_history_changed");
  await ops.context.close();
  console.log(JSON.stringify({ result: "support_supplier_queue_positive_browser_pass", workId, turnoverId,
    pendingEvidenceId: pendingId, sha256: createHash("sha256").update(actualBytes).digest("hex"),
    observed: ["supervisor_supply_task_removed", "other_supervisor_excluded", "operations_review_card_current",
      "retained_pdf_bytes_match", "review_still_pending_after_reload", "prior_review_and_return_preserved"] }));
} finally { await browser.close(); }
