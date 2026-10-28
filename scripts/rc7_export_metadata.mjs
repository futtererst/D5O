// Encrypted, read-only export of selected Auth relationships or Storage metadata.
// Credential-bearing Auth columns are deliberately omitted.
import { createHash, createCipheriv, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { loadProtectedKey } from "./rc6_dpapi_key.mjs";

const [kind, uriFile, protectedDir, suffix = ""] = process.argv.slice(2);
if (!["auth", "storage", "boundary"].includes(kind) || !uriFile || !protectedDir || !/^[a-z0-9-]*$/.test(suffix))
  throw Error("usage: rc7_export_metadata.mjs <auth|storage|boundary> <URI file> <protected dir> [suffix]");
const uriPath = realpathSync(uriFile);
const outDir = realpathSync(protectedDir);
const url = new URL(readFileSync(uriPath, "utf8").trim());
if (!url.hostname.endsWith(".pooler.supabase.com")
    || decodeURIComponent(url.username) !== "postgres.fcawktdjoxvahhgvkebx"
    || url.port !== "5432" || url.searchParams.get("sslmode") !== "require")
  throw Error("unauthorized connection identity or TLS setting");
const outputPath = join(outDir, `rc7-${kind}${suffix}.jsonl.aesgcm`);
if (existsSync(outputPath)) throw Error("protected metadata artifact already exists");

const authSql = `select j::text from (
  select 1 as ordinal, id::text as item_id,
    jsonb_build_object('kind','user','id',id,'instance_id',instance_id,
      'aud',aud,'role',role,'email',email,'phone',phone,
      'email_confirmed_at',email_confirmed_at,'confirmed_at',confirmed_at,
      'last_sign_in_at',last_sign_in_at,'raw_app_meta_data',raw_app_meta_data,
      'is_sso_user',is_sso_user,'is_anonymous',is_anonymous,
      'created_at',created_at,'updated_at',updated_at,'deleted_at',deleted_at,
      'banned_until',banned_until) as j
  from auth.users
  union all
  select 2, id::text,
    jsonb_build_object('kind','identity','id',id,'user_id',user_id,
      'provider_id',provider_id,'provider',provider,'email',email,
      'created_at',created_at,'updated_at',updated_at,
      'last_sign_in_at',last_sign_in_at)
  from auth.identities
) q order by ordinal,item_id`;
const storageSql = `select jsonb_build_object('id',id,'bucket_id',bucket_id,
  'name',name,'owner',owner,'owner_id',owner_id,'created_at',created_at,
  'updated_at',updated_at,'metadata',metadata,'version',version,
  'is_delete_marker',is_delete_marker,'is_versioned',is_versioned)::text
  from storage.objects order by bucket_id,name,id`;
const boundarySql = `select jsonb_build_object(
  'ledger',(select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'|' order by version),'') ) from supabase_migrations.schema_migrations t),
  'auth_users',(select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'|' order by id),'') ) from auth.users t),
  'auth_identities',(select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'|' order by id),'') ) from auth.identities t),
  'storage_objects',(select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'|' order by id),'') ) from storage.objects t),
  'work_events',(select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'|' order by id),'') ) from d5o_hosted.work_events t),
  'work_receipts',(select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'|' order by workspace_id,command_id),'') ) from d5o_hosted.work_command_receipts t))::text`;
const sql = `begin transaction read only; ${kind === "auth" ? authSql : kind === "storage" ? storageSql : boundarySql}; commit;`;
const shell = `uri="$(cat /run/secret/postgres-url.txt)"; psql "$uri" -q -X -v ON_ERROR_STOP=1 -At -c "${sql}"`;
const mount = `type=bind,source=${uriPath},target=/run/secret/postgres-url.txt,readonly`;
const child = spawn("docker", ["run", "--rm", "--pull=never", "--read-only", "--tmpfs", "/tmp",
  "--network", "bridge", "--mount", mount, "postgres:17-alpine", "sh", "-eu", "-c", shell],
  { stdio: ["ignore", "pipe", "pipe"] });
let stderr = "";
child.stderr.on("data", (chunk) => { if (stderr.length < 10000) stderr += chunk.toString("utf8"); });
const key = loadProtectedKey(outDir);
const nonce = randomBytes(12);
const cipher = createCipheriv("aes-256-gcm", key, nonce);
const sha = createHash("sha256");
let plainBytes = 0;
let lineCount = 0;
const hashPass = new Transform({
  transform(chunk, encoding, callback) {
    sha.update(chunk);
    plainBytes += chunk.length;
    lineCount += chunk.toString("utf8").split("\n").length - 1;
    callback(null, chunk);
  }
});
const output = createWriteStream(outputPath, { flags: "wx", mode: 0o600 });
output.write(Buffer.concat([Buffer.from("D5ORC6A1"), nonce]));
try {
  await pipeline(child.stdout, hashPass, cipher, output, { end: false });
  output.end(cipher.getAuthTag());
  await new Promise((resolve, reject) => { output.once("finish", resolve); output.once("error", reject); });
  const code = await new Promise((resolve) => child.once("close", resolve));
  if (code !== 0) throw Error("metadata_export_failed:exit=" + code);
  const encryptedHash = createHash("sha256");
  for await (const chunk of createReadStream(outputPath)) encryptedHash.update(chunk);
  console.log(JSON.stringify({ exported: true, kind, suffix, lineCount, plainBytes,
    plainSha256: sha.digest("hex"), encryptedBytes: statSync(outputPath).size,
    encryptedSha256: encryptedHash.digest("hex"), localArtifact: outputPath }));
} catch (error) {
  try { rmSync(outputPath, { force: true }); } catch { /* report original error */ }
  throw error;
} finally {
  key.fill(0);
}
