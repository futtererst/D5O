import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { chromium } from "playwright";

const credentialFile = process.env.D5O_PILOT_CREDENTIALS_FILE;
if (!credentialFile || !process.env.TEMP) throw new Error("disposable_credentials_file_required");
const users = JSON.parse(readFileSync(credentialFile, "utf8")).users;
const workId = "rybex-d86cdd4cd0c04dea97da79c382cf790c";
const turnover = "6cca5386-2805-4482-ab91-4fd6d6879cfe";
const saved = join(process.env.TEMP, "d5o-support-walkthrough-20261010", "private-storage-bytes");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const browser = await chromium.launch({ headless: true });
async function login(base, key, next) {
  const user = users.find((item) => item.key === key);
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${base}/auth/sign-in?next=${encodeURIComponent(next)}`);
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.waitForURL((url) => !url.pathname.includes("sign-in"), { timeout: 30000, waitUntil: "domcontentloaded" });
  return { context, page };
}
try {
  const deliveryBase = "http://127.0.0.1:61644";
  const worker = await login(deliveryBase, "worker", "/work/my-schedule");
  await worker.page.getByText("Loading your schedule…").waitFor({ state: "hidden", timeout: 30000 });
  await worker.page.locator('a[href*="booking=crew-rybex-7"]').click();
  await worker.page.getByRole("heading", { name: "Photos and files" }).waitFor({ timeout: 30000 });
  const evidenceLink = worker.page.locator('a[href*="/api/d5o-hosted/worker-deploy?"]').first();
  const href = await evidenceLink.getAttribute("href");
  if (!href) throw new Error("delivery_private_evidence_link_missing");
  const id = new URL(href, deliveryBase).searchParams.get("evidenceId");
  const response = await worker.page.request.get(new URL(href, deliveryBase).href);
  if (!response.ok() || !id) throw new Error(`delivery_authorized_retrieval_failed:${response.status()}`);
  const actual = await response.body();
  const path = join(saved, "d5o-deploy-evidence", "rybex", hash(Buffer.from(workId)), id);
  const versions = readdirSync(path);
  if (versions.length !== 1 || !actual.equals(readFileSync(join(path, versions[0]))))
    throw new Error("delivery_private_evidence_bytes_changed");
  await worker.context.close();

  const supportBase = "http://127.0.0.1:61645";
  const reviewer = await login(supportBase, "quality", "/work?workspace=rybex&view=my-work");
  await reviewer.page.getByRole("heading", { name: "What needs your attention" }).waitFor({ timeout: 30000 });
  const exact = reviewer.page.locator(`a[href*="record=${workId}"][href*="focus=review-document"][href*="turnover=${turnover}"]`);
  await exact.click();
  const row = reviewer.page.locator('section[aria-label="Accepted turnover documentation"] article')
    .filter({ hasText: turnover }).filter({ hasText: "As-built controls record" });
  const document = row.getByRole("link", { name: "Open retained north-as-built.pdf" }).last();
  const documentHref = await document.getAttribute("href");
  if (!documentHref) throw new Error("support_private_document_link_missing");
  const pdf = await reviewer.page.request.get(new URL(documentHref, supportBase).href);
  if (!pdf.ok()) throw new Error(`support_authorized_retrieval_failed:${pdf.status()}`);
  const pdfBytes = await pdf.body();
  const expectedPdf = readFileSync("output/pdf/d5o-fictional-support/north-as-built.pdf");
  if (!pdfBytes.equals(expectedPdf)) throw new Error("support_private_document_bytes_changed");
  const state = await reviewer.page.evaluate(async () =>
    (await (await fetch("/api/d5o-hosted/prototype-state?workspace=rybex&key=work", { cache: "no-store" })).json()).state);
  const source = state.records.find((item) => item.id === workId).operate.documentationObligations
    .filter((item) => item.turnoverId === turnover && item.kind === "as-built").at(-1);
  if (source.status !== "Submitted" || source.checksumSha256 !== hash(pdfBytes))
    throw new Error("support_document_receipt_checksum_mismatch");
  console.log(JSON.stringify({ result: "observation_private_bytes_verified",
    delivery: { actor: "assigned fictional worker", evidenceId: id, bytes: actual.length, sha256: hash(actual), type: "image/png" },
    support: { actor: "independent fictional Quality reviewer", documentId: source.id,
      status: source.status, bytes: pdfBytes.length, sha256: hash(pdfBytes) } }));
  await reviewer.context.close();
} finally { await browser.close(); }
