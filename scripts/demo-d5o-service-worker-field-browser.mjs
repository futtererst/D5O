import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import sharp from "sharp";

if (process.env.D5O_ISOLATED_PILOT !== "1" || !process.env.D5O_PILOT_CREDENTIALS_FILE)
  throw new Error("disposable_pilot_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const partial = process.env.D5O_SERVICE_VARIANT === "partial";
const worker = users.find((item) => item.key === (partial ? "southWorker" : "serviceWorker"));
const origin = process.env.D5O_PILOT_ORIGIN || "http://127.0.0.1:61641";
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent("/work/my-schedule")}`);
  await page.locator('input[name="email"]').fill(worker.email);
  await page.locator('input[name="password"]').fill(worker.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  const booking = page.locator(`article:has-text("${partial ? "Synthetic partial monitoring crew" : "Synthetic controls service crew"}")`);
  await booking.getByRole("link", { name: "Open assigned work" }).click();
  try { await page.getByRole("heading", { name: "Report work performed" }).waitFor({ timeout: 8000 }); }
  catch (error) { console.log(JSON.stringify({ url: page.url(), text: (await page.locator("body").innerText()).slice(0, 1700) })); throw error; }
  const body = await page.locator("body").innerText();
  if (!body.includes("Authorized")) { console.log(JSON.stringify({ fieldText: body.slice(0, 1700) })); throw new Error("worker_did_not_receive_field_authority"); }
  const files = page.locator('section:has(h2:text-is("Photos and files"))');
  if (!(await files.locator("article").count())) {
    const png = partial ? await sharp(Buffer.from('<svg width="640" height="320" xmlns="http://www.w3.org/2000/svg"><rect width="640" height="320" fill="#17324a"/><rect x="40" y="75" width="560" height="190" rx="8" fill="#e7edf1"/><path d="M70 180 H260 L325 115 H570" fill="none" stroke="#d7a40f" stroke-width="12"/><text x="45" y="45" fill="white" font-size="24">FICTIONAL PILOT - ROUTE ENTRY</text><text x="70" y="225" fill="#17324a" font-size="19">Illustrative diagnostic evidence; not a real site photo</text></svg>')).png().toBuffer() : Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/9ZkAAAAASUVORK5CYII=", "base64");
    await files.locator('input[name="file"]').setInputFiles({ name: partial ? "FICTIONAL-route-entry-diagnostic.png" : "synthetic-monitoring-panel.png", mimeType: "image/png", buffer: png });
    await files.locator('select[name="purpose"]').selectOption("Inspection result");
    await files.locator('input[name="caption"]').fill(partial ? "FICTIONAL PILOT illustration of route-entry diagnostic; not a real site photograph" : "SYNTHETIC PILOT image of monitored panel after covered inspection");
    await files.getByRole("button", { name: "Upload file" }).click();
    try { await files.getByText(partial ? /FICTIONAL-route-entry-diagnostic.png/ : /synthetic-monitoring-panel.png/).waitFor({ timeout: 15000 }); }
    catch (error) { console.log(JSON.stringify({ uploadStatus: (await page.locator("body").innerText()).slice(0, 2000) })); throw error; }
  }
  const report = page.locator('section:has(h2:text-is("Report work performed"))');
  const reportSummary = partial ? "FICTIONAL PILOT: inspected the existing monitoring route through the revised safe access method; fault localized at the obstructed route entry, continuity confirmed after diagnostic correction, and no equipment replaced. Four labor hours within the approved visit." : "Panel inspection and alarm inputs completed; normal operation restored and documented for independent review.";
  if (!(await page.locator("body").innerText()).includes(reportSummary)) {
    await report.locator('input[name="quantity"]').fill("1");
    await report.locator('input[name="unit"]').fill("service visit");
    await report.locator('input[name="laborHours"]').fill("4");
    await report.locator('textarea[name="summary"]').fill(reportSummary);
    const evidenceBox = report.locator('input[name="evidenceId"]');
    if (await evidenceBox.count()) await evidenceBox.first().check();
    await report.getByRole("button", { name: "Save on device" }).click();
    await report.getByText("Local only").waitFor({ timeout: 5000 });
    await report.getByRole("button", { name: "Synchronize report" }).click();
    await page.getByText(/1 service visit · Draft/).waitFor({ timeout: 30000 });
  }
  const myReports = page.locator('section:has(h2:text-is("My reports"))');
  if (await myReports.getByRole("button", { name: "Submit for supervisor review" }).count()) {
    await myReports.getByRole("button", { name: "Submit for supervisor review" }).click();
    await myReports.getByText(/Submitted/).waitFor({ timeout: 30000 });
  }
  await page.reload();
  await page.getByText(/1 service visit · Submitted/).waitFor({ timeout: 30000 });
  console.log(JSON.stringify({ status: "service_worker_report_and_evidence_submitted", person: partial ? "Samira Khan" : "Jordan Lee", variant: partial ? "partially_covered" : "covered" }));
  await context.close();
} finally { await browser.close(); }
