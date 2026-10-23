import type { WorkRecord } from "./work-types";
import { currentWorkAcceptanceScope } from "./deploy-model";
import { legacyOperateControlPolicy, type OperateControlPolicy } from "./operate-policy";
import type { PricingEvaluation, PricingInput, PricingPolicy } from "./develop-pricing";
import { supportDocumentationPositions } from "./support-documentation";

export type OperateActor = { id: string; membershipId: string; name: string; role: string };
export type OperateEvent = { id: string; commandId: string; fingerprint: string; at: string; actorId: string; membershipId: string; action: string; detail: string };
export type SupportedAsset = { id: string; name: string; kind: string; customer: string; site: string; location: string; externalId?: string; manufacturer?: string; model?: string; serial?: string; parentId?: string; sourceWorkIds: string[]; sourceTurnoverId?: string; status: "Pending" | "Supported" | "Suspended" | "Retired"; owner: string; documentation: string; history: Array<{ at: string; action: string; source: string; actorId: string }> };
export type AcceptedAssetLink = { id: string; status: "Accepted"; assetId: string; ownerWorkId: string; workAcceptanceId: string; workAcceptanceRevision: number; acceptedAt: string; acceptedByActorId: string; reason: string };
export type CoverageAgreement = { id: string; name: string; kind: "Warranty" | "Service agreement" | "No coverage"; status: "Draft" | "Active" | "Expired" | "Superseded"; assetIds: string[]; effectiveFrom: string; effectiveTo: string; includes: string; excludes: string; serviceCategories?: string[]; laborCovered?: boolean; partsCovered?: boolean; travelCovered?: boolean; responseHours: number | null; restorationHours?: number | null; resolutionHours?: number | null; calendar: "Business hours" | "Continuous"; timezone: string; source: string; revision: number; createdByActorId?: string; approvedBy?: string; approvedAt?: string };
export type ServiceEstimate = { revision: number; requestCycleAt: string; status: "Draft" | "Pricing review" | "Approved" | "Returned"; input: PricingInput; evaluation: PricingEvaluation; policySnapshot: PricingPolicy; savedAt: string; savedByActorId: string; submittedByActorId?: string; reviewedByActorId?: string; reviewedAt?: string; reviewNote?: string; history: Array<{ revision: number; status: string; at: string; actorId: string; note: string; input: PricingInput; evaluation: PricingEvaluation; policySnapshot: PricingPolicy }> };
export type ServiceAuthorization = { estimateRevision: number; amountMinor: number; currency: string; source: string; customerParty: string; customerOrganization?: string; customerRole?: string; authorityBasis?: string; outcome?: string; conditions?: string; exclusions?: string; customerEvidence?: { id: string; checksumSha256: string; sizeBytes: number; uploadedAt: string }; recordedByActorId: string; recordedAt: string };
export type ServiceRequest = { id: string; assetId: string; title: string; description: string; impact: "Standard" | "High" | "Critical"; contact: string; reportedAt: string; reopenedAt?: string; owner: string; status: "New" | "Triaged" | "In progress" | "Resolved" | "Closed" | "Reopened"; coverage: "Awaiting" | "Covered" | "Partially covered" | "Chargeable" | "Excluded" | "Expired"; coverageBasis?: string; agreementId?: string; serviceCategory?: string; responseDueAt?: string; restorationDueAt?: string; resolutionDueAt?: string; respondedAt?: string; restoredAt?: string; resolvedAt?: string; resolution?: string; resolutionSource?: string; reviewedBy?: string; serviceEstimate?: ServiceEstimate; serviceAuthorization?: ServiceAuthorization; serviceAuthorizationHistory?: ServiceAuthorization[]; slaBasis?: { configurationVersionId?: string; agreementId?: string; agreementRevision?: number; calendar: "Business hours" | "Continuous"; timezone: string; holidayDates: string[]; businessStartHour?: number; businessEndHour?: number; responseHours?: number; restorationHours?: number; resolutionHours?: number }; activePause?: { at: string; reason: string; actorId: string }; slaHistory?: Array<{ at: string; action: string; actorId: string; reason: string; responseDueAt?: string; restorationDueAt?: string; resolutionDueAt?: string }>; jobIds: string[]; currentCycleJobIds?: string[]; history: Array<{ at: string; action: string; actorId: string; note: string }> };
export type ServiceJob = { id: string; workId: string; assetIds: string[]; requestId?: string; planId?: string; dueDate: string; status: "Generated" | "Execution linked" | "Completed" | "Cancelled"; evidence: string[]; completionRefs?: string[]; createdAt: string; linkedByActorId?: string; completedAt?: string; completedByActorId?: string; completionReason?: string };
export type MaintenancePlan = { id: string; assetId: string; title: string; frequencyDays: number; nextDue: string; mode: "Fixed date" | "Completion relative"; owner: string; skill: string; expectedHours: number; requiredEvidence: string; status: "Active" | "Suspended"; revision: number; generatedDates: string[]; deferrals?: Array<{ originalDue: string; revisedDue: string; reason: string; actorId: string; at: string }> };
export type SupportDocumentation = {
  restricted?: boolean;
  id: string; turnoverId: string; kind: "as-built" | "inspection";
  basis: { turnoverId: string; turnoverRevision: number; packageId: string; releaseId: string;
    releaseRevision: number; workAcceptanceId: string; workAcceptanceRevision: number; kind: string };
  status: "Submitted" | "Reviewed" | "Returned"; filename: string; checksumSha256: string;
  uploadedAt: string; uploadedByActorId: string; submittedAt: string;
  submittedByActorId: string; submittedByMembershipId: string;
  supersedesId?: string | null; note?: string; reviewedAt?: string;
  reviewedByActorId?: string; reviewedByMembershipId?: string; reviewReason?: string;
};
export type OperateState = {
  authorityRevision?: number;
  documentationObligations?: SupportDocumentation[];
  supportDocumentAssignments?: Array<{ id: string; turnoverId: string; packageId: string; releaseId: string; actorId: string; email: string; status: "Assigned" | "Revoked"; previousAssignmentId?: string; byActorId: string; at: string; reason: string }>;
  source?: { kind: "Accepted Deploy" | "Legacy onboarding"; workAcceptanceId?: string; revision?: number; turnoverIds: string[]; acceptedAt: string; acceptedByActorId: string; note: string };
  support?: { owner: string; ownerActorId: string; acceptedAt: string; customerContact: string; escalation: string; intakeRoute: string; warrantyDisposition: string; serviceDisposition: string; documentationReviewed: string; residualOwner: string };
  activation?: { status: "Active" | "Suspended" | "Deactivated"; at: string; actorId: string; basis: string; sourceRevision: number; history: Array<{ at: string; action: string; actorId: string; reason: string }> };
  assetLinks?: AcceptedAssetLink[];
  assets: SupportedAsset[]; agreements: CoverageAgreement[]; requests: ServiceRequest[]; jobs: ServiceJob[]; maintenance: MaintenancePlan[];
  customerReviews: Array<{ id: string; at: string; contact: string; summary: string; actions: string; owner: string }>;
  lifecycleLinks: Array<{ id: string; opportunityWorkId: string; assetId?: string; requestId?: string; rationale: string; owner: string; at: string }>;
  finance: { status: "Pending" | "In review" | "Closed"; owner: string; note: string; at?: string };
  lessons: Array<{ id: string; finding: string; owner: string; action: string; status: "Open" | "Done" }>;
  events: OperateEvent[];
};
export const emptyOperate = (): OperateState => ({ assets: [], agreements: [], requests: [], jobs: [], maintenance: [], customerReviews: [], lifecycleLinks: [], finance: { status: "Pending", owner: "Finance", note: "" }, lessons: [], events: [] });
export const operateState = (work: WorkRecord): OperateState => work.operate ?? emptyOperate();

