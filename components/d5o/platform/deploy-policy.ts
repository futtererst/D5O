/** Published per-work-type prototype controls. Authorization remains a server membership decision. */
export type DeployControlPolicy = { schemaVersion: 1; requireWorkerAcknowledgment: boolean; requirePhysicalMaterials: boolean; requirePermit: boolean; requireAccess: boolean; requireReviewedEvidence: boolean; allowPartialAcceptance: boolean; maxActualHoursPerShift: number; fieldStartLeadMinutes?: number };
export function defaultDeployControlPolicy(workTypeKey: string): DeployControlPolicy {
  const service = workTypeKey.includes("service") || workTypeKey.includes("lifecycle");
  return { schemaVersion: 1, requireWorkerAcknowledgment: true, requirePhysicalMaterials: !service, requirePermit: !service, requireAccess: true, requireReviewedEvidence: true, allowPartialAcceptance: true, maxActualHoursPerShift: 16, fieldStartLeadMinutes: 60 };
}
export const legacyDeployControlPolicy: DeployControlPolicy = { ...defaultDeployControlPolicy("technical-delivery"), requireWorkerAcknowledgment: false, requireReviewedEvidence: false };
export function validateDeployControlPolicy(value: DeployControlPolicy): string[] {
  if (!value || value.schemaVersion !== 1) return ["Deploy control schema is invalid."];
  const errors: string[] = [];
  for (const key of ["requireWorkerAcknowledgment", "requirePhysicalMaterials", "requirePermit", "requireAccess", "requireReviewedEvidence", "allowPartialAcceptance"] as const)
    if (typeof value[key] !== "boolean") errors.push(`${key} must be a boolean.`);
  if (!Number.isInteger(value.maxActualHoursPerShift) || value.maxActualHoursPerShift < 1 || value.maxActualHoursPerShift > 24) errors.push("Maximum actual hours per shift must be 1–24.");
  if (value.fieldStartLeadMinutes !== undefined && (!Number.isInteger(value.fieldStartLeadMinutes) || value.fieldStartLeadMinutes < 0 || value.fieldStartLeadMinutes > 60)) errors.push("Field-start lead must be 0–60 minutes before the published shift. Older pinned contracts retain 60 minutes.");
  return errors;
}
