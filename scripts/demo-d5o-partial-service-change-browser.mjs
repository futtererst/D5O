import { readFileSync } from "node:fs";
import { chromium } from "playwright";

if (process.env.D5O_ISOLATED_PILOT !== "1" || !process.env.D5O_PILOT_CREDENTIALS_FILE)
  throw new Error("disposable_pilot_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const origin = "http://127.0.0.1:61644";
const child = "rybex-a11c09e603a248359205ec84f0af4ae8";
const browser = await chromium.launch({ headless: true });
function fictionalPdf() {
  const content = "BT /F1 12 Tf 45 740 Td (FICTIONAL PILOT - NOT A REAL CUSTOMER SIGNATURE - SERVICE ACCESS CHANGE) Tj ET";
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`];
  let body = "%PDF-1.4\n", offsets = [0];
  for (let i=0; i<objects.length; i++) { offsets.push(Buffer.byteLength(body)); body += `${i+1} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(body); body += `xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10,"0")} 00000 n \n`;
  return Buffer.from(body + `trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}
async function signIn(key, section) {
  const user = users.find((item) => item.key === key);
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("response", async (response) => { if (response.url().endsWith("/api/d5o-hosted/field-changes") && response.request().method() === "POST") { const body = await response.json().catch(() => ({})); console.log(JSON.stringify({ actionResponse: response.status(), error: body.error, message: body.message })); } });
  const target = `/work?workspace=rybex&view=record&section=${section}&record=${child}`;
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent(target)}`);
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.waitForURL((url) => url.pathname === "/work", { timeout: 30000 });
  return { context, page };
}
async function stage(key, section, action) {
  const session = await signIn(key, section);
  try { await action(session.page); }
  finally { await session.context.close(); }
}
try {
  if (process.env.D5O_PILOT_STAGE !== "customer") {
  await stage("pm", "Develop", async (page) => {
    await page.getByText("Field condition and controlled change").waitFor({ timeout: 30000 });
    const form = page.locator('form:has(button:has-text("Save Develop change proposal"))');
    await form.waitFor({ timeout: 30000 });
    await form.locator('input[name="scopeDifference"]').fill("Controlled access around the obstructed tray to complete the approved monitoring route diagnosis; no equipment replacement or unrelated expansion.");
    await form.locator('input[name="costBasis"]').fill("Additional access effort is not yet evidenced; no committed supplier or labor cost is asserted.");
    await form.locator('input[name="priceBasis"]').fill("No added charge authorized in this pilot; original service estimate r2 remains the only priced scope.");
    await form.locator('input[name="priceAmount"]').fill("0");
    await form.locator('input[name="currency"]').fill("USD");
    await form.locator('input[name="scheduleImpact"]').fill("Reassess the access window before field restart.");
    await form.locator('input[name="assumptions"]').fill("Diagnostic access can be achieved within the separately authorized four-hour visit; if not, stop and reprice before additional work.");
    await form.getByRole("button", { name: "Save Develop change proposal" }).click();
    await page.getByText(/Proposed/).first().waitFor({ timeout: 30000 });
    const submit = page.locator('form:has(button:has-text("Submit independent commercial review"))');
    await submit.locator('input[name="reason"]').fill("Submit zero-price access clarification and original r2 cap for independent review.");
    await submit.getByRole("button", { name: "Submit independent commercial review" }).click();
    await page.getByText(/Internal review/).first().waitFor({ timeout: 30000 });
  });
  await stage("commercial", "Develop", async (page) => {
    const review = page.locator('form:has(button:has-text("Record internal decision"))');
    await review.waitFor({ timeout: 30000 });
    await review.locator('input[name="reason"]').fill("Pilot review accepts no added price only within the existing authorized diagnostic cap; any excess requires new approval.");
    await review.getByRole("button", { name: "Record internal decision" }).click();
    await page.getByText(/Internally approved/).first().waitFor({ timeout: 30000 });
  });
  }
  await stage("operations", "Develop", async (page) => {
    const form = page.locator('form:has(button:has-text("Record separate customer authorization"))');
    await form.waitFor({ timeout: 30000 });
    await form.locator('input[type="file"][accept="application/pdf"]').setInputFiles({ name: "FICTIONAL-SERVICE-ACCESS-CHANGE.pdf", mimeType: "application/pdf", buffer: fictionalPdf() });
    await form.getByRole("button", { name: "Retain signed PDF" }).click();
    await form.getByRole("link", { name: "Open retained signed PDF" }).waitFor({ timeout: 30000 });
    await form.locator('input[name="representative"]').fill("Fictional Casey Customer");
    await form.locator('input[name="organization"]').fill("Fictional North Campus Properties");
    await form.locator('input[name="authority"]').fill("FICTIONAL pilot consent to diagnostic access only within the existing approved four-hour and zero-added-price limit");
    await form.getByRole("button", { name: "Record separate customer authorization" }).click();
    await page.getByText(/Customer authorized/).first().waitFor({ timeout: 30000 });
  });
  console.log(JSON.stringify({ status: "partial_service_change_customer_authorized", child }));
} finally { await browser.close(); }



