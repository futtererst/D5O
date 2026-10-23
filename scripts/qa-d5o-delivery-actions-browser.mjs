import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const base = process.env.D5O_PREVIEW_URL;
const file = process.env.D5O_PILOT_CREDENTIALS_FILE;
const workId = process.env.D5O_WORK_ID;
if (!base?.startsWith("http://127.0.0.1:") || !file || !workId) throw new Error("isolated_delivery_fixture_required");
const users = JSON.parse(readFileSync(file, "utf8")).users;
const browser = await chromium.launch({ headless: true });
const observed = [];
try {
  for (const key of ["pm", "supervisor", "quality", "operations"]) {
    const user = users.find((item) => item.key === key);
    if (!user) throw new Error(`missing_pilot_user:${key}`);
    const context = await browser.newContext();
    const page = await context.newPage();
    const landing = "/work?workspace=rybex&view=my-work";
    await page.goto(`${base}/auth/sign-in?next=${encodeURIComponent(landing)}`);
    await page.locator('input[name="email"]').fill(user.email);
    await page.locator('input[name="password"]').fill(user.password);
    await page.getByRole("button", { name: "Continue to your work" }).click();
    await page.getByRole("heading", { name: "Actions requiring attention" }).waitFor({ timeout: 30000 });
    const queue = await page.evaluate(async () => {
      const response = await fetch("/api/d5o-hosted/prototype-search?workspace=rybex&view=actions", { cache: "no-store" });
      const body = await response.json();
      return { status: response.status, error: body.error, actions: body.deliveryActions ?? [] };
    });
    if (queue.status !== 200) throw new Error(`queue_unavailable:${key}:${queue.status}:${queue.error}`);
    const current = queue.actions.filter((action) => action.workId === workId);
    if (process.env.D5O_EXPECT_COMPLETE === "1" && current.length) throw new Error(`completed_action_still_queued:${key}`);
    observed.push({ role: key, currentActions: current.map((action) => `${action.kind}:${action.position}`) });
    if (key === "pm" && process.env.D5O_EXPECT_COMPLETE === "1") {
      await page.goto(`${base}/work?workspace=rybex&view=handoff`);
      await page.getByRole("heading", { name: "Current scope and receiving responsibility" }).waitFor({ timeout: 30000 });
      const work = await page.evaluate(async (id) => {
        const response = await fetch("/api/d5o-hosted/prototype-state?workspace=rybex&key=work", { cache: "no-store" });
        const body = await response.json();
        return body.state?.records?.find((item) => item.id === id);
      }, workId);
      const row = page.locator("button").filter({ hasText: work.title }).filter({ hasText: "2/2 current releases" }).filter({ hasText: "2/2 reviewed completions" })
        .filter({ hasText: "2/2 scoped acceptances" }).filter({ hasText: "Operations received exact scope" });
      if (!(await row.count())) throw new Error("handoff_scope_projection_mismatch");
      const handoffText = await row.innerText();
      if (!handoffText.includes("Receipt actor") || !handoffText.includes("receiving owner"))
        throw new Error("handoff_receiving_identity_missing");
      if (work?.packages?.length !== 2 || !work.deploy?.workAcceptance || work.deploy.workAcceptance.receipt !== "Accepted")
        throw new Error("whole_work_receipt_missing");
      const release = work.design?.releases?.find((item) => item.packageId === work.packages[0].id && item.status === "Accepted");
      if (!release) throw new Error("accepted_release_missing");
      const stale = new URL(`${base}/work`);
      for (const [key, value] of Object.entries({ workspace: "rybex", view: "record", record: workId, section: "Deploy",
        focus: "completion-review", decision: release.id, sourceRevision: "-1", decisionRevision: String(release.packageRevision),
        package: release.packageId, release: release.id })) stale.searchParams.set(key, value);
      await page.goto(stale.href);
      await page.getByRole("heading", { name: "This queue link is no longer current" }).waitFor({ timeout: 30000 });
      observed.push({ handoff: "2/2 exact scope received", staleLink: "blocked" });
    }
    await context.close();
  }
  console.log(JSON.stringify({ result: "isolated_delivery_role_queue", workId, observed }));
} finally { await browser.close(); }
