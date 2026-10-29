import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { createP0aRuntime, cleanupP0aRuntime } from "./disposable-runtime.mjs";

const root = resolve(process.cwd());
const output = resolve(root, "artifacts/d5o-local-qualification/local-recovery.json");
const evidence = { startedAt: new Date().toISOString(), checks: [], sourceCleanup: null,
  targetCleanup: null, error: null };
const q = (value) => `'${String(value).replaceAll("'", "''")}'`;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
let source, target;
function docker(runtime, args, input = undefined, allowFailure = false) {
  const result = spawnSync("docker", ["exec", "-i", runtime.dbContainer, ...args], {
    input, encoding: "utf8", shell: false, maxBuffer: 1024 * 1024 * 16 });
  if (!allowFailure && result.status !== 0) throw Error(`docker_db_failed:${result.stderr.slice(-700)}`);
  return result;
}
function sql(runtime, query, allowFailure = false) {
  return docker(runtime, ["psql", "-U", "postgres", "-d", "postgres", "-X", "-t", "-A",
    "-v", "ON_ERROR_STOP=1"], query, allowFailure);
}
function dump(runtime, table) {
  return docker(runtime, ["pg_dump", "-U", "postgres", "-d", "postgres", "--data-only",
    "--column-inserts", `--table=${table}`]).stdout;
}
function clients(runtime) {
  const url = runtime.status.API_URL ?? runtime.status.SUPABASE_URL;
  const anonKey = runtime.status.ANON_KEY ?? runtime.status.PUBLISHABLE_KEY;
  const serviceKey = runtime.status.SERVICE_ROLE_KEY ?? runtime.status.SECRET_KEY;
  assert(url && anonKey && serviceKey && url.startsWith("http://127.0.0.1:"));
  const settings = { auth: { persistSession: false, autoRefreshToken: false } };
  return { admin: createClient(url, serviceKey, settings), anon: createClient(url, anonKey, settings) };
}
const probeSchema = `create schema d5o_recovery_probe;
  create table d5o_recovery_probe.records(
    id uuid primary key, actor_user_id uuid not null references auth.users(id),
    storage_path text not null unique, bytes_sha256 text not null);`;
try {
  const email = `recovery-${randomUUID()}@example.test`;
  const password = `${randomBytes(24).toString("base64url")}!`;
  const path = `local-recovery-${randomUUID()}/evidence-${randomUUID()}.pdf`;
  const bytes = Buffer.from(`%PDF-1.4\n% Fictional D5O recovery ${randomUUID()}\n%%EOF\n`);
  const digest = sha256(bytes);
  const recordId = randomUUID();
  source = await createP0aRuntime(root);
  const from = clients(source);
  const user = await from.admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert.ifError(user.error);
  const userId = user.data.user.id;
  const signedIn = await from.anon.auth.signInWithPassword({ email, password });
  assert.ifError(signedIn.error);
  assert.equal(signedIn.data.user.id, userId);
  const uploaded = await from.admin.storage.from("d5o-deploy-evidence").upload(path, bytes,
    { contentType: "application/pdf", upsert: false });
  assert.ifError(uploaded.error);
  sql(source, probeSchema);
  sql(source, `insert into d5o_recovery_probe.records values
    (${q(recordId)},${q(userId)},${q(path)},${q(digest)});`);
  const sourceObjectId = sql(source, `select id::text from storage.objects
    where bucket_id='d5o-deploy-evidence' and name=${q(path)};`).stdout.trim();
  assert(sourceObjectId);
  evidence.checks.push({ name: "source_auth_storage_database_fixture", status: "PASS" });

  const interrupted = sql(source, `begin;
    insert into d5o_recovery_probe.records values
      (${q(randomUUID())},${q(userId)},${q(`${path}.interrupted`)},${q(digest)});
    select 1/0;`, true);
  assert.notEqual(interrupted.status, 0);
  assert.equal(sql(source, "select count(*) from d5o_recovery_probe.records;").stdout.trim(), "1");
  evidence.checks.push({ name: "interrupted_transaction_rolled_back", status: "PASS" });

  // Keep only fictional table data in memory; never write Auth hashes to the artifact.
  const backup = [dump(source, "auth.users"), dump(source, "auth.identities"),
    dump(source, "d5o_recovery_probe.records")];
  evidence.checks.push({ name: "logical_database_auth_backup_captured", status: "PASS",
    tableCount: backup.length, backupSha256: sha256(backup.join("\n")) });
  evidence.sourceCleanup = cleanupP0aRuntime(source);
  source = null;
  assert(evidence.sourceCleanup.clean);

  target = await createP0aRuntime(root);
  const to = clients(target);
  sql(target, probeSchema);
  for (const tableSql of backup) sql(target, tableSql);
  const restored = sql(target, `select actor_user_id::text||':'||storage_path||':'||bytes_sha256
    from d5o_recovery_probe.records where id=${q(recordId)};`).stdout.trim();
  assert.equal(restored, `${userId}:${path}:${digest}`);
  const reauth = await to.anon.auth.signInWithPassword({ email, password });
  assert.ifError(reauth.error);
  assert.equal(reauth.data.user.id, userId);
  evidence.checks.push({ name: "restored_database_and_auth_identity", status: "PASS",
    userIdPreserved: true, reauthenticationSucceeded: true });

  const targetUpload = await to.admin.storage.from("d5o-deploy-evidence").upload(path, bytes,
    { contentType: "application/pdf", upsert: false });
  assert.ifError(targetUpload.error);
  const downloaded = await to.admin.storage.from("d5o-deploy-evidence").download(path);
  assert.ifError(downloaded.error);
  assert.equal(sha256(Buffer.from(await downloaded.data.arrayBuffer())), digest);
  const denied = await to.anon.storage.from("d5o-deploy-evidence").download(path);
  assert(denied.error);
  const targetObjectId = sql(target, `select id::text from storage.objects
    where bucket_id='d5o-deploy-evidence' and name=${q(path)};`).stdout.trim();
  assert(targetObjectId);
  evidence.checks.push({ name: "restored_storage_bytes_match_database_reference", status: "PASS",
    sha256: digest, anonymousDenied: true, metadataIdPreserved: sourceObjectId === targetObjectId });
} catch (error) { evidence.error = String(error.message).slice(0, 1400); }
finally {
  if (source) evidence.sourceCleanup = cleanupP0aRuntime(source);
  if (target) evidence.targetCleanup = cleanupP0aRuntime(target);
  evidence.finishedAt = new Date().toISOString();
  evidence.summary = { passed: evidence.checks.filter((item) => item.status === "PASS").length,
    error: Boolean(evidence.error), sourceCleanupVerified: Boolean(evidence.sourceCleanup?.clean),
    targetCleanupVerified: Boolean(evidence.targetCleanup?.clean) };
  mkdirSync(resolve(root, "artifacts/d5o-local-qualification"), { recursive: true });
  writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({ ...evidence.summary, output }));
  if (evidence.error || !evidence.sourceCleanup?.clean || !evidence.targetCleanup?.clean) process.exitCode = 1;
}
