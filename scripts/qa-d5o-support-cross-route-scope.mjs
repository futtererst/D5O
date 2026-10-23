import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const base = process.env.D5O_LOCAL_PREVIEW;
if (!base?.startsWith("http://127.0.0.1:")) throw new Error("disposable_preview_required");
const users = JSON.parse(readFileSync(process.env.D5O_PILOT_CREDENTIALS, "utf8")).users;
const second = JSON.parse(readFileSync(process.env.D5O_SECOND_SUPERVISOR_CREDENTIALS, "utf8"));
const workId = "rybex-9e4f1e5f9e6b4e429142d3b01e1825e5";
const browser = await chromium.launch({ headless: true });
async function session(user) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(base + "/auth/sign-in?next=%2Fwork%3Fworkspace%3Drybex%26view%3Dmy-work");
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.getByRole("heading", { name: "Actions requiring attention" }).waitFor({ timeout: 30000 });
  return { context, page };
}
async function get(page, path) {
  return page.evaluate(async (url) => {
    const response = await fetch(url);
    return { status: response.status, body: await response.json() };
  }, path);
}
try {
  const ops = await session(users.find((user) => user.key === "operations"));
  const source = await get(ops.page, "/api/d5o-hosted/prototype-state?workspace=rybex&key=work");
  if (source.status !== 200) throw new Error("operations_read_failed");
  const record = source.body.state.records.find((item) => item.id === workId);
  const foreign = record.operate.supportDocumentAssignments.find((item) =>
    item.status === "Assigned" && item.actorId !== second.userId);
  if (!foreign?.email) throw new Error("foreign_assignment_fixture_missing");
  const foreignDocument = record.operate.documentationObligations.find((item) =>
    item.uploadedByActorId && item.uploadedByActorId !== second.userId);
  if (!foreignDocument?.id) throw new Error("foreign_document_fixture_missing");
  await ops.context.close();
  const supervisor = await session(second);
  const build = process.env.D5O_EXPECTED_BUILD;
  if (build && !(await supervisor.page.locator("body").innerText()).includes("Build " + build))
    throw new Error("displayed_build_mismatch");
  const paths = [
    "/api/d5o-hosted/prototype-state?workspace=rybex&key=work",
    "/api/d5o-hosted/prototype-search?workspace=rybex&view=search&record=" + workId,
    "/api/d5o-hosted/prototype-search?workspace=rybex&view=actions",
    "/api/d5o-hosted/private-evidence-index?workspace=rybex"
  ];
  for (const path of paths) {
    const result = await get(supervisor.page, path);
    if (result.status !== 200) throw new Error("route_failed:" + path + ":" + result.status);
    const response = JSON.stringify(result.body);
    if (response.includes(foreign.email) || response.includes(foreignDocument.id))
      throw new Error("foreign_support_metadata_exposed:" + path);
  }
  const denied = await get(supervisor.page,
    "/api/d5o-hosted/customer-decision-evidence?workspace=rybex&workId=" + workId +
      "&evidenceId=" + foreignDocument.id);
  if (denied.status !== 403 || denied.body.error !== "customer_evidence_authority_required")
    throw new Error("foreign_document_retrieval_not_denied:" + denied.status);
  await supervisor.context.close();
  console.log(JSON.stringify({ result: "support_cross_route_scope_pass", routes: paths.length,
    build: build ?? null, foreignDocumentRetrieval: denied.status }));
} finally { await browser.close(); }
