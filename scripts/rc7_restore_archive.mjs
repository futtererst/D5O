// Decrypt an RC7 pg_dump directly into a network-isolated local pg_restore.
// No plaintext database dump is written to disk.
import { createDecipheriv, createHash } from "node:crypto";
import { openSync, closeSync, readSync, statSync, createReadStream, readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { loadProtectedKey } from "./rc6_dpapi_key.mjs";
import { dirname } from "node:path";

const [mode, file] = process.argv.slice(2);
if (!["list", "schema", "data", "full-data"].includes(mode) || !file)
  throw Error("usage: rc7_restore_archive.mjs <list|schema|data|full-data> <encrypted archive>");
const container = process.env.D5O_RC7_CONTAINER || "d5o-rc7-historical-db";
if (!["d5o-rc7-historical-db", "d5o-rc7-recovery-db", "d5o-checkpoint-restore-db"].includes(container))
  throw Error("unexpected local restore container");
const inspect = spawnSync("docker", ["inspect", container], { encoding: "utf8", maxBuffer: 1024 * 1024 });
if (inspect.status !== 0) throw Error("isolated restore container missing");
const target = JSON.parse(inspect.stdout)[0];
if (target.HostConfig.NetworkMode !== "none" || Object.keys(target.HostConfig.PortBindings ?? {}).length
    || JSON.stringify(target.Config.Env ?? []).includes("fcawktdjoxvahhgvkebx"))
  throw Error("restore target is not isolated from production");
const size = statSync(file).size;
if (size < 36) throw Error("encrypted archive too small");
const fd = openSync(file, "r");
const header = Buffer.alloc(20);
const tag = Buffer.alloc(16);
try {
  readSync(fd, header, 0, 20, 0);
  readSync(fd, tag, 0, 16, size - 16);
} finally { closeSync(fd); }
if (!header.subarray(0, 8).equals(Buffer.from("D5ORC6A1")))
  throw Error("invalid RC7 encrypted archive");
const key = loadProtectedKey(dirname(file));
const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(8));
decipher.setAuthTag(tag);
const plainSha = createHash("sha256");
let plainBytes = 0;
const hashPass = new Transform({
  transform(chunk, encoding, callback) {
    plainSha.update(chunk);
    plainBytes += chunk.length;
    callback(null, chunk);
  }
});
// The local Supabase image owns provider event triggers as supabase_admin.
// Use its superuser only inside the network-isolated disposable container.
const args = ["exec", "-i", container, "pg_restore", "-U", "supabase_admin", "-d", "postgres"];
if (mode === "list") args.push("--list");
else {
  args.push("--exit-on-error", "--single-transaction");
  if (mode === "schema") args.push("--schema-only", "--clean", "--if-exists");
  if (mode === "data" || mode === "full-data") args.push("--data-only", "--disable-triggers");
}
const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
const childClosed = new Promise((resolve) => child.once("close", resolve));
let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => { if (stdout.length < 2_000_000) stdout += chunk.toString("utf8"); });
child.stderr.on("data", (chunk) => { if (stderr.length < 20_000) stderr += chunk.toString("utf8"); });
try {
  let streamError;
  try {
    await pipeline(createReadStream(file, { start: 20, end: size - 17 }), decipher, hashPass, child.stdin);
  } catch (error) { streamError = error; }
  const code = await childClosed;
  if (code !== 0 || streamError) {
    const cause = /role .* does not exist/i.test(stderr) ? "MISSING_LOCAL_ROLE" :
      /extension .* is not available/i.test(stderr) ? "MISSING_LOCAL_EXTENSION" :
      /already exists/i.test(stderr) ? "LOCAL_OBJECT_CONFLICT" :
      /foreign key constraint/i.test(stderr) ? "LOCAL_FK_ORDER" :
      /permission denied/i.test(stderr) ? "LOCAL_PERMISSION" : "OTHER";
    const diagnostic = (stderr.split(/\r?\n/).find((line) => /error:|ERROR:/i.test(line)) ?? "")
      .replace(/'[^']*'/g, "'[redacted]'").slice(0, 280);
    throw Error(`local_pg_restore_failed:exit=${code},cause=${cause},diagnostic=${diagnostic}`);
  }
  console.log(JSON.stringify({ mode, container, networkMode: "none", plainBytes,
    plainSha256: plainSha.digest("hex"), tocLines: mode === "list" ? stdout.split(/\r?\n/).length : undefined,
    restored: mode !== "list" }));
} finally {
  key.fill(0);
}
