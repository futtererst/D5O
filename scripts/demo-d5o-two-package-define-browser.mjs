import { readFileSync } from "node:fs";
import { chromium } from "playwright";

if (process.env.D5O_ISOLATED_PILOT !== "1" ||
  process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:56621" ||
  !process.env.D5O_PILOT_CREDENTIALS_FILE) throw new Error("fresh_disposable_pilot_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const workId = "rybex-9e4f1e5f9e6b4e429142d3b01e1825e5";
const browser = await chromium.launch({ headless: true });
async function signIn(key) {
  const user = users.find((item) => item.key === key);
  if (!user) throw new Error(`pilot_user_missing:${key}`);
  const context = await browser.newContext();
  const page = await context.newPage();
  const path = `/work?workspace=rybex&view=define&record=${workId}`;
  await page.goto(`http://127.0.0.1:61642/auth/sign-in?next=${encodeURIComponent(path)}`);
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.getByText("Rybex Delivery").first().waitFor({ timeout: 30000 });
  await page.getByText("Shape the project before committing to delivery.").waitFor({ timeout: 30000 });
  return { context, page };
}
try {
  const { context, page } = await signIn("pm");
  const save = async (action) => {
    const response = page.waitForResponse((item) => item.request().method() === "POST" &&
      item.url().includes("/api/d5o-hosted/prototype-state"), { timeout: 30000 });
    await action();
    const result = await response;
    if (!result.ok()) throw new Error(`define_draft_save:${result.status()}:${(await result.text()).slice(0,300)}`);
  };
  const tab = (label) => page.getByRole("button", { name: label, exact: true }).last().click();
  const drawer = () => page.getByRole("dialog");
  const existing = await page.evaluate(async (id) => {
    const response = await fetch("/api/d5o-hosted/prototype-state?workspace=rybex&key=work");
    const payload = await response.json();
    const definition = payload.state?.records?.find((item) => item.id === id)?.definition;
    return { status: definition?.status, scopeCount: definition?.registers?.scope_items?.length ?? 0 };
  }, workId);
  if (existing.scopeCount < 2) {
  await tab("Investigation");
  await page.getByRole("button", { name: "Edit context" }).click();
  await drawer().getByLabel("Linked Discover stakeholder").selectOption({ label: "Fictional Morgan Buyer · Decision-maker" });
  await drawer().getByLabel("Site and affected area").fill("North and south monitored control zones · Data Hall B");
  await drawer().getByLabel("Assets and systems").fill("Two control panels, monitoring sensors, and central alarm interface");
  await drawer().getByLabel("Access and operating constraints").fill("Escorted access and approved outage window per zone");
  await drawer().getByLabel("Customer required date").fill("2026-11-20");
  await save(() => drawer().getByRole("button", { name: "Save context" }).click());
  await page.getByRole("button", { name: "+ Add finding" }).click();
  await drawer().locator('select[name="status"]').selectOption("Confirmed");
  await drawer().locator('textarea[name="detail"]').fill("North and south control zones can be isolated and commissioned separately.");
  await drawer().locator('input[name="source"]').fill("Fictional site walk 2026-10-09 · pilot note DC-B-01");
  await save(() => drawer().getByRole("button", { name: "Save finding" }).click());
  console.log(JSON.stringify({ step: "define_investigation_ui_saved" }));

  await tab("Scope & acceptance");
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await drawer().getByLabel("Promised outcome").fill("Deliver two separately commissioned and witnessed monitoring zones with traceable test records.");
  await save(() => drawer().getByRole("button", { name: "Save to revision" }).click());
  await page.getByRole("button", { name: "+ Add requirement" }).click();
  await drawer().locator('input[name="need"]').fill("Each control zone provides independently verified monitoring and alarms.");
  await drawer().locator('input[name="source"]').fill("Fictional customer scope meeting DC-B-02");
  await drawer().locator('input[name="owner"]').fill("Pilot Project Manager");
  await drawer().locator('select[name="state"]').selectOption("Confirmed");
  await save(() => drawer().getByRole("button", { name: "Save to Define revision" }).click());
  await page.getByRole("button", { name: "Record agreement" }).click();
  await drawer().locator('input[name="representative"]').fill("Fictional Morgan Buyer");
  await drawer().locator('input[name="agreedAt"]').fill("2026-10-09");
  await drawer().locator('input[name="basis"]').fill("Fictional scope meeting DC-B-02; preliminary alignment only");
  await save(() => drawer().getByRole("button", { name: "Save to Define revision" }).click());
  const addRegister = async (section, values, source) => {
    await page.getByRole("region", { name: section }).getByRole("button", { name: /\+ Add/ }).click();
    const form = drawer().locator("form");
    for (const [label, value] of Object.entries(values)) await form.getByLabel(label, { exact: false }).fill(value);
    if (source) await form.getByLabel(source.label, { exact: false }).selectOption({ label: source.value });
    await save(() => drawer().getByRole("button", { name: "Save item" }).click());
  };
  await addRegister("Included scope", { "Deliverable": "North zone control panel and sensors", "Scope boundary": "North zone through central alarm interface", "Owner": "Pilot Project Manager" },
    { label: "Customer requirement", value: "Each control zone provides independently verified monitoring and alarms." });
  await addRegister("Included scope", { "Deliverable": "South zone control panel and sensors", "Scope boundary": "South zone through central alarm interface", "Owner": "Pilot Project Manager" },
    { label: "Customer requirement", value: "Each control zone provides independently verified monitoring and alarms." });
  await addRegister("Acceptance criteria", { "Result": "North zone alarms and monitoring pass witnessed test", "Verification method": "Commissioning test", "Required proof": "Signed test sheet and photographs", "Accepting authority": "Customer technical reviewer" },
    { label: "Included deliverable", value: "North zone control panel and sensors" });
  await addRegister("Acceptance criteria", { "Result": "South zone alarms and monitoring pass witnessed test", "Verification method": "Commissioning test", "Required proof": "Signed test sheet and photographs", "Accepting authority": "Customer technical reviewer" },
    { label: "Included deliverable", value: "South zone control panel and sensors" });
  await page.getByRole("button", { name: "Edit", exact: true }).last().click();
  await drawer().getByLabel("Exclusions and customer responsibilities").fill("Customer retains network access approval and operations escort; unrelated control systems excluded.");
  await save(() => drawer().getByRole("button", { name: "Save to revision" }).click());
  console.log(JSON.stringify({ step: "define_two_scope_items_ui_saved" }));

  await tab("Delivery basis");
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await drawer().getByLabel("Delivery approach").fill("Engineer, release, install and verify north and south zones as separate packages; retain customer outage control.");
  await save(() => drawer().getByRole("button", { name: "Save to revision" }).click());
  await addRegister("Milestones", { "Milestone": "North zone ready for commissioning", "Due date": "2026-11-05", "Owner": "Pilot Project Manager" });
  await addRegister("Dependencies", { "Dependency": "Customer approves isolated outage and escorted access", "Owner": "Fictional facilities director", "Needed by": "2026-10-28" });
  await page.getByRole("button", { name: "+ Add interface" }).click();
  await drawer().locator('input[name="boundary"]').fill("Customer network and alarm interface");
  await drawer().locator('input[name="owner"]').fill("Pilot Project Manager");
  await drawer().locator('input[name="counterparty"]').fill("Fictional customer IT lead");
  await drawer().locator('textarea[name="agreement"]').fill("Customer provides credentials and witnesses point-to-point test.");
  await save(() => drawer().getByRole("button", { name: "Save to Define revision" }).click());
  await page.getByRole("button", { name: "+ Add assumption" }).click();
  await drawer().locator('textarea[name="statement"]').fill("Outage windows available one zone at a time.");
  await drawer().locator('input[name="owner"]').fill("Fictional facilities director");
  await drawer().locator('input[name="source"]').fill("Fictional meeting DC-B-02");
  await drawer().locator('select[name="state"]').selectOption("Accepted");
  await save(() => drawer().getByRole("button", { name: "Save to Define revision" }).click());
  await page.getByRole("button", { name: "Record ROM range" }).click();
  await drawer().locator('input[name="low"]').fill("120000");
  await drawer().locator('input[name="high"]').fill("170000");
  await drawer().locator('textarea[name="assumptions"]').fill("Two standard panels, existing cabling reusable pending survey; not a priced offer.");
  await save(() => drawer().getByRole("button", { name: "Save to Define revision" }).click());
  await tab("Review & handoff");
  await addRegister("Risks and controls", { "Risk or assessment": "Access and outage changes", "Control or rationale": "Confirm customer window before package release", "Owner": "Pilot Project Manager" });
  }
  if (existing.status === "Draft") {
    if (existing.scopeCount > 2) {
      await tab("Scope & acceptance");
      for (let count = existing.scopeCount; count > 2; count--) {
        await page.getByRole("region", { name: "Included scope" }).getByRole("button", { name: "Edit" }).last().click();
        await save(() => drawer().getByRole("button", { name: "Remove" }).click());
      }
    }
    await tab("Review & handoff");
  console.log(JSON.stringify({ step: "define_before_submit", text: (await page.locator("body").innerText()).slice(-2000) }));
  await page.getByRole("button", { name: "Request Commercial and Delivery review" }).click();
  await page.waitForFunction(async (id) => {
    const response = await fetch("/api/d5o-hosted/prototype-state?workspace=rybex&key=work");
    const payload = await response.json();
    return payload.state?.records?.find((item) => item.id === id)?.definition?.status === "In review";
  }, workId, { timeout: 30000 });
  await page.reload();
  await page.getByText("Role decisions required").waitFor({ timeout: 30000 });
  console.log(JSON.stringify({ step: "define_submitted_by_project_manager" }));
  }
  await context.close();

  for (const [key, role] of [["commercial", "commercial"], ["operations", "delivery"]]) {
    const reviewer = await signIn(key);
    await reviewer.page.getByRole("button", { name: "Review & handoff", exact: true }).click();
    await reviewer.page.getByLabel("Decision basis").fill(`Fictional pilot ${role} review accepts exact two-package scope and witnessed verification requirements.`);
    await reviewer.page.getByRole("button", { name: "Approve revision 1" }).first().click();
    await reviewer.page.waitForTimeout(700);
    await reviewer.page.reload();
    await reviewer.page.getByText("Shape the project before committing to delivery.").waitFor({ timeout: 30000 });
    console.log(JSON.stringify({ step: `define_${role}_independent_review`, text: (await reviewer.page.locator("body").innerText()).slice(-600) }));
    await reviewer.context.close();
  }

  const sender = await signIn("pm");
  await sender.page.getByRole("button", { name: "Review & handoff", exact: true }).click();
  await sender.page.getByRole("button", { name: "Send approved revision to Develop" }).click();
  await sender.page.getByText("SUBMITTED", { exact: true }).waitFor({ timeout: 30000 });
  await sender.context.close();
  const receiver = await signIn("operations");
  await receiver.page.getByRole("button", { name: "Review & handoff", exact: true }).click();
  await receiver.page.getByLabel("Receiving decision basis").fill("Operations receives the exact approved two-zone Define baseline for solution development.");
  await receiver.page.getByRole("button", { name: "Accept into Develop" }).click();
  await receiver.page.getByText("ACCEPTED", { exact: true }).waitFor({ timeout: 30000 });
  await receiver.page.reload();
  await receiver.page.getByRole("button", { name: "Review & handoff", exact: true }).click();
  await receiver.page.getByText("ACCEPTED", { exact: true }).waitFor({ timeout: 30000 });
  console.log(JSON.stringify({ step: "define_develop_independent_receipt" }));
  await receiver.context.close();
} finally { await browser.close(); }
