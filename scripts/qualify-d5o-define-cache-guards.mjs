import { readFileSync } from "node:fs";
import { chromium } from "playwright";

if (process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:58521" ||
    process.env.D5O_REHEARSAL_TARGET_URL !== process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.D5O_PILOT_CREDENTIALS_FILE) throw new Error("disposable_clone_only");
const user = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8"))
  .users.find(entry => entry.key === "pm");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:61657/auth/sign-in?next=%2Fwork%3Fworkspace%3Drybex%26view%3Ddefine");
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.getByRole("button", { name: "Investigation", exact: true }).waitFor({ timeout: 30000 });
  const result = await page.evaluate(async () => {
    const path = "/api/d5o-hosted/prototype-state?workspace=rybex";
    const read = async () => (await (await fetch(`${path}&key=work`, { cache: "no-store" })).json()).state;
    const send = async (state, revision) => {
      const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace: "rybex", key: "work", expectedRevision: revision, state }) });
      return { status: response.status, payload: await response.json() };
    };
    const initial = await read();
    const design = structuredClone(initial);
    const designRecord = design.records.find(record => record.canonicalWorkId && record.design);
    if (!designRecord) throw new Error("design_guard_fixture_unavailable");
    designRecord.design = { ...designRecord.design, syntheticGuardProbe: "unauthorized edit" };
    const designResponse = await send(design, initial.revision);
    const afterDesign = await read();
    const packages = structuredClone(afterDesign);
    const packageRecord = packages.records.find(record => record.canonicalWorkId && Array.isArray(record.packages) && record.packages.length);
    if (!packageRecord) throw new Error("package_guard_fixture_unavailable");
    packageRecord.packages = [...packageRecord.packages, { syntheticGuardProbe: "unauthorized package" }];
    const packageResponse = await send(packages, afterDesign.revision);
    const final = await read();
    return { before: initial.revision, afterDesign: afterDesign.revision, afterPackage: final.revision,
      design: { status: designResponse.status, error: designResponse.payload.error },
      package: { status: packageResponse.status, error: packageResponse.payload.error } };
  });
  console.log(JSON.stringify(result));
  if (result.design.status === 200 || result.package.status === 200 ||
      result.before !== result.afterDesign || result.before !== result.afterPackage)
    throw new Error("cached_guard_bypass_or_mutation");
} finally { await browser.close(); }
