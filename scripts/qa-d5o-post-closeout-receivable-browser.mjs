import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const mode = process.argv[2];
const origin = process.env.D5O_REHEARSAL_BROWSER_URL;
if (!["reproduce", "record", "verify"].includes(mode) || origin !== "http://127.0.0.1:61643" ||
    process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:56621" ||
    !process.env.D5O_PILOT_CREDENTIALS_FILE) throw new Error("disposable_rehearsal_only");

const finance = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8"))
  .users.find((user) => user.key === "finance");
if (!finance) throw new Error("finance_pilot_user_missing");
const workId = "rybex-f50b8a6e7c174052ba298491a6ce1037";
const path = `/work?workspace=rybex&view=record&section=Operate&record=${workId}&focus=finance`;
const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent(path)}`);
  await page.locator('input[name="email"]').fill(finance.email);
  await page.locator('input[name="password"]').fill(finance.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.waitForURL((url) => url.pathname === "/work", { timeout: 30000 });
  await page.getByRole("button", { name: "Finance & lessons", exact: true }).click();
  await page.getByRole("heading", { name: "Job cost, margin and billing readiness" }).waitFor();
  const read = async () => page.evaluate(async (id) => {
    const response = await fetch(`/api/d5o-hosted/job-finance?workspace=rybex&workId=${id}`);
    if (!response.ok) throw new Error(`finance_read_${response.status}`);
    return response.json();
  }, workId);
  const before = await read();
  if (mode === "verify") {
    const billed = before.cashEvents.filter((event) => event.kind === "Billed")
      .reduce((sum, event) => sum + event.amount_minor, 0);
    const paid = before.cashEvents.filter((event) => event.kind === "Paid")
      .reduce((sum, event) => sum + event.amount_minor, 0);
    if (before.financeStatus !== "Closed" || billed !== 10997715 || paid !== 2500000 ||
        !before.cashEvents.some((event) => event.source === "FICTIONAL-REMITTANCE-PARTIAL-01" && event.amount_minor === 2000000) ||
        !before.cashEvents.some((event) => event.source === "FICTIONAL-POST-CLOSEOUT-REMITTANCE-02" && event.amount_minor === 500000))
      throw new Error("retained_invoice_or_payment_mismatch");
    const body = await page.locator("body").innerText();
    if (!body.includes("Finance Closed") || !body.includes("$84,977.15") ||
        (process.env.D5O_EXPECTED_SOURCE_SHA && !body.includes(`Build ${process.env.D5O_EXPECTED_SOURCE_SHA.slice(0, 12)}`)) ||
        await page.getByRole("button", { name: "Record cost fact" }).count() ||
        await page.getByRole("button", { name: "Record billed event" }).count() ||
        await page.getByRole("button", { name: "Record paid event" }).count() !== 2)
      throw new Error("closed_finance_controls_or_receivable_mismatch");
    await page.reload();
    await page.getByRole("button", { name: "Finance & lessons", exact: true }).click();
    const after = await read();
    if (JSON.stringify(after.cashEvents) !== JSON.stringify(before.cashEvents) ||
        JSON.stringify(after.bills) !== JSON.stringify(before.bills) ||
        JSON.stringify(after.baseline) !== JSON.stringify(before.baseline))
      throw new Error("finance_history_changed_on_reload");
    console.log(JSON.stringify({ mode, finance: "Closed", billedMinor: billed,
      paidMinor: paid, receivableMinor: billed - paid, paymentEvents: 2,
      bills: after.bills.length, reloaded: true }));
  } else {
  const north = page.locator("article").filter({ hasText: "FICTIONAL-NORTH-BILL-REV3" }).last();
  const payment = north.locator('form:has(button:has-text("Record paid event"))');
  await payment.waitFor();
  const amount = mode === "reproduce" ? "100.00" : "5000.00";
  const source = mode === "reproduce" ? "FICTIONAL-REPRO-CLOSED-PAYMENT" :
    "FICTIONAL-POST-CLOSEOUT-REMITTANCE-02";
  if (mode === "record" && before.cashEvents.some((event) => event.source === source))
    throw new Error("fictional_payment_already_recorded");
  await payment.locator('input[name="amount"]').fill(amount);
  await payment.locator('input[name="date"]').fill("2026-10-10");
  await payment.locator('input[name="source"]').fill(source);
  const pending = page.waitForResponse((response) => response.url().includes("/api/d5o-hosted/job-finance") &&
    response.request().method() === "POST", { timeout: 30000 });
  await payment.getByRole("button", { name: "Record paid event" }).click();
  const response = await pending;
  const result = await response.json();
  const after = await read();
  const unchanged = before.revision === after.revision &&
    before.cashEvents.length === after.cashEvents.length;
  if (mode === "reproduce") {
    if (response.status() !== 409 || result.error !== "finance_closed_requires_reopen" || !unchanged)
      throw new Error(`original_rejection_not_reproduced:${JSON.stringify({ status: response.status(), result, unchanged })}`);
    console.log(JSON.stringify({ mode, status: 409, error: result.error, unchanged: true,
      priorPaidMinor: before.cashEvents.filter((event) => event.kind === "Paid")
        .reduce((sum, event) => sum + event.amount_minor, 0) }));
  } else {
    if (!response.ok() || after.revision !== before.revision + 1 ||
        after.cashEvents.length !== before.cashEvents.length + 1)
      throw new Error(`post_closeout_payment_failed:${JSON.stringify({ status: response.status(), result })}`);
    await page.reload();
    await page.getByRole("button", { name: "Finance & lessons", exact: true }).click();
    await page.getByText(source, { exact: false }).waitFor();
    const body = await page.locator("body").innerText();
    if (!body.includes("Finance Closed") || !body.includes("$84,977.15"))
      throw new Error("closed_status_or_partial_receivable_missing_after_reload");
    console.log(JSON.stringify({ mode, paidAddedMinor: 500000, ledgerRevision: after.revision,
      finance: "Closed", reloaded: true, receivableMinor: 8497715 }));
  }
  }
  await context.close();
} finally {
  await browser.close();
}
