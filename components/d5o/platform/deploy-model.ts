import type { WorkRecord } from "./work-types";
import type { DesignRelease } from "./design-model";
import type { SharedSchedule } from "./schedule-model";
import { legacyDeployControlPolicy, type DeployControlPolicy } from "./deploy-policy";

export type DeployActor = { id: string; name: string; membershipId: string; role: string; person?: string | null };
export type DeployEvent = { id: string; commandId: string; fingerprint?: string; at: string; actorId: string; membershipId: string; action: string; packageId?: string; note: string };
export type StartPermit = { id: string; packageId: string; releaseId: string; packageRevision: number; publicationId: string; scheduleRevision: number; policyVersionId: string; status: "Authorized" | "Held"; at: string; heldAt?: string; actorId: string; reason: string };
export type FieldReport = { id: string; revision: number; packageId: string; releaseId: string; bookingId: string; date: string; quantity: number; unit: string; laborHours: number; material: string; summary: string; evidenceIds: string[]; capturedAt: string; receivedAt: string; authorId: string; status: "Draft" | "Submitted" | "Returned" | "Reviewed"; reviewerId?: string; reviewNote?: string; history: Array<{ revision: number; at: string; reason: string }> };
export type PackageCompletion = { id: string; revision?: number; supersedesId?: string | null; packageId: string; releaseId: string; packageRevision: number; basis: NonNullable<DesignRelease["snapshot"]["completionBasis"]>; reviewedQuantity: number | null; unit: string | null; reportIds: string[]; inspectionIds: string[]; reviewedAt: string; reviewerId: string; membershipId: string; reason: string };
export type FieldInspection = { id: string; packageId: string; releaseId: string; reportId: string; requirementId?: string; requirement: string; method: string; result: "Pass" | "Fail"; note: string; evidenceIds: string[]; at: string; actorId: string; status: "Submitted" | "Returned" | "Verified"; reviewerId?: string; reviewNote?: string; supersedesId?: string };
export type FieldIssue = { id: string; packageId: string; releaseId: string | null; kind?: "Pre-start concern" | "Field issue"; bookingId?: string; title: string; impact: string; owner: string; status: "Open" | "Resolved"; evidenceIds: string[]; raisedAt: string; raisedBy: string; resolution?: string; resolvedAt?: string; resolvedBy?: string };
export type DeployEvidence = { id: string; packageId: string; releaseId: string; purpose: string; caption: string; filename: string; mimeType: string; sizeBytes: number; checksumSha256: string; uploadedAt: string; uploaderId: string; state: "Uploaded" | "Reviewed" | "Rejected"; reviewerId?: string; reviewNote?: string; reviewedAt?: string };
export type FieldSignoff = { id: string; kind: "Customer report acknowledgment" | "Customer scope acceptance" | "Final client acceptance"; recordId: string; recordRevision: number; releaseIds: string[]; scope: string; statement: string; signerName: string; signerOrganization: string; signerRole: string; method: "Captured on device" | "External source recorded" | "Externally signed document"; authorityBasis: string; source: string; capturedByActorId: string; at: string; outcome: "Acknowledged" | "Accepted" | "Conditional" | "Declined"; conditions: string; snapshot: unknown };
export type DeployTurnover = { id: string; revision: number; releaseIds: string[]; reportIds: string[]; inspectionIds: string[]; completionId?: string; issueIds: string[]; signoffIds: string[]; assembledAt: string; assembledByActorId: string; status: "Draft" | "Conditionally accepted" | "Client accepted"; operateOwner: string; obligations: string; receipt: "Awaiting" | "Accepted" | "Returned" };
export type WorkAcceptance = { id: string; revision: number; turnoverIds: string[]; releaseIds: string[]; acceptedAt: string; recordedByActorId: string; signerName: string; signerOrganization: string; signerRole: string; authorityBasis: string; source: string; conditions: string; receipt: "Awaiting" | "Accepted" | "Returned"; operateOwner: string; receiptNote?: string; receivedByActorId?: string; receivedAt?: string };
export type DeployState = { authorityRevision?: number; permits: StartPermit[]; reports: FieldReport[]; inspections: FieldInspection[]; issues: FieldIssue[]; evidence: DeployEvidence[]; signoffs: FieldSignoff[]; turnovers: DeployTurnover[]; completions?: PackageCompletion[]; workAcceptance?: WorkAcceptance; events: DeployEvent[] };
export const emptyDeploy = (): DeployState => ({ permits: [], reports: [], inspections: [], issues: [], evidence: [], signoffs: [], turnovers: [], events: [] });
export const deployState = (work: WorkRecord): DeployState => work.deploy ?? emptyDeploy();

