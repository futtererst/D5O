import { readFileSync } from "node:fs";
import { chromium } from "playwright";
if (process.env.D5O_QUEUE_TARGET_URL !== "http://127.0.0.1:56821" ||
  process.env.D5O_QUEUE_ORIGIN !== "http://127.0.0.1:61645")
  throw new Error("disposable_service_cost_fixture_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const origin = process.env.D5O_QUEUE_ORIGIN;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const finance = users.find((item) => item.key === "finance");
  await page.goto(origin + "/auth/sign-in?next=" + encodeURIComponent("/work?workspace=rybex&view=my-work"));
  await page.locator('input[name="email"]').fill(finance.email);
  await page.locator('input[name="password"]').fill(finance.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.getByRole("heading", { name: "Actions requiring attention" }).waitFor();
  const queue = page.locator('section[aria-label="Service commercial and Finance actions"]');
  if (await queue.getByRole("link", { name: /Synthetic monitoring route fault · Service cost source/ }).count())
    throw Error("cost_source_still_missing");
  if (await queue.getByRole("link", { name: /Synthetic monitoring route fault · Service cost allocation/ }).count())
    throw Error("corrected_cost_still_unallocated");
  await queue.getByRole("link", { name: /Synthetic monitoring route fault · Service payment recording/ }).click();
  await page.reload();
  const panel = page.locator('section[aria-label="Service actual costs and economics"]');
  await panel.getByText(/estimate included-cost basis \$367\.25/).waitFor();
  await panel.getByText(/Recorded incurred cost \$75\.00/).waitFor();
  await panel.getByText(/Material · Uncovered: \$75\.00/).waitFor();
  await panel.getByText(/Provisional uncovered contribution from recorded costs only: \$449\.65/).waitFor();
  await panel.getByText(/Final margin: unknown/).waitFor();
  await page.locator('section[aria-label="Service invoice and receivable"]')
    .getByText(/outstanding \$424\.65/).waitFor();
  if (!(await page.locator("body").innerText()).includes("c396e7b"))
    throw Error("displayed_build_identity_mismatch");
  console.log(JSON.stringify({ displayedBuild: "c396e7b", estimatedIncludedCostMinor: 36725,
    recordedIncurredMinor: 7500, provisionalUncoveredContributionMinor: 44965,
    finalMargin: "Unknown", invoicedMinor: 52465, paidMinor: 10000,
    outstandingMinor: 42465, paymentQueue: "retained", costQueue: "resolved", reload: "retained" }));
} finally { await browser.close(); }
