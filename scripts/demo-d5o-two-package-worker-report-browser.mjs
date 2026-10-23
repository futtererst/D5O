import { readFileSync } from "node:fs";
import { chromium } from "playwright";
if (process.env.D5O_ISOLATED_PILOT !== "1" || process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:56621" || !process.env.D5O_PILOT_CREDENTIALS_FILE) throw new Error("fresh_disposable_pilot_only");
const mode = process.argv[2];
const variants = {
  "north-partial": { key: "serviceWorker", crew: "Fictional North controls crew", quantity: 5, summary: "Fictional pilot North zone: five of ten control points installed; remaining scope still open." },
  "north-correction": { key: "serviceWorker", crew: "Fictional North controls crew", quantity: 5, summary: "Fictional pilot North zone: final five control points installed and failed alarm terminal corrected." },
  "south-full": { key: "southWorker", crew: "Fictional South controls crew", quantity: 10, summary: "Fictional pilot South zone: ten control points installed and recorded for independent inspection." }
};
const variant = variants[mode];
if (!variant) throw new Error("report_mode_required");
const user = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users.find((item) => item.key === variant.key);
const origin = "http://127.0.0.1:61642", browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext(), page = await context.newPage();
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent("/work/my-schedule")}`);
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.locator("article").filter({ hasText: variant.crew }).getByRole("link", { name: "Open assigned work" }).click();
  await page.getByRole("heading", { name: "Report work performed" }).waitFor({ timeout: 30000 });
  if (!(await page.locator("body").innerText()).includes("Authorized")) throw new Error(`field_authority_missing:${mode}`);
  const files = page.locator('section:has(h2:text-is("Photos and files"))');
  if (!(await files.getByText(new RegExp(`synthetic-${mode}-controls.png`)).count())) {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/9ZkAAAAASUVORK5CYII=", "base64");
    await files.locator('input[name="file"]').setInputFiles({ name: `synthetic-${mode}-controls.png`, mimeType: "image/png", buffer: png });
    await files.locator('select[name="purpose"]').selectOption("Inspection result");
    await files.locator('input[name="caption"]').fill(`FICTIONAL PILOT ${mode}: control-point installation image`);
    await files.getByRole("button", { name: "Upload file" }).click();
    await files.getByText(new RegExp(`synthetic-${mode}-controls.png`)).waitFor({ timeout: 30000 });
  }
  const report = page.locator('section:has(h2:text-is("Report work performed"))');
  if (!(await page.locator("body").innerText()).includes(variant.summary)) {
    await report.locator('input[name="quantity"]').fill(String(variant.quantity));
    await report.locator('input[name="unit"]').fill("control points");
    await report.locator('input[name="laborHours"]').fill("4");
    await report.locator('textarea[name="summary"]').fill(variant.summary);
    const evidence = report.locator('input[name="evidenceId"]');
    if (await evidence.count()) await evidence.first().check();
    await report.getByRole("button", { name: "Save on device" }).click();
    await report.getByText("Local only").waitFor({ timeout: 5000 });
    await report.getByRole("button", { name: "Synchronize report" }).click();
    await page.getByText(new RegExp(`${variant.quantity} control points · Draft`)).last().waitFor({ timeout: 30000 });
  }
  const reports = page.locator('section:has(h2:text-is("My reports"))');
  const row = reports.locator("article").filter({ hasText: variant.summary });
  if (await row.getByRole("button", { name: "Submit for supervisor review" }).count()) {
    await row.getByRole("button", { name: "Submit for supervisor review" }).click();
    await row.getByText("Submitted").waitFor({ timeout: 30000 });
  }
  await page.reload();
  await page.locator('section:has(h2:text-is("My reports"))').locator("article").filter({ hasText: variant.summary }).getByText(/Submitted|Reviewed/).waitFor({ timeout: 30000 });
  console.log(JSON.stringify({ step: "worker_report_and_image_ui", mode, worker: user.name, quantity: variant.quantity }));
  await context.close();
} finally { await browser.close(); }
