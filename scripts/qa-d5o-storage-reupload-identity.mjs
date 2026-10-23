// Disposable Storage API probe. Never point this at shared or production Storage.
// It creates and removes only a random path under __recovery_probe__.
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const expectedTarget = "d5o_release_nonempty_restore_20261018";
const url = process.env.D5O_PROBE_URL;
const key = process.env.D5O_PROBE_SERVICE_ROLE_KEY;
const pdfPath = process.env.D5O_PROBE_PDF;
if (process.env.D5O_PROBE_CONFIRM_DISPOSABLE !== expectedTarget ||
    !url || !/^http:\/\/127\.0\.0\.1:\d+$/.test(url) || !key || !pdfPath) {
  throw new Error("Explicit disposable target, loopback URL, service key and synthetic PDF are required");
}

const bytes = await readFile(pdfPath);
if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-" ||
    !bytes.subarray(-32).toString("ascii").includes("%%EOF")) {
  throw new Error("The supplied synthetic source is not a PDF");
}
const checksum = createHash("sha256").update(bytes).digest("hex");
const path = `rybex/__recovery_probe__/${randomUUID()}.pdf`;
const bucket = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
  .storage.from("d5o-deploy-evidence");
let present = false;

async function uploadAndInspect() {
  const uploaded = await bucket.upload(path, bytes, { contentType: "application/pdf", upsert: false });
  if (uploaded.error) throw uploaded.error;
  present = true;
  const inspected = await bucket.info(path);
  if (inspected.error || !inspected.data?.id) throw inspected.error ?? new Error("Missing object identity");
  const downloaded = await bucket.download(path);
  if (downloaded.error || !downloaded.data) throw downloaded.error ?? new Error("Object bytes missing");
  const recovered = Buffer.from(await downloaded.data.arrayBuffer());
  if (recovered.length !== bytes.length ||
      createHash("sha256").update(recovered).digest("hex") !== checksum) {
    throw new Error("Downloaded bytes do not match the synthetic backup");
  }
  return { id: inspected.data.id,
    updatedAt: inspected.data.updatedAt ?? inspected.data.lastModified ?? null,
    size: inspected.data.size ?? null,
    contentType: inspected.data.contentType ?? null };
}

async function remove() {
  const result = await bucket.remove([path]);
  if (result.error) throw result.error;
  present = false;
}

try {
  const absent = await bucket.info(path);
  if (!absent.error) throw new Error("Random probe path unexpectedly exists");
  const first = await uploadAndInspect();
  await remove();
  const second = await uploadAndInspect();
  console.log(JSON.stringify({ target: expectedTarget, synthetic: true, path,
    checksumSha256: checksum, sizeBytes: bytes.length, first, second,
    sameObjectId: first.id === second.id,
    sameObjectTimestamp: first.updatedAt === second.updatedAt,
    wouldMatchOriginalIdGuard: first.id === second.id }, null, 2));
} finally {
  if (present) {
    try { await remove(); } catch (error) {
      console.error(`Probe cleanup requires attention at ${path}: ${error.message}`);
      process.exitCode = 2;
    }
  }
}
