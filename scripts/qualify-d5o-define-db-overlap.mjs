import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { chromium } from "playwright";

const origin = "http://127.0.0.1:61657";
const target = "http://127.0.0.1:58521";
const workId = "rybex-2fad0999a8f24514a7188e98f0720149";
const container = "supabase_db_d5o-graybar-final-full-replay-20261016";
if (process.env.NEXT_PUBLIC_SUPABASE_URL !== target ||
    process.env.D5O_REHEARSAL_TARGET_URL !== target || !process.env.D5O_PILOT_CREDENTIALS_FILE)
  throw new Error("disposable_clone_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const browser = await chromium.launch({ headless: true });
const statePath = "/api/d5o-hosted/prototype-state?workspace=rybex";
const commandPath = "/api/d5o-hosted/prototype-define-command?workspace=rybex";

function sql(query) {
  return execFileSync("docker", ["exec", container, "psql", "-U", "postgres", "-d", "postgres", "-Atc", query],
    { encoding: "utf8", timeout: 10000 }).trim();
}
function counts() {
  return sql(`select (select count(*) from d5o_hosted.connected_define_events e where e.workspace_id=l.workspace_id and e.work_id=l.work_id)
    ||'|'||(select count(*) from d5o_hosted.connected_define_receipts r where r.workspace_id=l.workspace_id and r.work_id=l.work_id)
    from d5o_hosted.work_identity_links l join d5o_hosted.workspaces w on w.id=l.workspace_id
    where w.workspace_key='rybex' and l.presentation_id='${workId}'`);
}
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
    const start = performance.now();
    const response = await fetch(path, { method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
    const payload = await response.json();
    return { status: response.status, error: payload.error ?? null,
      ms: Math.round(performance.now() - start), payload };
  }, { path, body });
}
async function work(page) {
  const result = await request(page, `${statePath}&key=work`);
  if (result.status !== 200) throw new Error(`read_${result.status}:${result.error}`);
  return result.payload.state;
}
function decision(action, state, decisionRevision) {
  return { workId, action, commandId: randomUUID(), expectedRevision: state.revision,
    expectedDecisionRevision: decisionRevision,
    reason: `Fictional overlap qualification: ${action} the exact current Define basis` };
}
function startBarrier() {
  const child = spawn("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-qAt"],
    { stdio: ["pipe", "pipe", "pipe"] });
  let output = "", errors = "";
  child.stdout.on("data", chunk => { output += chunk.toString(); });
  child.stderr.on("data", chunk => { errors += chunk.toString(); });
  child.stdin.write(`begin; select revision from d5o_hosted.prototype_states where workspace_id=(select id from d5o_hosted.workspaces where workspace_key='rybex') and state_key='work' for update; select 'LOCKED';\n`);
  return { child, async ready() {
    const until = Date.now() + 10000;
    while (!output.includes("LOCKED")) {
      if (Date.now() > until || child.exitCode !== null) throw new Error(`diagnostic_lock_failed:${errors}`);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }, async release() {
    child.stdin.write("commit;\n"); child.stdin.end();
    await new Promise(resolve => child.on("close", resolve));
    if (errors) throw new Error(`diagnostic_lock_error:${errors}`);
  } };
}
async function waitForOverlap() {
  const until = Date.now() + 5500;
  const samples = [];
  while (Date.now() < until) {
    const rows = sql(`select pid||':'||coalesce(wait_event_type,'active')||':'||
      case when query ilike '%d5o_hosted_prototype_save_v1%' then 'save' else 'define' end
      from pg_stat_activity where state='active' and pid<>pg_backend_pid()
      and (query ilike '%d5o_hosted_prototype_save_v1%' or query ilike '%d5o_hosted_define_command_v1%')`);
    if (rows) samples.push(rows);
    if (rows.includes(":Lock:save") && rows.includes(":Lock:define")) return samples;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return samples;
}

try {
  const pm = await signIn("pm");
  const admin = await signIn("admin");
  console.log(JSON.stringify({ case: "build", marker: (await pm.page.locator("body").innerText()).match(/Build\s+[0-9a-f]{12,40}/)?.[0] ?? "missing" }));
  let state = await work(pm.page);
  let record = state.records.find(item => item.id === workId);
  if (process.argv.includes("--post-overlap")) {
    const row = sql(`select e.command_id||'|'||e.decision_revision||'|'||(r.result->>'revision')
      from d5o_hosted.connected_define_events e join d5o_hosted.connected_define_receipts r
        on r.workspace_id=e.workspace_id and r.command_id=e.command_id
      join d5o_hosted.work_identity_links l on l.workspace_id=e.workspace_id and l.work_id=e.work_id
      join d5o_hosted.workspaces w on w.id=l.workspace_id
      where w.workspace_key='rybex' and l.presentation_id='${workId}' and e.action='submit'
      order by e.decision_revision desc limit 1`).split("|");
    const beforeReplay = counts();
    const replay = await request(pm.page, commandPath, { workId, action: "submit", commandId: row[0],
      expectedRevision: Number(row[2]), expectedDecisionRevision: Number(row[1]) - 1,
      reason: "Fictional overlap qualification: submit the exact current Define basis" });
    const afterReplay = counts();
    const retryState = await work(admin.page);
    const retry = await request(admin.page, statePath,
      { workspace: "rybex", key: "work", expectedRevision: retryState.revision, state: retryState });
    console.log(JSON.stringify({ case: "post-overlap-recovery", beforeReplay, afterReplay,
      replay: { status: replay.status, error: replay.error },
      currentRetry: { status: retry.status, error: retry.error,
        before: retryState.revision, after: retry.payload.state?.revision } }));
    if (replay.status !== 200 || beforeReplay !== afterReplay || retry.status !== 200)
      throw new Error("post_overlap_recovery_failed");
    await pm.context.close(); await admin.context.close();
    process.exit(0);
  }
  if (process.argv.includes("--complete-save-first")) {
    if (record?.definition?.status !== "Draft") throw new Error("current_draft_required");
    const before = counts();
    const body = decision("submit", state, record.definition.authorityRevision);
    const submitted = await request(pm.page, commandPath, body);
    const after = counts();
    const replay = await request(pm.page, commandPath, body);
    const afterReplay = counts();
    console.log(JSON.stringify({ case: "fresh-retry-after-save-first", before, after, afterReplay,
      submitted: { status: submitted.status, error: submitted.error },
      replay: { status: replay.status, error: replay.error } }));
    if (submitted.status !== 200 || replay.status !== 200 || after !== afterReplay)
      throw new Error("fresh_retry_or_replay_failed");
    await pm.context.close(); await admin.context.close();
    process.exit(0);
  }
  if (record?.definition?.status === "In review" &&
      (process.argv.includes("--save-first") || process.argv.includes("--decision-first"))) {
    const returned = await request(admin.page, commandPath, {
      ...decision("return-review", state, record.definition.authorityRevision),
      role: "delivery", reason: "Fictional independent reviewer requests a new overlap revision" });
    console.log(JSON.stringify({ case: "prepare-independent-return", status: returned.status, error: returned.error }));
    if (returned.status !== 200) throw new Error("independent_return_failed");
    state = await work(pm.page); record = state.records.find(item => item.id === workId);
  }
  if (record?.definition?.status === "Changes requested") {
    const revised = await request(pm.page, commandPath,
      decision("new-revision", state, record.definition.authorityRevision));
    console.log(JSON.stringify({ case: "prepare-new-revision", status: revised.status, error: revised.error }));
    if (revised.status !== 200) throw new Error("new_revision_failed");
    state = await work(pm.page); record = state.records.find(item => item.id === workId);
  }
  if (record?.definition?.status !== "Draft") throw new Error(`draft_required:${record?.definition?.status}`);
  const before = counts();
  const barrier = startBarrier();
  await barrier.ready();
  const saveBody = { workspace: "rybex", key: "work", expectedRevision: state.revision, state };
  const submitBody = decision("submit", state, record.definition.authorityRevision);
  let save, submit;
  if (process.argv.includes("--decision-first")) {
    submit = request(pm.page, commandPath, submitBody);
    await new Promise(resolve => setTimeout(resolve, 650));
    save = request(admin.page, statePath, saveBody);
  } else {
    save = request(admin.page, statePath, saveBody);
    if (process.argv.includes("--save-first")) await new Promise(resolve => setTimeout(resolve, 650));
    submit = request(pm.page, commandPath, submitBody);
  }
  let overlap;
  try { overlap = await waitForOverlap(); }
  finally { await barrier.release(); }
  const [saveResult, submitResult] = await Promise.all([save, submit]);
  const afterState = await work(pm.page);
  const after = counts();
  console.log(JSON.stringify({ case: "database-overlap", before, after,
    observedBothLockWaiters: overlap.some(sample => sample.includes(":Lock:save") && sample.includes(":Lock:define")),
    lockSamples: overlap.slice(-5), save: { status: saveResult.status, error: saveResult.error, ms: saveResult.ms },
    submit: { status: submitResult.status, error: submitResult.error, ms: submitResult.ms },
    revision: afterState.revision,
    definition: afterState.records.find(item => item.id === workId)?.definition?.status }));
  if (![saveResult.status, submitResult.status].includes(200) ||
      ![saveResult.status, submitResult.status].some(status => status === 409 || status === 403))
    throw new Error("serialized_outcome_failed");
  const replay = await request(pm.page, commandPath, submitBody);
  const afterReplay = counts();
  console.log(JSON.stringify({ case: "identical-command-replay", status: replay.status,
    error: replay.error, afterReplay }));
  await pm.context.close(); await admin.context.close();
} finally { await browser.close(); }