export type OperateFinding = { key: string; severity: "blocker" | "unknown"; fact: string; source: string; owner: string; nextAction: string };
export function assessOperationalReadiness(work: WorkRecord, policy: OperateControlPolicy = legacyOperateControlPolicy, allWork?: WorkRecord[]): { recommendation: "Ready to activate" | "Supported through existing asset" | "Hold for information" | "Hold for resolution"; findings: OperateFinding[] } {
  const state = operateState(work), findings: OperateFinding[] = [];
  const add = (key: string, severity: OperateFinding["severity"], fact: string, source: string, owner: string, nextAction: string) => findings.push({ key, severity, fact, source, owner, nextAction });
  const receipt = work.deploy?.workAcceptance;
  if (state.source?.kind === "Accepted Deploy" && state.source.workAcceptanceId && !currentWorkAcceptanceScope(work)) add("accepted-scope", "blocker", "The historical whole-work acceptance does not cover the current package and release set.", "Exact Deploy acceptance", "Operations lead", "Keep the accepted scope visible and govern additional work on a separate Work Record.");
  if (!state.source || (state.source.kind === "Accepted Deploy" && state.source.workAcceptanceId && (!receipt || receipt.id !== state.source.workAcceptanceId || receipt.revision !== state.source.revision || receipt.receipt !== "Accepted")))
    add("source", "blocker", "No exact accepted Deploy receipt or authorized legacy onboarding basis is linked.", "Deploy turnover", "Operations leader", "Receive an exact turnover or document legacy provenance.");
  if (state.source?.kind === "Legacy onboarding" && !policy.allowLegacyOnboarding) add("legacy", "blocker", "This Work Type does not allow legacy support onboarding.", "Pinned Operate policy", "System administrator", "Use an approved source path or publish an applicable policy.");
  if (state.source?.kind === "Accepted Deploy" && !state.source.workAcceptanceId && !policy.allowPartialHandoff) add("partial", "blocker", "Partial handoff is not permitted by this policy.", "Pinned Operate policy", "Operations lead", "Receive the whole work or obtain an applicable policy decision.");
  if (state.source?.kind === "Accepted Deploy" && !state.source.workAcceptanceId && (!state.source.turnoverIds.length || state.source.turnoverIds.some((id) => !work.deploy?.turnovers.some((item) => item.id === id && item.status === "Client accepted" && item.receipt === "Accepted" && item.revision === state.source?.revision)))) add("partial-source", "blocker", "The exact accepted scoped turnover is unavailable or changed.", "Deploy turnover", "Operations lead", "Reconcile the accepted turnover revision.");
  const acceptedLinks = state.assetLinks?.filter((item) => item.status === "Accepted") ?? [];
  if (acceptedLinks.length) {
    for (const link of acceptedLinks) {
      const owner = allWork?.find((item) => item.workspace === work.workspace && item.id === link.ownerWorkId);
      const asset = owner?.operate?.assets.find((item) => item.id === link.assetId);
      if (!owner || !asset || !asset.sourceWorkIds.includes(work.id) || !owner.operate?.support?.ownerActorId || owner.operate.activation?.status !== "Active" || asset.status !== "Supported")
        add(`linked-${link.id}`, owner ? "blocker" : "unknown", "The linked asset's current support ownership or active position cannot be confirmed.", "Owning asset Work Record", "Operations leader", "Inspect the linked asset and resolve its support position on the owning Work Record.");
    }
    if (supportDocumentationPositions(work).some((item) => item.status !== "Reviewed"))
      add("linked-documents", "unknown", "Accepted turnover documents still require supply or independent review.", "Accepted Deploy turnovers", "Project manager and Operations leader", "Complete the retained document obligations for this delivery.");
    return { recommendation: findings.some((item) => item.severity === "blocker") ? "Hold for resolution" : findings.length ? "Hold for information" : "Supported through existing asset", findings };
  }
  if (!state.assets.length) add("assets", "blocker", "No supported asset or infrastructure is identified.", "Operate asset register", "Operations lead", "Link at least one asset to the accepted scope.");
  const support = state.support;
  if (!support?.ownerActorId || !support.acceptedAt) add("owner", "blocker", "Support responsibility has not been accepted by an authenticated owner.", "Operate support assignment", "Operations lead", "Accept support ownership.");
  if ((policy.requireCustomerContact && !support?.customerContact) || !support?.escalation || !support?.intakeRoute) add("routing", "unknown", "Customer contact, escalation or request intake is incomplete.", "Operate support profile", "Support owner", "Record the contact and intake route.");
  if (policy.requireExplicitCoverageDisposition && (!support?.warrantyDisposition || !support.serviceDisposition)) add("coverage", "unknown", "Warranty and service dispositions are not explicit.", "Operate support profile", "Support owner", "Record coverage or an explicit no-coverage disposition.");
  if (!policy.allowNoCoverage && /\bnone\b|no (warranty|agreement|coverage)/i.test(`${support?.warrantyDisposition} ${support?.serviceDisposition}`)) add("no-coverage", "blocker", "The recorded no-coverage disposition is not permitted by this policy.", "Pinned Operate policy", "Operations lead", "Record applicable coverage or route a policy exception.");
  if (policy.requireDocumentationReview && !support?.documentationReviewed) add("documentation", "unknown", "Received documentation has not been reviewed.", "Deploy handoff", "Support owner", "Review the applicable documents and record the reference.");
  if (!support?.residualOwner && work.deploy?.turnovers.some((item) => item.obligations.trim())) add("residual", "unknown", "Residual obligations have no accountable owner.", "Accepted turnover", "Operations lead", "Assign continuing obligations.");
  return { recommendation: findings.some((item) => item.severity === "blocker") ? "Hold for resolution" : findings.length ? "Hold for information" : "Ready to activate", findings };
}

