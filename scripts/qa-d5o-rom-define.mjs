import { readFileSync } from "node:fs";
import { chromium } from "playwright";
if (process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:58221" ||
    process.env.D5O_COMMAND_RUNTIME !== "rehearsal" || !process.env.D5O_PILOT_CREDENTIALS_FILE)
  throw new Error("disposable_rom_target_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const origin = "http://127.0.0.1:61643", workId = "rybex-f85daaed685f4b5b9e113b8a0f5cf33c";
const browser = await chromium.launch({ headless: true });
async function login(key) {
  const user = users.find((item) => item.key === key);
  const context = await browser.newContext(), page = await context.newPage();
  const path = `/work?workspace=rybex&view=define&record=${workId}`;
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent(path)}`);
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.getByRole("button", { name: "Investigation", exact: true }).waitFor({ timeout: 30000 });
  return { context, page };
}
async function read(page) {
  return page.evaluate(async (id) => {
    const payload = await fetch("/api/d5o-hosted/prototype-state?workspace=rybex&key=work").then((response) => response.json());
    return payload.state?.records?.find((item) => item.id === id)?.definition;
  }, workId);
}
async function save(page, action) {
  const response = page.waitForResponse((item) => item.request().method() === "POST" && item.url().includes("/api/d5o-hosted/prototype-state") && !item.url().includes("pricing=1"), { timeout: 30000 });
  await action(); const result = await response;
  if (!result.ok()) throw new Error(`define_draft_save:${result.status()}:${(await result.text()).slice(0, 400)}`);
}
const tab = (page, name) => page.getByRole("button", { name, exact: true }).last().click();
const drawer = (page) => page.getByRole("dialog");
async function register(page, section, fields, link) {
  await page.getByRole("region", { name: section }).getByRole("button", { name: /\+ Add/ }).click();
  const form = drawer(page).locator("form");
  for (const [label, value] of Object.entries(fields)) await form.getByLabel(label, { exact: false }).fill(value);
  if (link) await form.getByLabel(link.label, { exact: false }).selectOption({ label: link.value });
  await save(page, () => drawer(page).getByRole("button", { name: "Save item" }).click());
}
try {
  const { page, context } = await login("pm");
  const existing = await read(page);
  if ((!existing || existing.status === "Draft") && !(existing?.registers?.scope_items?.length)) {
    await tab(page, "Investigation");
    await page.getByLabel("Customer contact", { exact: true }).fill("Fictional Morgan Buyer");
    await page.getByLabel("Site and affected area").fill("Data Hall R · 48 Cat6A link endpoints and pathways");
    await page.getByLabel("Affected systems").fill("Passive Cat6A structured cabling, patch panels and labeling");
    await page.getByLabel("Access and operating constraints").fill("Escorted access; customer outage approval and pathway permit before installation");
    await page.getByLabel("Customer required date").fill("2026-11-20");
    await save(page, () => page.getByRole("button", { name: "Save investigation facts" }).click());
    await page.getByRole("button", { name: "+ Add finding" }).click();
    await drawer(page).locator('select[name="status"]').selectOption("Confirmed");
    await drawer(page).locator('textarea[name="detail"]').fill("Fictional customer confirms 48 certified Cat6A links; exact pathway length and installation productivity remain Design unknowns.");
    await drawer(page).locator('input[name="source"]').fill("Fictional Hall R site brief ROM-01, 2026-10-16");
    await save(page, () => drawer(page).getByRole("button", { name: "Save finding" }).click());
    await tab(page, "Scope & acceptance");
    await page.getByRole("button", { name: "Edit", exact: true }).first().click();
    await drawer(page).getByLabel("Promised outcome").fill("Deliver 48 separately certified Cat6A links with labels, test results and an as-built link schedule for fictional Data Hall R.");
    await save(page, () => drawer(page).getByRole("button", { name: "Save to revision" }).click());
    await page.getByRole("button", { name: "+ Add requirement" }).click();
    await drawer(page).locator('input[name="need"]').fill("Provide 48 certified Cat6A permanent links, labels, test results and as-built documentation.");
    await drawer(page).locator('input[name="source"]').fill("Fictional customer Hall R scope brief ROM-01");
    await drawer(page).locator('input[name="owner"]').fill("Fictional ROM Project Manager");
    await drawer(page).locator('select[name="state"]').selectOption("Confirmed");
    await save(page, () => drawer(page).getByRole("button", { name: "Save to Define revision" }).click());
    await page.getByRole("button", { name: "Record agreement" }).click();
    await drawer(page).locator('input[name="representative"]').fill("Fictional Morgan Buyer");
    await drawer(page).locator('input[name="agreedAt"]').fill("2026-10-16");
    await drawer(page).locator('input[name="basis"]').fill("Fictional Hall R scope meeting ROM-01; agreement on requirements only, not a price or award");
    await save(page, () => drawer(page).getByRole("button", { name: "Save to Define revision" }).click());
    await register(page, "Included scope", { Deliverable: "48 Cat6A links, labels and certification", "Scope boundary": "Data Hall R passive cabling and patch panels; route quantities remain Design assumptions", Owner: "Fictional ROM Project Manager" }, { label: "Customer requirement", value: "Provide 48 certified Cat6A permanent links, labels, test results and as-built documentation." });
    await register(page, "Acceptance criteria", { Result: "48 Cat6A links pass witnessed permanent-link tests with labels and as-built link schedule", "Verification method": "Witnessed permanent-link certification and documentation review", "Required proof": "Certification files, labeled link schedule and fictional customer witness record", "Accepting authority": "Customer technical reviewer" }, { label: "Included deliverable", value: "48 Cat6A links, labels and certification" });
    await page.getByRole("button", { name: "Edit", exact: true }).last().click();
    await drawer(page).getByLabel("Exclusions and customer responsibilities").fill("Customer supplies escorted access and outage approvals. Active network electronics and building modifications excluded; cabling installation and testing remain in Rybex scope.");
    await save(page, () => drawer(page).getByRole("button", { name: "Save to revision" }).click());
    await tab(page, "Delivery basis");
    await page.getByRole("button", { name: "Edit", exact: true }).first().click();
    await drawer(page).getByLabel("Delivery approach").fill("Estimate 48 passive links and certification; detailed Design validates routing, specifications and effort before delivery award.");
    await save(page, () => drawer(page).getByRole("button", { name: "Save to revision" }).click());
    await register(page, "Milestones", { Milestone: "ROM reviewed before detailed Design", "Due date": "2026-10-30", Owner: "Fictional ROM Project Manager" });
    await register(page, "Dependencies", { Dependency: "Customer confirms escorted access and pathway availability", Owner: "Fictional facilities director", "Needed by": "2026-11-05" });
    await page.getByRole("button", { name: "+ Add interface" }).click();
    await drawer(page).locator('input[name="boundary"]').fill("Customer patch-panel ports and active-network demarcation");
    await drawer(page).locator('input[name="owner"]').fill("Fictional ROM Project Manager");
    await drawer(page).locator('input[name="counterparty"]').fill("Fictional customer IT lead");
    await drawer(page).locator('textarea[name="agreement"]').fill("Customer identifies active-network demarcation; Rybex provides passive certified links only.");
    await save(page, () => drawer(page).getByRole("button", { name: "Save to Define revision" }).click());
    await page.getByRole("button", { name: "+ Add assumption" }).click();
    await drawer(page).locator('textarea[name="statement"]').fill("48 links are confirmed; installed cable length and person-hours per link remain estimating assumptions.");
    await drawer(page).locator('input[name="owner"]').fill("Fictional ROM Project Manager");
    await drawer(page).locator('input[name="source"]').fill("Fictional Hall R brief ROM-01");
    await drawer(page).locator('select[name="state"]').selectOption("Accepted");
    await save(page, () => drawer(page).getByRole("button", { name: "Save to Define revision" }).click());
    await tab(page, "Review & handoff");
    await register(page, "Risks and controls", { "Risk or assessment": "Live hall access and route length unknown", "Control or rationale": "ROM assumptions retained; detailed Design verifies pathways before delivery release", Owner: "Fictional ROM Project Manager" });
  }
  if ((await read(page))?.status === "Draft") {
    await tab(page, "Delivery basis");
    const current = await read(page);
    if (!(current?.registers?.dependencies?.length))
      await register(page, "Dependencies", { Dependency: "Customer confirms escorted access and pathway availability", Owner: "Fictional facilities director", "Needed by": "2026-11-05" });
    if (!(current?.scopeControl?.interfaces?.length)) {
      await page.getByRole("button", { name: "+ Add interface" }).click();
      await drawer(page).locator('input[name="boundary"]').fill("Customer patch-panel ports and active-network demarcation");
      await drawer(page).locator('input[name="owner"]').fill("Fictional ROM Project Manager");
      await drawer(page).locator('input[name="counterparty"]').fill("Fictional customer IT lead");
      await drawer(page).locator('textarea[name="agreement"]').fill("Customer identifies active-network demarcation; Rybex provides passive certified links only.");
      await save(page, () => drawer(page).getByRole("button", { name: "Save to Define revision" }).click());
    }
    if (!((await read(page))?.scopeControl?.assumptions?.length)) {
      await page.getByRole("button", { name: "+ Add assumption" }).click();
      await drawer(page).locator('textarea[name="statement"]').fill("48 links are confirmed; installed cable length and person-hours per link remain estimating assumptions.");
      await drawer(page).locator('input[name="owner"]').fill("Fictional ROM Project Manager");
      await drawer(page).locator('input[name="source"]').fill("Fictional Hall R brief ROM-01");
      await drawer(page).locator('select[name="state"]').selectOption("Accepted");
      await save(page, () => drawer(page).getByRole("button", { name: "Save to Define revision" }).click());
    }
    await tab(page, "Review & handoff");
    if (!((await read(page))?.registers?.risks?.length))
      await register(page, "Risks and controls", { "Risk or assessment": "Live hall access and route length unknown", "Control or rationale": "ROM assumptions retained; detailed Design verifies pathways before delivery release", Owner: "Fictional ROM Project Manager" });
  }
  await tab(page, "Review & handoff");
  console.log(JSON.stringify({ step: "define_preparation", status: (await read(page))?.status, checks: (await page.locator("main").last().innerText()).slice(-700) }));
  if ((await read(page))?.status === "Draft") {
    await page.getByRole("button", { name: "Request Commercial and Delivery review" }).click();
    await page.waitForFunction(async (id) => {
      const payload = await fetch("/api/d5o-hosted/prototype-state?workspace=rybex&key=work").then((response) => response.json());
      return payload.state?.records?.find((item) => item.id === id)?.definition?.status === "In review";
    }, workId, { timeout: 30000 });
  }
  await context.close();
  for (const [key, role] of [["commercial", "commercial"], ["operations", "delivery"]]) {
    const reviewer = await login(key);
    await tab(reviewer.page, "Review & handoff");
    const definition = await read(reviewer.page);
    if (definition?.reviews?.[role] === "Pending") {
      await reviewer.page.getByLabel("Decision basis").fill(`Independent fictional ${role} review accepts the exact Cat6A scope, acceptance evidence and documented ROM unknowns.`);
      await reviewer.page.getByRole("button", { name: `Approve revision ${definition.revision}` }).first().click();
      await reviewer.page.waitForFunction(async ({ id, reviewRole }) => {
        const payload = await fetch("/api/d5o-hosted/prototype-state?workspace=rybex&key=work").then((response) => response.json());
        return payload.state?.records?.find((item) => item.id === id)?.definition?.reviews?.[reviewRole] === "Approved";
      }, { id: workId, reviewRole: role }, { timeout: 30000 });
    }
    console.log(JSON.stringify({ step: `define_${role}_review`, status: (await read(reviewer.page))?.reviews?.[role] }));
    await reviewer.context.close();
  }
  const sender = await login("pm");
  await tab(sender.page, "Review & handoff");
  await sender.page.getByRole("button", { name: "Send approved revision to Develop" }).click();
  await sender.page.getByText("SUBMITTED", { exact: true }).waitFor({ timeout: 30000 });
  await sender.context.close();
  const receiver = await login("operations");
  await tab(receiver.page, "Review & handoff");
  await receiver.page.getByLabel("Receiving decision basis").fill("Operations independently receives exact Cat6A requirements, acceptance and ROM unknowns for Develop.");
  await receiver.page.getByRole("button", { name: "Accept into Develop" }).click();
  await receiver.page.getByText("ACCEPTED", { exact: true }).waitFor({ timeout: 30000 });
  await receiver.page.reload();
  console.log(JSON.stringify({ step: "define_develop_receipt", status: (await read(receiver.page))?.status, receipt: (await read(receiver.page))?.developHandoff?.status }));
  await receiver.context.close();
} finally { await browser.close(); }
