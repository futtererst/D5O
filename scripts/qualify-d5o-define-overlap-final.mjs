import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";

const origin = "http://127.0.0.1:61657";
const target = "http://127.0.0.1:58521";
const workId = "rybex-2fad0999a8f24514a7188e98f0720149";
if (process.env.NEXT_PUBLIC_SUPABASE_URL !== target || process.env.D5O_REHEARSAL_TARGET_URL !== target || !process.env.D5O_PILOT_CREDENTIALS_FILE) throw new Error("disposable_clone_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const browser = await chromium.launch({ headless: true });
const statePath = "/api/d5o-hosted/prototype-state?workspace=rybex";
const commandPath = "/api/d5o-hosted/prototype-define-command?workspace=rybex";
const log = (caseId, data) => console.log(JSON.stringify({ caseId, ...data }));

async function signIn(key) {
  const user = users.find((entry) => entry.key === key);
  if (!user) throw new Error(`missing_fictional_user:${key}`);
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent(`/work?workspace=rybex&view=define&record=${workId}`)}`);
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.getByRole("button", { name: "Investigation", exact: true }).waitFor({ timeout: 30000 });
  return { context, page };
}

async function request(page, path, body) {
  return page.evaluate(async ({ path, body }) => {
    const started = performance.now();
    const response = await fetch(path, { method: body ? "POST" : "GET", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
    const payload = await response.json();
    return { status: response.status, error: payload.error ?? null, elapsedMs: Math.round(performance.now() - started), payload };
  }, { path, body });
}

async function work(page) {
  const result = await request(page, `${statePath}&key=work`);
  if (result.status !== 200) throw new Error(`work_read_${result.status}:${result.error}`);
  return result.payload.state;
}

function saveBody(state) { return { workspace: "rybex", key: "work", expectedRevision: state.revision, state }; }
function decisionBody(action, state, decisionRevision, role, reason) {
  return { workId, action, role, reason, commandId: randomUUID(), expectedRevision: state.revision, expectedDecisionRevision: decisionRevision };
}

try {
  const pm = await signIn("pm");
  const admin = await signIn("admin");
  log("build", { marker: (await pm.page.locator("body").innerText()).match(/Build\s+[0-9a-f]{12,40}/)?.[0] ?? "missing" });
  let basis = await work(pm.page);
  const record = basis.records.find((item) => item.id === workId);
  if (!record?.canonicalWorkId || record.definition?.status !== "Draft") throw new Error("fresh_define_draft_required");
  const definition = record.definition;
  const suffix = Date.now().toString(36);
  definition.project = { ...definition.project, customerContact: `Fictional scope contact ${suffix}`, siteArea: "Fictional test room", affectedSystems: "Two fictional monitoring panels", accessConstraints: "Escorted access only" };
  definition.outcome = "Document a fictional two-panel monitoring refresh";
  definition.excludedScope = "Physical construction and live commissioning are excluded from this isolated Define test";
  definition.deliveryApproach = "Review the fictional monitoring interfaces and prepare a documented Design basis";
  definition.findings = [{ id: `finding-${suffix}`, status: "Confirmed", source: "Fictional checkpoint interview", detail: "Two panels require a documented interface review" }];
  definition.clarifications = [];
  definition.scopeControl = {
    customerAgreement: { representative: "Fictional sponsor", agreedAt: "2026-10-17", basis: "Synthetic test-scope confirmation, not a customer signature" },
    requirements: [{ id: `requirement-${suffix}`, state: "Confirmed", need: "Document two monitoring-panel interfaces", source: "Fictional checkpoint interview", owner: "Pilot PM" }],
    interfaces: [{ boundary: "Monitoring-panel interface", owner: "Pilot PM", counterparty: "Fictional site contact", agreement: "Documented interface only" }],
    assumptions: []
  };
  definition.registers = {
    ...definition.registers,
    scope_items: [{ id: `scope-${suffix}`, requirementId: `requirement-${suffix}`, deliverable: "Interface review brief", boundary: "Design-only document", owner: "Pilot PM" }],
    acceptance_criteria: [{ id: `acceptance-${suffix}`, scopeId: `scope-${suffix}`, result: "Two interfaces documented", method: "Independent document review", proof: "Fictional review note", authority: "Pilot reviewer" }],
    milestones: [{ id: `milestone-${suffix}`, milestone: "Review brief", dueDate: "2026-10-31", owner: "Pilot PM" }],
    dependencies: [{ id: `dependency-${suffix}`, dependency: "Fictional site information", owner: "Pilot PM", neededBy: "2026-10-24" }],
    risks: [{ id: `risk-${suffix}`, risk: "Incomplete panel information", control: "Hold Design until reviewed", owner: "Pilot PM" }]
  };
  const prepared = await request(pm.page, statePath, saveBody(basis));
  log("supported-draft-preparation", { status: prepared.status, error: prepared.error, elapsedMs: prepared.elapsedMs, revision: prepared.payload.state?.revision });
  if (prepared.status !== 200) throw new Error(`draft_setup_${prepared.status}:${prepared.error}`);
  basis = await work(pm.page);

  // Order one: a PM save is held at the browser transport while the typed Define submission commits.
  let releaseSave, sawSave;
  const heldSave = new Promise((resolve) => { releaseSave = resolve; });
  const saveSeen = new Promise((resolve) => { sawSave = resolve; });
  const holdSave = async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    sawSave(); await heldSave; await route.continue();
  };
  await pm.page.route(/\/api\/d5o-hosted\/prototype-state(?:\?|$)/, holdSave);
  const saveBeforeDecision = request(pm.page, statePath, saveBody(basis));
  await saveSeen;
  const submitted = await request(admin.page, commandPath, decisionBody("submit", basis, 0));
  releaseSave();
  const staleSave = await saveBeforeDecision;
  await pm.page.unroute(/\/api\/d5o-hosted\/prototype-state(?:\?|$)/, holdSave);
  const afterSubmit = await work(admin.page);
  log("decision-first", { decisionStatus: submitted.status, decisionError: submitted.error, decisionMs: submitted.elapsedMs,
    saveStatus: staleSave.status, saveError: staleSave.error, saveMs: staleSave.elapsedMs, revision: afterSubmit.revision,
    defineStatus: afterSubmit.records.find((item) => item.id === workId)?.definition?.status });
  if (submitted.status !== 200 || staleSave.status !== 409) throw new Error("decision_first_contract_failed");

  // Order two: a review request is held before transport while an exact protected save commits.
  let releaseReview, sawReview;
  const heldReview = new Promise((resolve) => { releaseReview = resolve; });
  const reviewSeen = new Promise((resolve) => { sawReview = resolve; });
  const holdReview = async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    sawReview(); await heldReview; await route.continue();
  };
  await pm.page.route(/\/api\/d5o-hosted\/prototype-define-command(?:\?|$)/, holdReview);
  const oldReview = request(pm.page, commandPath, decisionBody("return-review", afterSubmit, 1, "delivery", "Fictional source review requests a corrected Design-only basis"));
  await reviewSeen;
  const savedFirst = await request(admin.page, statePath, saveBody(afterSubmit));
  releaseReview();
  const staleReview = await oldReview;
  await pm.page.unroute(/\/api\/d5o-hosted\/prototype-define-command(?:\?|$)/, holdReview);
  const afterSave = await work(pm.page);
  log("save-first", { saveStatus: savedFirst.status, saveError: savedFirst.error, saveMs: savedFirst.elapsedMs,
    reviewStatus: staleReview.status, reviewError: staleReview.error, reviewMs: staleReview.elapsedMs, revision: afterSave.revision });
  if (savedFirst.status !== 200 || staleReview.status !== 409) throw new Error("save_first_contract_failed");
  const currentReview = await request(pm.page, commandPath, decisionBody("return-review", afterSave, 1, "delivery", "Fictional source review requests a corrected Design-only basis"));
  const final = await work(pm.page);
  log("fresh-decision", { status: currentReview.status, error: currentReview.error, elapsedMs: currentReview.elapsedMs,
    revision: final.revision, defineStatus: final.records.find((item) => item.id === workId)?.definition?.status });
  if (currentReview.status !== 200) throw new Error("fresh_decision_failed");
  await pm.context.close(); await admin.context.close();
} finally { await browser.close(); }