export function coverageFor(state: OperateState, assetId: string, at: string, kind?: string) {
  const agreements = state.agreements.filter((item) => item.status === "Active" && item.assetIds.includes(assetId) && item.effectiveFrom <= at && item.effectiveTo >= at);
  if (agreements.length > 1) return { decision: "Awaiting" as const, basis: "Overlapping active terms require an authorized coverage decision.", agreementId: undefined, conflict: true };
  const agreement = agreements[0];
  if (!agreement) {
    const expired = state.agreements.filter((item) => item.assetIds.includes(assetId) && item.kind !== "No coverage" && item.effectiveTo < at && ["Active", "Expired", "Superseded"].includes(item.status)).sort((a, b) => b.effectiveTo.localeCompare(a.effectiveTo))[0];
    if (expired) return { decision: "Expired" as const, basis: `${expired.name} ended ${expired.effectiveTo}; review current terms before deciding entitlement or chargeability.`, agreementId: expired.id, conflict: false };
    return { decision: "Chargeable" as const, basis: "No active warranty or agreement covers this asset; commercial authorization remains separate.", agreementId: undefined, conflict: false };
  }
  if (agreement.kind === "No coverage") return { decision: "Chargeable" as const, basis: `${agreement.name} explicitly records no coverage for this asset; pricing authorization remains separate.`, agreementId: agreement.id, conflict: false };
  if (kind && agreement.excludes.toLowerCase().includes(kind.toLowerCase())) return { decision: "Excluded" as const, basis: `${agreement.name} excludes ${kind}.`, agreementId: agreement.id, conflict: false };
  return { decision: agreement.kind === "Warranty" ? "Partially covered" as const : "Covered" as const, basis: `${agreement.name} applies to the asset; labor, materials and travel require the recorded terms to be checked.`, agreementId: agreement.id, conflict: false };
}