export function currentAcceptedRelease(work: WorkRecord, packageId: string): DesignRelease | null {
  const releases = work.design?.releases?.filter((item) => item.packageId === packageId) ?? [];
  const latest = releases.at(-1);
  return latest?.status === "Accepted" ? latest : null;
}

/** A retained receipt describes its original scope, not later package additions. */
export function currentWorkAcceptanceScope(work: WorkRecord): boolean {
  const acceptance = work.deploy?.workAcceptance;
  const packages = work.packages ?? [];
  if (!acceptance || !packages.length || acceptance.releaseIds.length !== packages.length ||
    acceptance.turnoverIds.length !== packages.length ||
    (work.design?.packages.length ?? 0) !== packages.length) return false;
  const releases = packages.map((item) => currentAcceptedRelease(work, item.id));
  if (releases.some((item, index) => !item || item.packageRevision !== work.design?.packages.find((detail) => detail.packageId === packages[index].id)?.revision ||
    !acceptance.releaseIds.includes(item.id))) return false;
  return acceptance.turnoverIds.every((id) => work.deploy?.turnovers.some((item) => item.id === id &&
    item.status === "Client accepted" &&
    item.releaseIds.some((releaseId) => acceptance.releaseIds.includes(releaseId))));
}

/** Completion is a reviewed scope fact, separate from a reviewed activity report. */
export function assessPackageCompletion(work: WorkRecord, packageId: string) {
  const release = currentAcceptedRelease(work, packageId);
  const state = deployState(work);
  const basis = release?.snapshot?.completionBasis;
  const reports = (state.reports ?? []).filter((item) => item.packageId === packageId && item.releaseId === release?.id && item.status === "Reviewed");
  const inspections = (state.inspections ?? []).filter((item) => item.packageId === packageId && item.releaseId === release?.id && item.status === "Verified" && item.result === "Pass");
  const blockers: string[] = [];
  if (!release) blockers.push("A current accepted Design release is required.");
  if (release && work.design?.packages?.find((item) => item.packageId === packageId)?.revision !== release.packageRevision)
    blockers.push("Design detail changed after the accepted release; resolve the field basis before completion.");
  if (!basis) blockers.push("The released package has no planned quantity or explicit qualitative completion criterion.");
  if (!reports.length) blockers.push("No independently reviewed field report records the performed work.");
  if (!inspections.length) blockers.push("No independently verified passing inspection supports completion.");
  if ((state.issues ?? []).some((item) => item.packageId === packageId && item.status === "Open")) blockers.push("An open issue remains on this package.");
  for (const id of release?.snapshot?.requirementIds ?? [])
    if (!inspections.some((item) => item.requirementId === id)) blockers.push(`Requirement ${id} has no verified passing inspection.`);
  const unresolvedFailure = (state.inspections ?? []).some((item) => item.packageId === packageId && item.releaseId === release?.id && item.status === "Verified" && item.result === "Fail"
    && !inspections.some((pass) => pass.supersedesId === item.id && pass.requirementId === item.requirementId));
  if (unresolvedFailure) blockers.push("A failed inspection has no verified passing retest.");
  let reviewedQuantity: number | null = null;
  if (basis?.kind === "Measured") {
    const mismatched = reports.filter((item) => item.unit.trim().toLowerCase() !== basis.unit.trim().toLowerCase());
    if (mismatched.length) blockers.push("Reviewed quantities use a unit different from the released plan.");
    reviewedQuantity = reports.filter((item) => !mismatched.includes(item)).reduce((sum, item) => sum + item.quantity, 0);
    if (reviewedQuantity < basis.plannedQuantity) blockers.push(`${basis.plannedQuantity - reviewedQuantity} ${basis.unit} of planned scope remains unreported or unreviewed.`);
  }
  return { release, basis, reportIds: reports.map((item) => item.id).sort(), inspectionIds: inspections.map((item) => item.id).sort(),
    reviewedQuantity, remainingQuantity: basis?.kind === "Measured" && reviewedQuantity !== null ? Math.max(0, basis.plannedQuantity - reviewedQuantity) : null,
    blockers, ready: blockers.length === 0 };
}

