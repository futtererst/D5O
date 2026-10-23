import "server-only";

import { getBillingV2PersistenceMode } from "../billing-v2/persistence-mode";
import { getCloseoutFinalBillingPersistenceMode } from "../closeout-final-billing/persistence-mode";
import { getDataSourceMode } from "../data/data-source";
import { getEvidenceStoreMode } from "../evidence/evidence-store";
import { getFieldIssuePersistenceMode } from "../field-issue-escalation/persistence-mode";
import { getAuthMode } from "../auth/auth-mode";
import { getRuntimeMode } from "./runtime-mode";

export type ProductionReadinessIssue = {
  code: string;
  severity: "blocker" | "warning";
  message: string;
};

export type ProductionReadinessResult = {
  ok: boolean;
  runtimeMode: string;
  authMode: string;
  dataSource: string;
  billingPersistence: string;
  fieldIssuePersistence: string;
  closeoutPersistence: string;
  evidenceMode: string;
  scannerMode: string;
  issues: ProductionReadinessIssue[];
};

export function getProductionReadiness(): ProductionReadinessResult {
  const runtimeMode = getRuntimeMode();
  const authMode = getAuthMode();
  const dataSource = getDataSourceMode();
  const billingPersistence = safeValue(() => getBillingV2PersistenceMode(), "unresolved");
  const fieldIssuePersistence = safeValue(() => getFieldIssuePersistenceMode(), "unresolved");
  const closeoutPersistence = safeValue(() => getCloseoutFinalBillingPersistenceMode(), "unresolved");
  const evidenceMode = getEvidenceStoreMode();
  const scannerMode = getScannerMode();
  const issues: ProductionReadinessIssue[] = [];

  requireEqual(issues, "runtime_mode", runtimeMode, "production", "Production runtime requires RYBEXOS_RUNTIME_MODE=production.");
  requireEqual(issues, "auth_mode", authMode, "supabase", "Production runtime requires RYBEXOS_AUTH_MODE=supabase.");
  requireEqual(issues, "data_source", dataSource, "database", "Production runtime requires RYBEXOS_DATA_SOURCE=database.");
  requireEqual(issues, "billing_persistence", billingPersistence, "database", "Production Billing V2 requires database persistence.");
  requireEqual(issues, "field_issue_persistence", fieldIssuePersistence, "database", "Production Field Issue requires database persistence.");
  requireEqual(issues, "closeout_persistence", closeoutPersistence, "database", "Production Closeout requires database persistence.");
  requireEqual(issues, "evidence_mode", evidenceMode, "database", "Production evidence requires database evidence custody.");

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    issues.push(blocker("supabase_url", "NEXT_PUBLIC_SUPABASE_URL is required."));
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY && !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    issues.push(blocker("supabase_publishable_key", "A Supabase publishable or anon key is required."));
  }

  if (!process.env.SUPABASE_SECRET_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    issues.push(blocker("supabase_server_key", "A server-side Supabase key is required for controlled server operations."));
  }

  // scanner.ts currently instantiates a scanner only for local_service.
  // Other declared modes return scanner_unavailable and cannot qualify evidence.
  if (scannerMode !== "local_service") {
    issues.push(blocker("scanner_mode", "Production evidence scanning requires an implemented scanner adapter."));
  }

  if (scannerMode === "local_service" && !process.env.RYBEXOS_SCANNER_URL) {
    issues.push(blocker("scanner_url", "RYBEXOS_SCANNER_URL is required for local_service scanner mode."));
  }

  return {
    ok: issues.filter((issue) => issue.severity === "blocker").length === 0,
    runtimeMode,
    authMode,
    dataSource,
    billingPersistence,
    fieldIssuePersistence,
    closeoutPersistence,
    evidenceMode,
    scannerMode,
    issues
  };
}

export function assertProductionReadiness() {
  const result = getProductionReadiness();

  if (!result.ok) {
    throw new Error(`Production readiness failed: ${result.issues.map((issue) => issue.code).join(", ")}`);
  }

  return result;
}

export function getScannerMode() {
  const configured = process.env.RYBEXOS_SCANNER_MODE;
  if (configured === "local_service" || configured === "external" || configured === "unavailable" || configured === "disabled") {
    return configured;
  }
  return "not_configured";
}

function requireEqual(issues: ProductionReadinessIssue[], code: string, actual: string, expected: string, message: string) {
  if (actual !== expected) {
    issues.push(blocker(code, `${message} Current value is ${actual || "unset"}.`));
  }
}

function blocker(code: string, message: string): ProductionReadinessIssue {
  return { code, severity: "blocker", message };
}

function safeValue(fn: () => string, fallback: string) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