export function responseDeadline(reportedAt: string, hours: number, calendar: "Business hours" | "Continuous", timezone: string, holidays: string[] = [], businessStartHour = 9, businessEndHour = 17): string | null {
  if (!Number.isFinite(hours) || hours <= 0 || hours > 720 || !Number.isFinite(Date.parse(reportedAt)) || !timezone) return null;
  if (calendar === "Continuous") return new Date(Date.parse(reportedAt) + hours * 3_600_000).toISOString();
  const end = new Date(reportedAt), formatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); let remaining = Math.ceil(hours * 60), guard = 0;
  while (remaining > 0 && guard++ < 300000) {
    const parts = formatter.formatToParts(end);
    const day = parts.find((part) => part.type === "weekday")?.value;
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    const localDate = `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}-${parts.find((part) => part.type === "day")?.value}`;
    if (day !== "Sat" && day !== "Sun" && !holidays.includes(localDate) && hour >= businessStartHour && hour < businessEndHour) remaining--;
    end.setUTCMinutes(end.getUTCMinutes() + 1);
  }
  return remaining === 0 ? end.toISOString() : null;
}

export function pausedClockMinutes(startAt: string, endAt: string, calendar: "Business hours" | "Continuous", timezone: string, holidays: string[] = [], businessStartHour = 9, businessEndHour = 17): number | null {
  const start = Date.parse(startAt), end = Date.parse(endAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 31 * 86_400_000) return null;
  if (calendar === "Continuous") return Math.ceil((end - start) / 60_000);
  let formatter: Intl.DateTimeFormat;
  try { formatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }); } catch { return null; }
  let minutes = 0;
  for (let at = start; at + 60_000 <= end; at += 60_000) {
    const parts = formatter.formatToParts(at), part = (kind: string) => parts.find((item) => item.type === kind)?.value ?? "";
    const date = `${part("year")}-${part("month")}-${part("day")}`;
    if (part("weekday") !== "Sat" && part("weekday") !== "Sun" && !holidays.includes(date) && Number(part("hour")) >= businessStartHour && Number(part("hour")) < businessEndHour) minutes++;
  }
  return minutes;
}

export function shiftSlaDeadline(dueAt: string | undefined, pausedAt: string, resumedAt: string, calendar: "Business hours" | "Continuous", timezone: string, holidays: string[] = [], businessStartHour = 9, businessEndHour = 17): string | undefined {
  if (!dueAt || Date.parse(pausedAt) >= Date.parse(dueAt)) return dueAt;
  const lost = pausedClockMinutes(pausedAt, resumedAt, calendar, timezone, holidays, businessStartHour, businessEndHour);
  if (lost === null) return undefined;
  if (!lost) return dueAt;
  return responseDeadline(dueAt, lost / 60, calendar, timezone, holidays, businessStartHour, businessEndHour) ?? undefined;
}
