// Verify AES-256-GCM authentication and plaintext hash without writing plaintext.
import { createDecipheriv, createHash } from "node:crypto";
import { createReadStream, openSync, closeSync, readSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { Writable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { loadProtectedKey } from "./rc6_dpapi_key.mjs";

const path = process.argv[2];
if (!path) throw Error("provide encrypted artifact path");
const size = statSync(path).size;
if (size < 36) throw Error("encrypted artifact too small");
const fd = openSync(path, "r");
const header = Buffer.alloc(20);
const tag = Buffer.alloc(16);
try { readSync(fd, header, 0, 20, 0); readSync(fd, tag, 0, 16, size - 16); }
finally { closeSync(fd); }
if (!header.subarray(0, 8).equals(Buffer.from("D5ORC6A1")))
  throw Error("invalid encrypted artifact header");
const key = loadProtectedKey(dirname(path).endsWith("objects") ? dirname(dirname(path)) : dirname(path));
const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(8));
decipher.setAuthTag(tag);
const hash = createHash("sha256");
let plainBytes = 0;
const pass = new Transform({
  transform(chunk, encoding, callback) {
    hash.update(chunk);
    plainBytes += chunk.length;
    callback(null, chunk);
  }
});
try {
  await pipeline(createReadStream(path, { start: 20, end: size - 17 }), decipher, pass,
    new Writable({ write(chunk, encoding, callback) { callback(); } }));
  console.log(JSON.stringify({ authenticated: true, encryptedBytes: size,
    plainBytes, plainSha256: hash.digest("hex") }));
} finally { key.fill(0); }
