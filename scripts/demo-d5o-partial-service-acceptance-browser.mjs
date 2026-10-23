import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { chromium } from "playwright";

if (process.env.D5O_ISOLATED_PILOT !== "1" || !process.env.D5O_PILOT_CREDENTIALS_FILE) throw new Error("disposable_pilot_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const origin = "http://127.0.0.1:61644", child = "rybex-a11c09e603a248359205ec84f0af4ae8";
const browser = await chromium.launch({ headless: true });
function fictionalPdf(label) {
  const content = `BT /F1 12 Tf 45 740 Td (FICTIONAL PILOT - NOT A REAL CUSTOMER SIGNATURE - ${label}) Tj ET`;
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`];
  let body = "%PDF-1.4\n", offsets = [0];
  for (let i=0; i<objects.length; i++) { offsets.push(Buffer.byteLength(body)); body += `${i+1} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(body); body += `xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10,"0")} 00000 n \n`;
  return Buffer.from(body + `trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}
async function signIn(key) {
  const user = users.find((item) => item.key === key);
  const context = await browser.newContext(), page = await context.newPage();
  const target = `/work?workspace=rybex&view=record&section=Deploy&record=${child}`;
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent(target)}`);
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.getByRole("heading", { name: "Deliver and verify the released work" }).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Acceptance & turnover" }).click();
  return { context, page };
}
async function command(page, button) {
  const pending = page.waitForResponse((response) => response.url().includes("prototype-deploy-command") && response.request().method() === "POST", { timeout: 30000 });
  await button.click(); const response = await pending;
  if (!response.ok()) throw new Error(`deploy_decision:${response.status()}:${(await response.text()).slice(0,600)}`);
}
async function retain(page, scope, label) {
  const pdf = fictionalPdf(label);
  await scope.locator('input[type="file"][accept="application/pdf"]').setInputFiles({ name: `FICTIONAL-${label.replaceAll(" ","-")}.pdf`, mimeType: "application/pdf", buffer: pdf });
  const pending = page.waitForResponse((response) => response.url().includes("customer-decision-evidence") && response.request().method() === "POST", { timeout: 30000 });
  await scope.getByRole("button", { name: "Retain signed PDF" }).click(); const uploaded = await pending;
  if (!uploaded.ok()) throw new Error(`document_upload:${uploaded.status()}:${(await uploaded.text()).slice(0,500)}`);
  const link = scope.getByRole("link", { name: "Open retained signed PDF" });
  await link.waitFor({ timeout: 30000 });
  const retrieved = await page.evaluate(async (href) => { const response = await fetch(href); return { status: response.status, bytes: Array.from(new Uint8Array(await response.arrayBuffer())) }; }, await link.getAttribute("href"));
  if (retrieved.status !== 200 || createHash("sha256").update(Buffer.from(retrieved.bytes)).digest("hex") !== createHash("sha256").update(pdf).digest("hex")) throw new Error(`retained_document_mismatch:${label}`);
  return new URL(await link.getAttribute("href"), origin).searchParams.get("evidenceId");
}
try {
  if (process.env.D5O_PILOT_STAGE === "assemble") {
    const pm = await signIn("pm");
    try {
      const form = pm.page.locator('form:has(button:has-text("Assemble revisioned turnover"))');
      await form.locator('input[name="operateOwner"]').fill("Pilot Operations receiver");
      await form.locator('input[name="obligations"]').fill("Retain monitoring route history, unresolved commercial receivable and future coverage limits separately from this accepted visit.");
      await command(pm.page, form.getByRole("button", { name: "Assemble revisioned turnover" }));
      await pm.page.getByText("Turnover revision 1 · Draft").waitFor({ timeout: 30000 });
      console.log(JSON.stringify({ status: "partial_service_turnover_assembled", child }));
    } finally { await pm.context.close(); }
  }
  if (process.env.D5O_PILOT_STAGE === "accept") {
    const quality = await signIn("quality");
    try {
      const card = quality.page.locator('article:has(strong:text-is("Turnover revision 1 · Draft"))');
      const scoped = card.locator('form:has(button:has-text("Record scoped Client Accepted"))');
      if (await scoped.count()) {
      const packageEvidence = await retain(quality.page, scoped, "PARTIAL SERVICE PACKAGE ACCEPTANCE");
      await scoped.locator('input[name="signerName"]').fill("Fictional Casey Customer");
      await scoped.locator('input[name="organization"]').fill("Fictional North Campus Properties");
      await scoped.locator('input[name="role"]').fill("Site service representative");
      await scoped.locator('input[name="authority"]').fill("FICTIONAL PILOT site authority for revised diagnostic package only");
      await scoped.locator('input[name="conditions"]').fill("");
      await scoped.locator('input[name="exclusions"]').fill("No unrelated monitoring expansion or equipment replacement");
      await command(quality.page, scoped.getByRole("button", { name: "Record scoped Client Accepted" }));
      await quality.page.getByText("Turnover revision 1 · Client accepted").waitFor({ timeout: 30000 });
      console.log(JSON.stringify({ status: "partial_service_package_accepted", packageEvidence }));
      }
      await quality.page.reload();
      await quality.page.getByRole("button", { name: "Acceptance & turnover" }).click();
      const whole = quality.page.locator('form:has(button:has-text("Record whole-work Client Accepted"))');
      const wholeEvidence = await retain(quality.page, whole, "PARTIAL SERVICE WHOLE VISIT ACCEPTANCE");
      if (await whole.getByRole("button", { name: "Record whole-work Client Accepted" }).isDisabled()) throw new Error("whole_work_scope_not_ready");
      await whole.locator('input[name="signerName"]').fill("Fictional Casey Customer");
      await whole.locator('input[name="organization"]').fill("Fictional North Campus Properties");
      await whole.locator('input[name="role"]').fill("Site service representative");
      await whole.locator('input[name="authority"]').fill("FICTIONAL PILOT authority for exact one-package service visit only");
      await whole.locator('input[name="conditions"]').fill("");
      await command(quality.page, whole.getByRole("button", { name: "Record whole-work Client Accepted" }));
      await quality.page.getByText(/Client Accepted · 20/).waitFor({ timeout: 30000 });
      console.log(JSON.stringify({ status: "partial_service_scope_and_work_accepted", wholeEvidence }));
    } finally { await quality.context.close(); }
  }
  if (process.env.D5O_PILOT_STAGE === "receipt") {
    const ops = await signIn("operations");
    try {
      const packageReceipt = ops.page.locator('form:has(button:has-text("Record independent receipt"))');
      await packageReceipt.locator('input[name="note"]').fill("Operations independently receives revised diagnostic package and retained service history.");
      await command(ops.page, packageReceipt.getByRole("button", { name: "Record independent receipt" }));
      const wholeReceipt = ops.page.locator('form:has(button:has-text("Record independent whole-work receipt"))');
      await wholeReceipt.locator('input[name="note"]').fill("Operations independently receives the exact accepted one-package service visit; commercial collection remains separate.");
      await command(ops.page, wholeReceipt.getByRole("button", { name: "Record independent whole-work receipt" }));
      await ops.page.reload();
      await ops.page.getByText("Client Accepted · whole Work Record").waitFor({ timeout: 30000 });
      console.log(JSON.stringify({ status: "partial_service_operate_receipt_accepted", child }));
    } finally { await ops.context.close(); }
  }
} finally { await browser.close(); }

