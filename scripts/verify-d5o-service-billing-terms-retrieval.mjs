import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

if (process.env.D5O_REHEARSAL_TARGET_URL !== "http://127.0.0.1:56321" ||
  !process.env.D5O_PILOT_CREDENTIALS_FILE)
  throw new Error("disposable_pilot_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const origin = process.env.D5O_PILOT_ORIGIN || "http://127.0.0.1:61644";
const workId = "rybex-a8fd95e7e20d4bb3881c3549459c99e0";
const requestId = "abe94af3-bdc5-435b-b6ad-ca810293988e";
const id = "fb1adb39-7ec9-485b-b132-585f8a5ab1d6";
const pdf = join(process.env.TEMP, "FICTIONAL-D5O-service-billing-terms-52465.pdf");
const expected = createHash("sha256").update(readFileSync(pdf)).digest("hex");
const path = `/api/d5o-hosted/customer-decision-evidence?workspace=rybex&workId=${workId}&requestId=${requestId}&evidenceId=${id}`;
const browser = await chromium.launch({ headless: true });

async function signedIn(key) {
  const user = users.find((entry) => entry.key === key);
  if (!user) throw new Error(`missing_${key}_account`);
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${origin}/auth/sign-in?next=%2Fwork`);
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/"), { timeout: 30_000 });
  return { context, page };
}

try {
  const finance = await signedIn("finance");
  const authorized = await finance.page.request.get(`${origin}${path}`);
  if (authorized.status() !== 200) throw new Error(`finance_retrieval_${authorized.status()}`);
  const actual = createHash("sha256").update(await authorized.body()).digest("hex");
  if (actual !== expected) throw new Error("retained_pdf_bytes_mismatch");
  const worker = await signedIn("worker");
  const denied = await worker.page.request.get(`${origin}${path}`);
  if (denied.status() !== 403) throw new Error(`worker_document_access_${denied.status()}`);
  console.log(JSON.stringify({ financeRetrieval: 200, exactPdfSha256: actual,
    workerRetrieval: 403 }));
  await finance.context.close(); await worker.context.close();
} finally { await browser.close(); }
