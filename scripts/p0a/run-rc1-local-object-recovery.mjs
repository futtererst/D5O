import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { createP0aRuntime, cleanupP0aRuntime } from "./disposable-runtime.mjs";

const root = resolve(process.cwd());
const output = join(root, "docs/release/D5O_RC1_LOCAL_OBJECT_RECOVERY.json");
const result = { format: "d5o-rc1-local-object-recovery-v1", scope: "fictional local object only; not a database or hosted Storage restore",
  candidateCommit: "ebad4b2b59ca65654777811a40ccde046f929e07", cleanup: null, error: null };
let runtime;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
function objectIdentity(path) {
  const run = spawnSync("docker", ["exec", "-i", runtime.dbContainer, "psql", "-U", "postgres", "-d", "postgres",
    "-X", "-t", "-A", "-v", "ON_ERROR_STOP=1"], {
    cwd: root, input: `select id::text from storage.objects where bucket_id='d5o-deploy-evidence' and name='${path}';`,
    encoding: "utf8", shell: false });
  if (run.status !== 0) throw Error(`storage_metadata_query_failed:${String(run.stderr).slice(-500)}`);
  return run.stdout.trim();
}
try {
  runtime = await createP0aRuntime(root);
  const url = runtime.status.API_URL ?? runtime.status.SUPABASE_URL;
  const serviceKey = runtime.status.SERVICE_ROLE_KEY ?? runtime.status.SECRET_KEY;
  const anonKey = runtime.status.ANON_KEY ?? runtime.status.PUBLISHABLE_KEY;
  assert(url && serviceKey && anonKey, "disposable_storage_binding_missing");
  const service = createClient(url, serviceKey, { auth: { persistSession: false } });
  const anonymous = createClient(url, anonKey, { auth: { persistSession: false } });
  const path = `rc1-fictional-${randomUUID()}/work-${randomUUID()}/evidence-${randomUUID()}.pdf`;
  const bytes = Buffer.from(`%PDF-1.4\n% RC1 fictional recovery fixture ${randomUUID()}\n%%EOF\n`);
  const beforeHash = digest(bytes);
  const upload = await service.storage.from("d5o-deploy-evidence").upload(path, bytes, { contentType: "application/pdf", upsert: false });
  assert.ifError(upload.error);
  const oldObjectId = objectIdentity(path);
  assert(oldObjectId, "missing_original_storage_metadata");
  const denied = await anonymous.storage.from("d5o-deploy-evidence").download(path);
  assert(denied.error, "anonymous_private_object_read_allowed");
  const checkpointAt = new Date().toISOString();
  const backup = await service.storage.from("d5o-deploy-evidence").download(path);
  assert.ifError(backup.error);
  const backupBytes = Buffer.from(await backup.data.arrayBuffer());
  assert.equal(digest(backupBytes), beforeHash);
  const remove = await service.storage.from("d5o-deploy-evidence").remove([path]);
  assert.ifError(remove.error);
  assert.equal(objectIdentity(path), "");
  const recoveryStart = performance.now();
  const restore = await service.storage.from("d5o-deploy-evidence").upload(path, backupBytes, { contentType: "application/pdf", upsert: false });
  assert.ifError(restore.error);
  const restored = await service.storage.from("d5o-deploy-evidence").download(path);
  assert.ifError(restored.error);
  const restoredBytes = Buffer.from(await restored.data.arrayBuffer());
  const newObjectId = objectIdentity(path);
  assert.equal(digest(restoredBytes), beforeHash);
  assert(newObjectId, "missing_restored_storage_metadata");
  const deniedAfter = await anonymous.storage.from("d5o-deploy-evidence").download(path);
  assert(deniedAfter.error, "anonymous_restored_object_read_allowed");
  result.object = { bucket: "d5o-deploy-evidence", privateBucket: true, path, byteLength: bytes.length,
    sha256: beforeHash, checkpointAt, objectIdBefore: oldObjectId, objectIdAfter: newObjectId,
    objectIdPreserved: oldObjectId === newObjectId, restoredBytesMatch: true,
    anonymousReadDeniedBeforeAndAfter: true, localObjectRecoveryMs: Math.round(performance.now() - recoveryStart) };
} catch (error) { result.error = String(error); }
finally {
  if (runtime) result.cleanup = cleanupP0aRuntime(runtime);
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ recovered: result.object?.restoredBytesMatch === true,
    objectIdPreserved: result.object?.objectIdPreserved ?? null,
    localObjectRecoveryMs: result.object?.localObjectRecoveryMs ?? null,
    cleanupClean: result.cleanup?.clean ?? false, error: result.error }));
}
if (result.error || !result.cleanup?.clean) process.exitCode = 1;
