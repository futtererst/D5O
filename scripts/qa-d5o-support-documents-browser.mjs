import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
const base = "http://127.0.0.1:61643", workId = "rybex-d86cdd4cd0c04dea97da79c382cf790c";
const users = JSON.parse(readFileSync(process.env.TEMP + "/d5o-fresh-replay-final2-20261009/pilot/pilot-credentials.json", "utf8")).users;
const items = [
  { turnover: "6cca5386-2805-4482-ab91-4fd6d6879cfe", kind: "as-built", file: "north-as-built.pdf" },
  { turnover: "6cca5386-2805-4482-ab91-4fd6d6879cfe", kind: "inspection", file: "north-inspection.pdf" },
  { turnover: "8a8fd746-0c2f-4039-b2a2-5feb177045ef", kind: "as-built", file: "south-as-built.pdf" },
  { turnover: "8a8fd746-0c2f-4039-b2a2-5feb177045ef", kind: "inspection", file: "south-inspection.pdf" }
];
if (process.env.D5O_RUN_FICTIONAL_SUPPORT_MUTATIONS !== "1") throw new Error("explicit_disposable_fixture_mutation_required");
const browser = await chromium.launch({ headless: true });
const landing = base + "/work?workspace=rybex&view=my-work";
async function login(key) {
  const user = users.find((item) => item.key === key);
  const context = await browser.newContext(), page = await context.newPage();
  await page.goto(base + "/auth/sign-in?next=" + encodeURIComponent("/work?workspace=rybex&view=my-work"));
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.getByRole("heading", { name: "Actions requiring attention" }).waitFor({ timeout: 30000 });
  return { context, page };
}
async function openQueue(page, kind, item) {
  await page.goto(landing);
  await page.getByRole("heading", { name: "Actions requiring attention" }).waitFor({ timeout: 30000 });
  const links = page.locator('a[href*="focus=' + kind + '"]');
  await links.first().waitFor({ timeout: 30000 });
  const count = await links.count();
  for (let n = 0; n < count; n++) {
    const href = await links.nth(n).getAttribute("href");
    if (href?.includes("record=" + workId) && href.includes("turnover=" + item.turnover) &&
      href.includes("documentKind=" + item.kind)) {
      await links.nth(n).click();
      await page.locator('section[aria-label="Accepted turnover documentation"]').waitFor({ timeout: 30000 });
      return;
    }
  }
  console.log("queue_links", await links.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href"))));
  throw new Error("queue_action_missing:" + kind + ":" + item.file);
}
function row(page, item) {
  return page.locator('section[aria-label="Accepted turnover documentation"] article')
    .filter({ hasText: item.turnover })
    .filter({ hasText: item.kind === "as-built" ? "As-built controls record" : "Inspection retention" });
}
const observed = [];
try {
  const pm = await login("pm");
  for (const item of items) {
    const prior = await pm.page.evaluate(async ({ workId, item }) => {
      const body = await (await fetch("/api/d5o-hosted/prototype-state?workspace=rybex&key=work")).json();
      const work = body.state.records.find((row) => row.id === workId);
      return work.operate?.documentationObligations?.find((doc) => doc.turnoverId === item.turnover && doc.kind === item.kind)?.status;
    }, { workId, item });
    if (prior === "Submitted" || prior === "Reviewed") { observed.push({ actor: "pm", action: "already-submitted", file: item.file }); continue; }
    await openQueue(pm.page, "supply-document", item);
    const target = row(pm.page, item);
    if (await target.count() !== 1) throw new Error("document_row_ambiguous:" + item.file);
    await target.locator('input[name="file"]').setInputFiles("output/pdf/d5o-fictional-support/" + item.file);
    await target.locator('input[name="note"]').fill("Fictional pilot source index supplied for exact accepted package and release.");
    const commandResponse = pm.page.waitForResponse((response) => response.url().includes("prototype-operate-command") && response.request().method() === "POST");
    await target.getByRole("button", { name: "Retain and submit document" }).click();
    const committed = await commandResponse;
    if (!committed.ok()) throw new Error("submit_command_failed:" + committed.status() + ":" + await committed.text());
    observed.push({ actor: "pm", action: "submit", file: item.file, turnover: item.turnover });
  }
  await pm.context.close();
  const reviewer = await login("quality");
  for (const item of items) {
    await openQueue(reviewer.page, "review-document", item);
    const target = row(reviewer.page, item);
    if (await target.count() !== 1) throw new Error("review_row_ambiguous:" + item.file);
    const file = target.getByRole("link", { name: "Open retained " + item.file });
    const response = await reviewer.page.request.get(new URL(await file.getAttribute("href"), base).href);
    if (!response.ok()) throw new Error("reviewer_document_unavailable:" + response.status());
    const bytes = await response.body();
    const expected = readFileSync("output/pdf/d5o-fictional-support/" + item.file);
    if (!bytes.equals(expected)) throw new Error("reviewer_document_bytes_changed:" + item.file);
    await target.locator('select[name="decision"]').selectOption("Reviewed");
    await target.locator('input[name="note"]').fill("Fictional pilot index inspected against exact retained source and accepted package.");
    const reviewResponse = reviewer.page.waitForResponse((response) => response.url().includes("prototype-operate-command") && response.request().method() === "POST");
    await target.getByRole("button", { name: "Record independent review" }).click();
    const committed = await reviewResponse;
    if (!committed.ok()) throw new Error("review_command_failed:" + committed.status() + ":" + await committed.text());
    observed.push({ actor: "quality", action: "review", file: item.file,
      sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  await reviewer.page.goto(base + "/work?workspace=rybex&view=handoff");
  await reviewer.page.getByRole("heading", { name: "Current scope and receiving responsibility" }).waitFor({ timeout: 30000 });
  const board = await reviewer.page.locator("button").filter({ hasText: "Synthetic Production UI Command Trial F" }).first().innerText();
  if (!board.includes("Reviewed support documents: 4/4")) throw new Error("handoff_document_count_mismatch");
  await reviewer.context.close();
  console.log(JSON.stringify({ result: "support_document_browser_pass", observed }));
} finally { await browser.close(); }
