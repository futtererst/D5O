import { readFileSync } from "node:fs";
import { chromium } from "playwright";

if (process.env.D5O_ISOLATED_PILOT !== "1" || !process.env.D5O_PILOT_CREDENTIALS_FILE)
  throw new Error("disposable_pilot_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const pm = users.find((item) => item.key === "pm");
const partial = process.env.D5O_SERVICE_VARIANT === "partial";
if (process.env.D5O_SERVICE_VARIANT && !partial) throw new Error("unsupported_service_variant");
const browser = await chromium.launch({ headless: true });
const date = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const child = partial ? "rybex-a11c09e603a248359205ec84f0af4ae8" : "rybex-d910a2a58a9c46038fb459436e1839c3";
  const url = `http://127.0.0.1:61641/work?workspace=rybex&view=record&section=Design&record=${child}`;
  await page.goto(`http://127.0.0.1:61641/auth/sign-in?next=${encodeURIComponent(url.slice("http://127.0.0.1:61641".length))}`);
  await page.locator('input[name="email"]').fill(pm.email);
  await page.locator('input[name="password"]').fill(pm.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.getByRole("heading", { name: "Receive the service execution basis" }).waitFor({ timeout: 30000 });
  if (!(await page.locator("body").innerText()).includes(`accepted · revision ${partial ? 2 : 1}`)) throw new Error("service_basis_not_accepted");
  await page.getByRole("button", { name: "Documents", exact: true }).click();
  const documentTitle = partial ? "Monitoring route diagnostic and continuity test method" : "Covered monitoring inspection method and alarm test";
  if (!(await page.locator("body").innerText()).includes(documentTitle)) {
    await page.locator('select[name="type"]').selectOption("Service engineering");
    await page.locator('input[name="title"]').fill(documentTitle);
    await page.locator('input[name="source"]').fill("SYNTHETIC-PILOT-SERVICE-METHOD-001");
    await page.locator('select[name="requirements"]').selectOption(["service-scope"]);
    await page.locator('input[name="due"]').fill(date(2));
    await page.getByRole("button", { name: "Save draft for selected package" }).click();
    await page.getByText(`${documentTitle} · rev 1`).waitFor({ timeout: 30000 });
  }
  await page.getByRole("button", { name: "Packages", exact: true }).click();
  const packageForm = page.locator('form:has(button:has-text("Save new design revision"))');
  if (await packageForm.count() !== 1) throw new Error("service_package_design_form_missing");
  await packageForm.locator('textarea[name="scope"]').fill(partial ? "Inspect the covered monitoring route and perform the separately authorized four-hour fiber continuity diagnostic." : "Inspect the covered monitoring panel, test recorded alarm inputs, and return documented normal operation.");
  await packageForm.locator('input[name="location"]').fill(partial ? "Supported data hall monitoring route" : "Supported data hall monitoring panel");
  await packageForm.locator('input[name="systems"]').fill(partial ? "Monitoring fiber route and alarm interfaces" : "Monitoring panel and alarm interfaces");
  await packageForm.locator('select[name="requirementIds"]').selectOption(["service-scope"]);
  const documentRef = await packageForm.locator('select[name="documentRefs"] option').last().getAttribute("value");
  if (!documentRef) throw new Error("document_reference_missing");
  await packageForm.locator('select[name="documentRefs"]').selectOption([documentRef]);
  await packageForm.locator('input[name="plannedQuantity"]').fill("1");
  await packageForm.locator('input[name="plannedUnit"]').fill("service visit");
  await packageForm.locator('input[name="access"]').fill("Customer-approved data hall access");
  await packageForm.locator('textarea[name="safetyControls"]').fill("Site briefing, energized-circuit check, and safe isolation");
  await packageForm.locator('textarea[name="method"]').fill(partial ? "Inspect route, measure fiber continuity and record fault location within approved four-hour scope" : "Inspect panel, simulate agreed alarm inputs, record results");
  await packageForm.locator('textarea[name="rollback"]').fill(partial ? "Restore route access and return unresolved fault for controlled engineering review" : "Restore original panel state and escalate failed input checks");
  await packageForm.locator('textarea[name="verification"]').fill(partial ? "Independent quality review of continuity readings and fault-location record" : "Independent quality review of recorded alarm input results");
  await packageForm.locator('input[name="proof"]').fill(partial ? "Timestamped continuity readings and route image" : "Timestamped alarm test record and panel image");
  await packageForm.locator('input[name="acceptingAuthority"]').fill("Customer site representative for this visit");
  await packageForm.locator('input[name="windowStart"]').fill(date(3));
  await packageForm.locator('input[name="windowEnd"]').fill(date(5));
  await packageForm.locator('input[name="targetReleaseDate"]').fill(date(2));
  await packageForm.getByRole("button", { name: "Save new design revision" }).click();
  await page.getByText("engineering revision 1").waitFor({ timeout: 30000 });
  await page.reload();
  await page.getByRole("button", { name: "Packages", exact: true }).click();
  await page.getByText("engineering revision 1").waitFor({ timeout: 30000 });
  console.log(JSON.stringify({ status: "service_design_draft_saved", workId: child, documentRef }));
  await context.close();
} finally { await browser.close(); }
