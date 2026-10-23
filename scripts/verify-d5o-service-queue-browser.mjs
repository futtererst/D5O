import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

if (process.env.D5O_QUEUE_TARGET_URL !== "http://127.0.0.1:56821" ||
  process.env.D5O_QUEUE_ORIGIN !== "http://127.0.0.1:61645") throw new Error("disposable_queue_fixture_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const origin = process.env.D5O_QUEUE_ORIGIN;
const requestId = "abe94af3-bdc5-435b-b6ad-ca810293988e";
const pdf = join(process.env.TEMP, "FICTIONAL-D5O-service-billing-terms-52465.pdf");
const browser = await chromium.launch({ headless: true });
async function role(key) {
  const person = users.find((entry) => entry.key === key);
  if (!person) throw new Error(`missing_${key}`);
  const context = await browser.newContext();
  const page = await context.newPage();
  const next = "/work?workspace=rybex&view=my-work";
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent(next)}`);
  await page.locator('input[name="email"]').fill(person.email);
  await page.locator('input[name="password"]').fill(person.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.getByRole("heading", { name: "Actions requiring attention" }).waitFor({ timeout: 60_000 });
  return { context, page };
}
async function queueAction(session, kind) {
  await session.page.goto(`${origin}/work?workspace=rybex&view=my-work`);
  const queue = session.page.locator('section[aria-label="Service commercial and Finance actions"]');
  await queue.getByText(`Synthetic monitoring route fault · ${kind}`).waitFor({ timeout: 40_000 });
  await queue.getByRole("link", { name: new RegExp(`Synthetic monitoring route fault · ${kind}`) }).click();
  if (!session.page.url().includes(`request=${requestId}`)) throw new Error("request_link_not_exact");
  const panel = session.page.locator('section[aria-label="Service financial disposition"]');
  await panel.getByText("Partially covered · Closed").waitFor({ timeout: 40_000 });
  return panel;
}
async function recordTerms(panel, suffix) {
  await panel.locator('input[type="file"]').setInputFiles(pdf);
  await panel.getByRole("button", { name: "Retain PDF" }).click();
  await panel.getByRole("link", { name: "Open retained PDF for review" }).waitFor();
  const form = panel.locator("form").filter({ hasText: "Record customer billing-terms supplement" });
  await form.locator('select[name="paymentTerms"]').selectOption({ label: "Net 30 days from invoice" });
  await form.locator('input[name="customerParty"]').fill("Fictional Casey Customer");
  await form.locator('input[name="customerOrganization"]').fill("Fictional North Campus Properties");
  await form.locator('input[name="customerRole"]').fill("Site service representative");
  await form.locator('input[name="authorityBasis"]').fill("Fictional delegated authority for the exact uncovered scope and amount");
  await form.locator('input[name="note"]').fill(`Fictional PDF ${suffix} reviewed for exact USD 524.65 fixed fee and Net 30 terms.`);
  await form.getByRole("button", { name: "Record retained supplement" }).click();
  await panel.getByText(new RegExp(`Customer billing terms · revision ${suffix === "original" ? 1 : 2}`)).waitFor();
}
try {
  const pm = await role("pm");
  const first = await queueAction(pm, "Service Finance preparation");
  const prep = first.locator("form").filter({ hasText: "Prepare exact service basis" });
  await prep.locator('input[name="note"]').fill("Prepare fictional completed service for independent Finance review while billing terms remain unresolved.");
  const [preparedResponse] = await Promise.all([
    pm.page.waitForResponse((response) => response.url().includes("/service-finance") && response.request().method() === "POST"),
    prep.getByRole("button", { name: "Prepare Finance review" }).click()
  ]);
  if (!preparedResponse.ok()) throw new Error(`prepare_rejected:${preparedResponse.status()}:${(await preparedResponse.json()).error}`);
  await first.getByText("Prepared", { exact: true }).waitFor();

  const finance = await role("finance");
  const held = await queueAction(finance, "Service Finance review");
  const hold = held.locator("form").filter({ hasText: "Concrete Finance hold reason" });
  await hold.locator('input[name="note"]').fill("Retained billing terms are missing; obtain a customer source for USD 524.65 uncovered scope before billing readiness.");
  await hold.getByRole("button", { name: "Hold billing" }).click();
  await held.getByText("Hold", { exact: true }).waitFor();

  const follow = await queueAction(pm, "Service terms follow-up");
  await recordTerms(follow, "original");
  const prep2 = follow.locator("form").filter({ hasText: "Prepare exact service basis" });
  await prep2.locator('input[name="note"]').fill("Prepare exact fictional supplemental terms and source for independent Finance reassessment.");
  await prep2.getByRole("button", { name: "Prepare Finance review" }).click();
  await follow.getByText("Prepared", { exact: true }).waitFor();

  const review = await queueAction(finance, "Service Finance review");
  const ready = review.locator("form").filter({ hasText: "Why the retained terms make" });
  await ready.locator('input[name="note"]').fill("Independently checked fictional retained terms: USD 524.65 fixed fee for uncovered scope after service acceptance, Net 30.");
  await ready.getByRole("button", { name: "Mark supported amount ready for billing" }).click();
  await review.getByText("Ready for billing", { exact: true }).waitFor();
  await finance.page.goto(`${origin}/work?workspace=rybex&view=my-work`);
  const info = finance.page.locator('section[aria-label="Service commercial and Finance actions"]');
  await info.getByText("Synthetic monitoring route fault · Service billing handoff").waitFor();
  if (!(await info.innerText()).includes("no invoice or payment")) throw new Error("missing_invoice_handoff");

  const complete = await queueAction(pm, "Service billing handoff");
  await recordTerms(complete, "superseding");
  await queueAction(pm, "Service Finance reassessment");
  await finance.page.goto(`${origin}/work?workspace=rybex&view=my-work`);
  await finance.page.locator('section[aria-label="Service commercial and Finance actions"]')
    .getByText("Synthetic monitoring route fault · Service Finance reassessment").waitFor();
  console.log(JSON.stringify({ pm: "Hold opened from My Work; terms recorded; basis prepared; superseded source requires reassessment",
    finance: "Independent Hold then Ready for billing from My Work", requestId,
    final: "Historical Ready retained; current source awaits preparation", invoice: "none", payment: "none" }));
  await finance.context.close(); await pm.context.close();
} finally { await browser.close(); }
