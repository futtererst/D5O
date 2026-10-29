import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createServer } from "node:net";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "@playwright/test";
import { createP0aRuntime, cleanupP0aRuntime } from "./disposable-runtime.mjs";
import { captureNextEnv } from "./next-env-guard.mjs";

const root = resolve(process.cwd());
const output = resolve(root, ".tmp/d5o-evidence/session-expiry/browser.json");
const restoreNextEnv = captureNextEnv(root);
const evidence = { startedAt: new Date().toISOString(), checks: [], error: null, cleanup: null };
let runtime, server, browser;
const freePort = () => new Promise((done, fail) => {
  const socket = createServer(); socket.once("error", fail);
  socket.listen(0, "127.0.0.1", () => { const address = socket.address();
    socket.close(() => done(address.port)); });
});
async function startNext(url, anon, service) {
  const port = await freePort();
  const env = { ...process.env, NODE_ENV: "development", NEXT_TELEMETRY_DISABLED: "1",
    NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: anon, SUPABASE_SECRET_KEY: service,
    SUPABASE_SERVICE_ROLE_KEY: service, D5O_HOSTED_ENABLED: "1", D5O_ISOLATED_PILOT: "1",
    D5O_ISOLATED_PILOT_URL: url, D5O_ISOLATED_APP_ORIGIN: `http://127.0.0.1:${port}`,
    D5O_COMMAND_RUNTIME: "pilot", RYBEXOS_RUNTIME_MODE: "production",
    RYBEXOS_AUTH_MODE: "supabase", RYBEXOS_DATA_SOURCE: "database" };
  const handle = spawn(process.execPath, [resolve(root, "node_modules/next/dist/bin/next"),
    "dev", "--webpack", "-p", String(port), "-H", "127.0.0.1"],
  { cwd: root, env, stdio: "ignore", shell: false });
  for (let attempt = 0; attempt < 160; attempt++) {
    if (handle.exitCode !== null) throw Error(`next_exited:${handle.exitCode}`);
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok)
      return { handle, port }; } catch { /* Starting. */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  handle.kill(); throw Error("next_start_timeout");
}
try {
  runtime = await createP0aRuntime(root, { jwtExpirySeconds: 300 });
  const url = runtime.status.API_URL ?? runtime.status.SUPABASE_URL;
  const anon = runtime.status.ANON_KEY ?? runtime.status.PUBLISHABLE_KEY;
  const service = runtime.status.SERVICE_ROLE_KEY ?? runtime.status.SECRET_KEY;
  assert(url?.startsWith("http://127.0.0.1:") && anon && service);
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const email = `session-${randomUUID()}@example.test`;
  const password = `${randomBytes(24).toString("base64url")}!`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert.ifError(created.error);
  server = await startNext(url, anon, service);
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 900, height: 900 } });
  const page = await context.newPage();
  const base = `http://127.0.0.1:${server.port}`;
  await page.goto(`${base}/auth/sign-in?next=%2Fwork`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Continue to your work" }).click();
  await page.waitForURL((location) => location.pathname === "/work");
  await page.getByRole("heading", { name: /Account ready.*workspace access pending/ }).waitFor();
  const issuedAt = Date.now();
  const cookieNames = (await context.cookies()).map((cookie) => cookie.name);
  assert(cookieNames.some((name) => name.includes("auth-token")), "auth_cookie_missing");
  evidence.checks.push({ name: "fictional browser signs in with five-minute local JWT",
    status: "PASS", detail: { jwtExpirySeconds: 300, userId: created.data.user.id } });
  await new Promise((done) => setTimeout(done, 310_000));
  evidence.cookieNamesAfterExpiry = (await context.cookies()).map((cookie) => cookie.name);
  await page.goto(`${base}/work`);
  await page.waitForURL((location) => location.pathname === "/work", { timeout: 30000 });
  await page.getByRole("heading", { name: /Account ready.*workspace access pending/ }).waitFor();
  const elapsedSeconds = Math.floor((Date.now() - issuedAt) / 1000);
  assert(elapsedSeconds >= 300);
  evidence.checks.push({ name: "expired access token refreshes on protected browser navigation",
    status: "PASS", detail: { elapsedSeconds, protectedPage: "/work" } });
  await context.clearCookies();
  await page.goto(`${base}/work`);
  await page.waitForURL((location) => location.pathname === "/auth/sign-in", { timeout: 30000 });
  evidence.checks.push({ name: "missing session cannot navigate to protected Work",
    status: "PASS", detail: { redirectedTo: "/auth/sign-in" } });
  await context.close();
} catch (error) { evidence.error = String(error.stack ?? error).slice(0, 2200); }
finally {
  if (browser) await browser.close();
  if (server) server.handle.kill();
  restoreNextEnv();
  if (runtime) {
    try { evidence.cleanup = cleanupP0aRuntime(runtime); }
    catch (error) { evidence.cleanup = { clean: false, error: String(error.message) }; }
  }
  evidence.finishedAt = new Date().toISOString();
  evidence.summary = { passed: evidence.checks.length, error: Boolean(evidence.error),
    cleanupVerified: Boolean(evidence.cleanup?.clean) };
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({ ...evidence.summary, output }));
  if (evidence.error || !evidence.cleanup?.clean) process.exitCode = 1;
}
