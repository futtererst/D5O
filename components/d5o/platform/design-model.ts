import type { WorkRecord } from "./work-types";
import type { DesignHandoffBrief } from "./work-types";
import type { PackageCrewDemand } from "./schedule-model";
import { legacyDesignControlPolicy, type DesignControlPolicy } from "./design-policy";

// Design detail is keyed to the existing shared Work Package identity. Execution
// quantities and statuses remain in the package catalog and Deploy surface.
export type DesignDocument = {
  id: string; type: string; title: string; revision: number; source: string;
  owner: string; packageIds: string[]; requirementIds: string[];
  status: "Draft" | "In review" | "Approved" | "Issued for use" | "Superseded" | "Withdrawn";
  dueDate: string; createdAt: string; submittedByActorId?: string; approvedByActorId?: string; issuedAt?: string; issuedBy?: string;
};
export type DesignMaterial = { id: string; item: string; quantity: number; unit: string; source: string; status: "Unknown" | "Planned" | "Ordered" | "Supplier confirmed" | "Received" | "Available"; requiredDate: string; forecastDate: string; alternative: string; quoteDate?: string; quoteExpiry?: string; receivedQuantity?: number; availableQuantity?: number; confidence?: "Unknown" | "Planning assumption" | "Supplier confirmed" | "Physically counted" };
export type DesignPackage = {
  packageId: string; revision: number; scope: string; location: string; systems: string;
  completionBasis?: { kind: "Measured"; plannedQuantity: number; unit: string } | { kind: "Qualitative"; criterion: string };
  requirementIds: string[]; predecessorIds: string[]; documentRefs: string[];
  materials: string; materialStatus: "Unknown" | "Planned" | "Ordered" | "Supplier confirmed" | "Received" | "Available";
  materialLines?: DesignMaterial[];
  materialRequiredDate: string; materialForecastDate: string; materialSource: string;
  access: string; permit: string; safetyControls: string; equipment: string;
  method: string; rollback: string; verification: string; proof: string; acceptingAuthority: string;
  windowStart: string; windowEnd: string; targetReleaseDate: string;
  crewDemandRequired: boolean;
  crewExemptionReason: string;
  commercialImpact: string; commercialDisposition: "None" | "Assessment required" | "Routed to Develop";
  status: "Draft" | "In review" | "Returned" | "Approved";
};
export type DesignReview = {
  id: string; packageId: string; revision: number;
  discipline: "Engineering" | "Delivery" | "Safety" | "Quality" | "Procurement";
  status: "Requested" | "Approved" | "Returned"; assignee: string; dueDate: string;
  requestedAt: string; requestedByActorId: string; decidedAt?: string; decidedByActorId?: string;
  decidedByMembershipId?: string; note?: string;
};
export type DesignRelease = {
  id: string; packageId: string; packageRevision: number; documentRefs: string[];
  releaseGroupId?: string;
  sourceKind?: "commercial" | "service"; sourceId?: string; sourceDigest?: string;
  sourceHandoffRevision: number | null; definitionRevision: number | null;
  configurationVersionId: string; assessment: DesignReadiness;
  issuedAt: string; issuedByActorId: string; issuedByMembershipId: string;
  receivingOwner: string; responseDueDate: string;
  status: "Awaiting receipt" | "Accepted" | "Returned" | "Withdrawn" | "Hold pending acknowledgment" | "Held";
  receivedAt?: string; receivedByActorId?: string; receivedByMembershipId?: string; responseNote?: string;
  holdReason?: string; holdAt?: string; holdByActorId?: string; holdAcknowledgedAt?: string; holdAcknowledgedByActorId?: string;
  snapshot: DesignPackage;
  documentSnapshots: DesignDocument[];
  sourceSnapshot: DesignHandoffBrief | NonNullable<WorkRecord["serviceExecutionBasis"]>["brief"] | null;
  crewDemandSnapshot: PackageCrewDemand | null;
};
export type DesignEvent = { at: string; actorId: string; membershipId: string; action: string; note: string; packageId?: string; revision?: number };
export type DesignCustomerApproval = { id: string; packageId: string; packageRevision: number; customerParty: string; authorityBasis: string; source: string; approvedAt: string; recordedAt: string; recordedByActorId: string; recordedByMembershipId: string; note: string };
export type DesignChange = { id: string; packageId: string; openedRevision: number; sourceHandoffRevision: number | null; source: string; reason: string; affectedRequirementIds: string[]; affectedDocumentRefs: string[]; technicalImpact: string; commercialImpact: string; scheduleImpact: string; status: "Open" | "Resolved"; openedAt: string; openedByActorId: string; resolvedAt?: string; resolvedByActorId?: string; resolution?: string };
export type DesignForecast = { at: string; packageId: string; packageRevision: number; targetDate: string; forecastDate: string | null; driver: string; reason: string };
export type DesignState = { authorityRevision?: number; documents: DesignDocument[]; packages: DesignPackage[]; reviews: DesignReview[]; releases: DesignRelease[]; history: DesignEvent[]; forecasts?: DesignForecast[]; customerApprovals?: DesignCustomerApproval[]; changes?: DesignChange[] };
export type DesignFinding = { key: string; area: string; severity: "blocker" | "unknown" | "warning"; message: string; nextAction: string };
export type DesignReadiness = { evaluatedAt: string; packageId: string; packageRevision: number; policyVersion: string; recommendation: "Ready for release" | "Hold for information" | "Hold for resolution" | "Return for redesign/change"; findings: DesignFinding[] };

