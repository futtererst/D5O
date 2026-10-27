// Keep the RC6 AES key wrapped by Windows DPAPI under the current user.
// This module never prints key material.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const keyFile = (dir) => join(dir, "rc6-key.dpapi");
const wrap = "$s=[Console]::In.ReadToEnd().Trim() | ConvertTo-SecureString -AsPlainText -Force; $s | ConvertFrom-SecureString";
const unwrap = "$s=[Console]::In.ReadToEnd().Trim() | ConvertTo-SecureString; $p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try {[Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p))} finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)}";
function powershell(command, input) {
  const r = spawnSync("pwsh.exe", ["-NoProfile", "-NonInteractive", "-Command", command],
    { input, encoding: "utf8", maxBuffer: 16 * 1024, timeout: 10000 });
  if (r.status !== 0) throw Error("DPAPI key operation failed");
  return r.stdout.trim();
}
export function createProtectedKey(dir) {
  if (existsSync(keyFile(dir))) throw Error("RC6 key already exists");
  const key = randomBytes(32);
  try {
    const protectedText = powershell(wrap, key.toString("hex"));
    if (!protectedText) throw Error("DPAPI returned no protected key");
    writeFileSync(keyFile(dir), protectedText + "\n", { flag: "wx", mode: 0o600 });
    return Buffer.from(key);
  } finally {
    key.fill(0);
  }
}
export function loadProtectedKey(dir) {
  const protectedText = readFileSync(keyFile(dir), "utf8");
  const hex = powershell(unwrap, protectedText);
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw Error("invalid unwrapped RC6 key");
  return Buffer.from(hex, "hex");
}
