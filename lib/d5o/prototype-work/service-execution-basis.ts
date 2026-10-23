import type { WorkRecord } from "@/components/d5o/platform/work-types";

/** Checks the source request at the moment of release/start, not only the job's copied labels. */
export function serviceExecutionBasisIssue(work: WorkRecord, records: WorkRecord[]): string | null {
  const source = work.serviceSource;
  if (!source) return null;
  const parent = records.find((item) => item.id === source.parentWorkId && item.workspace === work.workspace);
  if (!parent?.operate || parent.operate.activation?.status !== "Active") return "The source asset's support is not active.";
  if (!source.requestId) return source.maintenancePlanId && parent.operate.maintenance.some((item) => item.id === source.maintenancePlanId && item.status === "Active")
    ? null : "The maintenance obligation is unavailable or inactive.";
  const request = parent.operate.requests.find((item) => item.id === source.requestId);
  const cycle = request?.reopenedAt ?? request?.reportedAt;
  const job = parent.operate.jobs.find((item) => item.workId === work.id && item.requestId === source.requestId);
  if (!request || !job || !source.requestCycleAt || source.requestCycleAt !== cycle || !(request.currentCycleJobIds ?? request.jobIds).includes(job.id))
    return "The service job does not belong to the request's current cycle.";
  if (!["Triaged", "In progress"].includes(request.status) || !["Covered", "Partially covered", "Chargeable"].includes(request.coverage))
    return "The current service request lacks an active coverage disposition.";
  if (source.coverage !== request.coverage) return "Coverage changed after the service job was created; review its basis.";
  if (work.canonicalWorkId) {
    const basis = work.serviceExecutionBasis;
    if (!basis || basis.status !== "accepted")
      return "Operations must accept the exact service execution basis before Design starts.";
    const accepted = basis.brief.source;
    if (accepted.requestId !== request.id || accepted.requestCycleAt !== cycle
      || accepted.assetId !== request.assetId
      || accepted.request.serviceCategory !== request.serviceCategory
      || !parent.operate.agreements.some((agreement) => agreement.id === accepted.agreement.id
        && agreement.revision === accepted.agreement.revision && agreement.status === "Active"))
      return "The request, asset, or coverage terms changed after service-basis acceptance; review a new revision.";
  }
  if (["Chargeable", "Partially covered"].includes(request.coverage)) {
    const estimate = request.serviceEstimate, authorization = request.serviceAuthorization;
    // Canonical visits may be reassessed after a new priced customer decision.
    // Their accepted basis, not the immutable child-creation snapshot, governs Design.
    const pricing = work.canonicalWorkId ? work.serviceExecutionBasis?.brief.source.pricing : source.pricing;
    if (!pricing || estimate?.status !== "Approved" || estimate.requestCycleAt !== cycle || authorization?.estimateRevision !== estimate.revision ||
      String(pricing.estimateRevision) !== String(estimate.revision) || pricing.customerAuthorizationSource !== authorization.source)
      return "The current request requires exact approved pricing and customer authorization before release.";
  }
  return null;
}
