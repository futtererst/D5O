import "server-only";

import { createHash } from "node:crypto";
import { scanEvidence } from "@/lib/d5o/evidence/scanner/scanner";
import type { EvidenceScanInput } from "@/lib/d5o/evidence/scanner/types";

/** Reject before private Storage writes or business receipt registration. */
export async function scanHostedUpload(input: Omit<EvidenceScanInput, "sizeBytes" | "checksumSha256">): Promise<null | {
  error: "unsafe_upload" | "evidence_scanner_unavailable"; status: 422 | 503
}> {
  const result = await scanEvidence({ ...input, sizeBytes: input.bytes.byteLength,
    checksumSha256: createHash("sha256").update(input.bytes).digest("hex") });
  if (result.status === "clean") return null;
  return result.status === "infected"
    ? { error: "unsafe_upload", status: 422 }
    : { error: "evidence_scanner_unavailable", status: 503 };
}
