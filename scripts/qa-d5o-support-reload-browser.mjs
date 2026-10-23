import { readFileSync } from "node:fs";
import { chromium } from "playwright";
const base = "http://127.0.0.1:61643", id = "rybex-d86cdd4cd0c04dea97da79c382cf790c";
const users = JSON.parse(readFileSync(process.env.TEMP + "/d5o-fresh-replay-final2-20261009/pilot/pilot-credentials.json", "utf8")).users;
const browser = await chromium.launch({ headless: true });
const observed = [];
try {
  for (const key of ["pm", "quality", "operations"]) {
    const user = users.find((item) => item.key === key);
    const context = await browser.newContext(), page = await context.newPage();
    await page.goto(base + "/auth/sign-in?next=" + encodeURIComponent("/work?workspace=rybex&view=my-work"));
    await page.locator('input[name="email"]').fill(user.email);
    await page.locator('input[name="password"]').fill(user.password);
    await page.getByRole("button", { name: "Continue to your work" }).click();
    await page.getByRole("heading", { name: "Actions requiring attention" }).waitFor({ timeout: 30000 });
    if (!(await page.locator("body").innerText()).includes("Build cd1a43f"))
      throw new Error("displayed_build_identity_mismatch");
    const queue = await page.evaluate(async () => {
      const body = await (await fetch("/api/d5o-hosted/prototype-search?workspace=rybex&view=actions")).json();
      return body.supportActions ?? [];
    });
    const current = queue.filter((item) => item.workId === id);
    if (current.length !== 2 || current.some((item) => item.kind !== "supply-document"))
      throw new Error("current_queue_mismatch:" + key + ":" + JSON.stringify(current));
    observed.push({ role: key, positions: current.map((item) => item.position) });
    if (key === "pm") {
      const stale = new URL(base + "/work");
      for (const [name, value] of Object.entries({ workspace: "rybex", view: "record", record: id,
        section: "Operate", focus: "review-document", decision: "dea0a4a4-f0a2-4978-98e1-41b6fd250648",
        decisionRevision: "1", sourceRevision: "13", deployRevision: "42",
        turnover: "6cca5386-2805-4482-ab91-4fd6d6879cfe", documentKind: "as-built" }))
        stale.searchParams.set(name, value);
      await page.goto(stale.href);
      await page.getByRole("heading", { name: "This support action changed or was decided" }).waitFor({ timeout: 30000 });
      if (await page.getByRole("button", { name: "Record independent review" }).count())
        throw new Error("stale_document_review_executable");
      observed.push({ staleDocumentLink: "blocked without substitute" });
    }
    if (key === "operations") {
      await page.goto(base + "/work?workspace=rybex&view=handoff");
      const row = page.locator("button").filter({ hasText: "Synthetic Production UI Command Trial F" }).first();
      const text = await row.innerText();
      if (!text.includes("Support activation: Active") ||
        !text.includes("Reviewed support documents: 2/4") ||
        !text.includes("assigned documentation remains outstanding"))
        throw new Error("handoff_position_mismatch");
      observed.push({ handoff: "Active; 2/4 exact documents reviewed; two as-builts outstanding" });
    }
    await context.close();
  }
  console.log(JSON.stringify({ result: "support_reload_positions_pass", observed }));
} finally { await browser.close(); }
