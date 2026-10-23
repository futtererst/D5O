import { readFileSync } from "node:fs";
import { chromium } from "playwright";

if (process.env.D5O_ISOLATED_PILOT !== "1" || process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:56621" || !process.env.D5O_PILOT_CREDENTIALS_FILE) throw new Error("fresh_disposable_pilot_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const origin = "http://127.0.0.1:61642";
const workId = "rybex-9e4f1e5f9e6b4e429142d3b01e1825e5";
const evidenceId = "c4dc5b66-acf8-417e-8ce8-4d857120458c";
const browser = await chromium.launch({ headless: true });
async function session(key) {
  const user = users.find((item) => item.key === key);
  const context = await browser.newContext(), page = await context.newPage();
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent(`/work?workspace=rybex&view=record&section=Deploy&record=${workId}`)}`);
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.waitForURL(/\/work\?/, { timeout: 30000 });
  return { context, page };
}
const path = (work) => `/api/d5o-hosted/customer-decision-evidence?workspace=rybex&workId=${encodeURIComponent(work)}&evidenceId=${evidenceId}`;
try {
  const operations = await session("operations");
  const valid = await operations.page.evaluate(async (url) => (await fetch(url)).status, path(workId));
  const wrongWork = await operations.page.evaluate(async (url) => (await fetch(url)).status, path("rybex-d910a2a58a9c46038fb459436e1839c3"));
  if (valid !== 200 || wrongWork !== 404) throw new Error(`reviewer_scope:${valid}:${wrongWork}`);
  await operations.context.close();
  const worker = await session("worker");
  const restricted = await worker.page.evaluate(async (url) => (await fetch(url)).status, path(workId));
  if (restricted !== 403) throw new Error(`worker_can_read_customer_decision:${restricted}`);
  await worker.context.close();
  console.log(JSON.stringify({ status: "customer_document_retrieval_scope_passed", reviewer: valid, wrongWork, worker: restricted }));
} finally { await browser.close(); }