export function currentReviewedCompletion(work: WorkRecord, packageId: string) {
  const assessed = assessPackageCompletion(work, packageId);
  const completion = (deployState(work).completions ?? []).filter((item) => item.packageId === packageId).at(-1);
  const sameIds = (left: string[], right: string[]) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
  if (!completion || !assessed.ready || completion.releaseId !== assessed.release?.id || completion.packageRevision !== assessed.release.packageRevision ||
    JSON.stringify(completion.basis) !== JSON.stringify(assessed.basis) || completion.reviewedQuantity !== assessed.reviewedQuantity ||
    !sameIds(completion.reportIds, assessed.reportIds) || !sameIds(completion.inspectionIds, assessed.inspectionIds)) return null;
  return completion;
}

export type DeployFinding = { key: string; severity: "blocker" | "unknown" | "warning"; fact: string; source: string; nextAction: string };
export type DeployReadiness = { recommendation: "Ready for authorized start" | "Hold for information" | "Hold for resolution" | "Return for Design review"; releaseId: string | null; publicationId: string | null; findings: DeployFinding[] };

/** Display the same pinned-calendar shift gate that the command enforces. */
function scheduledStartPosition(date: string, shift: string, timezone: string, now: Date): "Current" | "Outside" | "Unknown" {
  const match = /^([0-2]\d):([0-5]\d)[\u2013-]([0-2]\d):([0-5]\d)$/.exec(shift);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !match || Number(match[1]) > 23 || Number(match[3]) > 23) return "Unknown";
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
    const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    const localNow = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"));
    const [year, month, day] = date.split("-").map(Number);
    const start = Date.UTC(year, month - 1, day, Number(match[1]), Number(match[2]));
    const end = Date.UTC(year, month - 1, day + (match[3] + match[4] <= match[1] + match[2] ? 1 : 0), Number(match[3]), Number(match[4]));
    return localNow >= start - 60 * 60_000 && localNow <= end ? "Current" : "Outside";
  } catch { return "Unknown"; }
}

