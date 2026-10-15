import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const base = process.env.D5O_LOCAL_PREVIEW;
if (!base?.startsWith("http://127.0.0.1:")) throw new Error("isolated_preview_required");
const pilot = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS, "utf8")).users;
const other = JSON.parse(readFileSync(process.env.D5O_SECOND_SUPERVISOR_CREDENTIALS, "utf8"));
const people = [pilot.find((item) => item.key === "supervisor"), other];
if (people.some((item) => !item?.email || !item?.password)) throw new Error("fictional_supervisors_required");
const workId = "rybex-9e4f1e5f9e6b4e429142d3b01e1825e5";
const browser = await chromium.launch({ headless: true });
const observed = [];
try {
  for (const person of people) {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(base + "/auth/sign-in?next=" + encodeURIComponent("/work?workspace=rybex&view=my-work"));
      await page.locator('input[name="email"]').fill(person.email);
      await page.locator('input[name="password"]').fill(person.password);
      await page.getByRole("button", { name: "Continue to your work" }).click();
      await page.getByRole("heading", { name: "Actions requiring attention" }).waitFor({ timeout: 30000 });
      if (process.env.D5O_EXPECTED_BUILD && !(await page.locator("body").innerText()).includes("Build " + process.env.D5O_EXPECTED_BUILD))
        throw new Error("displayed_build_mismatch");
      const result = await page.evaluate(async (id) => {
        const [actionsResponse, stateResponse] = await Promise.all([
          fetch("/api/d5o-hosted/prototype-search?workspace=rybex&view=actions"),
          fetch("/api/d5o-hosted/prototype-state?workspace=rybex&key=work")
        ]);
        if (!actionsResponse.ok || !stateResponse.ok) throw new Error("authenticated_read_failed");
        const actions = await actionsResponse.json(), state = await stateResponse.json();
        return { actions: actions.supportActions ?? [], record: state.state.records.find((item) => item.id === id) };
      }, workId);
      if (!result.record) throw new Error("scoped_work_unavailable");
      const own = result.record.operate.supportDocumentAssignments ?? [];
      const supply = result.actions.filter((item) => item.workId === workId && item.kind === "supply-document");
      for (const action of supply) {
        const assignment = own.filter((item) => item.turnoverId === action.turnoverId).at(-1);
        if (assignment?.status !== "Assigned" || assignment.email !== person.email)
          throw new Error("foreign_supplier_task_visible");
        const link = page.locator(`a[href*="turnover=${encodeURIComponent(action.turnoverId)}"]`)
          .filter({ hasText: "Supply turnover document" });
        if (!await link.count()) throw new Error("assigned_task_missing_from_my_work");
        await link.first().click();
        await page.getByRole("heading", { name: /accepted turnover documentation/i }).waitFor({ timeout: 15000 });
        if (!await page.locator('input[name="file"]').count()) throw new Error("assigned_task_has_no_upload_control");
        await page.goto(base + "/work?workspace=rybex&view=my-work");
        await page.getByRole("heading", { name: "Actions requiring attention" }).waitFor();
      }
      // The preserved pilot has reviewed documents. A saved old supply link must
      // identify the changed action instead of opening another package.
      const assignment = own.find((item) => item.status === "Assigned");
      if (assignment) {
        const turnover = result.record.deploy.turnovers.find((item) => item.id === assignment.turnoverId);
        const params = new URLSearchParams({ workspace: "rybex", view: "record", record: workId,
          section: "Operate", focus: "supply-document", decision: assignment.turnoverId,
          decisionRevision: String(turnover.revision), turnover: assignment.turnoverId,
          documentKind: "as-built", sourceRevision: String(result.record.operate.authorityRevision),
          deployRevision: String(result.record.deploy.authorityRevision) });
        await page.goto(base + "/work?" + params);
        await page.getByRole("heading", { name: "This support action changed or was decided" }).waitFor({ timeout: 15000 });
        if (!await page.getByRole("link", { name: "Return to refreshed My Work" }).count())
          throw new Error("stale_link_has_no_queue_return");
      }
      observed.push({ role: "field_supervisor", assigned: own.length, currentTasks: supply.length,
        staleReviewedLink: !!assignment });
    } finally { await context.close(); }
  }
  console.log(JSON.stringify({ result: "support_supplier_queue_browser_pass", workId, observed }));
} finally { await browser.close(); }
