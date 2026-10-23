import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const origin = "http://127.0.0.1:61656";
const workId = "rybex-f85daaed685f4b5b9e113b8a0f5cf33c";
const credentialsPath = process.env.D5O_PILOT_CREDENTIALS_FILE;
if (!credentialsPath) throw new Error("fictional_pilot_credentials_required");
const credentials = JSON.parse(readFileSync(credentialsPath, "utf8"));
const pm = credentials.users.find((user) => user.key === "pm");
if (!pm) throw new Error("fictional_pm_missing");

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent("/work?workspace=rybex")}`);
  await page.locator('input[name="email"]').fill(pm.email);
  await page.locator('input[name="password"]').fill(pm.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.waitForURL(/\/work\?workspace=rybex/, { timeout: 30000 });
  await page.goto(`${origin}/work?workspace=rybex&view=develop&record=${workId}`);
  await page.getByText("Controlled detailed-Design spending").waitFor({ timeout: 30000 });
  const body = await page.locator("body").innerText();
  const position = await page.evaluate(async (id) => {
    const response = await fetch(`/api/d5o-hosted/design-spend?workspace=rybex&workId=${id}`, { cache: "no-store" });
    return { status: response.status, data: await response.json() };
  }, workId);
  if (position.status !== 200 || position.data.revision !== 10 ||
      position.data.windowCapMinor !== 150000 || position.data.committedMinor !== 145000 ||
      position.data.remainingMinor !== 5000) {
    throw new Error("committed_window_balance_not_reflected_in_browser");
  }
  if (!body.includes("current spending window") || !body.includes("50.00")) {
    throw new Error("window_balance_not_visible");
  }
  const build = body.match(/Build ([a-f0-9]{12})/)?.[1] ?? null;
  console.log(JSON.stringify({ result: "passed", build, workId, revision: position.data.revision,
    windowCapMinor: position.data.windowCapMinor, committedMinor: position.data.committedMinor,
    remainingMinor: position.data.remainingMinor, url: page.url() }));
} finally {
  await browser.close();
}
