import { readFileSync } from "node:fs";
import { chromium } from "playwright";

if (process.env.D5O_ISOLATED_PILOT !== "1" ||
  process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:56621" ||
  !process.env.D5O_PILOT_CREDENTIALS_FILE)
  throw new Error("fresh_disposable_pilot_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const origin = "http://127.0.0.1:61642";
const browser = await chromium.launch({ headless: true });
async function signIn(key, path = "/work?workspace=rybex&view=discover") {
  const user = users.find((item) => item.key === key);
  if (!user) throw new Error(`pilot_user_missing:${key}`);
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent(path)}`);
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.getByText("Rybex Delivery").first().waitFor({ timeout: 30000 });
  return { context, page };
}

try {
  const pm = await signIn("pm");
  let submittedSnapshot;
  pm.page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/d5o-hosted/prototype-state"))
      submittedSnapshot = request.postDataJSON()?.state?.records?.[0];
  });
  pm.page.on("response", async (response) => {
    if (response.request().method() === "POST" && response.url().includes("/api/d5o-hosted/"))
      console.log(JSON.stringify({ url: new URL(response.url()).pathname, status: response.status(), body: (await response.text()).slice(0, 300) }));
  });
  const readRecord = () => pm.page.evaluate(async () => {
    const response = await fetch("/api/d5o-hosted/prototype-state?workspace=rybex&key=work");
    const payload = await response.json();
    return payload.state?.records?.find((item) => item.title === "Synthetic North Campus controls renewal · two-package release pilot");
  });
  let record = await readRecord();
  if (!record) {
    await pm.page.getByRole("button", { name: "+ Capture opportunity" }).click();
    const form = pm.page.locator('form:has(button:has-text("Capture draft opportunity"))');
    await form.locator('input[name="title"]').fill("Synthetic North Campus controls renewal · two-package release pilot");
    await form.locator('input[name="customer"]').fill("Fictional North Campus Properties");
    await form.locator('input[name="site"]').fill("Data Hall B · Manassas, VA");
    await form.locator('textarea[name="need"]').fill("Replace and commission two monitored controls zones with separately verified package scope.");
    await form.locator('input[name="owner"]').fill("Pilot Project Manager");
    await form.getByRole("button", { name: "Capture draft opportunity" }).click();
    await pm.page.getByText("Synthetic North Campus controls renewal · two-package release pilot").first().waitFor({ timeout: 30000 });
    record = await readRecord();
  }
  if (!record?.canonicalWorkId) throw new Error("canonical_ui_capture_missing");
  console.log(JSON.stringify({ step: "discover_ui_capture", workId: record.id, canonicalWorkId: record.canonicalWorkId }));
  if (record.discovery?.pursuitControl?.status === "draft") {
  await pm.page.getByRole("button", { name: "Decision & handoff" }).click();
  if (record.discovery?.pursuitControl?.revision === 0) {
    const intake = pm.page.locator('form:has(button:has-text("Save intake revision"))');
    await intake.locator('input[name="requester"]').fill("Fictional facilities director");
    await intake.locator('input[name="intendedOutcome"]').fill("Two separately commissioned control zones with documented monitoring tests.");
    await intake.locator('input[name="roughValue"]').fill("150000");
    await intake.locator('input[name="currency"]').fill("USD");
    await intake.locator('input[name="requiredDate"]').fill("2026-11-20");
    await intake.locator('textarea[name="knownRisk"]').fill("Live data hall access and outage windows require customer confirmation.");
    await intake.getByRole("button", { name: "Save intake revision" }).click();
    await pm.page.getByText("Intake revision 1 · draft").waitFor({ timeout: 30000 });
  }
  console.log(JSON.stringify({ step: "discover_intake_saved" }));
  await pm.page.getByRole("button", { name: "Overview", exact: true }).last().click();
  const overview = pm.page.locator('form:has(button:has-text("Save working details"))');
  await overview.locator('select[name="funding"]').selectOption("Confirmed");
  await overview.locator('textarea[name="buyingProcess"]').fill("Facilities director obtains capital approval, then procurement issues the customer order.");
  await overview.locator('textarea[name="desiredOutcome"]').fill("Two monitored control zones pass witnessed commissioning tests.");
  await overview.locator('textarea[name="preliminaryScope"]').fill("Replace panels and sensors in north and south zones as two independently released packages.");
  await overview.locator('input[name="nextDue"]').fill("2026-10-20");
  await overview.getByRole("button", { name: "Save working details" }).click();
  await pm.page.waitForTimeout(900);
  await pm.page.getByRole("button", { name: "People & buying" }).click();
  if (!(await readRecord())?.discovery?.crm?.contacts?.some((person) => person.name === "Fictional Morgan Buyer")) {
    const contact = pm.page.locator('form:has(button:has-text("Add stakeholder"))');
    await contact.locator('input[name="name"]').fill("Fictional Morgan Buyer");
    await contact.locator('input[name="organization"]').fill("Fictional North Campus Properties");
    await contact.locator('select[name="role"]').selectOption("Decision-maker");
    await contact.locator('input[name="note"]').fill("Approves facilities funding after technical review.");
    await contact.getByRole("button", { name: "Add stakeholder" }).click();
    await pm.page.getByText("Fictional Morgan Buyer · Decision-maker").first().waitFor({ timeout: 30000 });
  }
  await pm.page.waitForTimeout(900);
  await pm.page.getByRole("button", { name: "Forecast", exact: true }).click();
  const forecast = pm.page.locator('form:has(button:has-text("Save dated forecast snapshot"))');
  await forecast.locator('input[name="value"]').fill("150000");
  await forecast.locator('input[name="currency"]').fill("USD");
  await forecast.locator('input[name="probability"]').fill("60");
  await forecast.locator('input[name="awardDate"]').fill("2026-11-10");
  await forecast.locator('select[name="category"]').selectOption("Pipeline");
  await forecast.locator('input[name="basis"]').fill("Fictional customer capital budget discussion");
  await forecast.locator('textarea[name="rationale"]').fill("Customer budget confirmed; procurement and outage dates remain open.");
  await forecast.getByRole("button", { name: "Save dated forecast snapshot" }).click();
  await pm.page.waitForTimeout(900);
  await pm.page.getByRole("button", { name: "Qualification", exact: true }).click();
  const assessmentBefore = (await readRecord())?.discovery?.crm?.assessmentHistory?.length ?? 0;
  const qualification = pm.page.locator('form:has(button:has-text("Save assessment revision"))');
  for (const name of ["strategicFit", "needCredibility", "commercialAttractiveness", "deliveryFeasibility", "risk"])
    await qualification.locator(`select[name="${name}"]`).selectOption("4");
  await qualification.getByRole("button", { name: "Save assessment revision" }).click();
  await pm.page.waitForFunction(async (before) => {
    const response = await fetch("/api/d5o-hosted/prototype-state?workspace=rybex&key=work");
    const data = await response.json();
    return (data.state?.records?.find((item) => item.title === "Synthetic North Campus controls renewal · two-package release pilot")?.discovery?.crm?.assessmentHistory?.length ?? 0) > before;
  }, assessmentBefore, { timeout: 30000 });
  await pm.page.reload();
  await pm.page.getByText("Synthetic North Campus controls renewal · two-package release pilot").first().waitFor({ timeout: 30000 });
  await pm.page.getByRole("button", { name: "Decision & handoff" }).click();
  const refreshedIntake = pm.page.locator('form:has(button:has-text("Save intake revision"))');
  await refreshedIntake.locator('textarea[name="knownRisk"]').fill(`Customer outage access remains an open constraint; assessment refreshed after CRM revision ${(await readRecord())?.discovery?.crm?.assessmentHistory?.length ?? 0}.`);
  await refreshedIntake.getByRole("button", { name: "Save intake revision" }).click();
  await pm.page.waitForFunction(async (before) => {
    const response = await fetch("/api/d5o-hosted/prototype-state?workspace=rybex&key=work");
    const data = await response.json();
    return (data.state?.records?.find((item) => item.title === "Synthetic North Campus controls renewal · two-package release pilot")?.discovery?.pursuitControl?.revision ?? 0) > before;
  }, record.discovery?.pursuitControl?.revision ?? 0, { timeout: 30000 });
  await pm.page.getByRole("button", { name: "Submit intake for pursuit decision" }).click();
  await pm.page.waitForTimeout(1800);
  if ((await readRecord())?.discovery?.pursuitControl?.status !== "submitted") {
    const projected = await readRecord();
    const fields = ["stage", "status", "progress", "phaseConfigurationVersionId", "nextAction", "packages", "definition", "design", "deploy", "operate"];
    console.log(JSON.stringify({ protectedDifferences: fields.filter((key) => JSON.stringify(submittedSnapshot?.[key]) !== JSON.stringify(projected?.[key])).map((key) => ({ key, submitted: submittedSnapshot?.[key], projected: projected?.[key] })), pursuitSubmitted: submittedSnapshot?.discovery?.pursuitControl, pursuitProjected: projected?.discovery?.pursuitControl }));
    const body = await pm.page.locator("body").innerText();
    throw new Error(`pursuit_submit_not_persisted:${body.slice(0,1100)}`);
  }
  console.log(JSON.stringify({ step: "discover_intake_submitted" }));
  }
  record = await readRecord();
  await pm.context.close();

  if (record?.discovery?.pursuitControl?.status === "submitted") {
    const commercial = await signIn("commercial", `/work?workspace=rybex&view=discover&record=${record.id}`);
    await commercial.page.getByRole("button", { name: "Decision & handoff" }).click();
    await commercial.page.getByPlaceholder("Why is this pursuit qualified, held, declined or returned?").fill("Customer need, funding and decision-maker are recorded; pursue under the stated access risk.");
    await commercial.page.getByRole("button", { name: "Qualify pursuit" }).click();
    await commercial.page.waitForFunction(async () => {
      const response = await fetch("/api/d5o-hosted/prototype-state?workspace=rybex&key=work");
      const data = await response.json();
      return data.state?.records?.find((item) => item.title === "Synthetic North Campus controls renewal · two-package release pilot")?.discovery?.pursuitControl?.status === "qualified";
    }, undefined, { timeout: 30000 });
    await commercial.page.reload();
    await commercial.context.close();
  }
  console.log(JSON.stringify({ step: "discover_independent_qualification" }));

  const handoff = await signIn("pm", `/work?workspace=rybex&view=discover&record=${record.id}`);
  await handoff.page.getByRole("button", { name: "Decision & handoff" }).click();
  if (record?.discovery?.pursuitControl?.handoff?.status !== "submitted") {
    const brief = handoff.page.locator('form:has(button:has-text("Submit Define handoff"))');
    await brief.locator('input[name="receiver"]').fill(users.find((item) => item.key === "operations").email);
    await brief.locator('textarea[name="brief"]').fill("Define two separately released controls zones, customer outage windows, acceptance tests and site interfaces.");
    await brief.getByRole("button", { name: "Submit Define handoff" }).click();
    await handoff.page.getByText(/Revision 1 to .*d5o-pilot-operations/).waitFor({ timeout: 30000 });
  }
  await handoff.context.close();

  const operations = await signIn("operations", `/work?workspace=rybex&view=discover&record=${record.id}`);
  await operations.page.getByRole("button", { name: "Decision & handoff" }).click();
  await operations.page.getByLabel("Receiver response reason").fill("Operations accepts the exact qualified pursuit brief and owns Define receipt.");
  await operations.page.getByRole("button", { name: "Accept Define handoff" }).click();
  await operations.page.getByText(/Accepted by/).waitFor({ timeout: 30000 });
  await operations.page.reload();
  await operations.page.getByRole("button", { name: "Decision & handoff" }).click();
  await operations.page.getByText(/Accepted by/).waitFor({ timeout: 30000 });
  console.log(JSON.stringify({ step: "discover_define_receipt" }));
  await operations.context.close();
} finally { await browser.close(); }
