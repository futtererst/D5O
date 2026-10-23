import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const requiredFiles = [
  "docs/rls-storage-security-foundation.md",
  "supabase/migrations/0004_rls_security_scaffold.sql",
  "supabase/storage/rybexos-evidence-bucket.sql",
  "lib/d5o/security/rls-readiness.ts",
  "app/actions/workflow-transactions.ts",
  "app/actions/evidence-uploads.ts"
];

for (const file of requiredFiles) {
  if (!existsSync(path.join(root, file))) {
    failures.push(`Missing security foundation file: ${file}`);
  }
}

const rlsSql = source("supabase/migrations/0004_rls_security_scaffold.sql");
const storageSql = source("supabase/storage/rybexos-evidence-bucket.sql");
const readinessSource = source("lib/d5o/security/rls-readiness.ts");
const adminSource = source("app/admin/page.tsx");
const workflowAction = source("app/actions/workflow-transactions.ts");
const evidenceAction = source("app/actions/evidence-uploads.ts");

for (const helper of [
  "auth_user_profile_id",
  "auth_user_workspace_ids",
  "auth_user_role_keys",
  "is_workspace_member",
  "has_workspace_permission",
  "can_access_project",
  "can_access_workflow_instance",
  "can_access_evidence_requirement",
  "security_scaffold_status"
]) {
  assertIncludes(rlsSql, helper, `RLS scaffold missing helper function: ${helper}`);
}

for (const table of [
  "organizations",
  "workspaces",
  "user_profiles",
  "workspace_memberships",
  "projects",
  "opportunities",
  "workflow_instances",
  "workflow_transactions",
  "workflow_evidence_requirements",
  "attachments",
  "entity_attachments",
  "audit_events",
  "status_history"
]) {
  assertIncludes(rlsSql, table, `RLS scaffold missing table family: ${table}`);
}

if (/public\s*=\s*true/i.test(storageSql) || /public\s*,\s*true/i.test(storageSql)) {
  failures.push("Storage scaffold appears to make the bucket public.");
}

assertIncludes(storageSql, "public = false", "Storage scaffold must keep rybexos-evidence private.");
assertIncludes(storageSql, "No public read policy", "Storage scaffold must explicitly reject public read.");
assertIncludes(storageSql, "signed URLs", "Storage scaffold must mention future signed URL strategy.");

assertIncludes(readinessSource, "getRlsReadiness", "Security readiness helper missing getRlsReadiness.");
assertIncludes(readinessSource, "getStorageSecurityReadiness", "Security readiness helper missing getStorageSecurityReadiness.");
assertIncludes(readinessSource, "productionSecurityStatus", "Security readiness helper must report production status.");
assertIncludes(readinessSource, "not_ready", "Security readiness must not claim production readiness.");

assertStartsWithUseServer(workflowAction, "app/actions/workflow-transactions.ts");
assertStartsWithUseServer(evidenceAction, "app/actions/evidence-uploads.ts");
assertIncludes(evidenceAction, "uploadSupabaseStorageObject", "Evidence upload action should use the server-side Storage helper.");
assertIncludes(workflowAction, "persistWorkflowTransaction", "Workflow transaction writes should use the server-side write path.");

assertIncludes(adminSource, "Security / RLS Foundation", "Admin page missing Security / RLS readiness section.");
assertIncludes(adminSource, "Service key boundary", "Admin page missing service key boundary warning.");

for (const result of scanSourceFiles()) {
  const content = readFileSync(result.absolutePath, "utf8");
  const normalized = result.relativePath.replaceAll("\\", "/");

  if (content.includes("SUPABASE_SECRET_KEY") || content.includes("SUPABASE_SERVICE_ROLE_KEY")) {
    const isClientComponent =
      /\.(tsx|ts)$/.test(normalized) &&
      (normalized.startsWith("components/") || normalized.startsWith("app/")) &&
      !normalized.startsWith("app/actions/") &&
      !normalized.startsWith("app/api/") &&
      (content.includes('"use client"') || content.includes("'use client'"));
    const serverOnlyReference = [
      "lib/d5o/auth/supabase-server.ts",
      "lib/d5o/security/production-config.ts"
    ].includes(normalized);
    if (serverOnlyReference && !content.trimStart().startsWith('import "server-only";')) {
      failures.push(`Server key module must enforce server-only import: ${normalized}`);
    }
    const allowedReference =
      normalized.startsWith("docs/") ||
      normalized === ".env.example" ||
      normalized.startsWith("scripts/") ||
      normalized.startsWith("lib/d5o/data/") ||
      normalized.startsWith("app/actions/") ||
      serverOnlyReference;

    if (isClientComponent) {
      failures.push(`Client component references a Supabase service/secret key: ${normalized}`);
    }

    if (!allowedReference) {
      failures.push(`Unexpected Supabase service/secret key reference: ${normalized}`);
    }
  }

  const isDocOrScript = normalized.startsWith("docs/") || normalized.startsWith("scripts/");

  if (/SUPABASE_(SECRET|SERVICE_ROLE)_KEY\s*=\s*[^#\s]+/.test(content) && normalized !== ".env.example" && !isDocOrScript) {
    failures.push(`Potential hardcoded Supabase secret assignment: ${normalized}`);
  }
}

if (failures.length > 0) {
  console.error("Security foundation verification failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Security foundation verification passed: RLS scaffold, private storage scaffold, server-only key boundaries, docs, and Admin readiness are present.");

function source(relativePath) {
  const absolutePath = path.join(root, relativePath);

  if (!existsSync(absolutePath)) {
    return "";
  }

  return readFileSync(absolutePath, "utf8");
}

function assertIncludes(sourceText, token, message) {
  if (!sourceText.includes(token)) {
    failures.push(message);
  }
}

function assertStartsWithUseServer(sourceText, relativePath) {
  const firstLine = sourceText.trimStart().split(/\r?\n/)[0];

  if (!firstLine.includes("use server")) {
    failures.push(`${relativePath} must be server-only.`);
  }
}

function scanSourceFiles() {
  const roots = ["app", "components", "lib", "scripts", "docs"];
  const files = [];

  for (const item of roots) {
    walk(path.join(root, item), files);
  }

  const envExample = path.join(root, ".env.example");
  if (existsSync(envExample)) {
    files.push({ absolutePath: envExample, relativePath: ".env.example" });
  }

  return files.filter((item) => /\.(ts|tsx|js|mjs|md|sql|example)$/.test(item.relativePath));
}

function walk(directory, files) {
  if (!existsSync(directory)) {
    return;
  }

  for (const child of readdirSync(directory)) {
    const absolutePath = path.join(directory, child);
    const relativePath = path.relative(root, absolutePath);

    if (["node_modules", ".next", "package-output", "visual-qa-output"].includes(child)) {
      continue;
    }

    const stat = statSync(absolutePath);
    if (stat.isDirectory()) {
      walk(absolutePath, files);
    } else {
      files.push({ absolutePath, relativePath });
    }
  }
}
