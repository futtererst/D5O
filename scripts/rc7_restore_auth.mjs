// Restore non-secret Auth user/identity relationships into offline local DB.
import { createDecipheriv } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { loadProtectedKey } from "./rc6_dpapi_key.mjs";
const file = process.argv[2];
const container = process.env.D5O_RC7_CONTAINER || "d5o-rc7-historical-db";
if (!["d5o-rc7-historical-db", "d5o-rc7-recovery-db"].includes(container))
  throw Error("unexpected local restore container");
if (!file) throw Error("encrypted Auth export path required");
const check = spawnSync("docker", ["inspect", container], { encoding: "utf8" });
if (check.status !== 0) throw Error("restore container missing");
const target = JSON.parse(check.stdout)[0];
if (target.HostConfig.NetworkMode !== "none" || Object.keys(target.HostConfig.PortBindings ?? {}).length)
  throw Error("restore target has network access");
const encrypted = readFileSync(file);
if (!encrypted.subarray(0, 8).equals(Buffer.from("D5ORC6A1"))) throw Error("invalid artifact");
const key = loadProtectedKey(dirname(file));
let plain;
try {
  const decipher = createDecipheriv("aes-256-gcm", key, encrypted.subarray(8, 20));
  decipher.setAuthTag(encrypted.subarray(-16));
  plain = Buffer.concat([decipher.update(encrypted.subarray(20, -16)), decipher.final()]);
} finally { key.fill(0); }
const records = plain.toString("utf8").trim().split(/\r?\n/).map(JSON.parse);
plain.fill(0);
const users = records.filter((r) => r.kind === "user");
const identities = records.filter((r) => r.kind === "identity");
if (users.length !== 25 || identities.length !== 25) throw Error("Auth record count mismatch");
const fields = {
  user: ["id", "instance_id", "aud", "role", "email", "phone", "email_confirmed_at",
    "last_sign_in_at", "raw_app_meta_data", "is_sso_user", "is_anonymous",
    "created_at", "updated_at", "deleted_at", "banned_until"],
  identity: ["id", "user_id", "provider_id", "provider", "created_at", "updated_at", "last_sign_in_at"]
};
const sqlString = (s) => s == null ? "NULL" : "'" + String(s).replaceAll("'", "''") + "'";
const cast = (k, v) => {
  if (v == null) return "NULL";
  if (["id", "user_id", "instance_id"].includes(k)) return sqlString(v) + "::uuid";
  if (k.endsWith("_at") || k === "banned_until") return sqlString(v) + "::timestamptz";
  if (k === "raw_app_meta_data") return sqlString(JSON.stringify(v)) + "::jsonb";
  if (k === "is_sso_user" || k === "is_anonymous") return v ? "true" : "false";
  return sqlString(v);
};
const sql = ["begin;", ...users.map((r) => `insert into auth.users (${fields.user.join(",")}) values (${fields.user.map((k) => cast(k, r[k])).join(",")});`),
  ...identities.map((r) => `insert into auth.identities (${fields.identity.join(",")},identity_data) values (${fields.identity.map((k) => cast(k, r[k])).join(",")},'{}'::jsonb);`),
  "commit;"].join("\n");
const run = spawnSync("docker", ["exec", "-i", container, "psql", "-U", "supabase_admin", "-d", "postgres", "-q", "-X", "-v", "ON_ERROR_STOP=1"],
  { input: sql, encoding: "utf8", maxBuffer: 1024 * 1024 });
if (run.status !== 0) throw Error("local Auth relationship restore failed: " + (run.stderr.split(/\r?\n/).find((s) => /ERROR:/.test(s)) ?? "unknown").slice(0, 250));
console.log(JSON.stringify({ isolatedContainer: container, users: users.length,
  identities: identities.length, credentialColumnsRestored: false, identityDataSynthesized: true }));
