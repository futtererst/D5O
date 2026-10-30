import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const base = process.env.SCANNER_SMOKE_URL ?? "http://127.0.0.1:8080";
const token = process.env.RYBEXOS_SCANNER_TOKEN;
assert(token, "RYBEXOS_SCANNER_TOKEN is required");

async function scan(bytes, authorization = `Bearer ${token}`) {
  const response = await fetch(`${base}/scan`, { method: "POST", headers: {
    authorization, "content-type": "application/octet-stream",
    "x-rybexos-checksum": createHash("sha256").update(bytes).digest("hex")
  }, body: bytes });
  return { http: response.status, body: await response.json() };
}

const clean = await scan(Buffer.from("D5O fictional safe evidence"));
assert.deepEqual(clean, { http: 200, body: { status: "clean" } });
const eicar = await scan(Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"));
assert.deepEqual(eicar, { http: 200, body: { status: "infected" } });
const denied = await scan(Buffer.from("D5O fictional safe evidence"), "Bearer wrong");
assert.deepEqual(denied, { http: 401, body: { error: "unauthorized" } });
console.log("GREEN_SCANNER_SMOKE_PASS clean infected unauthorized");
