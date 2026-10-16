import { readFileSync } from "node:fs";
import { chromium } from "playwright";

if (process.env.D5O_COMMAND_RUNTIME !== "rehearsal" || process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:58221" || !process.env.D5O_PILOT_CREDENTIALS_FILE) throw new Error("disposable_pilot_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const workId = "rybex-f85daaed685f4b5b9e113b8a0f5cf33c";
const origin = "http://127.0.0.1:61643";
const browser = await chromium.launch({ headless: true });
async function signIn(key) {
  const user = users.find((item) => item.key === key);
  if (!user) throw new Error(`missing_pilot:${key}`);
  const context = await browser.newContext(), page = await context.newPage();
  const path = `/work?workspace=rybex&view=develop&record=${workId}`;
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent(path)}`);
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.waitForURL(/\/work\?workspace=rybex/, { timeout: 30000 });
  return { context, page };
}
const work = async (page) => page.evaluate(async (id) => {
  const response = await fetch("/api/d5o-hosted/prototype-state?workspace=rybex&key=work");
  const payload = await response.json();
  return payload.state?.records?.find((item) => item.id === id);
}, workId);
try {
  const pm = await signIn("pm"), page = pm.page;
  await page.getByRole("button", { name: "Detailed estimator", exact: true }).click();
  const add = async (line) => {
    const form = page.locator('form:has(button:has-text("Add cost line"))');
    if (!await form.isVisible()) await page.getByText("+ Add sourced cost line").click();
    for (const [name, value] of Object.entries(line)) {
      const input = form.locator(`[name="${name}"]`);
      if (name === "category" || name === "sourceKind") await input.selectOption(value);
      else await input.fill(value);
    }
    await form.getByRole("button", { name: "Add cost line" }).click();
  };
  await add({ scopeRef: "48-link Cat6A solution", category: "material", description: "Cat6A cable, jacks, panels and labels", quantity: "48", unit: "link", manualRate: "80", source: "Fictional supplier budget rate CAT6A-48", assumption: "Per-link material allowance, final BOM pending Design", quantityBasis: "48 assumed permanent links × one material allowance per link", sourceKind: "Assumed", sourceDate: "2026-10-16" });
  await add({ scopeRef: "48-link Cat6A solution", category: "labor", description: "Inside-plant installation effort", quantity: "96", unit: "person-hour", manualRate: "65", source: "Fictional published internal labor cost sheet", assumption: "48 links × 2 person-hours per link, not crew-hours", quantityBasis: "48 assumed links × 2 person-hours per link = 96 person-hours", sourceKind: "Historical", sourceDate: "2026-10-16" });
  await add({ scopeRef: "Witnessed acceptance", category: "other", description: "Certification, reporting and as-built schedule", quantity: "48", unit: "link", manualRate: "15", source: "Fictional test/report allowance TEST-48", assumption: "Separate per-link test and documentation effort", quantityBasis: "48 assumed links × one testing/reporting allowance", sourceKind: "Assumed", sourceDate: "2026-10-16" });
  await add({ scopeRef: "Mobilization and equipment", category: "equipment", description: "Certification equipment and mobilization", quantity: "1", unit: "job", manualRate: "1000", source: "Fictional equipment/mobilization allowance EQUIP-1", assumption: "One site mobilization; not a material purchase", quantityBasis: "One planned site mobilization", sourceKind: "Assumed", sourceDate: "2026-10-16" });
  await page.getByLabel("Estimate maturity").selectOption("ROM");
  await page.getByLabel("Risk basis").fill("Customer pathway access and productivity vary; 10% direct-cost contingency covers residual uncertainty. Quantity and productivity are not additionally padded in the base.");
  const rom = page.locator('section[aria-label="ROM requirement coverage and scenarios"]');
  await rom.waitFor();
  const articles = rom.locator("article");
  const labels = [];
  for (let i = 0; i < await articles.count(); i++) {
    const article = articles.nth(i), label = (await article.locator("h4").innerText()).trim();
    labels.push(label);
    await article.getByLabel("Treatment").selectOption("Line");
    await article.getByLabel("Accountable owner").fill("Pilot Project Manager");
    const candidates = article.locator('input[type="checkbox"]');
    const target = /test|certif|as-built/i.test(label) ? 2 : /milestone|date|dependency|access|demarcation/i.test(label) ? 1 : 0;
    await candidates.nth(Math.min(target, await candidates.count() - 1)).check();
    await article.getByLabel("Basis or approved responsibility").fill(`ROM allowance addresses this approved obligation; confirm exact route and quantities in detailed Design: ${label}`);
  }
  await rom.getByLabel("Installation labor line").selectOption({ label: "Inside-plant installation effort" });
  for (const [label, value] of Object.entries({ "Count of units": "48", "Unit (for example link)": "link", "Low person-hours per unit": "1.5", "Base person-hours per unit": "2", "High person-hours per unit": "3", "Quantity source and status": "Assumed 48 links from approved scope; pathway survey pending Design", "Scenario rationale": "Vary only installation productivity, 1.5/2/3 person-hours per link; all other quantities and rates unchanged" })) await rom.getByLabel(label).fill(value);
  for (const [label, value] of Object.entries({ "Indicative scope": "48 Cat6A permanent links, labels, witnessed certification and as-built schedule", "Quantity and delivery assumptions": "48 links, 2 base person-hours per link, escorted access and one mobilization", "Explicit exclusions": "Active network equipment and customer patching", "Information still required": "Final pathway survey, route lengths, access windows and port mapping", "Validity or review date": "2026-11-16", "What detailed Design must validate": "Route quantities, cable pathway, link count, tests, labor productivity and customer interfaces" })) await rom.getByLabel(label).fill(value);
  console.log(JSON.stringify({ step: "rom_ui_basis", obligations: labels, issues: await rom.locator('[role="status"]').allInnerTexts(), summary: (await rom.innerText()).slice(-650) }));
  const response = page.waitForResponse((item) => item.url().includes("/api/d5o-hosted/prototype-commercial-command") && item.request().method() === "POST", { timeout: 30000 });
  await page.getByRole("button", { name: "Save detailed estimate revision" }).click();
  const saved = await response;
  console.log(JSON.stringify({ step: "estimate_save", http: saved.status(), body: (await saved.text()).slice(0, 700) }));
  const after = await work(page);
  console.log(JSON.stringify({ step: "estimate_committed", revision: after?.discovery?.estimate?.revision, status: after?.discovery?.estimate?.status, direct: after?.discovery?.estimate?.detailed?.evaluation?.directCostMinor, price: after?.discovery?.estimate?.detailed?.evaluation?.proposedPriceMinor, lineIds: after?.discovery?.estimate?.detailed?.input?.lines?.map((line) => ({ id: line.id, description: line.description })) }));
  await pm.context.close();
} finally { await browser.close(); }
