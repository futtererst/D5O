import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const [origin, phase, outRoot] = process.argv.slice(2);
const accountPath = process.env.D5O_SYNTHETIC_ACCOUNTS_FILE;
if (!origin || !phase || !outRoot || !accountPath) throw new Error("origin, phase, output and account file are required");
const accounts = JSON.parse(fs.readFileSync(accountPath, "utf8"));
const cases = [
  { role: "public", name: "sign-in", href: "/auth/sign-in" },
  { role: "public", name: "forgot-password", href: "/auth/forgot-password" },
  { role: "public", name: "set-password-invalid", href: "/auth/set-password" },
  { role: "admin", name: "admin-overview", href: "/work/admin?workspace=rybex" },
  { role: "admin", name: "admin-workforce", href: "/work/admin/workforce?workspace=rybex" },
  { role: "admin", name: "admin-users", href: "/work/admin/users?workspace=rybex" },
  { role: "admin", name: "admin-configuration", href: "/work/admin/configuration?workspace=rybex" },
  { role: "admin", name: "admin-authority", href: "/work/admin/authority?workspace=rybex" },
  { role: "admin", name: "admin-audit", href: "/work/admin/audit?workspace=rybex" },
  { role: "pm", name: "my-work", href: "/work?workspace=rybex&view=my-work" },
  { role: "finance", name: "finance-my-work", href: "/work?workspace=rybex&view=my-work" },
  { role: "operations", name: "operations-my-work", href: "/work?workspace=rybex&view=my-work" },
  { role: "supervisor", name: "supervisor-my-work", href: "/work?workspace=rybex&view=my-work" },
  { role: "pm", name: "crew-calendar", href: "/work?workspace=rybex&view=crew" },
  { role: "worker1", name: "my-schedule", href: "/work/my-schedule?workspace=rybex" },
  { role: "worker1", name: "field-assignment", href: "/work/my-schedule?workspace=rybex", follow: /Open assigned work/ },
  { role: "pm", name: "procurement", href: "/work/procurement?workspace=rybex&workId=rybex-ab85e3563fa54579b3c8fed7ab2785ff" },
  { role: "pm", name: "labor-authority", href: "/work/labor?workspace=rybex&workId=rybex-ab85e3563fa54579b3c8fed7ab2785ff" },
].filter((entry) => !process.env.D5O_CAPTURE_ONLY || process.env.D5O_CAPTURE_ONLY.split(",").includes(entry.name));
const browser = await chromium.launch({ headless: true });
const widths = (process.env.D5O_CAPTURE_WIDTHS ?? "390,768,1440").split(",").map(Number);
const sessions = new Map();
let failures = 0;
try {
  for (const entry of cases) {
    let context = sessions.get(entry.role);
    if (!context) {
      const account = accounts.find((candidate) => candidate.role === entry.role);
      if (!account && entry.role !== "public") throw new Error(`missing ${entry.role} fixture`);
      context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
      sessions.set(entry.role, context);
      if (account) {
        const page = await context.newPage();
        await page.goto(new URL("/auth/sign-in", origin).href, { waitUntil: "domcontentloaded" });
        await page.getByLabel("Email").fill(account.email);
        await page.getByLabel("Password").fill(account.password);
        await page.getByRole("button", { name: "Continue to your work" }).click();
        await page.waitForURL((url) => !url.pathname.includes("sign-in"), { timeout: 25000 });
        await page.close();
      }
    }
    for (const width of widths) {
      const page = await context.newPage();
      await page.setViewportSize({ width, height: 900 });
      const response = await page.goto(new URL(entry.href, origin).href, { waitUntil: "domcontentloaded" });
      await page.getByText(/Loading workspace actions|Loading your schedule/).first().waitFor({ state: "hidden", timeout: 20000 }).catch(() => {});
      if (entry.follow) {
        await page.getByRole("link", { name: entry.follow }).first().click();
        await page.waitForURL((url) => url.pathname.endsWith("/field"), { timeout: 20000 });
      }
      await page.waitForTimeout(750);
      const measurement = await page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        title: document.title,
        headings: [...document.querySelectorAll("h1")].slice(0, 2).map((item) => item.textContent?.trim()),
        pending: /Loading workspace actions|Loading your schedule/.test(document.body.innerText),
        build: document.body.innerText.match(/Build\s+([0-9a-f]{12,40})/)?.[1] ?? null,
      }));
      const status = response?.status() ?? 0;
      const okay = status === 200 && !measurement.pending && (entry.role === "public" || !page.url().includes("/auth/sign-in")) && measurement.scrollWidth <= measurement.width + 1;
      if (!okay) failures += 1;
      const destination = path.join(outRoot, phase);
      fs.mkdirSync(destination, { recursive: true });
      await page.screenshot({ path: path.join(destination, `${entry.name}-${width}.png`), fullPage: true });
      console.log(JSON.stringify({ phase, name: entry.name, width, status, okay, ...measurement }));
      await page.close();
    }
  }
} finally {
  await Promise.all([...sessions.values()].map((context) => context.close()));
  await browser.close();
}
if (failures) process.exitCode = 1;
