import "server-only";

import { getScannerMode } from "@/lib/d5o/security/production-config";
import { LocalServiceEvidenceScanner } from "./local-scanner";
import type { EvidenceScanInput, EvidenceScanResult, EvidenceScanner } from "./types";

class UnavailableScanner implements EvidenceScanner {
  async scan(): Promise<EvidenceScanResult> {
    return {
      status: "scanner_unavailable",
      scanner: "unavailable",
      detail: "Evidence scanner is not configured.",
      scannedAt: new Date().toISOString()
    };
  }
}

export function getEvidenceScanner(): EvidenceScanner {
  const mode = getScannerMode();

  if (mode === "local_service" && process.env.RYBEXOS_SCANNER_URL) {
    return new LocalServiceEvidenceScanner(process.env.RYBEXOS_SCANNER_URL, undefined,
      process.env.RYBEXOS_SCANNER_TOKEN);
  }

  return new UnavailableScanner();
}

export async function scanEvidence(input: EvidenceScanInput): Promise<EvidenceScanResult> {
  return getEvidenceScanner().scan(input);
}

export function scanResultSatisfiesProductionEvidence(result: EvidenceScanResult) {
  return result.status === "clean";
}
