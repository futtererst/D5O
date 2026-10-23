import fs from "node:fs";
import { chromium } from "playwright";

const [origin, accountPath] = process.argv.slice(2);
if (!origin || !accountPath) throw new Error("origin and protected account file are required");
const accounts = JSON.parse(fs.readFileSync(accountPath, "utf8"));
const browser = await chromium.launch({ headless: true });
const results = [];
async function signedIn(role) {
  const account = accounts.find((candidate) => candidate.role === role);
  if (!account) throw new Error(`missing ${role} fixture`);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto(new URL("/auth/sign-in", origin).href);
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.waitForURL((url) => !url.pathname.includes("sign-in"), { timeout: 25000 });
  return { context, page };
}
try {
  const admin = await signedIn("admin");
  await admin.page.goto(new URL("/work/admin/workforce?workspace=rybex", origin).href);
  const directAdmin = await admin.page.getByRole("heading", { name: "Workforce", exact: true }).isVisible();
  await admin.page.getByRole("link", { name: /Return to Work/ }).click();
  await admin.page.waitForURL((url) => url.pathname === "/work", { timeout: 20000 });
  await admin.page.goBack();
  const backToAdmin = await admin.page.getByRole("heading", { name: "Workforce", exact: true }).isVisible();
  results.push({ check: "admin direct link, return and browser back", pass: directAdmin && backToAdmin });
  await admin.context.close();

  const worker = await signedIn("worker1");
  await worker.page.goto(new URL("/work/my-schedule?workspace=rybex", origin).href);
  await worker.page.getByText(/Loading your schedule/).first().waitFor({ state: "hidden", timeout: 20000 }).catch(() => {});
  await worker.page.getByRole("link", { name: /Open assigned work/ }).first().click();
  await worker.page.waitForURL((url) => url.pathname.endsWith("/field"), { timeout: 20000 });
  const fieldOpened = await worker.page.getByRole("heading", { name: /Fictional Hosted Field Beta/ }).isVisible();
  await worker.page.goBack();
  const workerReturned = await worker.page.getByRole("heading", { name: "My schedule and assigned work" }).isVisible();
  results.push({ check: "worker schedule, assignment and browser back", pass: fieldOpened && workerReturned });
  const denial = await worker.page.goto(new URL("/work/admin?workspace=rybex", origin).href);
  const noAdmin = denial?.status() === 404 && !(await worker.page.getByRole("heading", { name: "Overview" }).isVisible());
  results.push({ check: "worker direct Admin denial", pass: noAdmin, status: denial?.status() });
  await worker.context.close();
} finally { await browser.close(); }
for (const result of results) console.log(JSON.stringify(result));
if (results.some((result) => !result.pass)) process.exitCode = 1;
