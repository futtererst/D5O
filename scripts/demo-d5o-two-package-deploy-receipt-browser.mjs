import { readFileSync } from "node:fs";
import { chromium } from "playwright";
if (process.env.D5O_ISOLATED_PILOT !== "1" || process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:56621" || !process.env.D5O_PILOT_CREDENTIALS_FILE) throw new Error("fresh_disposable_pilot_only");
const user = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users.find((item) => item.key === "operations");
const origin = "http://127.0.0.1:61642", workId = "rybex-9e4f1e5f9e6b4e429142d3b01e1825e5";
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext(), page = await context.newPage();
  const path = `/work?workspace=rybex&view=record&section=Deploy&record=${workId}`;
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent(path)}`);
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.getByRole("heading", { name: "Deliver and verify the released work" }).waitFor({ timeout: 30000 });
  const work = await page.evaluate(async (id) => {
    const response = await fetch("/api/d5o-hosted/prototype-state?workspace=rybex&key=work");
    const payload = await response.json();
    return payload.state?.records?.find((item) => item.id === id);
  }, workId);
  const packages = work.packages.filter((item) => /zone controls installation/.test(item.name));
  if (packages.length !== 2) throw new Error(`two_packages_required:${packages.length}`);
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  for (const item of packages) {
    const release = page.locator("article").filter({ hasText: `${item.id} · rev 3 · Awaiting receipt` });
    if (await release.count()) {
      await release.getByLabel("Receipt reason").fill(`Fictional pilot: Operations received exact revision 3 of ${item.name} and governing instructions.`);
      await release.getByRole("button", { name: "Accept", exact: true }).click();
      await page.getByText(`${item.id} · rev 3 · Accepted`).waitFor({ timeout: 30000 });
    }
  }
  await page.reload();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  for (const item of packages) await page.getByText(`${item.id} · rev 3 · Accepted`).waitFor({ timeout: 30000 });
  console.log(JSON.stringify({ step: "deploy_independent_receipt_ui", packageIds: packages.map((item) => item.id) }));
  await context.close();
} finally { await browser.close(); }
