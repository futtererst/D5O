// Guarded matched checkpoint capture and offline restore using existing RC7
// encrypted exporters. Capture requires a separately approved write boundary.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createProtectedKey, loadProtectedKey } from "../rc6_dpapi_key.mjs";

const [mode, directory, uriFile, storageKeyFile, approvalFile] = process.argv.slice(2);
if (!["capture-production", "capture-local", "restore-local"].includes(mode) || !directory)
  throw Error("usage: checkpoint-runner.mjs capture-production|capture-local|restore-local <protected-dir> [uri-file storage-key-file approval-file]");
const dir = realpathSync(directory);
const root = resolve(import.meta.dirname, "../..").toLowerCase();
if (mode === "capture-production" && (dir.toLowerCase().startsWith(root + "\\") ||
    dir.toLowerCase().startsWith(resolve(process.env.TEMP || process.env.TMP || "C:/Windows/Temp").toLowerCase() + "\\")))
  throw Error("production checkpoint destination must be durable and outside Git/temporary storage");
const sha = (value) => createHash("sha256").update(value).digest("hex");
function run(program, args, env = {}) {
  const r = spawnSync(program, args, { encoding: "utf8", timeout: 10 * 60 * 1000,
    maxBuffer: 2 * 1024 * 1024, env: { ...process.env, ...env }, windowsHide: true });
  if (r.status !== 0) throw Error(`checkpoint step failed: ${args[0]}`);
  return JSON.parse(r.stdout.trim());
}
function crypt(path, payload) {
  const key = loadProtectedKey(dir);
  try {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const bytes = Buffer.concat([Buffer.from("D5ORC6A1"), iv,
      cipher.update(Buffer.from(JSON.stringify(payload))), cipher.final(), cipher.getAuthTag()]);
    writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
    return sha(bytes);
  } finally { key.fill(0); }
}
function cryptBytes(path, plain) {
  const key = loadProtectedKey(dir);
  try {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([Buffer.from("D5ORC6A1"), iv,
      cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
    writeFileSync(path, encrypted, { flag: "wx", mode: 0o600 });
    return { encryptedSha256: sha(encrypted), plainSha256: sha(plain) };
  } finally { key.fill(0); plain.fill(0); }
}
function decrypt(path) {
  const plain = decryptBytes(path);
  try { return JSON.parse(plain.toString("utf8")); }
  finally { plain.fill(0); }
}
function decryptBytes(path) {
  const key = loadProtectedKey(dir);
  try {
    const bytes = readFileSync(path);
    if (bytes.length < 36 || bytes.subarray(0, 8).toString() !== "D5ORC6A1") throw Error("invalid encrypted checkpoint manifest");
    const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(8, 20));
    decipher.setAuthTag(bytes.subarray(-16));
    return Buffer.concat([decipher.update(bytes.subarray(20, -16)), decipher.final()]);
  } finally { key.fill(0); }
}
function approvedCapture() {
  if (!uriFile || !storageKeyFile || !approvalFile || !process.env.D5O_CHECKPOINT_APPROVAL_SHA256)
    throw Error("restricted credentials and independently pinned checkpoint approval are required");
  const raw = readFileSync(realpathSync(approvalFile));
  if (sha(raw) !== process.env.D5O_CHECKPOINT_APPROVAL_SHA256.toLowerCase()) throw Error("approval hash mismatch");
  const a = JSON.parse(raw);
  const required = ["checkpointId", "releaseOwner", "databaseOperator", "storageOperator",
    "maintenanceStartUtc", "maintenanceEndUtc", "maxInterruptionMinutes",
    "retentionUntilUtc", "stopAndRestorationAuthority", "writeQuiescenceEvidencePath"];
  if (a.projectRef !== "fcawktdjoxvahhgvkebx" || a.destination !== dir ||
      required.some((key) => !a[key]) || a.maxInterruptionMinutes > 60 || a.maxInterruptionMinutes <= 0)
    throw Error("incomplete or wrong-target checkpoint approval");
  const aclScript = "$p=[Console]::In.ReadToEnd().Trim();$a=Get-Acl -LiteralPath $p;$user=$env:USERNAME; if(-not $a.AreAccessRulesProtected -or @($a.Access|Where-Object {$_.IsInherited -or ($_.IdentityReference.Value -notmatch ('(^|\\\\)'+[regex]::Escape($user)+'$')) -and $_.IdentityReference.Value -notin @('NT AUTHORITY\\SYSTEM','BUILTIN\\Administrators')}).Count -gt 0){exit 2};[Console]::Out.Write('PASS')";
  const acl = spawnSync("pwsh.exe", ["-NoProfile", "-NonInteractive", "-Command", aclScript],
    { input: dir, encoding: "utf8", timeout: 10000 });
  if (acl.status !== 0 || acl.stdout !== "PASS") throw Error("checkpoint destination ACL is not restricted");
  const now = Date.now();
  if (now < Date.parse(a.maintenanceStartUtc) || now >= Date.parse(a.maintenanceEndUtc) ||
      Date.parse(a.retentionUntilUtc) <= now ||
      Date.parse(a.maintenanceEndUtc) - Date.parse(a.maintenanceStartUtc) > a.maxInterruptionMinutes * 60000)
    throw Error("checkpoint approval outside bounded maintenance window");
  const evidence = JSON.parse(readFileSync(realpathSync(a.writeQuiescenceEvidencePath), "utf8"));
  if (evidence.checkpointId !== a.checkpointId || evidence.newWritesBlocked !== true ||
      evidence.uploadsBlocked !== true || evidence.inFlightWrites !== 0 ||
      evidence.releaseOwner !== a.releaseOwner || evidence.databaseOperator !== a.databaseOperator ||
      evidence.storageOperator !== a.storageOperator)
    throw Error("write quiescence not attested by named operators");
  if (Date.parse(evidence.confirmedAtUtc) < Date.parse(a.maintenanceStartUtc) ||
      Date.parse(evidence.confirmedAtUtc) > now) throw Error("quiescence attestation timing invalid");
  if (existsSync(join(dir, "checkpoint-manifest.json.aesgcm"))) throw Error("checkpoint destination already contains a completed manifest");
  return a;
}

if (mode === "capture-local") {
  const container = uriFile;
  const objectBase = storageKeyFile;
  const keyFile = approvalFile;
  if (container !== "d5o-checkpoint-fixture-db" || !objectBase?.startsWith("http://127.0.0.1:") || !keyFile)
    throw Error("capture-local requires named fixture, loopback object service and fictional key file");
  const inspect = spawnSync("docker", ["inspect", container], { encoding: "utf8" });
  if (inspect.status !== 0) throw Error("fictional fixture database missing");
  const started = performance.now();
  if (existsSync(join(dir, "rc6-key.dpapi"))) throw Error("local checkpoint destination already has an encryption key");
  const key = createProtectedKey(dir); key.fill(0);
  const psql = (sql) => {
    const r = spawnSync("docker", ["exec", container, "psql", "-U", "supabase_admin", "-d", "postgres",
      "-q", "-X", "-v", "ON_ERROR_STOP=1", "-At", "-c", sql],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024, timeout: 30000 });
    if (r.status !== 0) throw Error("fictional database inventory query failed");
    return r.stdout.trim();
  };
  const rows = () => psql("select row_to_json(t)::text from (select id,bucket_id,name,metadata,updated_at from storage.objects order by bucket_id,name,id) t")
    .split(/\r?\n/).filter(Boolean).map(JSON.parse);
  const before = rows();
  const inventoryHash = sha(Buffer.from(before.map((r) => JSON.stringify(r)).join("\n")));
  const authBefore = psql("select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'|' order by id),'')) from auth.users t");
  const dump = (args) => {
    const r = spawnSync("docker", ["exec", container, "pg_dump", "-U", "supabase_admin", "-d", "postgres",
      "--format=custom", "--compress=6", ...args], { maxBuffer: 128 * 1024 * 1024, timeout: 120000 });
    if (r.status !== 0) throw Error("fictional database dump failed");
    return r.stdout;
  };
  cryptBytes(join(dir, "rc7-schema.dump.aesgcm"), dump(["--schema-only"]));
  cryptBytes(join(dir, "d5o-full-database.dump.aesgcm"), dump(["--data-only", "--schema=auth", "--schema=public",
    "--schema=d5o_hosted", "--schema=storage", "--schema=supabase_migrations",
    "--exclude-table-data=auth.instances", "--exclude-table-data=auth.custom_oauth_providers",
    "--exclude-table-data=auth.saml_providers", "--exclude-table-data=auth.oauth_clients",
    "--exclude-table-data=auth.scim_tokens"]));
  const apiKey = readFileSync(realpathSync(keyFile), "utf8").trim();
  if (!apiKey || apiKey.includes("\n")) throw Error("fictional object key file invalid");
  mkdirSync(join(dir, "objects"));
  const index = [];
  for (const row of before) {
    const objectPath = [row.bucket_id, ...row.name.split("/")].map(encodeURIComponent).join("/");
    const response = await fetch(`${objectBase}/storage/v1/object/authenticated/${objectPath}`,
      { headers: { apikey: apiKey }, redirect: "error", signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw Error("fictional private-object GET failed");
    const bytes = Buffer.from(await response.arrayBuffer());
    const filename = sha(Buffer.from(`${row.id}\0${row.bucket_id}\0${row.name}`)) + ".blob.aesgcm";
    const encrypted = cryptBytes(join(dir, "objects", filename), bytes);
    index.push({ id: row.id, bucket_id: row.bucket_id, name: row.name,
      filename, byteSize: Number(row.metadata?.size), byteSha256: encrypted.plainSha256,
      encryptedSha256: encrypted.encryptedSha256 });
    if (index.at(-1).byteSize !== Number(response.headers.get("content-length")))
      throw Error("fictional object byte size mismatch");
  }
  const after = rows();
  const authAfter = psql("select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'|' order by id),'')) from auth.users t");
  if (sha(Buffer.from(after.map((r) => JSON.stringify(r)).join("\n"))) !== inventoryHash || authBefore !== authAfter)
    throw Error("fictional Auth or Storage changed during capture");
  crypt(join(dir, "rc7-storage-byte-index.json.aesgcm"), { project: "fcawktdjoxvahhgvkebx", objects: index });
  const counts = psql("select (select count(*) from auth.users),(select count(*) from auth.identities),(select count(*) from supabase_migrations.schema_migrations)")
    .split("|").map(Number);
  const manifest = { format: "d5o-matched-checkpoint-v1", checkpointId: "FICTIONAL_LOCAL_FIXTURE",
    source: "FICTIONAL_LOCAL_FIXTURE", projectRef: "LOCAL_ONLY", authRecordCount: counts[0] + counts[1],
    storageObjectCount: index.length, storageInventorySha256: inventoryHash, ledgerRows: counts[2] };
  crypt(join(dir, "checkpoint-manifest.json.aesgcm"), manifest);
  console.log(JSON.stringify({ status: "CAPTURE_PASS", source: manifest.source,
    authUsers: counts[0], authIdentities: counts[1], ledgerRows: counts[2],
    storageObjects: index.length, captureSeconds: Math.round((performance.now() - started) / 10) / 100 }));
} else if (mode === "capture-production") {
  const approval = approvedCapture();
  const started = performance.now();
  const inventoryBefore = run("node", ["scripts/production/checkpoint-inventory.mjs", uriFile]);
  const boundaryBefore = run("node", ["scripts/rc7_export_metadata.mjs", "boundary", uriFile, dir, "-before"]);
  const authBefore = run("node", ["scripts/rc7_export_metadata.mjs", "auth", uriFile, dir, "-before"]);
  const storageBefore = run("node", ["scripts/rc7_export_metadata.mjs", "storage", uriFile, dir, "-before"]);
  const schema = run("node", ["scripts/rc7_export_database.mjs", uriFile, dir, "schema-only"]);
  const database = run("node", ["scripts/rc7_export_database.mjs", uriFile, dir, "full-data"]);
  const bytes = run("node", ["scripts/rc7_export_storage_bytes.mjs", dir, storageKeyFile]);
  const storageAfter = run("node", ["scripts/rc7_export_metadata.mjs", "storage", uriFile, dir, "-after"]);
  const authAfter = run("node", ["scripts/rc7_export_metadata.mjs", "auth", uriFile, dir, "-after"]);
  const boundaryAfter = run("node", ["scripts/rc7_export_metadata.mjs", "boundary", uriFile, dir, "-after"]);
  const inventoryAfter = run("node", ["scripts/production/checkpoint-inventory.mjs", uriFile]);
  const stable = inventoryBefore.inventorySha256 === inventoryAfter.inventorySha256 &&
    inventoryBefore.objectCount === inventoryAfter.objectCount &&
    storageBefore.plainSha256 === storageAfter.plainSha256 &&
    authBefore.plainSha256 === authAfter.plainSha256 &&
    boundaryBefore.plainSha256 === boundaryAfter.plainSha256 &&
    bytes.objectCount === inventoryBefore.objectCount && bytes.sizeMismatches === 0;
  if (!stable || Date.now() >= Date.parse(approval.maintenanceEndUtc))
    throw Error("checkpoint consistency changed or maintenance window exceeded; do not migrate");
  const manifest = { format: "d5o-matched-checkpoint-v1", checkpointId: approval.checkpointId,
    projectRef: approval.projectRef, source: "PRODUCTION_WRITE_QUIESCENT_ATTESTED",
    capturedAtUtc: new Date().toISOString(), captureSeconds: Math.round((performance.now() - started) / 10) / 100,
    databaseEncryptedSha256: database.encryptedSha256, databasePlainSha256: database.plainSha256,
    schemaEncryptedSha256: schema.encryptedSha256, authRecordCount: authBefore.lineCount,
    storageObjectCount: bytes.objectCount, storageByteCount: bytes.totalBytes,
    storageInventorySha256: inventoryBefore.inventorySha256,
    boundarySha256: boundaryBefore.plainSha256, operatorApprovalSha256: sha(readFileSync(approvalFile)) };
  const encryptedManifestSha256 = crypt(join(dir, "checkpoint-manifest.json.aesgcm"), manifest);
  console.log(JSON.stringify({ status: "CAPTURE_PASS", checkpointId: approval.checkpointId,
    objectCount: bytes.objectCount, authRecordCount: authBefore.lineCount,
    captureSeconds: manifest.captureSeconds, encryptedManifestSha256,
    restoreRequiredBeforeMigration: true, productionAtomicityClaimed: false }));
} else {
  const manifest = decrypt(join(dir, "checkpoint-manifest.json.aesgcm"));
  const container = "d5o-checkpoint-restore-db";
  const inspect = spawnSync("docker", ["inspect", container], { encoding: "utf8" });
  if (inspect.status !== 0) throw Error("named isolated restore container missing");
  const target = JSON.parse(inspect.stdout)[0];
  if (target.HostConfig.NetworkMode !== "none" || Object.keys(target.HostConfig.PortBindings ?? {}).length)
    throw Error("restore target is not network-isolated");
  const started = performance.now();
  run("node", ["scripts/rc7_prepare_local_roles.mjs"], { D5O_RC7_CONTAINER: container });
  run("node", ["scripts/rc7_restore_archive.mjs", "schema", join(dir, "rc7-schema.dump.aesgcm")], { D5O_RC7_CONTAINER: container });
  run("node", ["scripts/rc7_restore_archive.mjs", "full-data", join(dir, "d5o-full-database.dump.aesgcm")], { D5O_RC7_CONTAINER: container });
  const storage = run("node", ["scripts/rc7_verify_storage_copy.mjs", dir], { D5O_RC7_CONTAINER: container });
  const index = decrypt(join(dir, "rc7-storage-byte-index.json.aesgcm"));
  if (index.objects.length !== storage.objects) throw Error("restored private-byte index count mismatch");
  const mkdir = spawnSync("docker", ["exec", container, "mkdir", "-p", "/tmp/d5o-private-objects"], { encoding: "utf8" });
  if (mkdir.status !== 0) throw Error("isolated private-byte restore directory failed");
  for (const item of index.objects) {
    if (!/^[a-f0-9]{64}\.blob\.aesgcm$/.test(item.filename)) throw Error("unsafe private-byte restore filename");
    const plain = decryptBytes(join(dir, "objects", item.filename));
    try {
      if (sha(plain) !== item.byteSha256 || plain.length !== item.byteSize) throw Error("private-byte restore source mismatch");
      const target = `/tmp/d5o-private-objects/${item.filename}`;
      const write = spawnSync("docker", ["exec", "-i", container, "sh", "-c", "cat > \"$1\"", "sh", target],
        { input: plain, maxBuffer: 1024 * 1024, timeout: 30000 });
      if (write.status !== 0) throw Error("isolated private-byte write failed");
      const readBack = spawnSync("docker", ["exec", container, "sha256sum", target], { encoding: "utf8" });
      if (readBack.status !== 0 || !readBack.stdout.startsWith(item.byteSha256 + " "))
        throw Error("isolated private-byte readback mismatch");
    } finally { plain.fill(0); }
  }
  const countsSql = "select (select count(*) from auth.users),(select count(*) from auth.identities),(select count(*) from supabase_migrations.schema_migrations)";
  const counts = spawnSync("docker", ["exec", container, "psql", "-U", "supabase_admin", "-d", "postgres", "-At", "-F", "|", "-c", countsSql], { encoding: "utf8" });
  if (counts.status !== 0) throw Error("restored Auth/ledger query failed");
  const [users, identities, ledger] = counts.stdout.trim().split("|").map(Number);
  if (users + identities !== manifest.authRecordCount || storage.objects !== manifest.storageObjectCount)
    throw Error("restored Auth or Storage count mismatch");
  console.log(JSON.stringify({ status: "RESTORE_PASS", checkpointId: manifest.checkpointId,
    authUsers: users, authIdentities: identities, ledgerRows: ledger, storageObjects: storage.objects,
    storageBytes: storage.totalBytes, objectBytesRestoredInIsolatedContainer: index.objects.length,
    recoverySeconds: Math.round((performance.now() - started) / 10) / 100,
    genuineGoTrueSignIn: "SEPARATE_TEST_REQUIRED" }));
}
