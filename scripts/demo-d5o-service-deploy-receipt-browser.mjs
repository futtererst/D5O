import { readFileSync } from "node:fs";
import { chromium } from "playwright";

if (process.env.D5O_ISOLATED_PILOT !== "1" || !process.env.D5O_PILOT_CREDENTIALS_FILE)
  throw new Error("disposable_pilot_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const ops = users.find((item) => item.key === "operations");
const partial = process.env.D5O_SERVICE_VARIANT === "partial";
if (process.env.D5O_SERVICE_VARIANT && !partial) throw new Error("unsupported_service_variant");
const origin = "http://127.0.0.1:61641";
const child = partial ? "rybex-a11c09e603a248359205ec84f0af4ae8" : "rybex-d910a2a58a9c46038fb459436e1839c3";
const packageId = partial ? "wp-4c76523afbe543e9af58270032081b44" : "wp-1c54906c52cc47abadca12283af54d9e";
const target = `${origin}/work?workspace=rybex&view=record&section=Deploy&record=${child}`;
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent(target.slice(origin.length))}`);
  await page.locator('input[name="email"]').fill(ops.email);
  await page.locator('input[name="password"]').fill(ops.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.getByRole("heading", { name: "Receive released package revisions" }).waitFor({ timeout: 30000 });
  const receipt = page.locator("article").filter({ hasText: packageId, has: page.getByRole("button", { name: "Accept", exact: true }) });
  if (await receipt.count()) {
    await receipt.getByLabel("Receipt reason").fill("Operations received the exact covered service release and issued instructions.");
    await receipt.getByRole("button", { name: "Accept", exact: true }).click();
    await page.getByText(`${packageId} · rev 1 · Accepted`).waitFor({ timeout: 30000 });
  }
  await page.reload();
  await page.getByText(`${packageId} · rev 1 · Accepted`).waitFor({ timeout: 30000 });
  console.log(JSON.stringify({ status: "service_release_received", workId: child }));
  await context.close();
} finally { await browser.close(); }
