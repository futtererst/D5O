// Read-only hosted release smoke. No customer mutation or invitation is sent.
import assert from "node:assert/strict";

const base = process.env.D5O_SMOKE_BASE_URL;
const expectedScope = process.env.D5O_SMOKE_SCOPE ?? "d5o_hosted";
if (!base) throw Error("D5O_SMOKE_BASE_URL is required");
const parsed = new URL(base);
if (parsed.username || parsed.password || parsed.search || parsed.hash) throw Error("invalid smoke target URL");
if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && parsed.hostname === "127.0.0.1"))
  throw Error("smoke target must be HTTPS or loopback HTTP");
if (process.env.D5O_SMOKE_PRODUCTION !== "APPROVED" && parsed.hostname.endsWith(".supabase.co"))
  throw Error("direct Supabase smoke target is unsupported");

async function probe(path, expected) {
  const response = await fetch(new URL(path, parsed), { redirect: "manual", signal: AbortSignal.timeout(10000) });
  const body = await response.text();
  assert.equal(response.status, expected, `${path}: HTTP ${response.status}`);
  return { path, status: response.status, body, cacheControl: response.headers.get("cache-control") };
}

const health = await probe("/api/health", 200);
const readiness = await probe("/api/readiness", 200);
const state = JSON.parse(readiness.body);
assert.equal(state.ok, true);
assert.equal(state.scope, expectedScope);
assert.equal(state.runtimeMode, "production");
assert.equal(state.authMode, "supabase");
assert.equal(state.dataSource, "database");
assert.equal(readiness.cacheControl, "no-store");
if (expectedScope === "d5o_hosted") {
  assert.equal(state.scannerMode, "disabled");
  assert(state.issueCodes.includes("scanner_disabled"));
}
const denied = await probe("/api/work/catalog", 503);
const anonymous = await probe("/api/d5o-hosted/customer-work", 401);
assert.equal(JSON.parse(anonymous.body).error, "unauthenticated");
console.log(JSON.stringify({ status: "PASS", targetOrigin: parsed.origin,
  health: health.status, readiness: readiness.status, scope: state.scope,
  legacyRoute: denied.status, anonymousHostedApi: anonymous.status,
  scannerMode: state.scannerMode, noStore: readiness.cacheControl === "no-store" }));
