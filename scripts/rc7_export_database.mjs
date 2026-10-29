// Read-only pg_dump from production into an AES-256-GCM encrypted local artifact.
// No URI or plaintext dump is written to the repository or printed.
import { createHash, createCipheriv, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { spawn } from "node:child_process";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createProtectedKey, loadProtectedKey } from "./rc6_dpapi_key.mjs";

const [uriFile, protectedDir, mode = "selected-data"] = process.argv.slice(2);
if (!uriFile || !protectedDir) throw Error("provide URI file and protected directory");
if (!["selected-data", "schema-only", "full-data"].includes(mode)) throw Error("invalid export mode");
const uriPath = realpathSync(uriFile);
const outDir = realpathSync(protectedDir);
const lines = readFileSync(uriPath, "utf8").trim().split(/\r?\n/);
if (lines.length !== 1) throw Error("URI must be one line");
const url = new URL(lines[0]);
if (!url.hostname.endsWith(".pooler.supabase.com") || url.port !== "5432"
    || decodeURIComponent(url.username) !== "postgres.fcawktdjoxvahhgvkebx"
    || url.pathname !== "/postgres" || url.searchParams.get("sslmode") !== "require"
    || !url.password) throw Error("unauthorized URI identity or TLS setting");
const outputPath = join(outDir, mode === "schema-only" ? "rc7-schema.dump.aesgcm" :
  mode === "full-data" ? "d5o-full-database.dump.aesgcm" : "rc7-database.dump.aesgcm");
if (existsSync(outputPath)) throw Error("protected database artifact already exists");

const key = existsSync(join(outDir, "rc6-key.dpapi")) ? loadProtectedKey(outDir) : createProtectedKey(outDir);
const nonce = randomBytes(12);
const cipher = createCipheriv("aes-256-gcm", key, nonce);
const sha = createHash("sha256");
let plainBytes = 0;
const hashPass = new Transform({
  transform(chunk, encoding, callback) {
    sha.update(chunk);
    plainBytes += chunk.length;
    callback(null, chunk);
  }
});
const mount = `type=bind,source=${uriPath},target=/run/secret/postgres-url.txt,readonly`;
const pgDumpArgs = mode === "schema-only" ? "--schema-only" : mode === "full-data" ?
  "--schema=auth --schema=public --schema=d5o_hosted --schema=storage --schema=supabase_migrations --exclude-table-data=auth.instances --exclude-table-data=auth.custom_oauth_providers --exclude-table-data=auth.saml_providers --exclude-table-data=auth.oauth_clients --exclude-table-data=auth.scim_tokens" :
  "--schema=public --schema=d5o_hosted --schema=storage --schema=supabase_migrations";
const shell = `uri="$(cat /run/secret/postgres-url.txt)"; export PGOPTIONS='-c default_transaction_read_only=on'; pg_dump --no-password --format=custom --compress=6 ${pgDumpArgs} --dbname="$uri"`;
const args = ["run", "--rm", "--pull=never", "--read-only", "--tmpfs", "/tmp", "--network", "bridge",
  "--mount", mount, "postgres:17-alpine", "sh", "-eu", "-c", shell];
const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
// Register completion before consuming stdout: pg_dump can exit while the
// encrypted stream is still being flushed, before a later close listener.
const childClose = new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("close", resolve);
});
let stderr = "";
child.stderr.on("data", (chunk) => { if (stderr.length < 10000) stderr += chunk.toString("utf8"); });
const output = createWriteStream(outputPath, { flags: "wx", mode: 0o600 });
output.write(Buffer.concat([Buffer.from("D5ORC6A1"), nonce]));
try {
  await pipeline(child.stdout, hashPass, cipher, output, { end: false });
  output.end(cipher.getAuthTag());
  await new Promise((resolve, reject) => {
    output.once("finish", resolve);
    output.once("error", reject);
  });
  const code = await childClose;
  if (code !== 0) throw Error("pg_dump_failed:exit=" + code);
  const encrypted = createReadStream(outputPath);
  const encryptedHash = createHash("sha256");
  for await (const chunk of encrypted) encryptedHash.update(chunk);
  console.log(JSON.stringify({
    exported: true, mode,
    schemas: mode === "schema-only" ? "ALL_SCHEMAS_STRUCTURE_ONLY" : mode === "full-data" ? ["auth", "public", "d5o_hosted", "storage", "supabase_migrations"] : ["public", "d5o_hosted", "storage", "supabase_migrations"],
    authSensitiveTableDataExcluded: mode !== "full-data", providerConfigurationSecretsExcluded: true,
    vaultDataExcluded: true, credentialFileName: basename(uriPath),
    plainBytes, plainSha256: sha.digest("hex"),
    encryptedBytes: statSync(outputPath).size, encryptedSha256: encryptedHash.digest("hex"),
    localArtifact: outputPath
  }));
} catch (error) {
  try { rmSync(outputPath, { force: true }); } catch { /* report original failure */ }
  throw error;
} finally {
  key.fill(0);
}
