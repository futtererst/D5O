// Verify encrypted private bytes and their captured association index offline.
import { createDecipheriv, createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { loadProtectedKey } from "./rc6_dpapi_key.mjs";
const dir = realpathSync(process.argv[2]);
const container = process.env.D5O_RC7_CONTAINER || "d5o-rc7-historical-db";
if (!["d5o-rc7-historical-db", "d5o-rc7-recovery-db", "d5o-checkpoint-restore-db"].includes(container))
  throw Error("unexpected local restore container");
const key = loadProtectedKey(dir);
function decrypt(file) {
  const data = readFileSync(file);
  if (!data.subarray(0, 8).equals(Buffer.from("D5ORC6A1"))) throw Error("invalid encrypted object");
  const decipher = createDecipheriv("aes-256-gcm", key, data.subarray(8, 20));
  decipher.setAuthTag(data.subarray(-16));
  return Buffer.concat([decipher.update(data.subarray(20, -16)), decipher.final()]);
}
try {
  const index = JSON.parse(decrypt(join(dir, "rc7-storage-byte-index.json.aesgcm")).toString("utf8"));
  if (index.project !== "fcawktdjoxvahhgvkebx" || !index.objects.length)
    throw Error("Storage index identity mismatch");
  let total = 0;
  for (const row of index.objects) {
    const path = join(dir, "objects", row.filename);
    const encrypted = readFileSync(path);
    if (createHash("sha256").update(encrypted).digest("hex") !== row.encryptedSha256)
      throw Error("encrypted Storage hash mismatch");
    const bytes = decrypt(path);
    if (bytes.length !== row.byteSize ||
      createHash("sha256").update(bytes).digest("hex") !== row.byteSha256)
      throw Error("private Storage byte integrity mismatch");
    total += bytes.length;
    bytes.fill(0);
  }
  const inspect = spawnSync("docker", ["inspect", container], { encoding: "utf8" });
  if (inspect.status !== 0 || JSON.parse(inspect.stdout)[0].HostConfig.NetworkMode !== "none")
    throw Error("isolated database unavailable");
  const query = "select row_to_json(t)::text from (select id,bucket_id,name from storage.objects order by id) t";
  const db = spawnSync("docker", ["exec", container, "psql", "-U", "supabase_admin",
    "-d", "postgres", "-q", "-X", "-v", "ON_ERROR_STOP=1", "-At", "-c", query],
    { encoding: "utf8", maxBuffer: 1024 * 1024 });
  if (db.status !== 0) throw Error("local Storage metadata query failed");
  const actual = db.stdout.trim().split(/\r?\n/).map(JSON.parse);
  const keys = new Set(actual.map((r) => `${r.id}\0${r.bucket_id}\0${r.name}`));
  if (keys.size !== actual.length || keys.size !== index.objects.length ||
      index.objects.some((r) => !keys.has(`${r.id}\0${r.bucket_id}\0${r.name}`)))
    throw Error("private bytes and restored Storage associations differ");
  console.log(JSON.stringify({ verified: true, project: index.project,
    objects: index.objects.length, totalBytes: total, contentHashesMatched: true,
    restoredMetadataAssociationsMatched: true }));
} finally { key.fill(0); }
