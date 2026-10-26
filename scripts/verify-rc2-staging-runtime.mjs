import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { resolveD5OCommandRuntime } from "../lib/d5o/auth/runtime-identity.ts";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const check = (label, env, expected) => {
  assert.equal(resolveD5OCommandRuntime(env), expected, label);
  return label;
};
const productionRef = "fcawktdjoxvahhgvkebx";
const stagingRef = "syntheticstagingref1";
const publicKey = "sb_publishable_synthetic_staging";
const secretKey = "sb_secret_synthetic_staging";
const staging = {
  D5O_HOSTED_ENABLED: "1",
  D5O_COMMAND_RUNTIME: "staging",
  D5O_ISOLATED_PILOT: "0",
  NODE_ENV: "production",
  RYBEXOS_RUNTIME_MODE: "production",
  RYBEXOS_AUTH_MODE: "supabase",
  RYBEXOS_DATA_SOURCE: "database",
  NEXT_PUBLIC_SUPABASE_URL: `https://${stagingRef}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publicKey,
  SUPABASE_SECRET_KEY: secretKey,
  D5O_STAGING_SUPABASE_REF: stagingRef,
  D5O_STAGING_PUBLISHABLE_KEY_SHA256: sha256(publicKey),
  D5O_STAGING_SECRET_KEY_SHA256: sha256(secretKey),
  VERCEL: "1",
  VERCEL_ENV: "preview",
  VERCEL_TARGET_ENV: "preview",
  VERCEL_PROJECT_ID: "prj_syntheticStagingProject",
  D5O_STAGING_VERCEL_PROJECT_ID: "prj_syntheticStagingProject",
  VERCEL_GIT_COMMIT_REF: "codex/d5o-rc2-staging",
  D5O_STAGING_GIT_BRANCH: "codex/d5o-rc2-staging"
};
const results = [];
results.push(check("production unchanged", {
  D5O_HOSTED_ENABLED: "1", D5O_COMMAND_RUNTIME: "production", D5O_ISOLATED_PILOT: "0",
  NODE_ENV: "production", RYBEXOS_RUNTIME_MODE: "production",
  NEXT_PUBLIC_SUPABASE_URL: `https://${productionRef}.supabase.co`
}, "production"));
results.push(check("production rejects another project", {
  D5O_HOSTED_ENABLED: "1", D5O_COMMAND_RUNTIME: "production", NODE_ENV: "production",
  RYBEXOS_RUNTIME_MODE: "production", NEXT_PUBLIC_SUPABASE_URL: staging.NEXT_PUBLIC_SUPABASE_URL
}, null));
results.push(check("local pilot unchanged", {
  D5O_HOSTED_ENABLED: "1", D5O_ISOLATED_PILOT: "1", NODE_ENV: "development",
  D5O_ISOLATED_PILOT_URL: "http://127.0.0.1:56321", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:56321"
}, "pilot"));
results.push(check("local rehearsal unchanged", {
  D5O_HOSTED_ENABLED: "1", D5O_COMMAND_RUNTIME: "rehearsal", NODE_ENV: "production",
  D5O_REHEARSAL_TARGET_URL: "http://127.0.0.1:56321", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:56321"
}, "rehearsal"));
results.push(check("approved synthetic staging", staging, "staging"));
for (const [label, override] of [
  ["hosted disabled", { D5O_HOSTED_ENABLED: "0" }],
  ["unknown runtime", { D5O_COMMAND_RUNTIME: "unknown" }],
  ["production Supabase denied", { NEXT_PUBLIC_SUPABASE_URL: `https://${productionRef}.supabase.co`, D5O_STAGING_SUPABASE_REF: productionRef }],
  ["production deployment denied", { VERCEL_ENV: "production", VERCEL_TARGET_ENV: "production" }],
  ["wrong Vercel project denied", { VERCEL_PROJECT_ID: "prj_other" }],
  ["wrong Git branch denied", { VERCEL_GIT_COMMIT_REF: "main" }],
  ["wrong public key denied", { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_wrong" }],
  ["wrong server key denied", { SUPABASE_SECRET_KEY: "sb_secret_wrong" }],
  ["legacy public key alias denied", { NEXT_PUBLIC_SUPABASE_ANON_KEY: "unexpected" }],
  ["legacy server key alias denied", { SUPABASE_SERVICE_ROLE_KEY: "unexpected" }],
  ["missing binding hash denied", { D5O_STAGING_SECRET_KEY_SHA256: undefined }],
  ["wrong auth mode denied", { RYBEXOS_AUTH_MODE: "demo" }],
  ["wrong data source denied", { RYBEXOS_DATA_SOURCE: "local" }],
  ["malformed URL denied", { NEXT_PUBLIC_SUPABASE_URL: `https://${stagingRef}.supabase.co/other` }]
]) results.push(check(label, { ...staging, ...override }, null));

const scheduleSource = readFileSync(new URL("../lib/d5o/scheduling/request-origin.ts", import.meta.url), "utf8")
  .replace('import { d5oCommandRuntime } from "@/lib/d5o/auth/hosted-target";',
    "const d5oCommandRuntime = () => globalThis.__d5oRc2TestRuntime;");
const scheduleJavaScript = ts.transpileModule(scheduleSource, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 }
}).outputText;
const { validLocalScheduleOrigin } = await import(`data:text/javascript;base64,${Buffer.from(scheduleJavaScript).toString("base64")}`);
const headers = (origin, host, site = "same-origin") => new Headers({ origin, host, "sec-fetch-site": site });
globalThis.__d5oRc2TestRuntime = "staging";
assert.equal(validLocalScheduleOrigin(headers("https://staging.example.test", "staging.example.test")), true);
assert.equal(validLocalScheduleOrigin(headers("http://staging.example.test", "staging.example.test")), false);
assert.equal(validLocalScheduleOrigin(headers("https://staging.example.test", "other.example.test")), false);
assert.equal(validLocalScheduleOrigin(headers("https://staging.example.test", "staging.example.test", "cross-site")), false);
results.push("staging HTTPS same-origin schedule accepted", "staging HTTP, mismatched host and cross-site schedules denied");
delete globalThis.__d5oRc2TestRuntime;

process.stdout.write(`${JSON.stringify({ format: "d5o-rc2b-runtime-guard-v1", passed: results.length, failed: 0,
  syntheticOnly: true, checks: results }, null, 2)}\n`);