export const emptyDesign = (): DesignState => ({ documents: [], packages: [], reviews: [], releases: [], history: [] });
export const designState = (work: WorkRecord): DesignState => {
  const state = work.design ?? emptyDesign();
  // Older drafts may contain JSON null references. Treat these as missing facts,
  // never as issued documents or release evidence, and allow a governed correction.
  return { ...state,
    documents: Array.isArray(state.documents) ? state.documents : [],
    reviews: Array.isArray(state.reviews) ? state.reviews : [],
    releases: Array.isArray(state.releases) ? state.releases : [],
    history: Array.isArray(state.history) ? state.history : [],
    packages: Array.isArray(state.packages) ? state.packages.map((item) => ({ ...item,
      requirementIds: Array.isArray(item.requirementIds) ? item.requirementIds : [],
      predecessorIds: Array.isArray(item.predecessorIds) ? item.predecessorIds : [],
      documentRefs: Array.isArray(item.documentRefs) ? item.documentRefs : [],
      materialLines: Array.isArray(item.materialLines) ? item.materialLines : []
    })) : [] };
};
export const documentRef = (document: DesignDocument) => `${document.id}@${document.revision}`;
const addCalendarDays = (value: string, days: number) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "";
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
};
export function designRequirementRefs(work: WorkRecord): Array<{ id: string; label: string; source: string }> {
  if (work.serviceSource && work.serviceExecutionBasis?.status === "accepted")
    return [{ id: "service-scope", label: work.serviceExecutionBasis.brief.scope,
      source: `Accepted service execution basis revision ${work.serviceExecutionBasis.revision}` }];
  const structured = work.definition?.scopeControl?.requirements ?? [];
  if (structured.length) return structured.map((item) => ({ id: item.id, label: item.need, source: item.source }));
  if (work.definition?.status === "Approved" && work.definition.acceptance?.trim())
    return [{ id: `legacy-define-acceptance@${work.definition.revision}`, label: work.definition.acceptance, source: "Approved legacy Define acceptance text; no structured requirement register" }];
  return [];
}

