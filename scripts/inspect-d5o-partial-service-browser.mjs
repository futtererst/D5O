import { readFileSync } from "node:fs";
import { chromium } from "playwright";

if (process.env.D5O_ISOLATED_PILOT !== "1" || !process.env.D5O_PILOT_CREDENTIALS_FILE) throw new Error("disposable_pilot_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const origin = process.env.D5O_PILOT_ORIGIN || "http://127.0.0.1:61644";
const child = "rybex-a11c09e603a248359205ec84f0af4ae8";
const user = users.find((item) => item.key === (process.env.D5O_PILOT_ACTOR || "quality"));
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext(), page = await context.newPage();
  const target = `/work?workspace=rybex&view=record&section=Deploy&record=${child}`;
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent(target)}`);
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.getByRole("heading", { name: "Deliver and verify the released work" }).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Field work" }).click();
  const ui = await page.locator('article:has(h3:text-is("Reviewed package completion"))').innerText();
  const projected = await page.evaluate(async (id) => {
    const response = await fetch('/api/d5o-hosted/prototype-state?workspace=rybex&key=work');
    const payload = await response.json();
    const work = payload.state.records.find((record) => record.id === id);
    return { status: response.status, packages:work?.packages?.map((p)=>({id:p.id,status:p.status})), designPackages:work?.design?.packages?.map((p)=>({id:p.packageId,revision:p.revision})), turnovers:work?.deploy?.turnovers?.map((t)=>({id:t.id,status:t.status,releaseIds:t.releaseIds})), issues:work?.deploy?.issues, design: work?.design?.releases?.map((r) => ({id:r.id,status:r.status,revision:r.packageRevision})), reports: work?.deploy?.reports?.map((r) => ({id:r.id,status:r.status,releaseId:r.releaseId,unit:r.unit,quantity:r.quantity})), inspections:work?.deploy?.inspections?.map((i)=>({id:i.id,status:i.status,releaseId:i.releaseId,requirementId:i.requirementId,result:i.result})), completions:work?.deploy?.completions };
  }, child);
  console.log(JSON.stringify({ ui, projected }));
  await context.close();
} finally { await browser.close(); }

