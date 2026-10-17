import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const origin = "http://127.0.0.1:61657";
const target = "http://127.0.0.1:58521";
const workId = "rybex-2fad0999a8f24514a7188e98f0720149";
if (process.env.NEXT_PUBLIC_SUPABASE_URL !== target ||
    process.env.D5O_REHEARSAL_TARGET_URL !== target ||
    !process.env.D5O_PILOT_CREDENTIALS_FILE) throw new Error("disposable_clone_only");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const browser = await chromium.launch({ headless: true });
const url = `${origin}/work?workspace=rybex&view=define&record=${workId}`;
const endpoint = /\/api\/d5o-hosted\/prototype-state(?:\?|$)/;
const log = (caseId, value) => console.log(JSON.stringify({ caseId, ...value }));

async function signIn(page, key) {
  const user = users.find((item) => item.key === key);
  if (!user) throw new Error(`missing_fictional_user:${key}`);
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent(`/work?workspace=rybex&view=define&record=${workId}`)}`);
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.getByRole("button", { name: "Investigation", exact: true }).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Investigation", exact: true }).click();
}

async function revision(page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/d5o-hosted/prototype-state?workspace=rybex&key=work", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || !data.state) throw new Error(`read_${response.status}`);
    return data.state.revision;
  });
}

async function editContact(page, value) {
  await page.getByLabel("Customer contact").fill(value);
  await page.getByRole("button", { name: "Save investigation facts" }).click();
}

async function switchAccount(page, key) {
  await page.getByRole("button", { name: /Account/ }).click();
  await page.getByRole("menuitem", { name: "Switch account" }).click();
  await signIn(page, key);
}

try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, "pm");
  const beforeCommitted = await revision(page);
  const committedContact = `Fictional committed-response-loss ${Date.now().toString(36)}`;
  let committedStatus = null;
  let committedRouteSeen;
  const committedSeen = new Promise((resolve) => { committedRouteSeen = resolve; });
  const lostResponse = async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const upstream = await route.fetch({ headers: { ...route.request().headers(), origin, "sec-fetch-site": "same-origin", host: new URL(origin).host } });
    committedStatus = upstream.status();
    if (committedStatus !== 200) log("intercept-server-rejection", { status: committedStatus, error: (await upstream.json()).error });
    committedRouteSeen();
    await route.abort("failed");
  };
  await page.route(endpoint, lostResponse);
  await editContact(page, committedContact);
  await committedSeen;
  await page.getByRole("alert", { name: "Unsaved Define draft recovery" }).waitFor({ timeout: 15000 });
  const afterCommitted = await revision(page);
  log("committed-intercept", { beforeCommitted, serverStatus: committedStatus, afterCommitted,
    notice: (await page.getByRole("status").allTextContents()).slice(0, 3) });
  await page.unroute(endpoint, lostResponse);
  await page.getByRole("button", { name: "Check and load current shared basis" }).click();
  await page.waitForTimeout(3000);
  const comparison = await page.evaluate(async (id) => {
    const key = Object.keys(sessionStorage).find((value) => value.startsWith("d5o.define-unsaved.v1:rybex:"));
    const saved = key ? JSON.parse(sessionStorage.getItem(key) ?? "[]")[0] : null;
    const response = await fetch("/api/d5o-hosted/prototype-state?workspace=rybex&key=work");
    const current = (await response.json()).state.records.find((item) => item.id === id)?.definition;
    return { retained: Boolean(saved), same: JSON.stringify(saved?.draft) === JSON.stringify(current),
      differingKeys: saved && current ? [...new Set([...Object.keys(saved.draft), ...Object.keys(current)])].filter((field) => JSON.stringify(saved.draft[field]) !== JSON.stringify(current[field])) : [],
      projectDiffKeys: saved && current ? [...new Set([...Object.keys(saved.draft.project ?? {}), ...Object.keys(current.project ?? {})])].filter((field) => JSON.stringify(saved.draft.project?.[field]) !== JSON.stringify(current.project?.[field])) : [],
      contactMatch: saved?.draft?.project?.customerContact === current?.project?.customerContact };
  }, workId);
  log("committed-reconcile-notice", { notices: (await page.getByRole("status").allTextContents()).slice(0, 3) });
  log("committed-reconcile-comparison", comparison);
  if (!await page.getByText(/already contains the retained edited values/).count()) throw new Error("committed_reconciliation_false_negative");
  const afterReconcile = await revision(page);
  log("committed-response-lost", { beforeCommitted, serverStatus: committedStatus, afterCommitted, afterReconcile,
    oneMutation: afterCommitted === beforeCommitted + 1 && afterReconcile === afterCommitted,
    retainedCleared: await page.getByRole("alert", { name: "Unsaved Define draft recovery" }).count() === 0 });

  const beforeUncommitted = await revision(page);
  const uncommittedContact = `Fictional uncommitted-response-loss ${Date.now().toString(36)}`;
  let blockedRouteSeen;
  const blockedSeen = new Promise((resolve) => { blockedRouteSeen = resolve; });
  const blockedRequest = async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    blockedRouteSeen();
    await route.abort("failed");
  };
  await page.route(endpoint, blockedRequest);
  await editContact(page, uncommittedContact);
  await blockedSeen;
  await page.getByRole("alert", { name: "Unsaved Define draft recovery" }).waitFor({ timeout: 15000 });
  await page.unroute(endpoint, blockedRequest);
  const afterBlocked = await revision(page);
  log("uncommitted-request-blocked", { beforeUncommitted, afterBlocked, noMutation: beforeUncommitted === afterBlocked });

  const failGet = async (route) => route.request().method() === "GET" ? route.abort("failed") : route.continue();
  await page.route(endpoint, failGet);
  await page.getByRole("button", { name: "Check and load current shared basis" }).click();
  await page.getByText(/Failed to fetch|unavailable/i).first().waitFor({ timeout: 15000 });
  log("reconciliation-read-failed", { draftStillVisible: await page.getByRole("alert", { name: "Unsaved Define draft recovery" }).count() === 1 });
  await page.unroute(endpoint, failGet);

  await switchAccount(page, "admin");
  log("same-tab-admin", { draftVisible: await page.getByRole("alert", { name: "Unsaved Define draft recovery" }).count() });
  await switchAccount(page, "pm");
  await page.getByRole("alert", { name: "Unsaved Define draft recovery" }).waitFor({ timeout: 15000 });
  log("same-tab-pm-return", { draftVisible: await page.getByRole("alert", { name: "Unsaved Define draft recovery" }).count() });
  await page.getByRole("button", { name: "Check and load current shared basis" }).click();
  await page.getByText(`Loaded shared revision ${afterBlocked}.`, { exact: false }).waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: "Investigation", exact: true }).click();
  const currentContact = await page.getByLabel("Customer contact").inputValue();
  const retryResponse = page.waitForResponse((response) => response.request().method() === "POST" && endpoint.test(response.url()));
  await editContact(page, uncommittedContact);
  const retry = await retryResponse;
  await page.reload();
  await page.getByRole("button", { name: "Investigation", exact: true }).click();
  log("uncommitted-retry", { currentContact, retryStatus: retry.status(), revision: await revision(page), retainedContact: await page.getByLabel("Customer contact").inputValue() });
  await context.close();
} finally { await browser.close(); }
