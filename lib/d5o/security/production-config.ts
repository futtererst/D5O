import "server-only";

import { getBillingV2PersistenceMode } from "../billing-v2/persistence-mode";
import { getCloseoutFinalBillingPersistenceMode } from "../closeout-final-billing/persistence-mode";
import { getDataSourceMode } from "../data/data-source";
import { getEvidenceStoreMode } from "../evidence/evidence-store";
import { getFieldIssuePersistenceMode } from "../field-issue-escalation/persistence-mode";
import { getAuthMode } from "../auth/auth-mode";
import { getRuntimeMode } from "./runtime-mode";
import { resolveD5OCommandRuntime } from "../auth/runtime-identity";

export type ProductionReadinessIssue = {
  code: string;
  severity: "blocker" | "warning";
  message: string;
};

export type ProductionReadinessResult = {
  ok: boolean;
  scope: "d5o_hosted" | "legacy_production";
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
  const hostedD5O = process.env.D5O_HOSTED_ENABLED === "1";
  const issues: ProductionReadinessIssue[] = [];

  requireEqual(issues, "runtime_mode", runtimeMode, "production", "Production runtime requires RYBEXOS_RUNTIME_MODE=production.");
  requireEqual(issues, "auth_mode", authMode, "supabase", "Production runtime requires RYBEXOS_AUTH_MODE=supabase.");
  requireEqual(issues, "data_source", dataSource, "database", "Production runtime requires RYBEXOS_DATA_SOURCE=database.");
  if (hostedD5O) {
    if (!resolveD5OCommandRuntime(process.env)) {
      issues.push(blocker("hosted_binding", "D5O hosted command target is not an approved production, staging or rehearsal binding."));
    }
    // These early-migration modules are blocked by the hosted proxy. Never
    // report their persistence as active merely because the D5O scope is ready.
    if (billingPersistence !== "database") issues.push(warning("legacy_billing_unavailable", "Legacy Billing V2 is unavailable in hosted D5O mode."));
    if (fieldIssuePersistence !== "database") issues.push(warning("legacy_field_issue_unavailable", "Legacy Field Issue is unavailable in hosted D5O mode."));
    if (closeoutPersistence !== "database") issues.push(warning("legacy_closeout_unavailable", "Legacy Closeout is unavailable in hosted D5O mode."));
  } else {
    requireEqual(issues, "billing_persistence", billingPersistence, "database", "Production Billing V2 requires database persistence.");
    requireEqual(issues, "field_issue_persistence", fieldIssuePersistence, "database", "Production Field Issue requires database persistence.");
    requireEqual(issues, "closeout_persistence", closeoutPersistence, "database", "Production Closeout requires database persistence.");
  }
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

  if (hostedD5O) {
    if (scannerMode !== "local_service")
      issues.push(blocker("hosted_scanner_mode", "Hosted evidence requires a configured clean-only scanner before upload."));
    if (!process.env.RYBEXOS_SCANNER_URL)
      issues.push(blocker("scanner_url", "RYBEXOS_SCANNER_URL is required for hosted evidence scanning."));
    else if (!/^https:\/\//i.test(process.env.RYBEXOS_SCANNER_URL))
      issues.push(blocker("scanner_transport", "Hosted scanner traffic must use HTTPS."));
    if (!process.env.RYBEXOS_SCANNER_TOKEN)
      issues.push(blocker("scanner_auth", "Hosted scanner requests require a protected service token."));
  } else {
    // Legacy evidence custody still requires an implemented scanner.
    if (scannerMode !== "local_service") {
      issues.push(blocker("scanner_mode", "Production evidence scanning requires an implemented scanner adapter."));
    }
    if (scannerMode === "local_service" && !process.env.RYBEXOS_SCANNER_URL) {
      issues.push(blocker("scanner_url", "RYBEXOS_SCANNER_URL is required for local_service scanner mode."));
    }
  }

  return {
    ok: issues.filter((issue) => issue.severity === "blocker").length === 0,
    scope: hostedD5O ? "d5o_hosted" : "legacy_production",
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

function warning(code: string, message: string): ProductionReadinessIssue {
  return { code, severity: "warning", message };
}

function safeValue(fn: () => string, fallback: string) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
