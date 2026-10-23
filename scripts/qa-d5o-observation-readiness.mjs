import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const base = process.env.D5O_PREVIEW_URL;
const credentials = process.env.D5O_PILOT_CREDENTIALS_FILE;
const workId = "rybex-d86cdd4cd0c04dea97da79c382cf790c";
if (!/^http:\/\/127\.0\.0\.1:6164[45]$/.test(base ?? "") || !credentials)
  throw new Error("disposable_observation_target_required");
const users = JSON.parse(readFileSync(credentials, "utf8")).users;
const browser = await chromium.launch({ headless: true });
const observed = [];
try {
  for (const key of (process.env.D5O_OBSERVE_ROLES?.split(",") ?? ["pm", "supervisor", "quality", "operations", "worker", "rina"])) {
    const user = users.find((item) => item.key === key);
    if (!user) throw new Error(`missing_fictional_account:${key}`);
    const context = await browser.newContext();
    const page = await context.newPage();
    const isWorker = ["worker", "worker2", "rina", "southWorker"].includes(key);
    const destination = isWorker ? "/work/my-schedule" : "/work?workspace=rybex&view=my-work";
    await page.goto(`${base}/auth/sign-in?next=${encodeURIComponent(destination)}`);
    await page.locator('input[name="email"]').fill(user.email);
    await page.locator('input[name="password"]').fill(user.password);
    await page.getByRole("button", { name: "Continue to your work" }).click();
    try {
      await page.waitForURL((url) => !url.pathname.includes("sign-in"), { timeout: 12000, waitUntil: "domcontentloaded" });
    } catch {
      throw new Error(`sign_in_did_not_navigate:${key}:${(await page.locator("body").innerText()).slice(0, 1100)}`);
    }
    if (isWorker) await page.getByText("Loading your schedule…").waitFor({ state: "hidden", timeout: 30000 });
    const body = await page.locator("body").innerText();
    const build = body.match(/Build\s+([0-9a-f]{7,12})/)?.[1] ?? "missing";
    if (!isWorker && !build.startsWith("7a4fcb5"))
      throw new Error(`build_identity_mismatch:${key}:${build}`);
    if (isWorker) {
      if (queue.some((item) => item.workId === workId))
        await page.locator('section[aria-label="Support handoff actions"], section[aria-label="Delivery and closeout actions"]').first().waitFor({ timeout: 30000 });
      observed.push({ role: key, build, landing: new URL(page.url()).pathname,
        assignments: await page.locator('a').evaluateAll((nodes) =>
          nodes.filter((node) => /field|assigned work/i.test((node.getAttribute("href") ?? "") + (node.textContent ?? "")))
            .map((node) => ({ text: node.textContent?.trim(), href: node.getAttribute("href") }))),
        summary: body.slice(0, 450) });
    } else {
      await page.getByRole("heading", { name: "Actions requiring attention" }).waitFor({ timeout: 30000 });
      const queue = await page.evaluate(async () => {
        const response = await fetch("/api/d5o-hosted/prototype-search?workspace=rybex&view=actions", { cache: "no-store" });
        if (!response.ok) throw new Error(`queue_http_${response.status}`);
        const result = await response.json();
        return [...(result.deliveryActions ?? []), ...(result.supportActions ?? [])];
      });
      if (queue.some((item) => item.workId === workId))
        await page.locator('section[aria-label="Support handoff actions"], section[aria-label="Delivery and closeout actions"]').first().waitFor({ timeout: 30000 });
      observed.push({ role: key, build, landing: new URL(page.url()).pathname,
        actions: queue.filter((item) => item.workId === workId).map((item) =>
          ({ kind: item.kind, position: item.position })),
        exactLinks: await page.locator(`a[href*="record=${workId}"][href*="focus="]`).evaluateAll((nodes) =>
          nodes.map((node) => ({ label: node.textContent?.trim(), href: node.getAttribute("href") }))) });
      if (base.endsWith("61645") && key === "operations") {
        await page.goto(`${base}/work?workspace=rybex&view=handoff`);
        const text = await page.locator("button").filter({ hasText: "Synthetic Production UI Command Trial F" }).first().innerText();
        if (!text.includes("Support activation: Active") || !text.includes("Reviewed support documents: 2/4") ||
          !text.includes("assigned documentation remains outstanding")) throw new Error("support_handoff_position_mismatch");
        observed.at(-1).handoff = "delivery received; distinct support owner; Active; 2/4 reviewed; Finance pending";
      }
    }
    const entry = observed.at(-1);
    if (base.endsWith("61644") && key === "supervisor" &&
      !entry.exactLinks?.some((link) => link.href?.includes("decision=0cbbdcfa-904f-46b7-8924-64d1a26c35c2")))
      throw new Error("pending_field_report_link_missing");
    if (base.endsWith("61644") && key === "quality" &&
      !entry.exactLinks?.some((link) => link.href?.includes("decision=2b3235d2-939b-4710-9705-9b28a5a77c55")))
      throw new Error("pending_failed_inspection_link_missing");
    if (base.endsWith("61645") && key === "pm" &&
      !entry.exactLinks?.some((link) => link.href?.includes("documentKind=as-built") && link.href?.includes("focus=supply-document")))
      throw new Error("outstanding_as_built_preparation_missing");
    if (base.endsWith("61645") && ["quality", "operations"].includes(key) &&
      !entry.exactLinks?.some((link) => link.href?.includes("decision=4abde86d-c6f1-4eb4-b461-a3610d55e8f1")))
      throw new Error("pending_independent_document_review_missing");
    await context.close();
  }
  console.log(JSON.stringify({ result: "observation_readiness", base, observed }));
} finally { await browser.close(); }
