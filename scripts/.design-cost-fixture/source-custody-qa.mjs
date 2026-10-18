import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { chromium } from "playwright";

const origin = "http://127.0.0.1:61657";
const workId = "rybex-a74e023ecf2a413f830bfb2c61671052";
if (process.env.D5O_SOURCE_CUSTODY_TARGET !== "mutable-disposable-clone" ||
    process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:58521" ||
    !process.env.D5O_PILOT_CREDENTIALS_FILE) throw new Error("mutable_disposable_clone_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const browser = await chromium.launch({ headless: true });
const result = {};
async function session(key, accountSet = users) {
  const user = accountSet.find((item) => item.key === key);
  if (!user) throw new Error(`missing_fictional_role_${key}`);
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent("/work?workspace=rybex&view=my-work")}`);
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.waitForURL(/\/work\?/, { timeout: 30000 });
  return { page, context };
}
const path = `/api/d5o-hosted/design-cost?workspace=rybex&workId=${workId}`;
async function position(page) {
  return page.evaluate(async (path) => {
    const response = await fetch(path, { cache: "no-store" });
    return { http: response.status, ...await response.json() };
  }, path);
}
async function pdf() {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const lines = [
    "FICTIONAL DESIGN COST SOURCE - TECHNICAL QUALIFICATION ONLY",
    "Remote planning study - supplemental internal Design effort",
    "Claim: USD 25.00, 2026-10-17. Illustrative internal record only.",
    "No real employee hours, payroll liability or customer acceptance.",
    "This retained file demonstrates custody and independent review mechanics."
  ];
  lines.forEach((line, index) => page.drawText(line, { x: 48, y: 730 - index * 27, size: 11, font }));
  const bytes = Buffer.from(await document.save());
  const file = join(tmpdir(), "d5o-fictional-design-cost-source-20261017.pdf");
  writeFileSync(file, bytes);
  return { file, checksum: createHash("sha256").update(bytes).digest("hex") };
}
try {
  const pm = await session("pm");
  const before = await position(pm.page);
  if (before.http !== 200) throw new Error(`pm_read_${before.http}`);
  result.buildVisible = (await pm.page.locator("body").innerText()).includes("Build 292eb46");
  if (!result.buildVisible) throw new Error("final_build_not_displayed");
  if (process.env.D5O_SOURCE_CUSTODY_SMOKE === "1") {
    result.authenticatedReadHttp = before.http;
    result.existingClaims = before.claims.length;
    console.log(JSON.stringify(result));
    await pm.context.close();
    process.exit(0);
  }
  const linked = before.links?.[0];
  if (!linked) throw new Error("no_linked_design_commitment_on_clone");
  await pm.page.goto(`${origin}/work?workspace=rybex&view=record&record=${workId}&section=Operate&focus=finance&taskKind=design-cost`);
  await pm.page.getByText("Design costs and outlook review").waitFor({ timeout: 30000 });
  const source = "FICTIONAL-DESIGN-CUSTODY-25-20261017";
  let claim = before.claims.find((item) => item.source_reference === source);
  if (!claim) {
    const form = pm.page.locator("form").filter({ has: pm.page.getByRole("button", { name: "Submit Design cost for Finance review" }) });
    await form.locator('[name="commitmentId"]').selectOption(linked.commitment_id);
    await form.locator('[name="amount"]').fill("25");
    await form.locator('[name="costDate"]').fill("2026-10-17");
    await form.locator('[name="sourceReference"]').fill(source);
    await form.locator('[name="evidenceNote"]').fill("Fictional supplemental remote planning cost assertion, retained solely to exercise private source custody; no real work or payroll event.");
    const response = pm.page.waitForResponse((item) => item.url().includes("/api/d5o-hosted/design-cost?") && item.request().method() === "POST");
    await form.getByRole("button", { name: "Submit Design cost for Finance review" }).click();
    const saved = await response;
    result.preparedHttp = saved.status();
    if (!saved.ok()) throw new Error(`prepare_${(await saved.json()).error}`);
    claim = (await position(pm.page)).claims.find((item) => item.source_reference === source);
  }
  if (!claim) throw new Error("prepared_claim_missing");
  result.claimId = claim.id;
  const synthetic = await pdf();
  const evidencePath = `/api/d5o-hosted/design-cost-evidence?workspace=rybex&workId=${workId}&claimId=${claim.id}`;
  let recordedChecksum = "";
  if (claim.status === "Prepared") {
    const claimCard = pm.page.locator("div").filter({ hasText: `Awaiting independent Finance review: ${source}` }).first();
    await claimCard.locator('input[name="file"]').first().setInputFiles(synthetic.file);
    const uploadResponse = pm.page.waitForResponse((item) => item.url().includes("/api/d5o-hosted/design-cost-evidence?") && item.request().method() === "POST");
    await claimCard.getByRole("button", { name: "Retain source for this claim" }).first().click();
    const upload = await uploadResponse;
    const uploadBody = await upload.json();
    result.uploadHttp = upload.status();
    result.checksumMatches = uploadBody.checksumSha256 === synthetic.checksum;
    recordedChecksum = uploadBody.checksumSha256;
    if (!upload.ok()) throw new Error(`upload_${uploadBody.error}`);
  } else {
    const retained = await pm.page.evaluate(async (path) => {
      const response = await fetch(path);
      return { http: response.status, body: await response.json() };
    }, evidencePath);
    result.uploadHttp = `retained_${retained.http}`;
    recordedChecksum = retained.body.checksumSha256;
    result.checksumMatches = /^[0-9a-f]{64}$/.test(recordedChecksum);
  }
  await pm.context.close();

  const finance = await session("commercial");
  await finance.page.goto(`${origin}/work?workspace=rybex&view=record&record=${workId}&section=Operate&focus=finance&taskKind=design-cost`);
  await finance.page.getByText("Design costs and outlook review").waitFor({ timeout: 30000 });
  const retrieval = await finance.page.evaluate(async (evidencePath) => {
    const response = await fetch(`${evidencePath}&download=1`);
    const buffer = await response.arrayBuffer();
    return { http: response.status, checksum: await crypto.subtle.digest("SHA-256", buffer)
      .then((bytes) => Array.from(new Uint8Array(bytes)).map((item) => item.toString(16).padStart(2, "0")).join("")) };
  }, evidencePath);
  result.financeRetrievalHttp = retrieval.http;
  result.financeChecksumMatches = retrieval.checksum === recordedChecksum;
  if (claim.status === "Prepared") {
    const review = finance.page.locator("form").filter({ has: finance.page.getByRole("button", { name: "Save independent cost review" }) }).first();
    await review.locator('[name="decision"]').selectOption("Reviewed");
    await review.locator('[name="reason"]').fill("Independent fictional Finance review of exact retained source file and calculation note; technical qualification only.");
    const response = finance.page.waitForResponse((item) => item.url().includes("/api/d5o-hosted/design-cost?") && item.request().method() === "POST");
    await review.getByRole("button", { name: "Save independent cost review" }).click();
    const saved = await response;
    result.reviewHttp = saved.status();
    result.reviewError = saved.ok() ? null : (await saved.json()).error;
  } else result.reviewHttp = "retained_prior_browser_review";
  result.reviewedStatus = (await position(finance.page)).claims.find((item) => item.id === claim.id)?.status;
  await finance.context.close();

  async function denied(page, path, download = true) {
    return page.evaluate(async ({ url, download }) => {
      const response = await fetch(download ? `${url}&download=1` : url);
      const contentType = response.headers.get("content-type") ?? "";
      const body = await response.text();
      return { http: response.status, contentType, hasPdfBytes: body.startsWith("%PDF-"),
        hasUsableLink: /https?:\/\/|objectPath|signedURL|downloadUrl/i.test(body), body };
    }, { url: path, download });
  }
  const wrongRole = await session("operations");
  result.operationsDenial = await denied(wrongRole.page, evidencePath);
  result.operationsMetadataDenial = await denied(wrongRole.page, evidencePath, false);
  await wrongRole.context.close();

  const secondCredentials = process.env.D5O_OTHER_PM_CREDENTIALS_FILE;
  if (!secondCredentials) throw new Error("other_pm_credentials_required");
  const secondUsers = JSON.parse(readFileSync(secondCredentials, "utf8")).users;
  const anotherPm = await session("pm", secondUsers);
  result.otherPmDenial = await denied(anotherPm.page, evidencePath);
  result.otherPmMetadataDenial = await denied(anotherPm.page, evidencePath, false);
  await anotherPm.context.close();

  const owner = await session("pm");
  result.crossTenantDenial = await denied(owner.page, evidencePath.replace("workspace=rybex", "workspace=rotork"));
  result.crossTenantMetadataDenial = await denied(owner.page,
    evidencePath.replace("workspace=rybex", "workspace=rotork"), false);
  const ownerDownload = await owner.page.evaluate(async (url) => {
    const response = await fetch(`${url}&download=1`);
    const buffer = await response.arrayBuffer();
    return { http: response.status, checksum: await crypto.subtle.digest("SHA-256", buffer)
      .then((bytes) => Array.from(new Uint8Array(bytes)).map((item) => item.toString(16).padStart(2, "0")).join("")) };
  }, evidencePath);
  result.ownerRetrievalHttp = ownerDownload.http;
  result.ownerChecksumMatches = ownerDownload.checksum === recordedChecksum;
  await owner.context.close();
  for (const [name, denial] of Object.entries({ operationsDenial: result.operationsDenial,
    operationsMetadataDenial: result.operationsMetadataDenial,
    otherPmDenial: result.otherPmDenial, otherPmMetadataDenial: result.otherPmMetadataDenial,
    crossTenantDenial: result.crossTenantDenial,
    crossTenantMetadataDenial: result.crossTenantMetadataDenial })) {
    if (denial.http !== 403 || denial.hasPdfBytes || denial.hasUsableLink ||
      !denial.contentType.includes("application/json"))
      throw new Error(`custody_denial_failed_${name}_${JSON.stringify(denial)}`);
  }
  if (result.financeRetrievalHttp !== 200 || !result.financeChecksumMatches ||
    result.ownerRetrievalHttp !== 200 || !result.ownerChecksumMatches) throw new Error("custody_retrieval_failed");
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