/** A deterministic, conservative assessment. Planning and receipt never authorize field work. */
export function assessDeployReadiness(work: WorkRecord, packageId: string, schedule: SharedSchedule | null, policy: DeployControlPolicy = legacyDeployControlPolicy, timezone = "UTC", now = new Date()): DeployReadiness {
  const findings: DeployFinding[] = [];
  const add = (key: string, severity: DeployFinding["severity"], fact: string, source: string, nextAction: string) => findings.push({ key, severity, fact, source, nextAction });
  const release = currentAcceptedRelease(work, packageId);
  const latestRelease = work.design?.releases.filter((item) => item.packageId === packageId).at(-1);
  if (!release) add("release", "blocker", latestRelease ? `Latest release is ${latestRelease.status}.` : "No Design release is recorded.", "Design release register", "Receive a current, unheld Design release.");
  const detail = release?.snapshot;
  if (release && work.design?.packages.find((item) => item.packageId === packageId)?.revision !== release.packageRevision)
    add("revision", "blocker", "Design detail has changed since this release.", `Release ${release.id}`, "Resolve the Design change and receive a new release.");
  if (release && work.phaseConfigurationVersionId && release.configurationVersionId !== work.phaseConfigurationVersionId)
    add("policy", "blocker", "Release configuration differs from the Work Record pin.", `Release ${release.id}`, "Reconcile the pinned policy before start.");
  for (const predecessor of detail?.predecessorIds ?? []) {
    if (!currentReviewedCompletion(work, predecessor)) add(`predecessor:${predecessor}`, "blocker", `Predecessor ${predecessor} has no current reviewed completion and verification against its released scope.`, "Deploy completion", "Review the predecessor's planned scope, actuals and verification.");
  }
  const publication = schedule?.publications.filter((item) => item.assignments.some((assignment) => assignment.workId === work.id && assignment.packageId === packageId)).at(-1);
  const booking = publication?.assignments.find((item) => item.workId === work.id && item.packageId === packageId);
  if (detail?.crewDemandRequired !== false && !booking) add("crew", "blocker", "No published named booking covers this package.", "Shared crew schedule", "Schedule and publish a qualified crew.");
  if (booking && publication) {
    const current = schedule?.assignments.find((item) => item.id === booking.id);
    if (JSON.stringify(current) !== JSON.stringify(booking)) add("booking-changed", "blocker", "The published booking differs from the current plan.", `Publication ${publication.id}`, "Review and republish the change.");
    const declined = booking.people.filter((person) => schedule?.receipts.some((receipt) => receipt.publicationId === publication.id && receipt.assignmentId === booking.id && receipt.recipient === person && receipt.response === "cannot-attend"));
    if (declined.length) add("attendance", "blocker", `${declined.join(", ")} cannot attend.`, `Publication ${publication.id}`, "Replace crew members and republish.");
    if (policy.requireWorkerAcknowledgment) {
      const awaiting = booking.people.filter((person) => !schedule?.receipts.some((receipt) => receipt.publicationId === publication.id && receipt.assignmentId === booking.id && receipt.recipient === person && receipt.response === "acknowledged"));
      if (awaiting.length) add("acknowledgment", "blocker", `${awaiting.join(", ")} have not acknowledged this publication.`, `Publication ${publication.id}`, "Ask the workers to respond or replan coverage.");
    }
    if (release?.crewDemandSnapshot && !release.crewDemandSnapshot.requiredSlots.some((slot) => slot.date === booking.date && slot.shift === booking.shift))
      add("released-slot", "blocker", "The published booking does not match the released crew-demand slot.", `Release ${release.id}`, "Return the changed shift for Design review and republish its crew plan.");
    if (detail && booking.date && (detail.windowStart && booking.date < detail.windowStart || detail.windowEnd && booking.date > detail.windowEnd))
      add("released-window", "blocker", "The published booking falls outside the released deployment window.", `Release ${release?.id ?? "unknown"}`, "Replan within the released window or return to Design.");
    const shiftPosition = booking.date ? scheduledStartPosition(booking.date, booking.shift, timezone, now) : "Unknown";
    if (shiftPosition === "Outside") add("shift-time", "blocker", `The published ${booking.date} ${booking.shift} shift is not current in ${timezone}.`, `Publication ${publication.id}`, "Authorize start during the published shift, no earlier than one hour before it begins.");
    if (shiftPosition === "Unknown") add("shift-time", "unknown", "The published shift or pinned time zone cannot be assessed.", `Publication ${publication.id}`, "Confirm the shift format and pinned time zone before start.");
    const minimum = release?.crewDemandSnapshot?.minimumPeople ?? 1;
    if (booking.people.length < minimum) add("staffing", "blocker", `${booking.people.length} booked; ${minimum} required.`, "Released crew demand", "Cover the remaining positions.");
  }
  for (const material of policy.requirePhysicalMaterials ? detail?.materialLines ?? [] : [])
    if (material.status !== "Available" || (material.availableQuantity ?? 0) < material.quantity)
      add(`material:${material.id}`, "blocker", `${material.item}: ${material.availableQuantity ?? 0}/${material.quantity} ${material.unit} physically available.`, material.source || "Released material line", "Confirm physical availability or return the package for a controlled change.");
  if (policy.requirePhysicalMaterials && detail && !detail.materialLines?.length && detail.materialStatus !== "Available")
    add("materials", "unknown", `Material availability is ${detail.materialStatus.toLowerCase()}.`, "Released package", "Confirm physically available materials.");
  if (policy.requireAccess && detail && !detail.access?.trim()) add("access", "unknown", "Access authorization is not recorded.", "Released package", "Confirm site access.");
  if (policy.requirePermit && detail && !detail.permit?.trim()) add("permit", "unknown", "Required permit disposition is not recorded.", "Released package", "Confirm permit approval or return for a controlled exception.");
  if (detail && !detail.safetyControls?.trim()) add("safety", "blocker", "Mandatory safety controls are missing.", "Released package", "Return to Design/Safety for controls.");
  if (detail && !detail.method?.trim()) add("method", "blocker", "Issued work method is missing.", "Released package", "Return to Design for an issued method.");
  for (const issue of deployState(work).issues.filter((item) => item.packageId === packageId && item.status === "Open"))
    add(`issue:${issue.id}`, "blocker", issue.title, `Deploy issue ${issue.id}`, "Resolve the issue or record an authorized exception.");
  if (work.blockers.length) add("work-hold", "blocker", work.blockers.join(" · "), "Work Record", "Resolve the controlled Work Record condition.");
  return { recommendation: findings.some((item) => item.key === "release" || item.key === "revision" || item.key === "safety" || item.key === "method") ? "Return for Design review" : findings.some((item) => item.severity === "blocker") ? "Hold for resolution" : findings.length ? "Hold for information" : "Ready for authorized start", releaseId: release?.id ?? null, publicationId: publication?.id ?? null, findings };
}
