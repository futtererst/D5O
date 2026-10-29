#!/usr/bin/env node
// Read-only release identity and configuration-name gate. Never prints secrets.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "../..");
const archive = process.argv[2];
if (!archive) throw Error("usage: launch-preflight.mjs <verified-release-archive> [restricted-db-uri-file]");
const dbUriFile = process.argv[3];
const expected = {
  applicationSource: "8ca44e778adc3913d9eca686da8c8473e4c85167",
  applicationTree: "84f2081b3b6266abf7d89906b04f816622838f2c",
  projectRef: "fcawktdjoxvahhgvkebx",
  vercelProject: "prj_HF8KhxUFvONQlpMr53FdhEgmIpFG",
  vercelTeam: "team_YSItyDw0cqxobdy4YBp9osYV",
  archiveSha256: "c9ebbcdc12194355388114eacb9f9b0ecb92fc89e219a3a5e8034cac4309e557",
  manifestSha256: "c7e3cc0cb3740c2b0acf00b19160b489ced836accfdd470949c4c65d65c8ebb1",
  bridgePreSha256: "0f076c496f756b8f56965b104cddd8c77c558344c89ca84cbf85946dfa924af5",
  bridgePostSha256: "b15dcd56a30fc4b46e81ea792fbfd51e19213630b698bd5734334f0cccbdf5d8"
};
const checks = {};
const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
function run(program, args, options = {}, channel = "stdout") {
  const r = spawnSync(program, args, { cwd: root, encoding: "utf8", timeout: 60000,
    maxBuffer: 2 * 1024 * 1024, windowsHide: true, ...options });
  if (r.status !== 0) throw Error(`${program} read-only preflight failed`);
  return (channel === "stderr" ? r.stderr : r.stdout).trim();
}
const vercel = (args, channel = "stdout") => process.platform === "win32"
  ? run("cmd.exe", ["/d", "/c", "vercel", ...args], {}, channel) : run("vercel", args, {}, channel);
function check(name, fn) {
  try { checks[name] = fn() ? "PASS" : "FAIL"; }
  catch { checks[name] = "BLOCKED"; }
}

check("cleanReleaseWorktree", () => !run("git", ["status", "--porcelain"]));
check("applicationAncestry", () => {
  run("git", ["merge-base", "--is-ancestor", expected.applicationSource, "HEAD"]);
  return true;
});
check("applicationTree", () => run("git", ["rev-parse", "HEAD:app"]) === expected.applicationTree);
check("releaseArchive", () => sha(resolve(archive)) === expected.archiveSha256);
check("migrationManifestAndFiles", () => {
  const path = resolve(root, "docs/release/evidence/D5O_RC5_COMPLETE_236_MIGRATION_MANIFEST.json");
  const migrations = JSON.parse(readFileSync(path, "utf8")).migrations;
  return sha(path) === expected.manifestSha256 && migrations.length === 236 &&
    migrations.every((item, index) => item.order === index + 1 &&
      sha(resolve(root, "supabase/migrations", item.filename)) === item.sha256);
});
check("atomicBridgeSources", () =>
  sha(resolve(root, "scripts/rc8_bridge_pre_215.sql")) === expected.bridgePreSha256 &&
  sha(resolve(root, "scripts/rc8_bridge_post_215.sql")) === expected.bridgePostSha256);
check("vercelProject", () => {
  const output = vercel(["project", "inspect", "d5o-system-of-work", "--scope", expected.vercelTeam], "stderr");
  return output.includes(expected.vercelProject);
});
check("productionVariableNames", () => {
  const output = vercel(["env", "list", "production", "--json", "--project", expected.vercelProject,
    "--scope", expected.vercelTeam, "--non-interactive"]);
  const data = JSON.parse(output);
  const vars = Array.isArray(data) ? data : data.envs ?? data.variables ?? [];
  const names = new Set(vars.map((item) => item.key));
  return ["D5O_SOURCE_SHA", "D5O_COMMAND_RUNTIME", "D5O_HOSTED_ENABLED", "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "RYBEXOS_RUNTIME_MODE",
    "RYBEXOS_AUTH_MODE", "RYBEXOS_DATA_SOURCE", "RYBEXOS_SCANNER_MODE"].every((key) => names.has(key));
});
check("productionStartingLedgerAndStorageInventory", () => {
  if (!dbUriFile) return false;
  const data = JSON.parse(run("node", ["scripts/production/checkpoint-inventory.mjs", resolve(dbUriFile)],
    { timeout: 120000 }));
  return data.projectRef === expected.projectRef && data.ledgerRows === 177 &&
    data.approvedLedgerFingerprintMatched === true && data.complete === true;
});
// Listing names does not establish effective decrypted values or an approved recovery point.
const identityChecksPassed = Object.values(checks).every((x) => x === "PASS");
const result = { status: identityChecksPassed ? "IDENTITY_PREFLIGHT_PASS" : "STOP",
  cutoverGoNoGo: "NO_GO", // Binding values and a current recovery point require separate proof.
  applicationSource: expected.applicationSource, applicationTree: expected.applicationTree,
  supabaseProject: expected.projectRef, vercelProject: expected.vercelProject,
  checks, effectiveBindingValuesVerified: false, recoveryCheckpointVerified: false,
  productionMutationPerformed: false };
console.log(JSON.stringify(result));
if (result.status !== "IDENTITY_PREFLIGHT_PASS") process.exitCode = 2;
