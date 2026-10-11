import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const base = process.env.D5O_PREVIEW_URL;
const credentials = process.env.D5O_PILOT_CREDENTIALS_FILE;
if (!/^http:\/\/127\.0\.0\.1:6164[45]$/.test(base ?? "") || !credentials)
  throw new Error("disposable_observation_target_required");
const users = JSON.parse(readFileSync(credentials, "utf8")).users;
const browser = await chromium.launch({ headless: true });
const roles = ["pm", "commercial", "operations", "supervisor", "quality", "finance", "executive", "admin", "worker"];
const results = [];
try {
  for (const key of roles) {
    const user = users.find((item) => item.key === key);
    if (!user) throw new Error(`fictional_account_missing:${key}`);
    const context = await browser.newContext({ viewport: key === "worker" ? { width: 390, height: 844 } : { width: 1365, height: 900 } });
    const page = await context.newPage();
    await page.goto(`${base}/auth/sign-in?next=${encodeURIComponent("/work?workspace=rybex")}`);
    await page.locator('input[name="email"]').fill(user.email);
    await page.locator('input[name="password"]').fill(user.password);
    await page.getByRole("button", { name: "Continue to your work" }).click();
    await page.waitForURL((url) => !url.pathname.includes("sign-in"), { timeout: 30_000 });
    if (key === "worker") {
      await page.waitForURL((url) => url.pathname.includes("/work/my-schedule"), { timeout: 30_000 });
      if (!page.url().includes("/work/my-schedule")) throw new Error("worker_not_assignment_scoped");
      await page.getByText("Loading your schedule…").waitFor({ state: "hidden", timeout: 30_000 });
      const workerOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
      if (workerOverflow) throw new Error("worker_mobile_horizontal_overflow");
      if (process.env.D5O_CAPTURE_DIR) await page.screenshot({ path: `${process.env.D5O_CAPTURE_DIR}/worker-mobile.png`, fullPage: true });
      results.push({ role: key, landing: new URL(page.url()).pathname, mobileWidth: 390,
        heading: (await page.locator("h1").first().innerText()).slice(0, 90) });
      await context.close(); continue;
    }
    await page.getByRole("heading", { name: "What needs your attention" }).waitFor({ timeout: 30_000 });
    const actionCards = page.locator('section[aria-label="Action needed"] .d5o-focused-task');
    const actionCount = await actionCards.count();
    const displayedCount = Number(await page.locator('section[aria-label="Action needed"] h2 span').innerText());
    if (displayedCount !== actionCount) throw new Error(`action_count_mismatch:${key}:${displayedCount}:${actionCount}`);
    const admin = page.locator('details.d5o-nav-disclosure').filter({ hasText: "Administration" });
    if ((await admin.count() > 0) !== (key === "admin")) throw new Error(`admin_navigation_scope:${key}`);
    if (key === "finance" && await page.getByRole("button", { name: "+ Start work" }).count())
      throw new Error("finance_start_work_exposed");
    if (key === "finance") {
      const denied = await page.request.get(`${base}/api/d5o-hosted/membership-access?workspace=rybex`);
      if (denied.status() !== 403 || (await denied.json()).error !== "admin_membership_required")
        throw new Error(`finance_admin_api_not_denied:${denied.status()}`);
      const otherTenant = await page.request.get(`${base}/api/d5o-hosted/prototype-search?workspace=rotork&view=actions`);
      if (otherTenant.ok()) throw new Error("other_tenant_action_queue_exposed");
    }
    if (key === "pm") {
      if (process.env.D5O_CAPTURE_DIR) await page.screenshot({ path: `${process.env.D5O_CAPTURE_DIR}/pm-desktop.png`, fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
      if (mobileOverflow) throw new Error("my_work_mobile_horizontal_overflow");
      if (process.env.D5O_CAPTURE_DIR) await page.screenshot({ path: `${process.env.D5O_CAPTURE_DIR}/pm-mobile.png`, fullPage: true });
      await page.setViewportSize({ width: 1365, height: 900 });
    }
    const build = (await page.locator("body").innerText()).match(/Build\s+(\S+)/)?.[1] ?? "missing";
    const exact = page.locator('a.d5o-focused-task[href*="record="][href*="focus="]');
    const exactCount = await exact.count();
    if (exactCount) {
      const href = await exact.first().getAttribute("href");
      if (!href) throw new Error(`task_link_missing:${key}`);
      await exact.first().click();
      await page.getByRole("heading", { name: /current task|review|accept|supply|link|assess/i }).first().waitFor({ timeout: 30_000 }).catch(() => undefined);
      const target = new URL(page.url());
      if (target.searchParams.get("record") !== new URL(href, base).searchParams.get("record"))
        throw new Error(`task_record_substituted:${key}`);
      await page.reload();
      if (new URL(page.url()).searchParams.get("record") !== target.searchParams.get("record"))
        throw new Error(`task_record_lost_after_reload:${key}`);
      if (key === "finance" && await page.getByRole("heading", { name: "Project financial closeout" }).count())
        throw new Error("unrelated_project_finance_shown_in_service_task");
    }
    if (key === "pm") {
      const staleCandidate = page.locator('a.d5o-focused-task[href*="focus=supply-document"]');
      await page.goto(`${base}/work?workspace=rybex&view=my-work`);
      await page.getByRole("heading", { name: "What needs your attention" }).waitFor();
      if (await staleCandidate.count()) {
        const href = await staleCandidate.first().getAttribute("href");
        const changed = new URL(href, base);
        changed.searchParams.set("sourceRevision", "999999");
        await page.goto(changed.href);
        await page.getByRole("heading", { name: "This support action changed or was decided" }).waitFor({ timeout: 30_000 });
        if (new URL(page.url()).searchParams.get("record") !== changed.searchParams.get("record"))
          throw new Error("stale_link_selected_other_work");
      }
      await page.goto(`${base}/work?workspace=rybex&view=configuration`);
      await page.getByRole("heading", { name: "What needs your attention" }).waitFor({ timeout: 30_000 });
      if (!await page.getByText("This view is outside your role workspace").count())
        throw new Error("pm_admin_view_not_restricted");
    }
    if (key === "admin") {
      await page.goto(`${base}/work?workspace=rybex&view=configuration`);
      await page.locator("details.d5o-studio-section").first().waitFor({ timeout: 30_000 });
      if (await page.locator("details.d5o-studio-section").count() < 4)
        throw new Error("administration_sections_not_disclosed");
    }
    results.push({ role: key, build, actionCount, exactCount, landing: "/work?workspace=rybex", adminNavigation: key === "admin" });
    await context.close();
  }
  console.log(JSON.stringify({ result: "role_task_presentation_pass", base, results }));
} finally { await browser.close(); }
