import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(file, imports, extras = {}) {
  const compiled = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022
  } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: (name) => {
    if (!(name in imports)) throw Error(`unexpected_import:${name}`);
    return imports[name];
  }, Buffer, Date, Error, AbortController, setTimeout, clearTimeout, ...extras }, { filename: file });
  return exports;
}

const bytes = Buffer.from("fictional clean evidence");
const input = { evidenceId: "fictional-upload", filename: "fictional.pdf",
  mimeType: "application/pdf", bytes };
for (const [scanStatus, expected] of [
  ["clean", null], ["infected", { error: "unsafe_upload", status: 422 }],
  ["scanner_unavailable", { error: "evidence_scanner_unavailable", status: 503 }],
  ["scan_failed", { error: "evidence_scanner_unavailable", status: 503 }]
]) {
  const scan = load("lib/d5o/hosted/scan-upload.ts", {
    "server-only": {}, "node:crypto": { createHash },
    "@/lib/d5o/evidence/scanner/scanner": { scanEvidence: async (seen) => {
      assert.equal(seen.checksumSha256, createHash("sha256").update(bytes).digest("hex"));
      assert.equal(seen.sizeBytes, bytes.length);
      return { status: scanStatus };
    } }
  });
  assert.deepEqual(JSON.parse(JSON.stringify(await scan.scanHostedUpload(input))), expected);
}

const adapter = load("lib/d5o/evidence/scanner/local-scanner.ts", {
  "server-only": {}
}, { fetch: async (url, options) => {
  assert.equal(url, "https://scanner.example.invalid/scan");
  assert.equal(options.headers.authorization, "Bearer synthetic-test-token");
  assert.equal(options.headers["x-rybexos-checksum"], "fictional-digest");
  return { ok: true, json: async () => ({ status: "clean" }) };
} });
const result = await new adapter.LocalServiceEvidenceScanner(
  "https://scanner.example.invalid", 5000, "synthetic-test-token").scan({
    ...input, checksumSha256: "fictional-digest", sizeBytes: bytes.length
  });
assert.equal(result.status, "clean");
for (const [response, expected] of [
  [{ ok: true, json: async () => ({ status: "infected" }) }, "infected"],
  [{ ok: false, status: 503 }, "scan_failed"]
]) {
  const candidate = load("lib/d5o/evidence/scanner/local-scanner.ts", {
    "server-only": {}
  }, { fetch: async () => response });
  const scanned = await new candidate.LocalServiceEvidenceScanner(
    "https://scanner.example.invalid", 5000, "synthetic-test-token").scan({
      ...input, checksumSha256: "fictional-digest", sizeBytes: bytes.length
    });
  assert.equal(scanned.status, expected);
}
const unavailable = load("lib/d5o/evidence/scanner/local-scanner.ts", {
  "server-only": {}
}, { fetch: async () => { throw Error("synthetic outage"); } });
assert.equal((await new unavailable.LocalServiceEvidenceScanner(
  "https://scanner.example.invalid", 5000, "synthetic-test-token").scan({
    ...input, checksumSha256: "fictional-digest", sizeBytes: bytes.length
  })).status, "scanner_unavailable");

for (const path of ["design-document-evidence", "design-cost-evidence",
  "customer-decision-evidence", "graybar-document", "prototype-deploy-command",
  "worker-deploy"]) {
  const source = readFileSync(`app/api/d5o-hosted/${path}/route.ts`, "utf8");
  const guard = source.indexOf("await scanHostedUpload(");
  const storageWrite = source.indexOf(".upload(", guard);
  assert(guard > 0 && storageWrite > guard, `${path}: scan must precede Storage upload`);
}
console.log("PASS: hosted uploads reject infected and unavailable scans before all six Storage writes");
