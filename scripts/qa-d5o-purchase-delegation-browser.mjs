import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const origin = "http://127.0.0.1:61658";
if (process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:58521" ||
  process.env.D5O_COMMAND_RUNTIME !== "rehearsal" || !process.env.D5O_PILOT_CREDENTIALS_FILE) {
  throw new Error("isolated_clone_runtime_required");
}
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const admin = users.find((user) => user.key === "admin");
if (!admin) throw new Error("fictional_admin_missing");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(origin + "/auth/sign-in?next=" + encodeURIComponent("/work?workspace=rybex&view=my-work"));
  await page.locator('input[name="email"]').fill(admin.email);
  await page.locator('input[name="password"]').fill(admin.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.waitForURL(/\/work/, { timeout: 30000 });
  await page.getByText(/Build\s+[0-9a-f]{7,12}/i).first().waitFor({ timeout: 15000 });
  const shell = await page.locator("body").innerText();
  const build = shell.match(/Build\s+([0-9a-f]{7,12})/i)?.[1];
  if (!build) throw new Error("displayed_build_missing");
  await page.getByRole("button", { name: "Administration" }).click();
  await page.getByText("Spending decision delegates").click();
  const option = page.getByRole("option", { name: "Purchase order approval" });
  if (await option.count() !== 1) throw new Error("purchase_category_missing");
  const route = await page.request.get(origin + "/api/d5o-hosted/spending-delegation?workspace=rybex");
  if (route.status() !== 200) throw new Error("admin_delegation_read_unavailable");
  console.log(JSON.stringify({ origin, displayedBuild: build, adminConfiguration: "purchase category visible", adminReadStatus: route.status() }));
} finally {
  await browser.close();
}