export function forecastDesignPackage(work: WorkRecord, packageId: string, at = new Date().toISOString(), policy: DesignControlPolicy = legacyDesignControlPolicy): DesignForecast {
  const state = designState(work), detail = state.packages.find((item) => item.packageId === packageId);
  if (!detail) return { at, packageId, packageRevision: 0, targetDate: "", forecastDate: null, driver: "Package design missing", reason: "Record package detail before a release date can be forecast." };
  const requiredReviews = policy.requiredReviews;
  const reviews = requiredReviews.map((discipline) => state.reviews.find((item) => item.packageId === packageId && item.revision === detail.revision && item.discipline === discipline));
  if (reviews.some((item) => !item)) return { at, packageId, packageRevision: detail.revision, targetDate: detail.targetReleaseDate, forecastDate: null, driver: "Review plan incomplete", reason: "Assign all mandatory discipline reviews and due dates to establish a forecast." };
  const openMaterials = detail.materialLines?.length ? detail.materialLines.filter((item) => !["Available", "Received"].includes(item.status)) : detail.materialStatus !== "Available" && detail.materialStatus !== "Received" ? [{ forecastDate: detail.materialForecastDate }] : [];
  if (openMaterials.some((item) => !item.forecastDate)) return { at, packageId, packageRevision: detail.revision, targetDate: detail.targetReleaseDate, forecastDate: null, driver: "Material delivery unknown", reason: "Record an evidenced delivery forecast for each outstanding material." };
  const documentDue = detail.documentRefs.map((ref) => state.documents.find((item) => documentRef(item) === ref)).filter((item) => item?.status !== "Issued for use").map((item) => item?.dueDate ?? "");
  if (documentDue.includes("")) return { at, packageId, packageRevision: detail.revision, targetDate: detail.targetReleaseDate, forecastDate: null, driver: "Document review date unknown", reason: "Set due dates for unissued governing documents." };
  const constraints = [ ...reviews.map((item) => ({ date: item!.status === "Approved" ? item!.decidedAt?.slice(0, 10) ?? "" : item!.dueDate || addCalendarDays(item!.requestedAt.slice(0, 10), policy.reviewLeadDays), driver: `${item!.discipline} review` })), ...documentDue.map((due) => ({ date: due, driver: "Document issue" })), ...openMaterials.map((item) => ({ date: addCalendarDays(item.forecastDate, policy.procurementBufferDays), driver: "Material delivery and configured buffer" })) ].filter((item) => item.date);
  if (!constraints.length) return { at, packageId, packageRevision: detail.revision, targetDate: detail.targetReleaseDate, forecastDate: null, driver: "Timing unrecorded", reason: "Record review and procurement dates." };
  constraints.sort((left, right) => right.date.localeCompare(left.date));
  return { at, packageId, packageRevision: detail.revision, targetDate: detail.targetReleaseDate, forecastDate: constraints[0].date, driver: constraints[0].driver, reason: "Latest recorded mandatory review, document, or delivery date. No unrecorded processing buffer is assumed." };
}

