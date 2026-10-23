import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

if (process.env.D5O_RUN_FICTIONAL_SUPPORT_MUTATIONS !== "1" ||
  process.env.D5O_LOCAL_PREVIEW !== "http://127.0.0.1:61650")
  throw new Error("exact_disposable_clone_required");
const stage = process.argv[2];
if (!["submit", "review", "inspect"].includes(stage)) throw new Error("select_submit_review_or_inspect_stage");
const base = process.env.D5O_LOCAL_PREVIEW;
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS, "utf8")).users;
const byKey = (key) => users.find((item) => item.key === key);
const workId = "rybex-9e4f1e5f9e6b4e429142d3b01e1825e5";
const turnoverId = "26241096-02c1-4699-8bdc-759f5d83a426";
const priorId = "ae4bdd50-1a34-4ebd-bdf3-3e1bfebdf62f";
const file = "output/pdf/d5o-fictional-support/north-as-built-v2.pdf";
const bytes = readFileSync(file), sha256 = createHash("sha256").update(bytes).digest("hex");
const browser = await chromium.launch({ headless: true });
const landing = base + "/work?workspace=rybex&view=my-work";
async function signIn(user) {
  const context = await browser.newContext(), page = await context.newPage();
  await page.goto(base + "/auth/sign-in?next=" + encodeURIComponent("/work?workspace=rybex&view=my-work"));
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  try { await page.getByRole("heading", { name: "Actions requiring attention" }).waitFor({ timeout: 30000 }); }
  catch { throw new Error("fictional_signin_landing_unavailable:" + page.url() + ":" +
    (await page.locator("body").innerText()).slice(0, 650)); }
  if (!(await page.locator("body").innerText()).includes("Build 717cc0f9aece"))
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
function history(work) {
  return work.operate.documentationObligations.filter((item) =>
    item.turnoverId === turnoverId && item.kind === "as-built");
}
function row(page) {
  return page.locator('section[aria-label="Accepted turnover documentation"] article')
    .filter({ hasText: turnoverId }).filter({ hasText: "As-built controls record" });
}
async function link(page, focus) {
  await page.goto(landing);
  await page.getByRole("heading", { name: "Actions requiring attention" }).waitFor({ timeout: 30000 });
  const exact = page.locator(`a[href*="focus=${focus}"][href*="record=${workId}"][href*="turnover=${turnoverId}"][href*="documentKind=as-built"]`);
  await exact.waitFor({ timeout: 30000 });
  if (await exact.count() !== 1) throw new Error("exact_task_not_unique:" + focus);
  return exact;
}
try {
  if (stage === "inspect") {
    const ops = await signIn(byKey("operations"));
    const currentDocument = history(await current(ops.page)).at(-1);
    const projected = await ops.page.evaluate(async (id) => {
      const response = await fetch("/api/d5o-hosted/prototype-search?workspace=rybex&view=actions");
      const body = await response.json();
      return { status: response.status, actorRole: body.actorRole,
        actions: (body.supportActions ?? []).filter((item) => item.workId === id).map((item) =>
          ({ kind: item.kind, turnoverId: item.turnoverId, documentKind: item.documentKind,
            decisionId: item.decisionId, position: item.position })) };
    }, workId);
    const links = await ops.page.locator('a[href*="focus=review-document"]').evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("href")));
    let focused = null;
    if (links.length) {
      await ops.page.locator('a[href*="focus=review-document"]').first().click();
      await ops.page.waitForTimeout(1000);
      focused = { url: ops.page.url(), body: (await ops.page.locator("body").innerText()).slice(0, 2000),
        evidenceLinks: await ops.page.locator('a[href*="evidenceId="]').evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute("href"))) };
    }
    console.log(JSON.stringify({ stage: "inspect", currentDocument: { id: currentDocument.id,
      status: currentDocument.status, supersedesId: currentDocument.supersedesId,
      checksumSha256: currentDocument.checksumSha256 }, projected, links, focused }));
    await ops.context.close();
  } else if (stage === "submit") {
    const supplier = await signIn(byKey("supervisor"));
    const before = await current(supplier.page);
    if (history(before).at(-1)?.id !== priorId || history(before).at(-1)?.status !== "Returned")
      throw new Error("previous_return_not_current");
    const task = await link(supplier.page, "supply-document");
    const saved = new URL(await task.getAttribute("href"), base).href;
    await task.click();
    await row(supplier.page).locator('input[name="file"]').setInputFiles(file);
    await row(supplier.page).locator('input[name="note"]').fill(
      "Fictional simulated route and label schedule for the exact North turnover; no real site verification is claimed.");
    const upload = supplier.page.waitForResponse((response) => response.url().includes("customer-decision-evidence") && response.request().method() === "POST", { timeout: 30000 });
    const command = supplier.page.waitForResponse((response) => response.url().includes("prototype-operate-command") && response.request().method() === "POST", { timeout: 30000 });
    await row(supplier.page).getByRole("button", { name: "Retain and submit document" }).click();
    const uploaded = await upload;
    if (!uploaded.ok()) throw new Error("upload_rejected:" + uploaded.status());
    const committed = await command;
    if (!committed.ok()) throw new Error("submission_rejected:" + committed.status() + ":" + (await committed.json()).error);
    const submitted = history(await current(supplier.page)).at(-1);
    if (submitted?.status !== "Submitted" || submitted.supersedesId !== priorId || submitted.checksumSha256 !== sha256)
      throw new Error("scope_or_checksum_not_retained");
    await supplier.page.goto(saved);
    await supplier.page.getByRole("heading", { name: "This support action changed or was decided" }).waitFor({ timeout: 30000 });
    await supplier.context.close();
    const ops = await signIn(byKey("operations"));
    await link(ops.page, "review-document");
    await ops.context.close();
    console.log(JSON.stringify({ stage: "fictional_asbuilt_submitted", evidenceId: submitted.id, sha256,
      priorId, workId, turnoverId, observed: ["named_supervisor_submitted_exact_pdf", "supplier_link_stale", "operations_review_task_available"] }));
  } else {
    const ops = await signIn(byKey("operations"));
    const before = history(await current(ops.page));
    const submitted = before.at(-1);
    if (submitted?.status !== "Submitted" || submitted.supersedesId !== priorId || submitted.checksumSha256 !== sha256)
      throw new Error("submitted_fictional_asbuilt_not_current");
    const task = await link(ops.page, "review-document");
    const saved = new URL(await task.getAttribute("href"), base).href;
    await task.click();
    const retained = row(ops.page).locator(`a[href*="evidenceId=${submitted.id}"]`);
    const download = await ops.page.request.get(new URL(await retained.getAttribute("href"), base).href);
    if (!download.ok() || !Buffer.from(await download.body()).equals(bytes))
      throw new Error("retained_fictional_pdf_bytes_changed");
    await row(ops.page).locator('select[name="decision"]').selectOption("Reviewed");
    await row(ops.page).locator('input[name="note"]').fill(
      "Fictional simulation reviewed for the exact North package: route coordinates, label schedule and inspection link are present. This is not real field verification.");
    const command = ops.page.waitForResponse((response) => response.url().includes("prototype-operate-command") && response.request().method() === "POST", { timeout: 30000 });
    await row(ops.page).getByRole("button", { name: "Record independent review" }).click();
    const committed = await command;
    if (!committed.ok()) throw new Error("review_rejected:" + committed.status() + ":" + (await committed.json()).error);
    const after = await current(ops.page);
    const reviewed = history(after).at(-1);
    if (reviewed.id !== submitted.id || reviewed.status !== "Reviewed" ||
      reviewed.checksumSha256 !== sha256 || history(after).at(-2).status !== "Returned" ||
      after.operate.activation?.status !== "Active") throw new Error("review_or_history_not_retained");
    await ops.page.goto(landing);
    await ops.page.getByRole("heading", { name: "Actions requiring attention" }).waitFor({ timeout: 30000 });
    await ops.page.waitForTimeout(1000);
    if (await ops.page.locator(`a[href*="focus=review-document"][href*="turnover=${turnoverId}"][href*="documentKind=as-built"]`).count())
      throw new Error("review_task_still_actionable");
    await ops.page.goto(saved);
    await ops.page.getByRole("heading", { name: "This support action changed or was decided" }).waitFor({ timeout: 30000 });
    await ops.context.close();
    console.log(JSON.stringify({ stage: "fictional_asbuilt_reviewed", evidenceId: reviewed.id,
      sha256, workId, turnoverId, observed: ["operations_downloaded_exact_bytes", "independent_review_retained",
        "prior_return_history_preserved", "support_still_active", "review_task_removed", "saved_link_stale"] }));
  }
} finally { await browser.close(); }
