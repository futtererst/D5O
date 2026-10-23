import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS_FILE, "utf8")).users;
const admin = users.find((item) => item.key === "admin");
const workId = "rybex-fe917921068844f0a9e6116cd76623c5";
const origin = "http://127.0.0.1:61656";
const path = `/work/procurement?workspace=rybex&workId=${workId}&step=po`;
const browser = await chromium.launch({ headless: true });
async function session() {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${origin}/auth/sign-in?next=${encodeURIComponent(path)}`);
  await page.locator('input[name="email"]').fill(admin.email);
  await page.locator('input[name="password"]').fill(admin.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.getByRole("heading", { name: "Purchasing plan and purchase order" }).waitFor();
  return { context, page };
}
async function read(page) {
  return page.evaluate(async (id) => {
    const response = await fetch(`/api/d5o-hosted/graybar?workspace=rybex&workId=${id}`, { cache: "no-store" });
    return response.json();
  }, workId);
}
async function approve(page, orderId, revision, commandId) {
  return page.evaluate(async ({ id, rev, command, work }) => {
    const response = await fetch(`/api/d5o-hosted/graybar?workspace=rybex&workId=${work}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve-po", input: { orderId: id, authorityBasis: "Active fictional workspace administrator" }, expectedRevision: rev, commandId: command })
    });
    const body = await response.json();
    return { http: response.status, error: body.error ?? null, revision: body.revision ?? null };
  }, { id: orderId, rev: revision, command: commandId, work: workId });
}
try {
  const [first, second] = await Promise.all([session(), session()]);
  const before = await read(first.page);
  const prepared = before.state.orders.filter((item) => item.status === "Prepared");
  if (prepared.length !== 2 || prepared[0].id === prepared[1].id ||
      prepared[0].lines.length !== 1 || prepared[1].lines.length !== 1 ||
      prepared[0].lines[0].materialId === prepared[1].lines[0].materialId ||
      prepared.reduce((sum, item) => sum + Number(item.amountMinor), 0) <= 750000 ||
      prepared.some((item) => Number(item.amountMinor) > 750000))
    throw new Error("Distinct eligible competing POs under insufficient cap required");
  const commands = [crypto.randomUUID(), crypto.randomUUID()];
  const results = await Promise.all(prepared.map((order, index) =>
    approve(index === 0 ? first.page : second.page, order.id, before.revision, commands[index])));
  const after = await read(first.page);
  const approved = after.state.orders.filter((item) => prepared.some((candidate) => candidate.id === item.id) && item.status === "Approved");
  const loser = prepared.find((item) => !approved.some((winner) => winner.id === item.id));
  const loserRetry = loser ? await approve(second.page, loser.id, after.revision, crypto.randomUUID()) : null;
  const winnerIndex = prepared.findIndex((item) => item.id === approved[0]?.id);
  const identicalReplay = winnerIndex >= 0 ? await approve(first.page, approved[0].id, before.revision, commands[winnerIndex]) : null;
  const final = await read(first.page);
  console.log(JSON.stringify({ fixture: "Hall L distinct POs", workId, revisionBefore: before.revision,
    poIds: prepared.map((item) => item.id), materialIds: prepared.map((item) => item.lines[0].materialId),
    amounts: prepared.map((item) => item.amountMinor), results, winnerIds: approved.map((item) => item.id),
    loserRetry, identicalReplay, revisionFinal: final.revision,
    finalStatuses: final.state.orders.filter((item) => prepared.some((candidate) => candidate.id === item.id))
      .map((item) => ({ id: item.id, status: item.status })) }));
  if (approved.length !== 1 || !loserRetry || loserRetry.http === 200 || identicalReplay?.http !== 200)
    throw new Error("Shared-cap race assertion failed");
  await Promise.all([first.context.close(), second.context.close()]);
} finally {
  await browser.close();
}
