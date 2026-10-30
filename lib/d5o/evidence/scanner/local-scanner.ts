import "server-only";

import type { EvidenceScanInput, EvidenceScanResult, EvidenceScanner } from "./types";

const defaultTimeoutMs = 5000;

export class LocalServiceEvidenceScanner implements EvidenceScanner {
  constructor(
    private readonly scannerUrl: string,
    private readonly timeoutMs = defaultTimeoutMs,
    private readonly scannerToken?: string
  ) {}

  async scan(input: EvidenceScanInput): Promise<EvidenceScanResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.scannerUrl.replace(/\/$/, "")}/scan`, {
        method: "POST",
        headers: {
          "content-type": "application/octet-stream",
          "x-rybexos-evidence-id": input.evidenceId,
          "x-rybexos-filename": input.filename,
          "x-rybexos-checksum": input.checksumSha256,
          "x-rybexos-correlation-id": input.correlationId ?? "",
          ...(this.scannerToken ? { authorization: `Bearer ${this.scannerToken}` } : {})
        },
        body: Buffer.from(input.bytes),
        cache: "no-store",
        signal: controller.signal
      });

      if (!response.ok) {
        return result("scan_failed", "local_scanner", `Scanner returned ${response.status}.`);
      }

      const body = await response.json().catch(() => ({}));
      const status = body.status === "clean" || body.status === "infected" ? body.status : "scan_failed";

      return result(status, "local_scanner", status === "clean" ? "Clean file accepted." : "Threat detected and evidence quarantined.");
    } catch {
      return result("scanner_unavailable", "local_scanner", "Scanner service unavailable.");
    } finally {
      clearTimeout(timeout);
    }
  }
}

function result(status: EvidenceScanResult["status"], scanner: string, detail: string): EvidenceScanResult {
  return {
    status,
    scanner,
    detail,
    scannedAt: new Date().toISOString()
  };
}
