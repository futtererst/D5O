import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";

if (process.env.D5O_COMMAND_RUNTIME !== "rehearsal" ||
  process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:56621" ||
  !process.env.D5O_PILOT_CREDENTIALS_FILE)
  throw new Error("disposable_production_rehearsal_only");

const origin = "http://127.0.0.1:61643";
const workId = "rybex-9e4f1e5f9e6b4e429142d3b01e1825e5";
const rehearsalId = "rybex-2fad0999a8f24514a7188e98f0720149";
const packageId = "wp-25c4b286f2454f01915a588c345cce03";
const evidenceId = "c4dc5b66-acf8-417e-8ce8-4d857120458c";
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const browser = await chromium.launch({ headless: true });

async function signIn(key, path = `/work?workspace=rybex&view=record&record=${workId}`) {
  const user = users.find((item) => item.key === key);
  if (!user) throw new Error(`pilot_user_missing:${key}`);
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent(path)}`);
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.waitForURL(/\/work/, { timeout: 30000 });
  return { context, page };
}

async function request(page, path, method = "GET", body) {
  return page.evaluate(async ({ path, method, body }) => {
    const response = await fetch(path, {
      method, headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    const payload = await response.json().catch(() => ({}));
    return { status: response.status, error: payload.error ?? null, payload };
  }, { path, method, body });
}

function denied(name, result, status, error) {
  if (result.status !== status || result.error !== error)
    throw new Error(`${name}_wrong_domain_rejection:${result.status}:${result.error}; expected ${status}:${error}`);
  return { name, status: result.status, error: result.error };
}

const probes = [];
try {
  const pm = await signIn("pm");
  const work = await request(pm.page, "/api/d5o-hosted/prototype-state?workspace=rybex&key=work");
  const catalog = await request(pm.page, "/api/d5o-hosted/prototype-catalog?workspace=rybex");
  const schedule = await request(pm.page, "/api/d5o-hosted/prototype-schedule?workspace=rybex");
  if ([work.status, catalog.status, schedule.status].some((status) => status !== 200))
    throw new Error("authoritative_read_unavailable");
  const record = work.payload.state.records.find((item) => item.id === workId);
  const newRecord = work.payload.state.records.find((item) => item.id === rehearsalId);
  if (!record?.canonicalWorkId || !newRecord?.canonicalWorkId)
    throw new Error("canonical_rehearsal_records_missing");
  const revision = work.payload.revision;
  const protectedState = structuredClone(work.payload.state);
  protectedState.records.find((item) => item.id === workId).definition.status = "Draft";
  probes.push(denied("generic_protected_write", await request(pm.page,
    "/api/d5o-hosted/prototype-state?workspace=rybex", "POST",
    { workspace: "rybex", key: "work", expectedRevision: revision, state: protectedState }), 409, "protected_definition_changed"));
  const base = { workId, expectedRevision: revision, commandId: randomUUID() };
  probes.push(denied("pursuit_rpc", await request(pm.page,
    "/api/d5o-hosted/prototype-pursuit-command?workspace=rybex", "POST",
    { ...base, workId: rehearsalId, action: "invalid-rehearsal-action",
      expectedDecisionRevision: 0, intent: {} }), 400, "invalid_pursuit_command"));
  probes.push(denied("define_rpc", await request(pm.page,
    "/api/d5o-hosted/prototype-define-command?workspace=rybex", "POST",
    { ...base, commandId: randomUUID(), action: "submit", expectedDecisionRevision: 999999 }), 409, "stale_state"));
  probes.push(denied("commercial_rpc", await request(pm.page,
    "/api/d5o-hosted/prototype-commercial-command?workspace=rybex", "POST",
    { ...base, commandId: randomUUID(), action: "submit-solution", packageRevision: 1,
      expectedDecisionRevision: 999999 }), 409, "stale_state"));
  probes.push(denied("design_rpc", await request(pm.page,
    "/api/d5o-hosted/prototype-design-command?workspace=rybex", "POST",
    { ...base, commandId: randomUUID(), action: "request-review", packageId,
      expectedDecisionRevision: 999999 }), 409, "stale_design_review_basis"));
  probes.push(denied("deploy_rpc", await request(pm.page,
    "/api/d5o-hosted/prototype-deploy-command?workspace=rybex", "POST",
    { ...base, commandId: randomUUID(), action: "authorize-start", packageId,
      expectedDesignRevision: 999999, expectedScheduleRevision: schedule.payload.schedule.revision,
      expectedDecisionRevision: 999999 }), 400, "invalid_field_start_command"));
  probes.push(denied("operate_rpc", await request(pm.page,
    "/api/d5o-hosted/prototype-operate-command?workspace=rybex", "POST",
    { ...base, commandId: randomUUID(), action: "activate",
      expectedDeployRevision: 999999, expectedDecisionRevision: 999999 }), 409, "stale_operate_basis"));
  probes.push(denied("catalog_package_rpc", await request(pm.page,
    "/api/d5o-hosted/prototype-catalog?workspace=rybex", "POST",
    { action: "create-package", workId, name: "Must not be created", owner: "Pilot PM",
      expectedRevision: catalog.payload.catalog.revision, expectedWorkRevision: revision,
      expectedHandoffRevision: 1, expectedPackageCount: 999999, commandId: randomUUID() }), 409, "stale_package_basis"));
  probes.push(denied("schedule_rpc", await request(pm.page,
    "/api/d5o-hosted/prototype-schedule?workspace=rybex", "POST",
    { action: "publish", week: 40, expectedRevision: 999999, commandId: randomUUID() }), 409, "stale_schedule"));
  const evidencePath = `/api/d5o-hosted/customer-decision-evidence?workspace=rybex&workId=${workId}&evidenceId=${evidenceId}`;
  await pm.context.close();

  const operations = await signIn("operations");
  const evidence = await operations.page.evaluate(async (path) => {
    const response = await fetch(path);
    return { status: response.status, bytes: (await response.arrayBuffer()).byteLength };
  }, evidencePath);
  if (evidence.status !== 200 || evidence.bytes < 1) throw new Error(`retained_evidence_unavailable:${evidence.status}`);
  const wrongWork = await request(operations.page, evidencePath.replace(workId, rehearsalId));
  if (wrongWork.status !== 404) throw new Error("cross_work_evidence_visible");
  await operations.context.close();

  let worker, bookings, workerKey;
  for (const key of ["worker", "worker2", "serviceWorker", "southWorker"]) {
    const candidate = await signIn(key, "/work/my-schedule?workspace=rybex");
    const result = await request(candidate.page, "/api/d5o-hosted/worker-schedule");
    if (result.status === 200 && result.payload.bookings?.length) {
      worker = candidate; bookings = result; workerKey = key; break;
    }
    await candidate.context.close();
  }
  if (!worker) throw new Error("worker_bookings_unavailable_for_all_pilot_workers");
  probes.push(denied("worker_response_rpc", await request(worker.page,
    "/api/d5o-hosted/worker-schedule", "POST",
    { publicationId: bookings.payload.bookings[0].publicationId,
      assignmentId: bookings.payload.bookings[0].assignmentId,
      response: "accepted", expectedRevision: 999999, commandId: randomUUID() }), 409, "stale_schedule"));
  const booking = bookings.payload.bookings.find((item) => item.workId === workId) ?? bookings.payload.bookings[0];
  if (booking.workId === workId) probes.push(denied("worker_report_rpc", await request(worker.page,
    "/api/d5o-hosted/worker-deploy", "POST",
    { action: "save-report", workId, packageId: booking.packageId, bookingId: booking.assignmentId,
      publicationId: booking.publicationId, expectedRevision: revision,
      expectedDesignRevision: 999999, expectedScheduleRevision: 999999,
      expectedDecisionRevision: 999999, commandId: randomUUID() }), 409, "stale_field_fact_basis"));
  const workerEvidence = await request(worker.page, evidencePath);
  if (workerEvidence.status !== 403) throw new Error("worker_customer_evidence_visible");
  await worker.context.close();

  const finance = await signIn("finance");
  const financeRead = await request(finance.page, "/api/d5o-hosted/prototype-state?workspace=rybex&key=work");
  const financeRecord = financeRead.payload.state?.records?.find((item) => item.id === workId);
  if (financeRead.status !== 200 || !financeRecord?.operate?.finance)
    throw new Error("finance_position_unavailable");
  await finance.context.close();

  const verifier = await signIn("pm");
  const afterWork = await request(verifier.page, "/api/d5o-hosted/prototype-state?workspace=rybex&key=work");
  const afterCatalog = await request(verifier.page, "/api/d5o-hosted/prototype-catalog?workspace=rybex");
  const afterSchedule = await request(verifier.page, "/api/d5o-hosted/prototype-schedule?workspace=rybex");
  await verifier.context.close();
  if (afterWork.payload.revision !== revision ||
    afterCatalog.payload.catalog.revision !== catalog.payload.catalog.revision ||
    afterSchedule.payload.schedule.revision !== schedule.payload.schedule.revision)
    throw new Error("rejected_probe_mutated_state");
  console.log(JSON.stringify({ status: "production_runtime_routes_passed", probes,
    retainedEvidenceBytes: evidence.bytes, workerEvidence: workerEvidence.status,
    financeState: financeRecord.operate.finance.status, workerKey,
    unchangedRevisions: [revision, catalog.payload.catalog.revision, schedule.payload.schedule.revision] }));
} finally { await browser.close(); }
