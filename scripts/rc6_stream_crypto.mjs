// AES-256-GCM streaming wrapper for protected local RC6 artifacts.
// The key arrives through a short-lived environment variable and is never printed.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream, openSync, closeSync, readSync, statSync } from "node:fs";
import { pipeline } from "node:stream/promises";

const [mode, path] = process.argv.slice(2);
const keyHex = process.env.D5O_RC6_KEY_HEX;
if (!["encrypt", "decrypt"].includes(mode) || !path || !/^[0-9a-f]{64}$/i.test(keyHex ?? ""))
  throw Error("usage: node rc6_stream_crypto.mjs <encrypt|decrypt> <path>, with D5O_RC6_KEY_HEX");
const key = Buffer.from(keyHex, "hex");
const magic = Buffer.from("D5ORC6A1");
try {
  if (mode === "encrypt") {
    const nonce = randomBytes(12);
    const output = createWriteStream(path, { flags: "wx", mode: 0o600 });
    output.write(Buffer.concat([magic, nonce]));
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    await pipeline(process.stdin, cipher, output, { end: false });
    output.end(cipher.getAuthTag());
    await new Promise((resolve, reject) => {
      output.once("finish", resolve);
      output.once("error", reject);
    });
  } else {
    const size = statSync(path).size;
    if (size < 36) throw Error("encrypted_artifact_too_small");
    const fd = openSync(path, "r");
    const header = Buffer.alloc(20);
    const tag = Buffer.alloc(16);
    try {
      readSync(fd, header, 0, 20, 0);
      readSync(fd, tag, 0, 16, size - 16);
    } finally {
      closeSync(fd);
    }
    if (!header.subarray(0, 8).equals(magic)) throw Error("invalid_rc6_artifact_header");
    const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(8));
    decipher.setAuthTag(tag);
    await pipeline(createReadStream(path, { start: 20, end: size - 17 }), decipher, process.stdout);
  }
} finally {
  key.fill(0);
}
