import { readFileSync } from "node:fs";
import { chromium } from "playwright";

if (process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:58521" ||
    process.env.D5O_REHEARSAL_TARGET_URL !== process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.D5O_PILOT_CREDENTIALS_FILE) throw new Error("disposable_clone_only");
const origin = "http://127.0.0.1:61657";
const user = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users.find((entry) => entry.key === "pm");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent("/work?workspace=rybex&view=define&record=rybex-2fad0999a8f24514a7188e98f0720149")}`);
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.getByRole("button", { name: "Investigation", exact: true }).waitFor({ timeout: 30000 });
  const outcome = await page.evaluate(async () => {
    const path = "/api/d5o-hosted/prototype-state?workspace=rybex&key=work";
    const beginRead = performance.now();
    const read = await fetch(path, { cache: "no-store" });
    const data = await read.json();
    const readMs = Math.round(performance.now() - beginRead);
    const before = data.state?.revision;
    const beginSave = performance.now();
    const save = await fetch("/api/d5o-hosted/prototype-state?workspace=rybex", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace: "rybex", key: "work", expectedRevision: before, state: data.state })
    });
    const result = await save.json();
    return { readStatus: read.status, readMs, saveStatus: save.status,
      saveMs: Math.round(performance.now() - beginSave), before,
      after: result.state?.revision ?? null, error: result.error ?? null };
  });
  console.log(JSON.stringify(outcome));
} finally { await browser.close(); }
