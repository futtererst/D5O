import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { chromium } from "playwright";

if (process.env.D5O_ISOLATED_PILOT !== "1" || process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:56321" || !process.env.D5O_PILOT_CREDENTIALS_FILE) throw new Error("original_disposable_pilot_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const origin = "http://127.0.0.1:61641", parent = "rybex-a8fd95e7e20d4bb3881c3549459c99e0";
const browser = await chromium.launch({ headless: true });
const requestId = "abe94af3-bdc5-435b-b6ad-ca810293988e";
function fictionalPdf() {
  const line = "FICTIONAL PILOT ONLY - NOT A REAL CUSTOMER SIGNATURE - PARTIAL SERVICE R2";
  const content = `BT /F1 12 Tf 45 740 Td (${line}) Tj ET`;
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`];
  let body = "%PDF-1.4\n", offsets = [0];
  for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(body)); body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  return Buffer.from(body + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}
async function signIn(key) {
  const user = users.find((item) => item.key === key);
  const context = await browser.newContext(), page = await context.newPage();
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent(`/work?workspace=rybex&view=record&section=Operate&record=${parent}`)}`);
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.getByRole("heading", { name: "Keep accepted work working" }).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Requests & jobs", exact: true }).click();
  const pricing = page.locator('details:has(summary:has-text("Chargeable service estimate"))').filter({ has: page.locator('p:has-text("partially applicable")') });
  await pricing.locator("summary").click();
  return { context, page, pricing };
}
async function open(pricing) { if (!(await pricing.evaluate((element) => element.open))) await pricing.locator("summary").click(); }
async function command(page, button) {
  const response = page.waitForResponse((item) => item.url().includes("prototype-operate-command") && item.request().method() === "POST", { timeout: 30000 });
  await button.click(); const result = await response;
  if (!result.ok()) throw new Error(`operate_command:${result.status()}:${(await result.text()).slice(0, 600)}`);
}
try {
  const pm = await signIn("pm");
  if (!(await pm.pricing.getByText(/Saved estimate r2/).count())) {
    await pm.pricing.locator('label:has-text("Estimate risk") input').fill("Fictional pilot revises the same four sourced labor hours solely to bind new customer evidence.");
    await command(pm.page, pm.pricing.getByRole("button", { name: "Save new estimate revision" }));
    await open(pm.pricing);
  }
  if ((await pm.pricing.innerText()).includes("Saved estimate r2 · Draft")) {
    await command(pm.page, pm.pricing.getByRole("button", { name: "Submit exact revision for pricing review" }));
    await open(pm.pricing);
  }
  await pm.page.getByText(/Saved estimate r2 · (Pricing review|Approved)/).waitFor({ timeout: 30000 });
  await pm.context.close();

  const ops = await signIn("operations");
  const review = ops.pricing.locator('form:has(button:has-text("Approve priced service"))');
  if (await review.count()) {
    await review.locator('input[name="note"]').fill("Independently reviewed exact revised four-hour cost, configured policy and unchanged uncovered scope.");
    await command(ops.page, review.getByRole("button", { name: "Approve priced service" }));
    await open(ops.pricing);
  }
  await ops.page.getByText(/Saved estimate r2 · Approved/).waitFor({ timeout: 30000 });
  const auth = ops.pricing.locator('form:has(button:has-text("Record exact customer authorization"))');
  if (await auth.count()) {
  const pdf = fictionalPdf();
  await auth.locator('input[type="file"][accept="application/pdf"]').setInputFiles({ name: "FICTIONAL-PARTIAL-SERVICE-AUTH-R2.pdf", mimeType: "application/pdf", buffer: pdf });
  const upload = ops.page.waitForResponse((item) => item.url().includes("customer-decision-evidence") && item.request().method() === "POST", { timeout: 30000 });
  await auth.getByRole("button", { name: "Retain signed PDF" }).click();
  const uploaded = await upload;
  if (!uploaded.ok()) throw new Error(`signed_pdf_upload:${uploaded.status()}:${(await uploaded.text()).slice(0, 500)}`);
  const link = auth.getByRole("link", { name: "Open retained signed PDF" });
  await link.waitFor({ timeout: 30000 });
  const file = await ops.page.evaluate(async (href) => { const r = await fetch(href); return { status: r.status, bytes: Array.from(new Uint8Array(await r.arrayBuffer())) }; }, await link.getAttribute("href"));
  if (file.status !== 200 || createHash("sha256").update(Buffer.from(file.bytes)).digest("hex") !== createHash("sha256").update(pdf).digest("hex")) throw new Error("partial_pdf_retrieval_mismatch");
  await auth.locator('input[name="customerParty"]').fill("Fictional Casey Customer");
  await auth.locator('input[name="customerOrganization"]').fill("Fictional North Campus Properties");
  await auth.locator('input[name="customerRole"]').fill("Site service representative");
  await auth.locator('input[name="authorityBasis"]').fill("FICTIONAL PILOT delegated approval for four uncovered labor hours");
  await auth.locator('input[name="note"]').fill("Recorded fictional external signed source against approved estimate revision two only.");
  await command(ops.page, auth.getByRole("button", { name: "Record exact customer authorization" }));
  }
  await ops.page.reload();
  await ops.page.getByRole("button", { name: "Requests & jobs", exact: true }).click();
  await open(ops.pricing);
  await ops.pricing.getByText(/Customer authorization recorded: estimate r2/).waitFor({ timeout: 30000 });
  console.log(JSON.stringify({ status: "partial_service_reauthorized_with_retained_pdf", requestId, estimateRevision: 2 }));
  await ops.context.close();
} finally { await browser.close(); }
