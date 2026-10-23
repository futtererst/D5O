import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const origin = process.env.D5O_REHEARSAL_BROWSER_URL;
if (origin !== "http://127.0.0.1:61643" ||
    process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:56621" ||
    !process.env.D5O_PILOT_CREDENTIALS_FILE) throw new Error("disposable_rehearsal_only");

const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const work = "rybex-f50b8a6e7c174052ba298491a6ce1037";
const browser = await chromium.launch({ headless: true });

async function open(key, section) {
  const user = users.find((item) => item.key === key);
  if (!user) throw new Error(`pilot_user_missing:${key}`);
  const context = await browser.newContext();
  const page = await context.newPage();
  const path = `/work?workspace=rybex&view=record&section=${section}&record=${work}`;
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent(path)}`);
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.waitForURL((url) => url.pathname === "/work", { timeout: 30000 });
  await page.reload();
  return { context, page };
}

try {
  for (const key of ["pm", "operations", "finance"]) {
    const { context, page } = await open(key, "Operate");
    await page.getByRole("heading", { name: "Keep accepted work working" }).waitFor();
    const body = await page.locator("body").innerText();
    if (!body.includes("e68c959727eb") || !body.includes("Synthetic Route Entry Cabling"))
      throw new Error(`build_or_work_missing:${key}`);
    await page.getByRole("button", { name: "Finance & lessons", exact: true }).click();
    await page.getByRole("heading", { name: "Job cost, margin and billing readiness" }).waitFor();
    const finance = await page.locator("body").innerText();
    if (!finance.includes("FICTIONAL-INVOICE-FICTIONAL-NORTH-BILL-REV3") ||
        !finance.includes("FICTIONAL-INVOICE-FICTIONAL-SOUTH-BILL") ||
        !finance.includes("FICTIONAL-REMITTANCE-PARTIAL-01") ||
        !finance.includes("Fictional pilot: revised contract fully billed"))
      throw new Error(`retained_finance_missing:${key}`);
    if (key === "pm") {
      const probe = await page.evaluate(async () => {
        const workId = "rybex-9e4f1e5f9e6b4e429142d3b01e1825e5";
        const path = `/api/d5o-hosted/job-finance?workspace=rybex&workId=${workId}`;
        const before = await (await fetch(path)).json();
        const line = { packageId: "wp-29a99d91129147a4853b2449fc7ee7e7",
          evidenceId: "d945f2e5-ad19-45f7-9cd8-8422dc947780",
          description: "Fictional API aggregate rejection", quantity: "6",
          unit: "control points", amountMinor: 1000 };
        const response = await fetch("/api/d5o-hosted/job-finance", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspace: "rybex", workId, action: "draft-bill",
            expectedRevision: before.revision, commandId: crypto.randomUUID(),
            data: { lines: [line, line] } })
        });
        const body = await response.json();
        const after = await (await fetch(path)).json();
        return { status: response.status, error: body.error,
          unchanged: before.revision === after.revision &&
            before.bills.length === after.bills.length &&
            before.cashEvents.length === after.cashEvents.length };
      });
      if (probe.status !== 409 || probe.error !== "billing_exceeds_accepted_quantity" || !probe.unchanged)
        throw new Error(`api_aggregate_probe_failed:${JSON.stringify(probe)}`);
      console.log(JSON.stringify({ api: "billing_exceeds_accepted_quantity", status: 409, unchanged: true }));
    }
    console.log(JSON.stringify({ role: key, source: "e68c959727eb", finance: "Closed", reloaded: true }));
    await context.close();
  }
} finally {
  await browser.close();
}
