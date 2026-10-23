import { readFileSync } from "node:fs";
import { chromium } from "playwright";

if (process.env.D5O_ISOLATED_PILOT !== "1" || !process.env.D5O_PILOT_CREDENTIALS_FILE)
  throw new Error("disposable_pilot_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const origin = "http://127.0.0.1:61641";
const child = "rybex-d910a2a58a9c46038fb459436e1839c3";
const target = `${origin}/work?workspace=rybex&view=record&section=Deploy&record=${child}`;
const source = "SYNTHETIC-PILOT-CUSTOMER-ACCEPTANCE-NOT-REAL";
const browser = await chromium.launch({ headless: true });
async function signIn(key) {
  const user = users.find((item) => item.key === key);
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent(target.slice(origin.length))}`);
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.getByRole("heading", { name: "Deliver and verify the released work" }).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Acceptance & turnover" }).click();
  return { context, page };
}
try {
  const pm = await signIn("pm");
  const assembly = pm.page.locator('form:has(button:has-text("Assemble revisioned turnover"))');
  if (!(await pm.page.locator("body").innerText()).includes("Turnover revision 1")) {
    await assembly.locator('input[name="operateOwner"]').fill("Pilot Operations receiver");
    await assembly.locator('input[name="obligations"]').fill("Retain monitoring panel service history and customer support coverage.");
    await assembly.getByRole("button", { name: "Assemble revisioned turnover" }).click();
    await pm.page.getByText("Turnover revision 1 · Draft").waitFor({ timeout: 30000 });
  }
  await pm.context.close();

  const quality = await signIn("quality");
  const packageCard = quality.page.locator('article:has(strong:text-is("Turnover revision 1 · Draft"))');
  const packageAcceptance = packageCard.locator('form:has(button:has-text("Record scoped Client Accepted"))');
  if (await packageAcceptance.count()) {
    await packageAcceptance.locator('input[name="signerName"]').fill("Synthetic pilot customer representative");
    await packageAcceptance.locator('input[name="organization"]').fill("Fictional Pilot Customer");
    await packageAcceptance.locator('input[name="role"]').fill("Site representative");
    await packageAcceptance.locator('input[name="authority"]').fill("Fictional pilot acceptance authority only");
    await packageAcceptance.locator('input[name="source"]').fill(source);
    await packageAcceptance.getByRole("button", { name: "Record scoped Client Accepted" }).click();
    await quality.page.getByText("Turnover revision 1 · Client accepted").waitFor({ timeout: 30000 });
  }
  const whole = quality.page.locator('form:has(button:has-text("Record whole-work Client Accepted"))');
  if (await whole.count()) {
    if (await whole.getByRole("button", { name: "Record whole-work Client Accepted" }).isDisabled())
      throw new Error("whole_service_acceptance_blocked");
    await whole.locator('input[name="signerName"]').fill("Synthetic pilot customer representative");
    await whole.locator('input[name="organization"]').fill("Fictional Pilot Customer");
    await whole.locator('input[name="role"]').fill("Site representative");
    await whole.locator('input[name="authority"]').fill("Fictional pilot acceptance authority only");
    await whole.locator('input[name="source"]').fill(source);
    await whole.getByRole("button", { name: "Record whole-work Client Accepted" }).click();
    await quality.page.getByText(/Client Accepted · 20/).waitFor({ timeout: 30000 });
  }
  await quality.context.close();

  const ops = await signIn("operations");
  const packageReceipt = ops.page.locator('form:has(button:has-text("Record independent receipt"))');
  if (await packageReceipt.count()) {
    await packageReceipt.locator('input[name="note"]').fill("Operations accepts the exact synthetic service turnover and supported asset duties.");
    await packageReceipt.getByRole("button", { name: "Record independent receipt" }).click();
    await ops.page.getByText(/Operate receipt Accepted/).first().waitFor({ timeout: 30000 });
  }
  const wholeReceipt = ops.page.locator('form:has(button:has-text("Record independent whole-work receipt"))');
  if (await wholeReceipt.count()) {
    await wholeReceipt.locator('input[name="note"]').fill("Operations independently receives the complete synthetic service visit and its evidence.");
    await wholeReceipt.getByRole("button", { name: "Record independent whole-work receipt" }).click();
    await ops.page.getByText(/Operate receipt Accepted/).last().waitFor({ timeout: 30000 });
  }
  await ops.page.reload();
  await ops.page.getByRole("heading", { name: "Deliver and verify the released work" }).waitFor({ timeout: 30000 });
  if (!(await ops.page.locator("body").innerText()).includes("Client Accepted · whole Work Record"))
    throw new Error("service_acceptance_not_persisted");
  const acceptedReceipt = await ops.page.evaluate(async () => {
    const response = await fetch("/api/d5o-hosted/prototype-state?workspace=rybex&key=work");
    const payload = await response.json();
    return payload.state?.records?.find((item) => item.id === "rybex-d910a2a58a9c46038fb459436e1839c3")?.deploy?.workAcceptance?.receipt;
  });
  if (acceptedReceipt !== "Accepted")
    throw new Error("whole_work_operate_receipt_not_persisted");
  console.log(JSON.stringify({ status: "service_customer_acceptance_and_operate_receipt_recorded", fictionalSource: source }));
  await ops.context.close();
} finally { await browser.close(); }
