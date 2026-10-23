import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { chromium } from "playwright";

if (process.env.D5O_COMMAND_RUNTIME !== "rehearsal" ||
  process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:56621" ||
  !process.env.D5O_PILOT_CREDENTIALS_FILE)
  throw new Error("disposable_rehearsal_only");

const origin = "http://127.0.0.1:61643";
const workId = "rybex-9e4f1e5f9e6b4e429142d3b01e1825e5";
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const browser = await chromium.launch({ headless: true });

async function open(role, section) {
  const user = users.find((item) => item.key === role);
  assert(user, `missing_${role}`);
  const context = await browser.newContext();
  const page = await context.newPage();
  const path = `/work?workspace=rybex&view=record&section=${section}&record=${workId}`;
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent(path)}`);
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.waitForURL(/\/work/, { timeout: 30000 });
  return { context, page };
}

try {
  const pm = await open("pm", "Deploy");
  await pm.page.getByText("Acceptance basis changed · review required").waitFor();
  await pm.page.getByText("Historical customer acceptance covers 2 package turnovers.", { exact: false }).waitFor();
  await pm.page.reload();
  await pm.page.getByText("Acceptance basis changed · review required").waitFor();
  const source = await pm.page.evaluate(async () => {
    const response = await fetch("/api/d5o-hosted/prototype-state?workspace=rybex&key=work");
    const payload = await response.json();
    return { status: response.status, record: payload.state.records.find((item) => item.id === "rybex-9e4f1e5f9e6b4e429142d3b01e1825e5") };
  });
  assert.equal(source.status, 200);
  assert.equal(source.record.packages.length, 3);
  assert.equal(source.record.deploy.workAcceptance.turnoverIds.length, 2);
  assert.equal(source.record.deploy.workAcceptance.receipt, "Accepted");
  assert.equal(source.record.operate.finance.status, "Closed");
  await pm.context.close();

  const finance = await open("finance", "Operate");
  await finance.page.getByText("The recorded customer acceptance, Operations receipt and Finance decision remain in history", { exact: false }).waitFor();
  await finance.page.reload();
  await finance.page.getByText("The recorded customer acceptance, Operations receipt and Finance decision remain in history", { exact: false }).waitFor();
  await finance.context.close();
  console.log(JSON.stringify({ status: "post_acceptance_scope_browser_passed", currentPackages: 3,
    retainedAcceptedTurnovers: 2, retainedReceipt: "Accepted", retainedFinance: "Closed",
    roles: ["pm", "finance"], reloaded: true }));
} finally { await browser.close(); }
