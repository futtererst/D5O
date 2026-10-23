import { readFileSync } from "node:fs";
import { chromium } from "playwright";
if (process.env.D5O_ISOLATED_PILOT !== "1" || process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:56321" || !process.env.D5O_PILOT_CREDENTIALS_FILE) throw new Error("original_disposable_pilot_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const origin = "http://127.0.0.1:61641", child = "rybex-a11c09e603a248359205ec84f0af4ae8";
const browser = await chromium.launch({ headless: true });
async function signIn(key) {
  const user = users.find((item) => item.key === key);
  const context = await browser.newContext(), page = await context.newPage();
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent(`/work?workspace=rybex&view=record&section=Design&record=${child}`)}`);
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.getByRole("heading", { name: "Receive the service execution basis" }).waitFor({ timeout: 30000 });
  return { context, page };
}
async function result(page, button) {
  const response = page.waitForResponse((item) => item.url().includes("prototype-design-command") && item.request().method() === "POST", { timeout: 30000 });
  await button.click(); const r = await response;
  if (!r.ok()) throw new Error(`basis_command:${r.status()}:${(await r.text()).slice(0, 600)}`);
}
try {
  const pm = await signIn("pm");
  const revise = pm.page.getByRole("button", { name: "Create revised basis" });
  if (await revise.count()) {
    await result(pm.page, revise);
    await pm.page.getByText(/draft · revision 2/).waitFor({ timeout: 30000 });
  }
  const submit = pm.page.getByRole("button", { name: "Submit for Operations receipt" });
  if (await submit.count()) {
    await pm.page.locator('input[name="reason"]').fill("Resubmit exact partial scope after pricing revision two and retained fictional customer document.");
    await result(pm.page, submit);
    await pm.page.getByText(/submitted · revision 2/).waitFor({ timeout: 30000 });
  }
  await pm.context.close();
  const ops = await signIn("operations");
  const accept = ops.page.getByRole("button", { name: "Accept exact service basis" });
  if (await accept.count()) {
    await ops.page.locator('textarea[name="reason"]').fill("Independently reviewed exact request cycle, partial coverage, approved estimate revision two and retained fictional customer source.");
    await result(ops.page, accept);
  }
  await ops.page.reload();
  await ops.page.getByText(/accepted · revision 2/).waitFor({ timeout: 30000 });
  console.log(JSON.stringify({ status: "partial_service_basis_r2_independently_accepted", child }));
  await ops.context.close();
} finally { await browser.close(); }
