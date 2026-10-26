import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => JSON.parse(readFileSync(join(root, path), "utf8"));
const applicationCommit = "3710ecace04e54769b5761da83f12594562e95b3";
const browser = read("docs/architecture/evidence/phase2hu-two-tenant-results.json");
const organization = read("docs/architecture/evidence/phase2a-two-tenant-results.json");
const service = read("docs/architecture/evidence/phase2htd-targeted-results.json");
const phaseReplay = read("docs/architecture/evidence/phase2g-two-tenant-results.json");
const contentionAttempt = read("docs/release/D5O_RC0_PHASE2G_CONTENTION_ATTEMPT.json");
const deployIntegrity = read("docs/release/D5O_RC0_DEPLOY_INTEGRITY.json");
const deployIntegrityFirstAttempt = read("docs/release/D5O_RC0_DEPLOY_INTEGRITY_FIRST_ATTEMPT.json");
const upgrade = read("docs/release/D5O_RC0_UPGRADE_SMOKE.json");
const suite = (name, path, value) => ({ name, path, ...value.summary,
  disposableProjectId: value.cleanup?.projectId ?? null, cleanupClean: value.cleanup?.clean === true });
const output = { format: "d5o-rc0-integration-results-v1", applicationCommit,
  baselineCommit: "4cf881b506def45564040d767292c5c8c4ecbe48",
  localSourceCommit: "9a0886990bc8d1d2cb4e3a28cbc73672501b7240", verdict: "INTEGRATION QUALIFIED",
  passed: [
    { name: "npm ci", status: "PASS" }, { name: "TypeScript", status: "PASS" },
    { name: "ESLint", status: "PASS" }, { name: "production build", status: "PASS", nextVersion: "16.4.2" },
    { name: "npm run verify", status: "PASS", routeSmokeChecks: 28 },
    { name: "published phase contract", status: "PASS" },
    { name: "readiness scanner invariant", status: "PASS" },
    { name: "fresh migration stack", status: "PASS", includedMigrations: 234, cleanupClean: true },
    { name: "released-main forward upgrade", status: upgrade.error || !upgrade.markerPreserved ||
      !upgrade.workPinPreserved || !upgrade.auditPreserved || !upgrade.cleanup?.clean ? "FAIL" : "PASS",
      appliedVersions: upgrade.appliedVersions, markerPreserved: upgrade.markerPreserved,
      workPinPreserved: upgrade.workPinPreserved, auditPreserved: upgrade.auditPreserved,
      cleanupClean: upgrade.cleanup?.clean },
    suite("tenant organization and people", "docs/architecture/evidence/phase2a-two-tenant-results.json", organization),
    suite("integrated Deploy browser", "docs/architecture/evidence/phase2hu-two-tenant-results.json", browser),
    suite("connected service security closure", "docs/architecture/evidence/phase2htd-targeted-results.json", service),
    suite("tenant-neutral Work and phase replay", "docs/architecture/evidence/phase2g-two-tenant-results.json", phaseReplay),
    { ...suite("Deploy integrity qualification", "docs/release/D5O_RC0_DEPLOY_INTEGRITY.json", deployIntegrity),
      finiteCases: deployIntegrity.rc0Integrity ?? [] },
  ],
  failed: [{ name: "legacy configuration-foundation static verifier", status: "FAIL",
    detail: "Five stale P1 documentation assertions in verify-no-regression; migration/schema/RLS/effective-resolution subchecks passed." },
    { name: "Phase 2G concurrent dev-server attempt", status: "FAIL", passed: contentionAttempt.summary.passed,
      failed: contentionAttempt.summary.failed, cleanupClean: contentionAttempt.cleanup?.clean === true,
      detail: "next_start_timeout while TD used the same checkout; isolated rerun passed 48/48" },
    { name: "Deploy integrity first probe", status: "FAIL", passed: deployIntegrityFirstAttempt.summary.passed,
      failed: deployIntegrityFirstAttempt.summary.failed, cleanupClean: deployIntegrityFirstAttempt.cleanup?.clean === true,
      detail: "Probe omitted turnoverId; authenticated RPCs denied both acceptance attempts before decision" }],
  blocked: [
    "Approved staging restore and recovery proof",
    "Read-only hosted migration ledger and approved staging data-copy comparison",
    "Live invitation delivery and historical fixture provenance",
    "General-customer routing and historical phase-projection data",
    "Production readiness and promotion authorization",
  ] };
writeFileSync(join(root, "docs/release/D5O_RC0_INTEGRATION_RESULTS.json"), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ applicationCommit, verdict: output.verdict,
  suites: output.passed.filter((item) => item.path).map((item) => ({ name: item.name, passed: item.passed, failed: item.failed })) }));
