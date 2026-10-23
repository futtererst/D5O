import { readFileSync } from "node:fs";
import { chromium } from "playwright";

if (process.env.D5O_QUEUE_TARGET_URL !== "http://127.0.0.1:56821" ||
  process.env.D5O_QUEUE_ORIGIN !== "http://127.0.0.1:61645")
  throw new Error("disposable_service_cost_fixture_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const finance = users.find((item) => item.key === "finance");
const origin = process.env.D5O_QUEUE_ORIGIN;
const requestId = "abe94af3-bdc5-435b-b6ad-ca810293988e";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(origin + "/auth/sign-in?next=" + encodeURIComponent("/work?workspace=rybex&view=my-work"));
  await page.locator('input[name="email"]').fill(finance.email);
  await page.locator('input[name="password"]').fill(finance.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.getByRole("heading", { name: "Actions requiring attention" }).waitFor();
  const queue = page.locator('section[aria-label="Service commercial and Finance actions"]');
  await queue.getByRole("link", { name: /Synthetic monitoring route fault · Service cost source/ }).click();
  if (!page.url().includes("request=" + requestId)) throw Error("wrong_service_request");
  let panel = page.locator('section[aria-label="Service actual costs and economics"]');
  await panel.getByText(/No sourced actual cost has been recorded/).waitFor();
  let form = panel.locator("form");
  await form.locator('input[name="amount"]').fill("80.00");
  await form.locator('select[name="category"]').selectOption("Material");
  await form.locator('select[name="allocation"]').selectOption("Unallocated");
  await form.locator('input[name="incurredDate"]').fill("2026-10-09");
  await form.locator('input[name="source"]').fill("FICTIONAL-SUPPLIER-COST-INITIAL-80");
  await form.locator('input[name="rationale"]').fill("Fictional material receipt awaiting coverage allocation.");
  const [recordResponse] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/service-cost") && r.request().method() === "POST"),
    form.getByRole("button", { name: "Record cost" }).click()
  ]);
  const recorded = await recordResponse.json();
  if (!recordResponse.ok()) throw Error("record:" + recorded.error);
  await page.reload();
  panel = page.locator('section[aria-label="Service actual costs and economics"]');
  await panel.getByText(/unallocated \$80\.00/).waitFor();
  await panel.getByRole("button", { name: "Correct" }).click();
  form = panel.locator("form");
  await form.locator('input[name="amount"]').fill("75.00");
  await form.locator('select[name="category"]').selectOption("Material");
  await form.locator('select[name="allocation"]').selectOption("Uncovered");
  await form.locator('input[name="incurredDate"]').fill("2026-10-09");
  await form.locator('input[name="source"]').fill("FICTIONAL-SUPPLIER-COST-CORRECTION-75");
  await form.locator('input[name="rationale"]').fill("Fictional corrected receipt allocated to uncovered scope.");
  const [correctResponse] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/service-cost") && r.request().method() === "POST"),
    form.getByRole("button", { name: "Record linked adjustment" }).click()
  ]);
  const corrected = await correctResponse.json();
  if (!correctResponse.ok()) throw Error("correct:" + corrected.error);
  await page.reload();
  panel = page.locator('section[aria-label="Service actual costs and economics"]');
  await panel.getByText(/uncovered \$75\.00/).waitFor();
  await panel.getByText(/Provisional uncovered contribution from recorded costs only: \$449\.65/).waitFor();
  await page.locator('section[aria-label="Service invoice and receivable"]')
    .getByText(/outstanding \$424\.65/).waitFor();
  console.log(JSON.stringify({ requestId, originalId: recorded.entryId,
    reversalId: corrected.reversalId, replacementId: corrected.entryId,
    invoicedMinor: 52465, paidMinor: 10000, outstandingMinor: 42465,
    activeUncoveredCostMinor: 7500, provisionalUncoveredContributionMinor: 44965,
    finalMargin: "Unknown", reload: "retained" }));
} finally { await browser.close(); }
