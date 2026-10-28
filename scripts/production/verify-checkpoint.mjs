// Verify retained encrypted D5O archive and private-object association without
// exposing decrypted business rows or object names. This does not prove an
// atomic production checkpoint or Storage API serving.
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const [protectedPath, mode = "post-upgrade"] = process.argv.slice(2);
if (!protectedPath || !["pre-upgrade", "post-upgrade"].includes(mode))
  throw Error("provide protected directory and pre-upgrade|post-upgrade");
const dir = realpathSync(protectedPath);
const container = "d5o-rc7-recovery-db";
function run(program, args, env = {}) {
  const p = spawnSync(program, args, { encoding: "utf8", windowsHide: true,
    env: { ...process.env, ...env }, maxBuffer: 1024 * 1024, timeout: 180000 });
  if (p.status !== 0) throw Error(`checkpoint verification failed: ${program} ${args[0]}`);
  return p.stdout.trim();
}
const inspect = JSON.parse(run("docker", ["inspect", container]))[0];
if (inspect.HostConfig.NetworkMode !== "none" || Object.keys(inspect.HostConfig.PortBindings ?? {}).length)
  throw Error("checkpoint target is not network-isolated");
const expectedLedger = mode === "post-upgrade" ? 202 : 177;
const ledger = run("docker", ["exec", container, "psql", "-U", "supabase_admin", "-d", "postgres", "-At", "-c",
  "select count(*) from supabase_migrations.schema_migrations"]);
if (ledger !== String(expectedLedger)) throw Error("checkpoint ledger mismatch");
const archives = mode === "post-upgrade"
  ? ["rc8-upgraded-schema.dump.aesgcm", "rc8-upgraded-data.dump.aesgcm", "rc7-auth.jsonl.aesgcm", "rc7-storage-byte-index.json.aesgcm"]
  : ["rc7-schema.dump.aesgcm", "rc7-database.dump.aesgcm", "rc7-auth.jsonl.aesgcm", "rc7-storage-byte-index.json.aesgcm"];
const verified = archives.map((filename) => {
  const path = join(dir, filename);
  const authenticated = JSON.parse(run("node", ["scripts/rc7_verify_encrypted.mjs", path]));
  if (!authenticated.authenticated || authenticated.plainBytes <= 0) throw Error("encrypted artifact authentication failed");
  return { kind: filename.replace(/\.aesgcm$/, ""), encryptedSha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
    plaintextSha256: authenticated.plainSha256, plaintextBytes: authenticated.plainBytes };
});
const storage = JSON.parse(run("node", ["scripts/rc7_verify_storage_copy.mjs", dir], { D5O_RC7_CONTAINER: container }));
if (storage.objects !== 23 || !storage.contentHashesMatched || !storage.restoredMetadataAssociationsMatched)
  throw Error("private-object and metadata mismatch");
console.log(JSON.stringify({ format: "d5o-checkpoint-verification-v1", status: "PASS",
  checkpointClassification: "NON_ATOMIC_HISTORICAL_SOURCE", mode,
  networkMode: "none", ledgerRows: expectedLedger,
  archives: verified, privateObjects: storage.objects, privateBytes: storage.totalBytes,
  metadataAssociationsMatched: true, productionConsistencyProven: false }));
