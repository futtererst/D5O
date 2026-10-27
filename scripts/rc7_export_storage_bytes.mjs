// GET-only private Storage export. Object bytes and association index are
// encrypted at rest; no key, path or protected content is printed.
import { createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { loadProtectedKey } from "./rc6_dpapi_key.mjs";

const [protectedDir, keyFile] = process.argv.slice(2);
if (!protectedDir || !keyFile) throw Error("provide protected directory and restricted service-key file");
const outDir = realpathSync(protectedDir);
const base = "https://fcawktdjoxvahhgvkebx.supabase.co";
const keyLines = readFileSync(realpathSync(keyFile), "utf8").trim().split(/\r?\n/);
if (keyLines.length !== 1 || !keyLines[0] || keyLines[0].length < 20)
  throw Error("restricted service-key file must contain exactly one key");
const apiKey = keyLines[0];
const key = loadProtectedKey(outDir);
function decryptSmall(path) {
  const data = readFileSync(path);
  if (data.length < 36 || data.subarray(0, 8).toString() !== "D5ORC6A1")
    throw Error("invalid encrypted Storage metadata");
  const decipher = createDecipheriv("aes-256-gcm", key, data.subarray(8, 20));
  decipher.setAuthTag(data.subarray(-16));
  return Buffer.concat([decipher.update(data.subarray(20, -16)), decipher.final()]);
}
function encryptBuffer(path, data) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const encrypted = Buffer.concat([
    Buffer.from("D5ORC6A1"), nonce, cipher.update(data), cipher.final(), cipher.getAuthTag()
  ]);
  writeFileSync(path, encrypted, { flag: "wx", mode: 0o600 });
  return createHash("sha256").update(encrypted).digest("hex");
}
const metadata = decryptSmall(join(outDir, "rc7-storage-before.jsonl.aesgcm"))
  .toString("utf8").trim().split(/\r?\n/).map((line) => JSON.parse(line));
if (metadata.length !== 23 || metadata.some((r) => r.is_delete_marker || r.is_versioned))
  throw Error("unexpected Storage object inventory shape");
const bytesDir = join(outDir, "objects");
if (existsSync(bytesDir)) throw Error("protected object directory already exists");
mkdirSync(bytesDir, { mode: 0o700 });
const index = [];
let totalBytes = 0;
let sizeMismatches = 0;
try {
  for (const row of metadata) {
    const bucket = String(row.bucket_id);
    const name = String(row.name);
    const path = [bucket, ...name.split("/")].map(encodeURIComponent).join("/");
    const url = `${base}/storage/v1/object/authenticated/${path}`;
    const headers = { apikey: apiKey, "User-Agent": "D5O-RC7-Authorized-Local-Copy" };
    if (!apiKey.startsWith("sb_secret_")) headers.Authorization = `Bearer ${apiKey}`;
    const response = await fetch(url, { method: "GET", headers, redirect: "error",
      signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw Error(`storage_get_failed:status=${response.status}`);
    const content = Buffer.from(await response.arrayBuffer());
    const expectedSize = Number(row.metadata?.size);
    if (Number.isFinite(expectedSize) && expectedSize !== content.length) sizeMismatches++;
    const identity = `${bucket}\0${name}\0${row.id}`;
    const filename = createHash("sha256").update(identity).digest("hex") + ".blob.aesgcm";
    const encryptedSha256 = encryptBuffer(join(bytesDir, filename), content);
    index.push({
      id: row.id, bucket_id: bucket, name, owner: row.owner, owner_id: row.owner_id,
      version: row.version, metadataUpdatedAt: row.updated_at,
      expectedSize, byteSize: content.length,
      byteSha256: createHash("sha256").update(content).digest("hex"),
      encryptedSha256, filename
    });
    content.fill(0);
    totalBytes += index.at(-1).byteSize;
  }
  const indexBytes = Buffer.from(JSON.stringify({ project: "fcawktdjoxvahhgvkebx",
    capturedAtUtc: new Date().toISOString(), objects: index }, null, 2));
  const indexHash = encryptBuffer(join(outDir, "rc7-storage-byte-index.json.aesgcm"), indexBytes);
  indexBytes.fill(0);
  console.log(JSON.stringify({ complete: true, objectCount: index.length, totalBytes,
    sizeMismatches, encryptedIndexSha256: indexHash, protectedDirectory: outDir }));
} finally {
  key.fill(0);
}
