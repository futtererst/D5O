import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const manifestPath = join(root, "docs/release/D5O_RC0_MIGRATION_CHECKSUMS.json");
const identityPath = join(root, "docs/release/D5O_RC2_ENVIRONMENT_IDENTITY.json");
const manifestBytes = readFileSync(manifestPath);
const manifest = JSON.parse(manifestBytes);
const identity = JSON.parse(readFileSync(identityPath, "utf8"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const errors = [];

if (sha256(manifestBytes) !== identity.source.migrationManifestSha256) errors.push("manifest_identity_hash_mismatch");
if (manifest.migrations.length !== 234 || identity.source.migrationCount !== 234) errors.push("migration_count_mismatch");
for (const [index, entry] of manifest.migrations.entries()) {
  if (entry.order !== index + 1) errors.push(`order:${entry.filename}`);
  try {
    if (sha256(readFileSync(join(root, "supabase/migrations", entry.filename))) !== entry.sha256)
      errors.push(`checksum:${entry.filename}`);
  } catch {
    errors.push(`missing:${entry.filename}`);
  }
}
const source = readFileSync(join(root, "lib/d5o/auth/hosted-target.ts"), "utf8");
const hostedGuardNeedsStaging = source.includes('const hostedProjectRef = "fcawktdjoxvahhgvkebx"') &&
  !source.includes('D5O_COMMAND_RUNTIME === "staging"');
const staging = identity.staging;
const prod = identity.productionReferenceOnly;
const stagingIdsSeparated = Boolean(staging.supabaseProjectRef && staging.vercelProjectId &&
  staging.supabaseProjectRef !== prod.supabaseProjectRef && staging.vercelProjectId !== prod.vercelProjectId);
const approved = identity.authorization.isolatedStagingMutation === "approved" &&
  identity.authorization.billableResourceCreation === "approved";

const result = {
  format: "d5o-rc2-preflight-results-v1",
  manifest: { filename: "D5O_RC0_MIGRATION_CHECKSUMS.json", sha256: sha256(manifestBytes),
    migrationCount: manifest.migrations.length, exactSourceChecksumsPass: errors.length === 0 },
  staging: { approved, stagingIdsSeparated, hostedGuardNeedsStaging,
    readyForHostedMutation: approved && stagingIdsSeparated && !hostedGuardNeedsStaging && errors.length === 0 },
  errors
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (errors.length) process.exitCode = 1;
