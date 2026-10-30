import "server-only";

import { getProductionReadiness, type ProductionReadinessResult } from "./production-config";

export type SafeProductionReadiness = Omit<ProductionReadinessResult, "issues"> & {
  issues: Array<{
    code: string;
    severity: "blocker" | "warning";
    message: string;
  }>;
};

export function getSafeProductionReadiness(): SafeProductionReadiness {
  return getProductionReadiness();
}

export async function summarizeProductionReadiness() {
  const readiness = getSafeProductionReadiness();
  const issues = readiness.issues.map((issue) => issue.code);
  let ok = readiness.ok;
  if (ok && readiness.scope === "d5o_hosted") {
    try {
      const response = await fetch(`${process.env.RYBEXOS_SCANNER_URL!.replace(/\/$/, "")}/health`, {
        headers: { authorization: `Bearer ${process.env.RYBEXOS_SCANNER_TOKEN}` },
        cache: "no-store", signal: AbortSignal.timeout(5000)
      });
      if (!response.ok || (await response.json()).status !== "ready") throw new Error("scanner_not_ready");
    } catch {
      ok = false;
      issues.push("scanner_unavailable");
    }
  }

  return {
    ok,
    scope: readiness.scope,
    runtimeMode: readiness.runtimeMode,
    authMode: readiness.authMode,
    dataSource: readiness.dataSource,
    billingPersistence: readiness.billingPersistence,
    fieldIssuePersistence: readiness.fieldIssuePersistence,
    closeoutPersistence: readiness.closeoutPersistence,
    evidenceMode: readiness.evidenceMode,
    scannerMode: readiness.scannerMode,
    issueCodes: issues
  };
}
