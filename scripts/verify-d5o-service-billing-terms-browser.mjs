import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

if (process.env.D5O_REHEARSAL_TARGET_URL !== "http://127.0.0.1:56321" ||
  !process.env.D5O_PILOT_CREDENTIALS_FILE)
  throw new Error("disposable_pilot_only");

const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const origin = process.env.D5O_PILOT_ORIGIN || "http://127.0.0.1:61644";
const target = "/work?workspace=rybex&view=record&section=Operate&record=rybex-a8fd95e7e20d4bb3881c3549459c99e0&focus=finance";
const pdf = join(process.env.TEMP, "FICTIONAL-D5O-service-billing-terms-52465.pdf");
const browser = await chromium.launch({ headless: true });

async function openRole(key) {
  const person = users.find((entry) => entry.key === key);
  if (!person) throw new Error(`missing_${key}_account`);
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent(target)}`);
  await page.locator('input[name="email"]').fill(person.email);
  await page.locator('input[name="password"]').fill(person.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.getByRole("button", { name: "Finance & lessons" }).click();
  const panel = page.locator('section[aria-label="Service financial disposition"]');
  await panel.getByText("Partially covered · Closed").waitFor({ timeoutMs: 30_000 });
  return { context, page, panel };
}

try {
  const pm = await openRole("pm");
  const initial = await pm.panel.innerText();
  if (!initial.includes("Hold") || !initial.includes("$524.65") ||
    !initial.includes("not established by a current retained terms supplement"))
    throw new Error(`unexpected_initial_finance:${initial}`);

  await pm.panel.locator('input[type="file"]').setInputFiles(pdf);
  await pm.panel.getByRole("button", { name: "Retain PDF" }).click();
  await pm.panel.getByRole("link", { name: "Open retained PDF for review" }).waitFor();
  const form = pm.panel.locator("form").filter({ hasText: "Record customer billing-terms supplement" });
  await form.locator('select[name="paymentTerms"]').selectOption({ label: "Net 30 days from invoice" });
  await form.locator('input[name="customerParty"]').fill("Fictional Casey Customer");
  await form.locator('input[name="customerOrganization"]').fill("Fictional North Campus Properties");
  await form.locator('input[name="customerRole"]').fill("Site service representative");
  await form.locator('input[name="authorityBasis"]').fill("Fictional delegated authority for the exact uncovered scope and amount");
  await form.locator('input[name="note"]').fill("Fictional PDF reviewed for fixed fee, acceptance trigger and Net 30 terms.");
  await form.getByRole("button", { name: "Record retained supplement" }).click();
  await pm.panel.getByText("Customer billing terms · revision 1").waitFor();

  const prepare = pm.panel.locator("form").filter({ hasText: "Prepare exact service basis" });
  await prepare.locator('input[name="note"]').fill("Project manager prepares exact current supplemental terms for independent Finance reassessment.");
  await prepare.getByRole("button", { name: "Prepare Finance review" }).click();
  await pm.panel.getByText("Prepared", { exact: true }).waitFor();
  await pm.page.reload();
  await pm.page.getByRole("button", { name: "Finance & lessons" }).click();
  await pm.panel.getByText("Prepared", { exact: true }).waitFor();

  const finance = await openRole("finance");
  const ready = finance.panel.locator("form").filter({ hasText: "Why the retained terms make" });
  await ready.locator('input[name="note"]').fill(
    "Independently reviewed the fictional PDF: USD 524.65 fixed fee only for uncovered scope, after accepted service, Net 30 from invoice.");
  await ready.getByRole("button", { name: "Mark supported amount ready for billing" }).click();
  await finance.panel.getByText("Ready for billing", { exact: true }).waitFor();
  await finance.page.reload();
  await finance.page.getByRole("button", { name: "Finance & lessons" }).click();
  await finance.panel.getByText("Ready for billing", { exact: true }).waitFor();
  const final = await finance.panel.innerText();
  if (!final.includes("Partially covered · Closed") ||
    !final.includes("invoice: pending/unknown") ||
    !final.includes("payment: pending/unknown") ||
    !final.includes("Net 30 days from invoice"))
    throw new Error(`incorrect_final_finance:${final}`);
  console.log(JSON.stringify({ projectManager: "supplement recorded and prepared after reload",
    finance: "independent Ready for billing after reload",
    classification: "Partially covered", amount: "USD 524.65",
    invoice: "pending/unknown", payment: "pending/unknown" }));
  await finance.context.close();
  await pm.context.close();
} finally {
  await browser.close();
}
