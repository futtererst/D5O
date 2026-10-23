import { readFileSync } from "node:fs";
import { chromium } from "playwright";

if (process.env.D5O_ISOLATED_PILOT !== "1" || !process.env.D5O_PILOT_CREDENTIALS_FILE) throw new Error("disposable_pilot_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const origin = "http://127.0.0.1:61644";
const child = "rybex-a11c09e603a248359205ec84f0af4ae8";
const changeId = "9117008f-9f08-4c16-a886-6b9448fb5595";
const browser = await chromium.launch({ headless: true });
async function stage(key, section, fn) {
  const user = users.find((item) => item.key === key);
  const context = await browser.newContext(), page = await context.newPage();
  page.on("response", async (response) => {
    if (response.request().method() === "POST" && response.url().includes("/api/d5o-hosted/prototype-design-command")) {
      const body = await response.json().catch(() => ({}));
      console.log(JSON.stringify({ designResponse: response.status(), error: body.error, message: body.message }));
    }
  });
  const target = `/work?workspace=rybex&view=record&section=${section}&record=${child}`;
  try {
    await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent(target)}`);
    await page.locator('input[name="email"]').fill(user.email);
    await page.locator('input[name="password"]').fill(user.password);
    await page.getByRole("button", { name: "Continue to your work" }).click();
    await page.getByRole("heading", { name: section === "Design" ? "Prepare executable work for release" : "Deliver and verify the released work" }).waitFor({ timeout: 30000 });
    await fn(page);
  } finally { await context.close(); }
}
try {
  if (process.env.D5O_PILOT_STAGE === "change") {
    await stage("pm", "Design", async (page) => {
      await page.getByRole("button", { name: "Changes", exact: true }).click();
      await page.getByRole("button", { name: "Use as Design source" }).click();
      const form = page.locator('form:has(button:has-text("Record change and hold active release"))');
      if (await form.locator('input[name="source"]').inputValue() !== `field-change:${changeId}`) throw new Error("field_change_source_not_selected");
      await form.locator('textarea[name="reason"]').fill("The obstructed route entry requires a controlled access method to complete only the authorized monitoring diagnostic.");
      await form.locator('textarea[name="technicalImpact"]').fill("Inspect around the existing tray using the approved safe access method; no new cable installation or equipment replacement.");
      await form.locator('textarea[name="commercialImpact"]').fill("");
      await form.locator('textarea[name="scheduleImpact"]').fill("Reconfirm the access window and crew briefing before restart.");
      await form.getByRole("button", { name: "Record change and hold active release" }).click();
      await page.getByText(`field-change:${changeId}`).last().waitFor({ timeout: 30000 });
    });
    await stage("supervisor", "Deploy", async (page) => {
      const receipt = page.locator('section:has(h2:has-text("Receive released package revisions"))');
      await receipt.getByLabel("Field hold acknowledgment reason").fill("Field team has received the hold on the original release and will not resume until revised receipt and start authorization.");
      await receipt.getByRole("button", { name: "Acknowledge field hold" }).click();
      await receipt.getByText(/acknowledged/).waitFor({ timeout: 30000 });
    });
    console.log(JSON.stringify({ status: "service_design_change_held_acknowledged", child, changeId }));
  }
  if (process.env.D5O_PILOT_STAGE === "package") {
    await stage("pm", "Design", async (page) => {
      await page.getByRole("button", { name: "Packages", exact: true }).click();
      const form = page.locator('form:has(button:has-text("Save new design revision"))');
      await form.locator('textarea[name="scope"]').fill("Diagnose the existing monitoring route and continuity through controlled access around the obstructed tray, within the authorized four-hour service visit. No replacement or unrelated expansion.");
      await form.locator('input[name="access"]').fill("Site representative confirms access to the obstructed route entry; pause if the tray cannot be safely inspected within the approved diagnostic window.");
      await form.locator('textarea[name="safetyControls"]').fill("Apply site electrical and fiber-handling controls; isolate the obstructed tray and stop if safe access is not established.");
      await form.locator('textarea[name="method"]').fill("Inspect route entry without altering unrelated cables, use approved safe access around the obstruction, measure fiber continuity, and record exact fault location within four authorized hours.");
      await form.locator('textarea[name="rollback"]').fill("Restore original tray condition and notify site representative if access or continuity cannot be safely confirmed.");
      await form.locator('textarea[name="verification"]').fill("Independent Quality review of continuity readings and recorded fault disposition against the revised access method.");
      await form.locator('input[name="proof"]').fill("Retained field photographs, continuity readings, reviewed report, and independent inspection.");
      await form.locator('textarea[name="commercialImpact"]').fill("");
      await form.locator('select[name="commercialDisposition"]').selectOption("None");
      await form.getByRole("button", { name: "Save new design revision" }).click();
      await page.getByRole("heading", { name: /engineering revision 2/ }).waitFor({ timeout: 30000 });
      await page.getByRole("button", { name: "Reviews", exact: true }).click();
      const request = page.locator('form:has(button:has-text("Request exact-revision review"))');
      for (const discipline of ["Engineering", "Delivery", "Safety", "Quality"]) {
        await request.locator('select[name="discipline"]').selectOption(discipline);
        await request.locator('input[name="dueDate"]').fill("2026-10-11");
        await request.getByRole("button", { name: "Request exact-revision review" }).click();
        await page.getByText(`${discipline} · rev 2 · Requested`).waitFor({ timeout: 30000 });
      }
    });
    console.log(JSON.stringify({ status: "service_design_rev2_review_requested", child }));
  }
  if (process.env.D5O_PILOT_STAGE === "review") {
    await stage("operations", "Design", async (page) => {
      await page.getByRole("button", { name: "Reviews", exact: true }).click();
      for (const discipline of ["Engineering", "Delivery", "Safety", "Quality"]) {
        const review = page.locator(`article:has(strong:text-is("${discipline} · rev 2 · Requested"))`);
        await review.getByLabel("Review rationale").fill(`${discipline} independently reviewed the revised safe access, four-hour authorized scope, and continuity proof requirement.`);
        await review.getByRole("button", { name: "Approve", exact: true }).click();
        await page.getByText(`${discipline} · rev 2 · Approved`).waitFor({ timeout: 30000 });
      }
    });
    await stage("pm", "Design", async (page) => {
      await page.getByRole("button", { name: "Changes", exact: true }).click();
      await page.getByRole("button", { name: "Resolve reviewed change" }).click();
      await page.getByText(/Resolved · revision 1/).waitFor({ timeout: 30000 });
      await page.getByRole("button", { name: "Readiness & release" }).click();
      const form = page.locator('form:has(button:has-text("Release this package to Deploy"))');
      await form.waitFor({ timeout: 30000 });
      await form.locator('input[name="owner"]').fill("Operations receiving queue");
      await form.locator('input[name="due"]').fill("2026-10-11");
      await form.getByRole("button", { name: "Release this package to Deploy" }).click();
      await page.getByText(/rev 2 · Awaiting receipt/).waitFor({ timeout: 30000 });
    });
    console.log(JSON.stringify({ status: "service_design_rev2_released", child }));
  }
  if (process.env.D5O_PILOT_STAGE === "release") {
    await stage("pm", "Design", async (page) => {
      await page.getByRole("button", { name: "Packages", exact: true }).click();
      const demand = page.locator('form:has(button:has-text("Save crew requirement"))');
      await demand.waitFor({ timeout: 30000 });
      await demand.getByRole("button", { name: "Save crew requirement" }).click();
      await page.waitForTimeout(750);
      await page.getByRole("button", { name: "Readiness & release" }).click();
      const form = page.locator('form:has(button:has-text("Release this package to Deploy"))');
      await form.waitFor({ timeout: 30000 });
      await form.locator('input[name="owner"]').fill("Operations receiving queue");
      await form.locator('input[name="due"]').fill("2026-10-11");
      await form.getByRole("button", { name: "Release this package to Deploy" }).click();
      await page.getByText(/rev 2 · Awaiting receipt/).waitFor({ timeout: 30000 });
    });
    console.log(JSON.stringify({ status: "service_design_rev2_released", child }));
  }
  if (process.env.D5O_PILOT_STAGE === "receipt") {
    await stage("operations", "Deploy", async (page) => {
      const receiving = page.locator('section:has(h2:has-text("Receive released package revisions"))');
      const pending = receiving.locator('article:has-text("rev 2 · Awaiting receipt")');
      await pending.getByLabel("Receipt reason").fill("Operations independently accepts revised package revision two with controlled route access and unchanged four-hour service limit.");
      await pending.getByRole("button", { name: "Accept", exact: true }).click();
      await page.getByText(/rev 2 · Accepted/).waitFor({ timeout: 30000 });
      await page.reload();
      await page.getByRole("button", { name: "Inspections & issues" }).click();
      const form = page.locator('form:has(button:has-text("Resolve against approved basis"))');
      await form.locator('input[name="reason"]').fill("Resolved against independently received revised package and fictional customer-authorized access method.");
      await form.getByRole("button", { name: "Resolve against approved basis" }).click();
      await page.getByText(/Unexpected cabling condition.*Resolved/).waitFor({ timeout: 30000 });
    });
    console.log(JSON.stringify({ status: "service_rev2_received_change_resolved", child, changeId }));
  }
} finally { await browser.close(); }