export function assessDesignPackage(work: WorkRecord, packageId: string, at = new Date().toISOString(), crewDemand: PackageCrewDemand | null = null, policy: DesignControlPolicy = legacyDesignControlPolicy, releaseSetIds: ReadonlySet<string> = new Set()): DesignReadiness {
  const state = designState(work), detail = state.packages.find((item) => item.packageId === packageId);
  const findings: DesignFinding[] = [];
  const add = (key: string, area: string, severity: DesignFinding["severity"], message: string, nextAction: string) => findings.push({ key, area, severity, message, nextAction });
  if (!detail) return { evaluatedAt: at, packageId, packageRevision: 0, policyVersion: work.phaseConfigurationVersionId ?? "legacy-unpinned", recommendation: "Hold for information", findings: [{ key: "package_detail", area: "Package", severity: "unknown", message: "Package design detail has not been recorded.", nextAction: "Complete the package design." }] };
  if (work.discovery?.pursuitControl && (work.discovery.outcome !== "Won" || work.discovery.designHandoff?.status !== "accepted")) add("handoff", "Received basis", "blocker", "The exact awarded Develop handoff has not been accepted by Design.", "Complete the customer award and accept the exact handoff.");
  if (work.serviceSource && work.serviceExecutionBasis?.status !== "accepted") add("service_basis", "Received basis", "blocker", "The exact service execution basis has not been independently accepted.", "Submit the covered scope and obtain Operations receipt.");
  if (work.discovery?.designHandoff?.status === "accepted" && work.definition?.revision !== work.discovery.designHandoff.brief.definitionRevision) add("stale_source", "Received basis", "blocker", "The current Define revision differs from the accepted Design source.", "Route the changed scope through Define and Develop handoff.");
  if (work.discovery?.designHandoff?.status === "accepted" && work.phaseConfigurationVersionId !== work.discovery.designHandoff.brief.configurationVersionId) add("stale_policy", "Received basis", "blocker", "The current configuration pin differs from the accepted Design source.", "Restore the pinned source or complete a governed new handoff.");
  if (!work.phaseConfigurationVersionId) add("policy", "Configuration", "unknown", "No exact phase configuration is pinned to this Work Record.", "Restore the required published configuration.");
  if (!detail.scope || !detail.location || !detail.systems) add("scope", "Package", "unknown", "Scope, location, or affected systems are incomplete.", "Complete the executable package boundary.");
  if (!detail.requirementIds.length) add("requirements", "Traceability", "unknown", "No approved requirement is linked.", "Link the package to the received requirement or service-scope ID.");
  const requirements = new Set(designRequirementRefs(work).map((item) => item.id));
  if (detail.requirementIds.some((id) => !requirements.has(id))) add("requirement_reference", "Traceability", "blocker", "A linked requirement is not in the received source baseline.", "Correct the requirement reference or route a scope change.");
  if (!detail.verification || !detail.proof || !detail.acceptingAuthority) add("verification", "Quality", "unknown", "Measurable verification, required proof, or accepting authority is missing.", "Complete the package verification plan.");
  if (!detail.completionBasis || (detail.completionBasis.kind === "Measured" && (!(detail.completionBasis.plannedQuantity > 0) || !detail.completionBasis.unit.trim())) ||
    (detail.completionBasis.kind === "Qualitative" && !detail.completionBasis.criterion.trim()))
    add("completion_basis", "Quality", "unknown", "The package has no explicit planned quantity or qualitative completion criterion.", "Record how complete scope will be established before release.");
  if (!detail.safetyControls) add("safety", "Safety", "blocker", "Mandatory safety controls are missing.", "Record and review the applicable safety controls.");
  if (policy.requirePermit && !detail.permit) add("permit", "Safety", "blocker", "Required permit disposition is missing.", "Record the applicable permit or an authorized no-permit basis.");
  if (policy.requireAccess && !detail.access || policy.requireMop && !detail.method || policy.requireRollback && !detail.rollback) add("method", "Deployment", "unknown", "Configured access, method of procedure, or rollback basis is incomplete.", "Record the required field method and recovery approach.");
  if (!detail.windowStart || !detail.windowEnd || detail.windowEnd < detail.windowStart) add("window", "Schedule", "unknown", "The deployment window is missing or invalid.", "Confirm the permitted start and finish dates.");
  if (policy.requireCrewDemand && detail.crewDemandRequired !== false) {
    if (!crewDemand || crewDemand.packageId !== packageId || crewDemand.workId !== work.id) add("crew_demand", "Resources", "unknown", "No dated skill, crew-size, and effort demand is linked to this package.", "Set required shifts in Design before release.");
    else if (!crewDemand.qualification || !Number.isFinite(crewDemand.minimumPeople) || crewDemand.minimumPeople < 1 || !Number.isFinite(crewDemand.estimatedPersonHours) || crewDemand.estimatedPersonHours <= 0 || !crewDemand.requiredSlots.length || crewDemand.requiredSlots.some((slot) => !slot.date || !slot.shift || detail.windowStart && slot.date < detail.windowStart || detail.windowEnd && slot.date > detail.windowEnd)) add("crew_demand", "Resources", "blocker", "Crew skill, size, effort, or required shifts are incomplete or outside the package window.", "Correct dated demand or obtain a revised window.");
  }
  else if ((detail.crewExemptionReason?.trim() ?? "").length < 20) add("crew_exception", "Resources", "blocker", "Crew demand was marked not applicable without an authorized reason.", "Record the reason and authorized disposition for this package revision.");
  if (detail.materialLines?.length) {
    for (const line of detail.materialLines) {
      if (!line.item || !line.unit || !line.source || !line.requiredDate || !Number.isFinite(line.quantity) || line.quantity <= 0) add(`material_input:${line.id}`, "Procurement", "unknown", `${line.item || "Material"} lacks a complete quantity, unit, source, or required date.`, "Complete the material line and its source.");
      if (!line.confidence || line.confidence === "Unknown") add(`material_confidence:${line.id}`, "Procurement", "unknown", `${line.item || "Material"} has no stated source confidence.`, "Identify whether this is a planning assumption, supplier commitment, or physical count.");
      if (line.quoteExpiry && line.quoteExpiry < at.slice(0, 10) && !["Ordered", "Received", "Available"].includes(line.status)) add(`quote_expired:${line.id}`, "Procurement", "blocker", `${line.item}: the quoted source expired on ${line.quoteExpiry}; cost and availability may have changed.`, "Refresh the quotation or record an approved alternative and route any commercial change.");
      if (["Received", "Available"].includes(line.status) && (!Number.isFinite(line.receivedQuantity) || (line.receivedQuantity ?? 0) < line.quantity)) add(`material_short:${line.id}`, "Procurement", "blocker", `${line.item}: recorded received quantity does not cover ${line.quantity} ${line.unit}.`, "Record a counted receipt or revise the package quantity.");
      if (line.status === "Available" && (!Number.isFinite(line.availableQuantity) || (line.availableQuantity ?? 0) < line.quantity)) add(`material_unavailable:${line.id}`, "Procurement", "blocker", `${line.item}: available-for-use quantity does not cover the package requirement.`, "Record actual available quantity or hold release.");
      if (policy.requireMaterialAvailability && !["Available", "Received"].includes(line.status)) add(`material_status:${line.id}`, "Procurement", "blocker", `${line.item}: ${line.status} is not physical availability.`, "Confirm receipt or availability before release.");
      if (line.requiredDate && line.forecastDate && addCalendarDays(line.forecastDate, policy.procurementBufferDays) > line.requiredDate) add(`material_late:${line.id}`, "Procurement", "blocker", `${line.item}: forecast delivery ${line.forecastDate} plus ${policy.procurementBufferDays} calendar-day buffer misses required date ${line.requiredDate}.`, "Revise sequence/window or assess the recorded alternative.");
    }
  } else {
    if (policy.requireMaterialAvailability && (!detail.materials || detail.materialStatus === "Unknown")) add("material", "Procurement", "unknown", "Material requirement or procurement position is unknown.", "Record quantities, source, status, and required date.");
    else if (policy.requireMaterialAvailability && !["Available", "Received"].includes(detail.materialStatus)) add("material", "Procurement", "blocker", `${detail.materialStatus} is not physical availability.`, "Confirm received/available material before release.");
    if (detail.materialRequiredDate && detail.materialForecastDate && addCalendarDays(detail.materialForecastDate, policy.procurementBufferDays) > detail.materialRequiredDate) add("material_late", "Procurement", "blocker", "Forecast material delivery and configured buffer miss the required-on-site date.", "Revise the sequence/window or obtain an evidenced alternative.");
  }
  if (detail.commercialImpact || detail.commercialDisposition !== "None") add("commercial", "Commercial change", "blocker", "A Design change may affect the approved commercial basis; no verified replacement approval is linked.", "Resolve the change in Define/Develop and receive a new approved source before release.");
  if (state.changes?.some((item) => item.packageId === packageId && item.status === "Open")) add("design_change", "Change control", "blocker", "An open design change affects this package revision.", "Acknowledge the field hold, revise the package, and record the reviewed resolution.");
  for (const predecessor of detail.predecessorIds) {
    const current = state.packages.find((item) => item.packageId === predecessor);
    if (!releaseSetIds.has(predecessor) && (!current || !state.releases.some((item) => item.packageId === predecessor && item.packageRevision === current.revision && item.status === "Accepted")))
      add(`predecessor:${predecessor}`, "Dependencies", "blocker", `Predecessor package ${predecessor} has no accepted Deploy receipt for its current Design revision.`, "Release and receive the current predecessor revision first, or revise the dependency.");
  }
  if (!detail.documentRefs.length) add("documents", "Engineering", "unknown", "No governing document revision is linked.", "Approve and issue the governing document.");
  for (const ref of detail.documentRefs) if (!state.documents.some((item) => documentRef(item) === ref && item.status === "Issued for use" && item.packageIds.includes(packageId))) add(`document:${ref}`, "Engineering", "blocker", `Document ${ref} is not the issued revision for this package.`, "Issue the exact reviewed document revision.");
  for (const discipline of policy.requiredReviews) if (!state.reviews.some((item) => item.packageId === packageId && item.revision === detail.revision && item.discipline === discipline && item.status === "Approved")) add(`review:${discipline}`, "Review", "blocker", `${discipline} approval is missing for package revision ${detail.revision}.`, `Request and complete the ${discipline} review.`);
  if (policy.requireCustomerTechnicalApproval && !state.customerApprovals?.some((item) => item.packageId === packageId && item.packageRevision === detail.revision)) add("customer_technical", "Customer approval", "blocker", "Externally sourced customer technical approval is missing for this exact package revision.", "Record the approving customer party, authority basis, date, and source.");
  const recommendation = findings.some((item) => item.key === "commercial" || item.key === "requirement_reference" || item.key.startsWith("document:")) ? "Return for redesign/change" : findings.some((item) => item.severity === "blocker") ? "Hold for resolution" : findings.some((item) => item.severity === "unknown") ? "Hold for information" : "Ready for release";
  return { evaluatedAt: at, packageId, packageRevision: detail.revision, policyVersion: work.phaseConfigurationVersionId ?? "legacy-unpinned", recommendation, findings };
}
