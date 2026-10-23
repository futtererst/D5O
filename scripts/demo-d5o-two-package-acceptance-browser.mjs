import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
if (process.env.D5O_ISOLATED_PILOT !== "1" || process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:56621" || !process.env.D5O_PILOT_CREDENTIALS_FILE) throw new Error("fresh_disposable_pilot_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const origin = "http://127.0.0.1:61642", workId = "rybex-9e4f1e5f9e6b4e429142d3b01e1825e5";
const names = ["North zone controls installation", "South zone controls installation"];
const browser = await chromium.launch({ headless: true });
function fictionalPdf(label) {
  const line = `FICTIONAL PILOT ONLY - NOT A REAL CUSTOMER SIGNATURE - ${label}`.replace(/[()\\]/g, "");
  const content = `BT /F1 12 Tf 45 740 Td (${line}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`
  ];
  let body = "%PDF-1.4\n", offsets = [0];
  for (let index = 0; index < objects.length; index++) {
    offsets.push(Buffer.byteLength(body)); body += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}
async function signIn(key) {
  const user = users.find((item) => item.key === key);
  const context = await browser.newContext(), page = await context.newPage();
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent(`/work?workspace=rybex&view=record&section=Deploy&record=${workId}`)}`);
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.getByRole("heading", { name: "Deliver and verify the released work" }).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Acceptance & turnover" }).click();
  return { context, page };
}
async function retain(page, scope, label) {
  const pdf = fictionalPdf(label);
  await scope.locator('input[type="file"][accept="application/pdf"]').setInputFiles({ name: `FICTIONAL-${label.replaceAll(" ", "-")}.pdf`, mimeType: "application/pdf", buffer: pdf });
  const response = page.waitForResponse((item) => item.url().includes("customer-decision-evidence") && item.request().method() === "POST", { timeout: 30000 });
  await scope.getByRole("button", { name: "Retain signed PDF" }).click();
  const result = await response;
  if (!result.ok()) throw new Error(`acceptance_pdf:${result.status()}:${(await result.text()).slice(0, 500)}`);
  const link = scope.getByRole("link", { name: "Open retained signed PDF" });
  await link.waitFor({ timeout: 30000 });
  const href = await link.getAttribute("href");
  const retrieved = await page.evaluate(async (url) => {
    const response = await fetch(url); return { status: response.status, bytes: Array.from(new Uint8Array(await response.arrayBuffer())) };
  }, href);
  if (retrieved.status !== 200 || createHash("sha256").update(Buffer.from(retrieved.bytes)).digest("hex") !== createHash("sha256").update(pdf).digest("hex")) throw new Error(`acceptance_pdf_retrieval_mismatch:${label}`);
  return new URL(href, origin).searchParams.get("evidenceId");
}
try {
  const pm = await signIn("pm");
  for (const name of names) {
    await pm.page.getByRole("button", { name: new RegExp(name) }).click();
    const assembly = pm.page.locator('form:has(button:has-text("Assemble revisioned turnover"))');
    if (!(await pm.page.getByText("Turnover revision 1 · Draft").count()) && !(await pm.page.getByText("Turnover revision 1 · Client accepted").count())) {
      await assembly.locator('input[name="operateOwner"]').fill("Fictional Operations receiver");
      await assembly.locator('input[name="obligations"]').fill("Retain the as-built controls record, inspection history and support responsibility.");
      const response = pm.page.waitForResponse((item) => item.url().includes("prototype-deploy-command") && item.request().method() === "POST", { timeout: 30000 });
      await assembly.getByRole("button", { name: "Assemble revisioned turnover" }).click();
      const result = await response;
      if (!result.ok()) throw new Error(`turnover_assembly:${result.status()}:${(await result.text()).slice(0, 500)}`);
      await pm.page.getByText("Turnover revision 1 · Draft").waitFor({ timeout: 30000 });
    }
    console.log(JSON.stringify({ step: "revisioned_turnover_ui", package: name }));
  }
  await pm.context.close();
  const reviewer = await signIn("quality");
  for (const name of names) {
    await reviewer.page.getByRole("button", { name: new RegExp(name) }).click();
    const card = reviewer.page.locator('article:has(strong:text-is("Turnover revision 1 · Draft"))');
    const acceptance = card.locator('form:has(button:has-text("Record scoped Client Accepted"))');
    if (await acceptance.count()) {
      const evidenceId = await retain(reviewer.page, acceptance, `${name} package acceptance`);
      await acceptance.locator('input[name="signerName"]').fill("Fictional Casey Customer");
      await acceptance.locator('input[name="organization"]').fill("Fictional North Campus Properties");
      await acceptance.locator('input[name="role"]').fill("Site acceptance representative");
      await acceptance.locator('input[name="authority"]').fill("FICTIONAL PILOT: delegated site acceptance for the named package only");
      await acceptance.locator('input[name="conditions"]').fill("");
      await acceptance.locator('input[name="exclusions"]').fill("No scope outside the named controls zone");
      const response = reviewer.page.waitForResponse((item) => item.url().includes("prototype-deploy-command") && item.request().method() === "POST", { timeout: 30000 });
      await acceptance.getByRole("button", { name: "Record scoped Client Accepted" }).click();
      const result = await response;
      if (!result.ok()) throw new Error(`package_acceptance:${result.status()}:${(await result.text()).slice(0, 700)}`);
      await reviewer.page.getByText("Turnover revision 1 · Client accepted").waitFor({ timeout: 30000 });
      console.log(JSON.stringify({ step: "evidence_bound_package_acceptance_ui", package: name, evidenceId }));
    }
  }
  const whole = reviewer.page.locator('form:has(button:has-text("Record whole-work Client Accepted"))');
  if (await whole.count()) {
    const evidenceId = await retain(reviewer.page, whole, "whole work acceptance");
    if (await whole.getByRole("button", { name: "Record whole-work Client Accepted" }).isDisabled()) throw new Error(`whole_acceptance_blocked:${(await whole.innerText()).slice(0, 700)}`);
    await whole.locator('input[name="signerName"]').fill("Fictional Casey Customer");
    await whole.locator('input[name="organization"]').fill("Fictional North Campus Properties");
    await whole.locator('input[name="role"]').fill("Project acceptance representative");
    await whole.locator('input[name="authority"]').fill("FICTIONAL PILOT: delegated whole-job acceptance for the exact two-package scope");
    await whole.locator('input[name="conditions"]').fill("");
    const response = reviewer.page.waitForResponse((item) => item.url().includes("prototype-deploy-command") && item.request().method() === "POST", { timeout: 30000 });
    await whole.getByRole("button", { name: "Record whole-work Client Accepted" }).click();
    const result = await response;
    if (!result.ok()) throw new Error(`whole_acceptance:${result.status()}:${(await result.text()).slice(0, 700)}`);
    await reviewer.page.getByText(/Client Accepted · whole Work Record/).waitFor({ timeout: 30000 });
    console.log(JSON.stringify({ step: "evidence_bound_whole_work_acceptance_ui", evidenceId }));
  }
  await reviewer.context.close();
  const operations = await signIn("operations");
  for (const name of names) {
    await operations.page.getByRole("button", { name: new RegExp(name) }).click();
    const receipt = operations.page.locator('form:has(button:has-text("Record independent receipt"))');
    if (await receipt.count()) {
      await receipt.locator('input[name="note"]').fill(`Fictional Operations independently receives the exact accepted ${name} turnover and residual support responsibility.`);
      await receipt.getByRole("button", { name: "Record independent receipt" }).click();
      await receipt.waitFor({ state: "detached", timeout: 30000 });
    }
    console.log(JSON.stringify({ step: "independent_package_operate_receipt_ui", package: name }));
  }
  const wholeReceipt = operations.page.locator('form:has(button:has-text("Record independent whole-work receipt"))');
  if (await wholeReceipt.count()) {
    await wholeReceipt.locator('input[name="note"]').fill("Fictional Operations independently receives complete accepted North and South controls delivery.");
    await wholeReceipt.getByRole("button", { name: "Record independent whole-work receipt" }).click();
    await wholeReceipt.waitFor({ state: "detached", timeout: 30000 });
  }
  await operations.page.reload();
  await operations.page.getByRole("heading", { name: "Deliver and verify the released work" }).waitFor({ timeout: 30000 });
  if (!(await operations.page.locator("body").innerText()).includes("Client Accepted · whole Work Record")) throw new Error("whole_acceptance_not_retained_after_reload");
  console.log(JSON.stringify({ step: "independent_whole_work_operate_receipt_ui" }));
  await operations.context.close();
} finally { await browser.close(); }
