import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { connect } from "node:net";

const port = Number(process.env.PORT ?? 8080);
const clamHost = process.env.CLAMD_HOST ?? "clamav";
const clamPort = Number(process.env.CLAMD_PORT ?? 3310);
const token = process.env.RYBEXOS_SCANNER_TOKEN ?? "";
const maxBytes = 20_000_000;
if (token.length < 32) throw new Error("scanner_token_required");

function authorized(header) {
  const supplied = typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7) : "";
  const left = Buffer.from(supplied), right = Buffer.from(token);
  return left.length === right.length && timingSafeEqual(left, right);
}

function reply(response, status, body) {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > maxBytes) throw new Error("too_large");
    chunks.push(chunk);
  }
  if (length === 0) throw new Error("empty");
  return Buffer.concat(chunks);
}

function scan(bytes) {
  return new Promise((resolve, reject) => {
    const socket = connect(clamPort, clamHost);
    let output = "", finished = false;
    const done = (error, value) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      error ? reject(error) : resolve(value);
    };
    socket.setTimeout(25_000, () => done(new Error("clamd_timeout")));
    socket.on("error", (error) => done(error));
    socket.on("data", (chunk) => {
      output += chunk.toString("utf8");
      if (output.length > 4096) return done(new Error("clamd_reply_too_large"));
      if (output.includes("\0") || output.includes("\n")) {
        if (/^stream: OK[\0\n]/.test(output)) done(null, "clean");
        else if (/^stream: .+ FOUND[\0\n]/.test(output)) done(null, "infected");
        else done(new Error("clamd_scan_failed"));
      }
    });
    socket.on("connect", () => {
      socket.write("zINSTREAM\0");
      for (let offset = 0; offset < bytes.length; offset += 64 * 1024) {
        const chunk = bytes.subarray(offset, offset + 64 * 1024);
        const length = Buffer.allocUnsafe(4);
        length.writeUInt32BE(chunk.length);
        socket.write(length);
        socket.write(chunk);
      }
      socket.write(Buffer.alloc(4));
    });
  });
}

function ping() {
  return new Promise((resolve, reject) => {
    const socket = connect(clamPort, clamHost);
    let finished = false;
    const done = (error) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      error ? reject(error) : resolve();
    };
    socket.setTimeout(2000, () => done(new Error("clamd_timeout")));
    socket.on("error", done);
    socket.on("connect", () => socket.write("zPING\0"));
    socket.on("data", (chunk) => chunk.toString("utf8").startsWith("PONG")
      ? done() : done(new Error("clamd_unhealthy")));
  });
}

createServer(async (request, response) => {
  if (request.url !== "/scan" && request.url !== "/health") return reply(response, 404, { error: "not_found" });
  if (!authorized(request.headers.authorization)) return reply(response, 401, { error: "unauthorized" });
  if (request.method === "GET" && request.url === "/health") {
    try {
      await ping();
      return reply(response, 200, { status: "ready" });
    }
    catch { return reply(response, 503, { error: "scanner_unavailable" }); }
  }
  if (request.method !== "POST" || request.url !== "/scan") return reply(response, 405, { error: "method_not_allowed" });
  if (request.headers["content-type"] !== "application/octet-stream") return reply(response, 415, { error: "unsupported_media_type" });
  if (Number(request.headers["content-length"] ?? 0) > maxBytes) return reply(response, 413, { error: "too_large" });
  let bytes;
  try { bytes = await readBody(request); }
  catch (error) { return reply(response, error.message === "too_large" ? 413 : 400, { error: "invalid_body" }); }
  const checksum = createHash("sha256").update(bytes).digest("hex");
  if (request.headers["x-rybexos-checksum"] !== checksum) return reply(response, 400, { error: "checksum_mismatch" });
  try { return reply(response, 200, { status: await scan(bytes) }); }
  catch { return reply(response, 503, { error: "scanner_unavailable" }); }
}).listen(port, "0.0.0.0");
