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

export function summarizeProductionReadiness() {
  const readiness = getSafeProductionReadiness();

  return {
    ok: readiness.ok,
    scope: readiness.scope,
    runtimeMode: readiness.runtimeMode,
    authMode: readiness.authMode,
    dataSource: readiness.dataSource,
    billingPersistence: readiness.billingPersistence,
    fieldIssuePersistence: readiness.fieldIssuePersistence,
    closeoutPersistence: readiness.closeoutPersistence,
    evidenceMode: readiness.evidenceMode,
    scannerMode: readiness.scannerMode,
    issueCodes: readiness.issues.map((issue) => issue.code)
  };
}
