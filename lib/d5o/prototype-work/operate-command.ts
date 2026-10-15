import type { WorkRecord } from "@/components/d5o/platform/work-types";
import { assessOperationalReadiness, coverageFor, emptyOperate, operateState, responseDeadline, shiftSlaDeadline, type CoverageAgreement, type OperateActor, type OperateState, type ServiceJob, type ServiceRequest } from "@/components/d5o/platform/operate-model";
import { PrototypeWorkError } from "./store-error";
import { sameJsonValue } from "./semantic-json";
import { legacyOperateControlPolicy, type OperateControlPolicy } from "@/components/d5o/platform/operate-policy";
import { evaluatePricing, formatMinor, type PricingInput, type PricingPolicyState } from "@/components/d5o/platform/develop-pricing";
import { currentAcceptedRelease, currentReviewedCompletion } from "@/components/d5o/platform/deploy-model";

export type OperateCommand = { action: "receive-handoff" | "onboard-legacy" | "add-asset" | "link-existing-asset" | "accept-asset" | "assign-support-supplier" | "revoke-support-supplier" | "accept-support" | "submit-support-document" | "review-support-document" | "transfer-support" | "activate" | "resume" | "suspend" | "deactivate" | "add-agreement" | "approve-agreement" | "open-request" | "triage-request" | "decide-coverage" | "record-chargeable-disposition" | "save-service-estimate" | "submit-service-pricing" | "approve-service-pricing" | "return-service-pricing" | "record-service-authorization" | "link-service-pricing" | "record-response" | "record-restoration" | "pause-sla" | "resume-sla" | "create-job" | "link-execution" | "complete-job" | "resolve-request" | "close-request" | "reopen-request" | "add-maintenance" | "generate-maintenance" | "defer-maintenance" | "add-review" | "open-lifecycle" | "update-finance" | "add-lesson";
  workId: string; expectedRevision: number; commandId: string; note?: string; id?: string; assetId?: string; requestId?: string; planId?: string; sourceWorkId?: string; turnoverId?: string;
  expectedDeployRevision?: number; expectedDecisionRevision?: number; expectedServiceDeployRevision?: number; expectedOwnerOperateRevision?: number;
  documentKind?: "as-built" | "inspection"; evidenceId?: string; decision?: "Reviewed" | "Returned"; supervisorEmail?: string;
  serviceCategory?: string; serviceCategories?: string[]; laborCovered?: boolean; partsCovered?: boolean; travelCovered?: boolean;
  name?: string; kind?: string; location?: string; externalId?: string; manufacturer?: string; model?: string; serial?: string; documentation?: string;
  customerContact?: string; escalation?: string; intakeRoute?: string; warrantyDisposition?: string; serviceDisposition?: string; residualOwner?: string;
  effectiveFrom?: string; effectiveTo?: string; includes?: string; excludes?: string; responseHours?: number; restorationHours?: number; resolutionHours?: number; calendar?: "Business hours" | "Continuous"; timezone?: string; source?: string; pauseReason?: string;
  title?: string; description?: string; impact?: "Standard" | "High" | "Critical"; contact?: string; owner?: string; dueDate?: string;
  frequencyDays?: number; mode?: "Fixed date" | "Completion relative"; skill?: string; expectedHours?: number; requiredEvidence?: string;
  pricingInput?: PricingInput; estimateRevision?: number; customerParty?: string; customerOrganization?: string; customerRole?: string; authorityBasis?: string; outcome?: "Authorized" | "Declined"; conditions?: string; exclusions?: string; resolution?: string; reviewSource?: string; resolutionMethod?: "Field" | "Remote"; rationale?: string; status?: string; actionOwner?: string };
const manager = new Set(["admin", "operations_leader", "project_manager"]);
const operations = new Set(["admin", "operations_leader"]);
const text = (value: unknown, max = 500) => typeof value === "string" ? value.trim().slice(0, max) : "";
const date = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) ? value : "";
function fail(code: string, message: string, status = 409): never { throw new PrototypeWorkError(code, status, message); }
export const operateCommandFingerprint = (command: OperateCommand) => JSON.stringify(Object.entries(command).sort(([a], [b]) => a.localeCompare(b)));
const active = (state: OperateState) => state.activation?.status === "Active";

export function applyOperateCommand(work: WorkRecord, all: WorkRecord[], command: OperateCommand, actor: OperateActor, policy: OperateControlPolicy = legacyOperateControlPolicy, pricingState?: PricingPolicyState): { work: WorkRecord; related?: WorkRecord; updatedRelated?: WorkRecord } {
  if (!actor.id || !actor.membershipId || !command.commandId || command.commandId.length > 100) fail("invalid_actor", "An authenticated membership and command ID are required.", 400);
  const state = structuredClone(work.operate ?? emptyOperate()), now = new Date().toISOString(), reason = text(command.note, 2000);
  const existing = state.events.find((item) => item.commandId === command.commandId);
  if (existing) { if (existing.actorId !== actor.id || existing.membershipId !== actor.membershipId || existing.fingerprint !== operateCommandFingerprint(command)) fail("command_reuse_conflict", "This command ID belongs to another action.", 409); return { work }; }
  const requireManager = () => { if (!manager.has(actor.role)) fail("operate_role_denied", "An operations manager is required.", 403); };
  const requireOperations = () => { if (!operations.has(actor.role)) fail("operate_receipt_denied", "An independent operations authority is required.", 403); };
  const addEvent = (action: string, detail = reason) => state.events.unshift({ id: crypto.randomUUID(), commandId: command.commandId, fingerprint: operateCommandFingerprint(command), at: now, actorId: actor.id, membershipId: actor.membershipId, action, detail });
  const asset = () => { const item = state.assets.find((entry) => entry.id === command.assetId); if (!item) fail("asset_missing", "Select an asset on this Work Record.", 404); return item; };
  const request = () => { const item = state.requests.find((entry) => entry.id === command.requestId); if (!item) fail("request_missing", "Select a request on this Work Record.", 404); return item; };
  const setSla = (item: ServiceRequest, agreement?: CoverageAgreement) => {
    const calendar = agreement?.calendar ?? policy.responseCalendar, timezone = agreement?.timezone ?? policy.timezone, holidayDates = [...policy.holidayDates];
    const businessStartHour = policy.businessStartHour ?? 9, businessEndHour = policy.businessEndHour ?? 17;
    const start = item.reopenedAt ?? item.reportedAt;
    const responseHours = agreement?.responseHours ?? policy.defaultResponseHours;
    const restorationHours = agreement?.restorationHours ?? null, resolutionHours = agreement?.resolutionHours ?? null;
    const deadline = (hours: number | null) => hours ? responseDeadline(start, hours, calendar, timezone, holidayDates, businessStartHour, businessEndHour) ?? undefined : undefined;
    item.slaBasis = { configurationVersionId: work.phaseConfigurationVersionId, agreementId: agreement?.id, agreementRevision: agreement?.revision, calendar, timezone, holidayDates, businessStartHour, businessEndHour, responseHours: responseHours ?? undefined, restorationHours: restorationHours ?? undefined, resolutionHours: resolutionHours ?? undefined };
    item.responseDueAt = deadline(responseHours); item.restorationDueAt = deadline(restorationHours); item.resolutionDueAt = deadline(resolutionHours);
    if ([responseHours, restorationHours, resolutionHours].some((hours) => hours && !deadline(hours))) fail("sla_deadline_unavailable", "A configured SLA deadline could not be calculated; review the calendar and hours.", 422);
  };
  let related: WorkRecord | undefined, updatedRelated: WorkRecord | undefined;
  if (command.action === "receive-handoff") {
    requireOperations(); const receipt = work.deploy?.workAcceptance;
    const turnover = command.turnoverId ? work.deploy?.turnovers.find((item) => item.id === command.turnoverId && item.status === "Client accepted" && item.receipt === "Accepted") : null;
    if (command.turnoverId ? !policy.allowPartialHandoff || !turnover || !reason : !receipt || receipt.receipt !== "Accepted" || !receipt.receivedByActorId || receipt.receivedByActorId === receipt.recordedByActorId || !reason) fail("handoff_not_received", "Receive the exact accepted Deploy turnover independently before opening support.");
    if (state.source) fail("source_exists", "The operating source is already recorded; changes require a controlled amendment.");
    state.source = { kind: "Accepted Deploy", workAcceptanceId: turnover ? undefined : receipt?.id, revision: turnover?.revision ?? receipt?.revision, turnoverIds: turnover ? [turnover.id] : [...(receipt?.turnoverIds ?? [])], acceptedAt: now, acceptedByActorId: actor.id, note: reason }; addEvent("Exact Deploy handoff linked");
  } else if (command.action === "onboard-legacy") {
    requireOperations(); if (!policy.allowLegacyOnboarding) fail("legacy_onboarding_denied", "This Work Type does not permit legacy onboarding."); if (state.source || text(command.source).length < 8 || reason.length < 10) fail("legacy_source_incomplete", "Record a verifiable external source and provenance gaps before onboarding.");
    state.source = { kind: "Legacy onboarding", turnoverIds: [], acceptedAt: now, acceptedByActorId: actor.id, note: `${reason} · ${text(command.source)}` }; addEvent("Legacy support basis onboarded");
  } else if (command.action === "add-asset") {
    requireManager(); if (!state.source || !text(command.name) || !text(command.kind) || !text(command.location)) fail("asset_incomplete", "Receive a source and record asset name, type and location.", 400);
    const externalId = text(command.externalId, 120);
    if (externalId && all.some((record) => record.workspace === work.workspace && record.operate?.assets.some((item) => item.externalId === externalId))) fail("asset_identity_conflict", "An asset with this external identity already exists in this tenant; review the match.");
    if (state.assets.some((item) => item.name.toLowerCase() === text(command.name).toLowerCase() && item.location.toLowerCase() === text(command.location).toLowerCase())) fail("asset_identity_conflict", "A matching asset and location already exist; review the match.");
    state.assets.push({ id: crypto.randomUUID(), name: text(command.name, 120), kind: text(command.kind, 80), customer: work.customer, site: work.site, location: text(command.location, 120), externalId: externalId || undefined, manufacturer: text(command.manufacturer) || undefined, model: text(command.model) || undefined, serial: text(command.serial) || undefined, sourceWorkIds: [work.id], sourceTurnoverId: state.source.workAcceptanceId, status: "Pending", owner: text(command.owner) || actor.name, documentation: text(command.documentation, 1000), history: [{ at: now, action: "Asset identified", source: state.source.kind, actorId: actor.id }] }); addEvent("Supported asset identified");
  } else if (command.action === "accept-asset") {
    requireOperations();
    const item = state.assets.find((entry) => entry.id === command.assetId && entry.status === "Pending");
    if (!item || state.activation?.status !== "Active" || !state.support
      || !state.source || item.sourceTurnoverId !== state.source.workAcceptanceId
      || text(command.source).length < 10 || reason.length < 10)
      fail("asset_acceptance_invalid", "Review the pending asset, exact source and documentation before accepting it into active support.");
    item.status = "Supported";
    item.history.push({ at: now, action: "Support accepted", source: text(command.source), actorId: actor.id });
    addEvent("Asset support accepted", `${item.id} · ${reason}`);
  } else if (command.action === "accept-support") {
    requireOperations(); if (!state.source || !state.assets.length || (policy.requireCustomerContact && !text(command.customerContact)) || !text(command.escalation) || !text(command.intakeRoute) || (policy.requireExplicitCoverageDisposition && (!text(command.warrantyDisposition) || !text(command.serviceDisposition))) || (policy.requireDocumentationReview && !text(command.documentation))) fail("support_profile_incomplete", "Record the applicable contact, escalation, intake, coverage and document review requirements.", 400);
    state.support = { owner: actor.name, ownerActorId: actor.id, acceptedAt: now, customerContact: text(command.customerContact), escalation: text(command.escalation), intakeRoute: text(command.intakeRoute), warrantyDisposition: text(command.warrantyDisposition), serviceDisposition: text(command.serviceDisposition), documentationReviewed: text(command.documentation, 1000), residualOwner: text(command.residualOwner) }; addEvent("Support ownership accepted");
  } else if (command.action === "transfer-support") {
    requireOperations(); if (!state.support || state.support.ownerActorId === actor.id || reason.length < 10) fail("support_transfer_invalid", "A different operations authority must accept the transfer and record a reason.");
    state.support.owner = actor.name; state.support.ownerActorId = actor.id; state.support.acceptedAt = now; addEvent("Support ownership transferred", reason);
  } else if (command.action === "activate") {
    requireOperations(); const readiness = assessOperationalReadiness({ ...work, operate: state }, policy);
    if (readiness.recommendation !== "Ready to activate") fail("activation_blocked", readiness.findings[0]?.fact ?? "Operational readiness is incomplete.");
    if (state.activation) fail("activation_exists", "Use explicit resume or transfer for an existing support activation.");
    state.activation = { status: "Active", at: now, actorId: actor.id, basis: reason || "Operational readiness confirmed", sourceRevision: state.source?.revision ?? 0, history: [{ at: now, action: "Activated", actorId: actor.id, reason: reason || "Operational readiness confirmed" }] };
    state.assets.forEach((item) => { if (item.status === "Pending") item.status = "Supported"; }); addEvent("Support activated");
  } else if (command.action === "resume") {
    requireOperations(); if (state.activation?.status !== "Suspended" || reason.length < 10) fail("resume_invalid", "Suspended support and a recorded resumption basis are required.");
    const readiness = assessOperationalReadiness({ ...work, operate: state }, policy);
    if (readiness.recommendation !== "Ready to activate") fail("resume_blocked", readiness.findings[0]?.fact ?? "Support is not ready to resume.");
    state.activation.status = "Active"; state.activation.history.push({ at: now, action: "Resumed", actorId: actor.id, reason }); addEvent("Support resumed");
  } else if (command.action === "suspend" || command.action === "deactivate") {
    requireOperations(); if (!active(state) || reason.length < 10) fail("activation_change_invalid", "Active support and a recorded reason are required.");
    const status = command.action === "suspend" ? "Suspended" : "Deactivated";
    state.activation!.status = status; state.activation!.history.push({ at: now, action: status, actorId: actor.id, reason }); addEvent(`Support ${status.toLowerCase()}`);
  } else if (command.action === "add-agreement") {
    requireManager(); asset(); const from = date(command.effectiveFrom), to = date(command.effectiveTo);
    if (!from || !to || from > to || !text(command.name) || !["Warranty", "Service agreement", "No coverage"].includes(command.kind ?? "") || !text(command.source)) fail("agreement_incomplete", "Record scope, dates and source for this coverage position.", 400);
    if (command.kind === "No coverage" && !policy.allowNoCoverage) fail("no_coverage_denied", "An explicit no-coverage agreement is not permitted by policy.");
    const timezone = text(command.timezone, 80) || policy.timezone;
    try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(); } catch { fail("invalid_timezone", "Use a valid response time zone.", 400); }
    for (const key of ["responseHours", "restorationHours", "resolutionHours"] as const) if (command[key] !== undefined && (!Number.isInteger(command[key]) || command[key]! < 1 || command[key]! > 720)) fail("invalid_sla_hours", `${key} must be 1–720.`, 400);
    state.agreements.push({ id: crypto.randomUUID(), name: text(command.name), kind: command.kind as "Warranty" | "Service agreement" | "No coverage", status: "Draft", assetIds: [command.assetId!], effectiveFrom: from, effectiveTo: to, includes: text(command.includes, 1000), excludes: text(command.excludes, 1000), responseHours: command.responseHours ?? policy.defaultResponseHours, restorationHours: command.restorationHours ?? null, resolutionHours: command.resolutionHours ?? null, calendar: command.calendar ?? policy.responseCalendar, timezone, source: text(command.source), revision: 1, createdByActorId: actor.id }); addEvent("Coverage draft recorded");
  } else if (command.action === "approve-agreement") {
    requireOperations(); const item = state.agreements.find((entry) => entry.id === command.id && entry.status === "Draft");
    if (!item || reason.length < 10) fail("agreement_review_incomplete", "Select a draft and record the approval basis.");
    if (item.createdByActorId === actor.id) fail("agreement_separation_required", "A second operations authority must approve these terms.");
    item.status = "Active"; item.approvedAt = now; item.approvedBy = actor.id; addEvent("Coverage terms approved", `${item.id} · ${reason}`);
  } else if (command.action === "open-request") {
    if (!active(state)) fail("support_inactive", "Activate support before accepting a service request.");
    asset(); if (!text(command.title) || !text(command.description) || !text(command.contact) || !["Standard", "High", "Critical"].includes(command.impact ?? "")) fail("request_incomplete", "Describe the issue, impact and reporting contact.", 400);
    const id = crypto.randomUUID(); state.requests.push({ id, assetId: command.assetId!, title: text(command.title), description: text(command.description, 2000), impact: command.impact!, contact: text(command.contact), reportedAt: now, owner: text(command.owner) || actor.name, status: "New", coverage: "Awaiting", jobIds: [], currentCycleJobIds: [], history: [{ at: now, action: "Opened", actorId: actor.id, note: reason }] }); addEvent("Service request opened", id);
  } else if (command.action === "triage-request") {
    requireManager(); const item = request(); if (item.status !== "New" && item.status !== "Reopened") fail("request_state_invalid", "Only a new or reopened request can be triaged.");
    const coverage = coverageFor(state, item.assetId, (item.reopenedAt ?? item.reportedAt).slice(0, 10), text(command.kind));
    if (coverage.conflict) fail("coverage_conflict", coverage.basis);
    item.coverage = coverage.decision; item.coverageBasis = coverage.basis; item.agreementId = coverage.agreementId; item.status = "Triaged"; item.owner = text(command.owner) || actor.name;
    const agreement = coverage.decision === "Expired" ? undefined : state.agreements.find((entry) => entry.id === coverage.agreementId);
    setSla(item, agreement);
    item.history.push({ at: now, action: "Triaged", actorId: actor.id, note: coverage.basis }); addEvent("Request triaged", item.id);
  } else if (command.action === "decide-coverage") {
    requireOperations(); const item = request(), agreement = state.agreements.find((entry) => entry.id === command.id && entry.status === "Active" && entry.assetIds.includes(item.assetId) && entry.effectiveFrom <= (item.reopenedAt ?? item.reportedAt).slice(0, 10) && entry.effectiveTo >= (item.reopenedAt ?? item.reportedAt).slice(0, 10));
    if (!agreement || reason.length < 10 || item.status !== "New" && item.status !== "Reopened") fail("coverage_decision_invalid", "Select applicable active terms and record why they govern this request.");
    const match = coverageFor(state, item.assetId, (item.reopenedAt ?? item.reportedAt).slice(0, 10), text(command.kind));
    if (!match.conflict) fail("coverage_not_conflicted", "Use ordinary triage when coverage terms do not conflict.");
    item.coverage = agreement.kind === "Warranty" ? "Partially covered" : agreement.kind === "No coverage" ? "Chargeable" : "Covered";
    item.coverageBasis = `Authorized conflicting-term decision: ${agreement.name} · ${reason}`; item.agreementId = agreement.id; item.status = "Triaged"; item.owner = text(command.owner) || actor.name;
    setSla(item, agreement);
    item.history.push({ at: now, action: "Coverage conflict decided", actorId: actor.id, note: item.coverageBasis }); addEvent("Coverage conflict decided", item.id);
  } else if (command.action === "record-chargeable-disposition") {
    requireOperations(); const item = request();
    if (item.coverage !== "Expired" || !["Triaged", "In progress"].includes(item.status) || !text(command.source) || reason.length < 10) fail("chargeable_disposition_invalid", "Review the expired terms and record the source and chargeable disposition basis.");
    item.coverage = "Chargeable"; item.coverageBasis = `Expired terms reviewed; chargeable disposition recorded from ${text(command.source)}. ${reason}`;
    item.history.push({ at: now, action: "Chargeable disposition recorded", actorId: actor.id, note: item.coverageBasis }); addEvent("Chargeable disposition recorded", item.id);
  } else if (command.action === "save-service-estimate") {
    requireManager(); const item = request(), supplied = command.pricingInput;
    if (!["Triaged", "In progress"].includes(item.status) || !["Chargeable", "Partially covered"].includes(item.coverage)) fail("service_pricing_not_applicable", "A triaged request with an explicit chargeable scope is required before saving a service estimate.");
    if (!supplied || !Array.isArray(supplied.lines) || supplied.lines.length > 100 || !Number.isFinite(supplied.discountPercent) || typeof supplied.riskBasis !== "string" || !supplied.riskBasis.trim() || !supplied.lines.every((line) => line && typeof line === "object" && [line.description, line.quantity, line.unit, line.source, line.assumption].every((value) => typeof value === "string") && (line.rateId === undefined || typeof line.rateId === "string") && (line.manualRate === undefined || typeof line.manualRate === "string") && line.procurement === undefined)) fail("service_estimate_invalid", "Provide sourced service cost lines, a discount and an uncertainty basis; procurement scenarios are handled in Develop.", 400);
    const activePolicy = pricingState?.activePricingPolicy;
    const pricingPolicy = pricingState?.pricingPolicies?.find((entry) => entry.id === activePolicy?.id && entry.version === activePolicy.version && entry.status === "published" && entry.workspace === work.workspace);
    if (!pricingPolicy) fail("service_pricing_policy_unavailable", "An active published tenant pricing policy is required.");
    const input: PricingInput = { ...supplied, currency: pricingPolicy.currency, workType: "Lifecycle service", customer: work.customer, region: work.site, pricedAt: now.slice(0, 10), definitionRevision: 0, solutionRevision: 0, lines: supplied.lines.map((line) => ({ ...structuredClone(line), scopeRef: item.id })) };
    const evaluation = evaluatePricing(pricingPolicy, input, now), previous = item.serviceEstimate;
    item.serviceEstimate = { revision: (previous?.revision ?? 0) + 1, requestCycleAt: item.reopenedAt ?? item.reportedAt, status: "Draft", input, evaluation, policySnapshot: structuredClone(pricingPolicy), savedAt: now, savedByActorId: actor.id, history: [...(previous?.history ?? []), ...(previous ? [{ revision: previous.revision, status: previous.status, at: now, actorId: actor.id, note: "Superseded by a new service estimate revision", input: structuredClone(previous.input), evaluation: structuredClone(previous.evaluation), policySnapshot: structuredClone(previous.policySnapshot) }] : [])] };
    item.history.push({ at: now, action: "Service estimate saved", actorId: actor.id, note: `Revision ${item.serviceEstimate.revision}; policy ${pricingPolicy.id} v${pricingPolicy.version}; ${evaluation.recommendation}` }); addEvent("Service estimate saved", item.id);
  } else if (command.action === "submit-service-pricing") {
    requireManager(); const item = request(), estimate = item.serviceEstimate;
    if (!estimate || estimate.revision !== command.estimateRevision || estimate.status !== "Draft" || estimate.requestCycleAt !== (item.reopenedAt ?? item.reportedAt) || !["Chargeable", "Partially covered"].includes(item.coverage)) fail("service_estimate_stale", "Submit the current-cycle chargeable estimate revision.");
    const recalculated = evaluatePricing(estimate.policySnapshot, estimate.input, estimate.evaluation.calculatedAt);
    if (recalculated.issues.length || JSON.stringify(recalculated) !== JSON.stringify(estimate.evaluation)) fail("service_estimate_not_ready", "The pinned estimate has unresolved inputs or no longer matches its saved calculation.");
    estimate.status = "Pricing review"; estimate.submittedByActorId = actor.id; item.history.push({ at: now, action: "Service pricing submitted", actorId: actor.id, note: `Revision ${estimate.revision} to ${estimate.policySnapshot.pricingApproverRole}` }); addEvent("Service pricing submitted", item.id);
  } else if (command.action === "approve-service-pricing" || command.action === "return-service-pricing") {
    const item = request(), estimate = item.serviceEstimate;
    if (!estimate || estimate.status !== "Pricing review" || estimate.revision !== command.estimateRevision || estimate.requestCycleAt !== (item.reopenedAt ?? item.reportedAt)) fail("service_pricing_review_stale", "Review the exact current-cycle service estimate revision.");
    if (actor.role !== estimate.policySnapshot.pricingApproverRole || actor.id === estimate.submittedByActorId || reason.length < 10) fail("service_pricing_authority_denied", "The assigned independent pricing authority must record a review reason.", 403);
    const recalculated = evaluatePricing(estimate.policySnapshot, estimate.input, estimate.evaluation.calculatedAt);
    if (JSON.stringify(recalculated) !== JSON.stringify(estimate.evaluation) || recalculated.issues.length) fail("service_estimate_not_ready", "The reviewed calculation is stale or has unresolved inputs.");
    estimate.status = command.action === "approve-service-pricing" ? "Approved" : "Returned"; estimate.reviewedByActorId = actor.id; estimate.reviewedAt = now; estimate.reviewNote = reason;
    item.history.push({ at: now, action: command.action === "approve-service-pricing" ? "Service pricing approved" : "Service pricing returned", actorId: actor.id, note: `Revision ${estimate.revision}; ${reason}` }); addEvent("Service pricing reviewed", item.id);
  } else if (command.action === "record-service-authorization") {
    requireOperations(); const item = request(), estimate = item.serviceEstimate;
    if (!estimate || estimate.status !== "Approved" || estimate.revision !== command.estimateRevision || estimate.requestCycleAt !== (item.reopenedAt ?? item.reportedAt) || !["Chargeable", "Partially covered"].includes(item.coverage) || !text(command.customerParty) || !text(command.source) || reason.length < 10) fail("service_authorization_invalid", "Record the external customer party and source against the exact approved chargeable estimate.");
    if (item.serviceAuthorization?.estimateRevision === estimate.revision) fail("service_authorization_exists", "The exact estimate revision already has a recorded customer authorization; preserve it and create a revised estimate for changed scope or price.");
    if (item.serviceAuthorization) item.serviceAuthorizationHistory = [...(item.serviceAuthorizationHistory ?? []), structuredClone(item.serviceAuthorization)];
    item.serviceAuthorization = { estimateRevision: estimate.revision, amountMinor: estimate.evaluation.proposedPriceMinor, currency: estimate.evaluation.currency, source: text(command.source), customerParty: text(command.customerParty), recordedByActorId: actor.id, recordedAt: now };
    item.history.push({ at: now, action: "Customer service authorization recorded", actorId: actor.id, note: `External source ${item.serviceAuthorization.source}; estimate revision ${estimate.revision}; ${reason}` }); addEvent("Customer service authorization recorded", item.id);
  } else if (command.action === "link-service-pricing") {
    requireOperations(); const item = request(), estimate = item.serviceEstimate, authorization = item.serviceAuthorization;
    const job = state.jobs.find((entry) => entry.id === command.id && entry.requestId === item.id && entry.status === "Generated");
    const execution = all.find((entry) => entry.id === job?.workId && entry.workspace === work.workspace && entry.serviceSource?.parentWorkId === work.id && entry.serviceSource.requestId === item.id);
    if (!job || !(item.currentCycleJobIds ?? item.jobIds).includes(job.id) || !execution || execution.serviceSource?.pricing || execution.deploy?.permits?.length || execution.deploy?.reports?.length || execution.design?.releases?.length || !["Chargeable", "Partially covered"].includes(item.coverage) || !estimate || estimate.status !== "Approved" || estimate.requestCycleAt !== (item.reopenedAt ?? item.reportedAt) || authorization?.estimateRevision !== estimate.revision) fail("service_pricing_link_invalid", "Only an unstarted, unreleased current-cycle service job can receive the exact approved and customer-authorized pricing basis.");
    const pricing = { estimateRevision: estimate.revision, policyId: estimate.policySnapshot.id, policyVersion: estimate.policySnapshot.version, currency: authorization.currency, amountMinor: authorization.amountMinor, customerAuthorizationSource: authorization.source };
    updatedRelated = { ...execution, value: `${formatMinor(pricing.amountMinor, pricing.currency)} authorized service basis`, nextAction: "Confirm service execution basis and release", serviceSource: { ...execution.serviceSource!, pricing }, history: [`${now} · Service pricing revision ${estimate.revision} linked by ${actor.name}; execution still requires Design release and Deploy authorization.`, ...execution.history] };
    item.history.push({ at: now, action: "Approved service pricing linked to planning job", actorId: actor.id, note: `${job.id}; estimate revision ${estimate.revision}; customer source ${authorization.source}` }); addEvent("Service pricing linked", job.workId);
  } else if (command.action === "record-response") {
    requireManager(); const item = request(); if ((item.status !== "Triaged" && item.status !== "In progress") || item.respondedAt) fail("request_state_invalid", "Triage this request and record only its first accountable response.");
    if (reason.length < 10) fail("response_source_missing", "Record what was communicated and its source reference.", 400);
    item.respondedAt = now; item.status = "In progress"; item.history.push({ at: now, action: "Customer response recorded", actorId: actor.id, note: reason }); addEvent("Response recorded", item.id);
  } else if (command.action === "record-restoration") {
    requireManager(); const item = request(); if (item.status !== "In progress" || item.restoredAt || item.activePause || reason.length < 10) fail("restoration_invalid", "Record a source-backed restoration against active, unpaused service work.");
    item.restoredAt = now; item.history.push({ at: now, action: "Service restored", actorId: actor.id, note: reason }); addEvent("Restoration recorded", item.id);
  } else if (command.action === "pause-sla") {
    requireOperations(); const item = request(), pauseReason = text(command.pauseReason, 120);
    if (!["Triaged", "In progress"].includes(item.status) || item.activePause || !item.slaBasis || ![item.responseDueAt && !item.respondedAt, item.restorationDueAt && !item.restoredAt, item.resolutionDueAt && !item.resolvedAt].some(Boolean) || !(policy.slaPauseReasons ?? []).includes(pauseReason) || reason.length < 10) fail("sla_pause_denied", "An open SLA milestone, configured pause reason and recorded authority basis are required.");
    item.activePause = { at: now, reason: pauseReason, actorId: actor.id };
    item.slaHistory = [...(item.slaHistory ?? []), { at: now, action: "Paused", actorId: actor.id, reason: `${pauseReason} · ${reason}`, responseDueAt: item.responseDueAt, restorationDueAt: item.restorationDueAt, resolutionDueAt: item.resolutionDueAt }]; addEvent("SLA paused", item.id);
  } else if (command.action === "resume-sla") {
    requireOperations(); const item = request(), pause = item.activePause, basis = item.slaBasis;
    if (!pause || !basis || reason.length < 10) fail("sla_resume_denied", "A recorded pause and resumption basis are required.");
    const shift = (due: string | undefined, met?: string) => met ? due : shiftSlaDeadline(due, pause.at, now, basis.calendar, basis.timezone, basis.holidayDates, basis.businessStartHour, basis.businessEndHour);
    const response = shift(item.responseDueAt, item.respondedAt), restoration = shift(item.restorationDueAt, item.restoredAt), resolution = shift(item.resolutionDueAt, item.resolvedAt);
    if ((item.responseDueAt && !response) || (item.restorationDueAt && !restoration) || (item.resolutionDueAt && !resolution)) fail("sla_clock_unavailable", "The pause exceeds the supported calendar calculation; escalate for an explicit SLA revision.");
    item.responseDueAt = response; item.restorationDueAt = restoration; item.resolutionDueAt = resolution; item.activePause = undefined;
    item.slaHistory = [...(item.slaHistory ?? []), { at: now, action: "Resumed", actorId: actor.id, reason, responseDueAt: response, restorationDueAt: restoration, resolutionDueAt: resolution }]; addEvent("SLA resumed", item.id);
  } else if (command.action === "create-job" || command.action === "generate-maintenance") {
    requireManager(); if (!active(state)) fail("support_inactive", "Support must be active before generating service work.");
    const req = command.action === "create-job" ? request() : null;
    const plan = command.action === "generate-maintenance" ? state.maintenance.find((item) => item.id === command.planId && item.status === "Active") : null;
    if (command.action === "generate-maintenance" && !plan) fail("plan_missing", "Select an active maintenance plan.");
    if (plan && plan.nextDue > now.slice(0, 10)) fail("maintenance_not_due", "This maintenance obligation is not due yet.");
    if (plan && plan.mode === "Completion relative" && state.jobs.some((item) => item.planId === plan.id && item.status !== "Completed" && item.status !== "Cancelled")) fail("maintenance_visit_open", "Complete the prior visit before generating the next completion-relative visit.");
    if (req && !["Triaged", "In progress"].includes(req.status)) fail("request_not_triaged", "Triage the request before opening an execution job.");
    if (req && !["Covered", "Partially covered", "Chargeable"].includes(req.coverage)) fail("coverage_undecided", "Record an applicable coverage or chargeable disposition before creating service work.");
    const due = plan?.nextDue ?? date(command.dueDate), assetId = plan?.assetId ?? req?.assetId;
    if (!due || !assetId) fail("job_incomplete", "A dated obligation and linked asset are required.", 400);
    const duplicate = state.jobs.find((item) => item.planId === plan?.id && item.dueDate === due && !!plan);
    if (duplicate) fail("job_exists", "A job has already been generated for this maintenance due date.");
    const id = crypto.randomUUID(), jobWorkId = `${work.workspace}-${command.commandId.replaceAll("-", "")}`, name = plan?.title ?? req!.title;
    const approved = req?.serviceEstimate;
    const authorized = approved?.status === "Approved" && approved.requestCycleAt === (req?.reopenedAt ?? req?.reportedAt) && req?.serviceAuthorization?.estimateRevision === approved.revision ? req.serviceAuthorization : undefined;
    const pricing = approved && authorized ? { estimateRevision: approved.revision, policyId: approved.policySnapshot.id, policyVersion: approved.policySnapshot.version, currency: authorized.currency, amountMinor: authorized.amountMinor, customerAuthorizationSource: authorized.source } : undefined;
    const job: ServiceJob = { id, workId: jobWorkId, assetIds: [assetId], requestId: req?.id, planId: plan?.id, dueDate: due, status: "Generated", evidence: [], createdAt: now };
    state.jobs.push(job); if (req) { req.currentCycleJobIds ??= [...req.jobIds]; req.jobIds.push(id); req.currentCycleJobIds.push(id); req.status = "In progress"; }
    if (plan) { plan.generatedDates.push(due); if (plan.mode === "Fixed date") { const next = new Date(`${due}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + plan.frequencyDays); plan.nextDue = next.toISOString().slice(0, 10); } }
    related = { id: jobWorkId, workspace: work.workspace, title: `${name} · ${state.assets.find((item) => item.id === assetId)?.name ?? "supported asset"}`, type: "Lifecycle service", customer: work.customer, site: work.site, stage: "Design", owner: text(command.owner) || req?.owner || plan?.owner || actor.name, nextAction: req && ["Chargeable", "Partially covered"].includes(req.coverage) && !pricing ? "Obtain customer service authorization before Design release" : "Confirm service execution basis and release", progress: 0, value: pricing ? `${formatMinor(pricing.amountMinor, pricing.currency)} authorized service basis` : "Unpriced service work", status: "attention", proof: [], blockers: [], history: [`${now} · Service job generated from ${work.id}; execution requires Design release and Deploy authorization.`], phaseConfigurationVersionId: work.phaseConfigurationVersionId, serviceSource: { parentWorkId: work.id, assetIds: [assetId], requestId: req?.id, requestCycleAt: req?.reopenedAt ?? req?.reportedAt, coverage: req?.coverage === "Covered" || req?.coverage === "Partially covered" || req?.coverage === "Chargeable" ? req.coverage : undefined, maintenancePlanId: plan?.id, pricing } };
    addEvent(plan ? "Maintenance job generated" : "Service job generated", jobWorkId);
  } else if (command.action === "link-execution") {
    requireManager(); const job = state.jobs.find((item) => item.id === command.id);
    const execution = all.find((item) => item.id === job?.workId && item.workspace === work.workspace && item.serviceSource?.parentWorkId === work.id && item.serviceSource.requestId === job?.requestId && item.serviceSource.maintenancePlanId === job?.planId && job.assetIds.every((id) => item.serviceSource?.assetIds.includes(id)));
    if (!job || !execution || !execution.deploy) fail("execution_missing", "The linked service Work Record has no Deploy execution history.");
    if (job.requestId) {
      const sourceRequest = state.requests.find((item) => item.id === job.requestId);
      if (!sourceRequest || !(sourceRequest.currentCycleJobIds ?? sourceRequest.jobIds).includes(job.id)
        || execution.serviceSource?.requestCycleAt !== (sourceRequest.reopenedAt ?? sourceRequest.reportedAt))
        fail("service_cycle_stale", "This visit belongs to an earlier request cycle. Preserve its history and generate current-cycle work.");
    }
    if (job.status === "Completed") fail("execution_already_linked", "This completed visit already has a retained execution basis.");
    const reviewed = execution.deploy.reports.filter((report) => {
      if (report.status !== "Reviewed") return false;
      const release = execution.design?.releases.find((item) => item.id === report.releaseId && item.packageId === report.packageId && item.receivedAt && !["Awaiting receipt", "Returned"].includes(item.status));
      const permit = execution.deploy?.permits.filter((item) => item.packageId === report.packageId && item.releaseId === report.releaseId && item.at <= report.capturedAt && item.at <= report.receivedAt).at(-1);
      const authorizedAtCapture = permit?.status === "Authorized" || (permit?.status === "Held" && !!permit.heldAt && report.capturedAt < permit.heldAt);
      return !!release && authorizedAtCapture;
    });
    if (!reviewed.length) fail("execution_unreviewed", "A reviewed report tied to an accepted Design release and authorized field start is required before updating asset history.");
    const refs = reviewed.map((item) => `${execution.id}:report:${item.id}:r${item.revision}`);
    if (refs.every((ref) => job.evidence.includes(ref))) fail("execution_already_linked", "These exact reviewed report revisions are already linked to the service job.");
    job.evidence = [...new Set([...job.evidence, ...refs])]; job.status = "Execution linked"; job.linkedByActorId = actor.id;
    for (const id of job.assetIds) { const item = state.assets.find((entry) => entry.id === id); if (item) for (const ref of refs) if (!item.history.some((entry) => entry.source === ref)) item.history.push({ at: now, action: "Reviewed service execution linked", source: ref, actorId: actor.id }); }
    addEvent("Reviewed execution linked", execution.id);
  } else if (command.action === "complete-job") {
    requireOperations(); const job = state.jobs.find((item) => item.id === command.id);
    if (!job || job.status !== "Execution linked" || !job.evidence.length || job.linkedByActorId === actor.id || reason.length < 10) fail("job_completion_invalid", "A different operations authority must review linked execution and record completion basis.");
    const execution = all.find((item) => item.id === job.workId && item.workspace === work.workspace && item.serviceSource?.parentWorkId === work.id);
    if (!execution) fail("execution_missing", "The service Work Record is unavailable for completion review.");
    if (job.requestId) {
      const sourceRequest = state.requests.find((item) => item.id === job.requestId);
      if (!sourceRequest || !(sourceRequest.currentCycleJobIds ?? sourceRequest.jobIds).includes(job.id)
        || execution.serviceSource?.requestCycleAt !== (sourceRequest.reopenedAt ?? sourceRequest.reportedAt))
        fail("service_cycle_stale", "An earlier service visit cannot complete the reopened request's current cycle.");
    }
    const packageIds = [...new Set(execution.design?.releases.map((item) => item.packageId) ?? [])];
    if (!packageIds.length) fail("job_scope_incomplete", "The service job has no released package scope to complete.");
    const completions = packageIds.map((packageId) => {
      const release = currentAcceptedRelease(execution, packageId);
      return release?.snapshot?.completionBasis ? currentReviewedCompletion(execution, packageId) : null;
    });
    if (completions.some((item) => !item)) fail("job_scope_incomplete", "Every service package requires current reviewed completion against its accepted release and verification.");
    job.completionRefs = completions.map((item) => `${execution.id}:completion:${item!.id}:release:${item!.releaseId}`);
    job.status = "Completed"; job.completedAt = now; job.completedByActorId = actor.id; job.completionReason = reason;
    if (job.planId) { const plan = state.maintenance.find((item) => item.id === job.planId); if (plan?.mode === "Completion relative") { const next = new Date(now); next.setUTCDate(next.getUTCDate() + plan.frequencyDays); plan.nextDue = next.toISOString().slice(0, 10); } }
    addEvent("Service visit completed", job.id);
  } else if (command.action === "resolve-request") {
    requireManager(); const item = request();
    if (!text(command.resolution) || !text(command.reviewSource)) fail("resolution_incomplete", "Record the resolution and its review source.", 400);
    if (!["Triaged", "In progress"].includes(item.status) || item.activePause) fail("resolution_state_invalid", "An active, unpaused request is required for reviewed resolution.");
    const cycleJobs = item.currentCycleJobIds ?? item.jobIds;
    if (cycleJobs.length && !cycleJobs.every((id) => state.jobs.some((job) => job.id === id && job.status === "Completed" && job.evidence.length))) fail("resolution_evidence_missing", "Every current-cycle service job requires independently completed, reviewed execution evidence before request resolution.");
    if (item.reopenedAt && !cycleJobs.length && command.resolutionMethod !== "Remote") fail("resolution_evidence_missing", "A reopened request needs a current-cycle reviewed job or an explicit remote resolution source.");
    item.status = "Resolved"; item.resolution = text(command.resolution, 2000); item.resolutionSource = text(command.reviewSource); item.reviewedBy = actor.id; item.resolvedAt = now; item.restoredAt ??= now; item.history.push({ at: now, action: "Resolution reviewed", actorId: actor.id, note: `${item.resolution} · source ${item.resolutionSource}` }); addEvent("Request resolution reviewed", item.id);
  } else if (command.action === "close-request") {
    requireOperations(); const item = request(); if (item.status !== "Resolved" || reason.length < 10) fail("request_close_invalid", "Review a resolved request and record the closure basis.");
    item.status = "Closed"; item.history.push({ at: now, action: "Closed", actorId: actor.id, note: reason }); addEvent("Service request closed", item.id);
  } else if (command.action === "reopen-request") {
    requireManager(); const item = request(); if (!["Resolved", "Closed"].includes(item.status) || reason.length < 10) fail("request_reopen_invalid", "A resolved or closed request and a new observed condition are required.");
    item.slaHistory = [...(item.slaHistory ?? []), { at: now, action: "Prior cycle retained", actorId: actor.id, reason: `Coverage ${item.coverage}; policy ${item.slaBasis?.configurationVersionId ?? "legacy"}; agreement ${item.slaBasis?.agreementId ?? "none"} revision ${item.slaBasis?.agreementRevision ?? "none"}; ${reason}`, responseDueAt: item.responseDueAt, restorationDueAt: item.restorationDueAt, resolutionDueAt: item.resolutionDueAt }];
    item.status = "Reopened"; item.reopenedAt = now; item.coverage = "Awaiting"; item.coverageBasis = undefined; item.agreementId = undefined; item.responseDueAt = undefined; item.restorationDueAt = undefined; item.resolutionDueAt = undefined; item.respondedAt = undefined; item.restoredAt = undefined; item.resolvedAt = undefined; item.slaBasis = undefined; item.activePause = undefined; item.currentCycleJobIds = [];
    item.history.push({ at: now, action: "Reopened", actorId: actor.id, note: reason }); addEvent("Service request reopened", item.id);
  } else if (command.action === "add-maintenance") {
    requireManager(); asset(); const days = command.frequencyDays;
    if (!text(command.title) || !date(command.dueDate) || !Number.isInteger(days) || days! < 1 || days! > policy.maxMaintenanceFrequencyDays || !text(command.skill)) fail("maintenance_incomplete", "Record an asset, task, due date, allowed frequency and skill.", 400);
    state.maintenance.push({ id: crypto.randomUUID(), assetId: command.assetId!, title: text(command.title), frequencyDays: days!, nextDue: command.dueDate!, mode: command.mode === "Completion relative" ? "Completion relative" : "Fixed date", owner: text(command.owner) || actor.name, skill: text(command.skill), expectedHours: typeof command.expectedHours === "number" && Number.isFinite(command.expectedHours) ? command.expectedHours : 0, requiredEvidence: text(command.requiredEvidence), status: "Active", revision: 1, generatedDates: [] }); addEvent("Maintenance plan created");
  } else if (command.action === "defer-maintenance") {
    requireOperations(); const plan = state.maintenance.find((item) => item.id === command.planId && item.status === "Active"); const revised = date(command.dueDate);
    if (!plan || !revised || revised <= plan.nextDue || reason.length < 10 || state.jobs.some((item) => item.planId === plan.id && item.dueDate === plan.nextDue)) fail("maintenance_deferral_invalid", "Defer an unissued active obligation to a later date with an operations reason.");
    plan.deferrals = [...(plan.deferrals ?? []), { originalDue: plan.nextDue, revisedDue: revised, reason, actorId: actor.id, at: now }]; plan.nextDue = revised; plan.revision++; addEvent("Maintenance due date deferred", plan.id);
  } else if (command.action === "add-review") {
    requireManager(); if (!text(command.contact) || !text(command.description)) fail("review_incomplete", "Record the customer contact and review outcome.", 400);
    state.customerReviews.push({ id: crypto.randomUUID(), at: now, contact: text(command.contact), summary: text(command.description, 2000), actions: text(command.note, 1000), owner: text(command.owner) || actor.name }); addEvent("Customer service review recorded");
  } else if (command.action === "open-lifecycle") {
    requireManager(); if (!text(command.rationale) || !text(command.owner)) fail("opportunity_incomplete", "Record a supported commercial rationale and pursuit owner.", 400);
    if (command.assetId && !state.assets.some((item) => item.id === command.assetId)) fail("asset_missing", "Select an asset on this Work Record.", 404);
    if (command.requestId && !state.requests.some((item) => item.id === command.requestId && (!command.assetId || item.assetId === command.assetId))) fail("request_missing", "Select a request linked to this support scope.", 404);
    const basis = `${command.assetId ?? ""}:${command.requestId ?? ""}:${text(command.rationale).toLowerCase()}`;
    if (state.lifecycleLinks.some((item) => command.requestId ? item.requestId === command.requestId : `${item.assetId ?? ""}:${item.requestId ?? ""}:${item.rationale.toLowerCase()}` === basis)) fail("opportunity_exists", "This underlying lifecycle opportunity is already linked.");
    const id = `${work.workspace}-${command.commandId.replaceAll("-", "")}`;
    related = { id, workspace: work.workspace, title: text(command.title) || `Lifecycle opportunity · ${work.customer}`, type: "Lifecycle service", customer: work.customer, site: work.site, stage: "Qualification", owner: text(command.owner), nextAction: "Qualify lifecycle need in Discover", progress: 0, value: "Indicative value unknown", status: "moving", proof: [], blockers: [], history: [`${now} · Originating Operate Work Record ${work.id}; rationale: ${text(command.rationale)}`], phaseConfigurationVersionId: work.phaseConfigurationVersionId, discovery: { source: "Lifecycle referral", need: text(command.rationale), procurement: "Unknown", phase: "Qualification", fit: "Unassessed", closeDate: "", estimate: { revision: 0, labor: 0, materials: 0, subcontract: 0, travel: 0, contingency: 0, targetMargin: 0, sellPrice: 0, status: "Not started", assumption: "" }, proposal: { status: "Not started", dueDate: "", method: "Customer portal", recipient: "", response: "" } } };
    state.lifecycleLinks.push({ id: crypto.randomUUID(), opportunityWorkId: id, assetId: command.assetId, requestId: command.requestId, rationale: text(command.rationale), owner: text(command.owner), at: now }); addEvent("Lifecycle opportunity opened", id);
  } else if (command.action === "update-finance") {
    if (!["admin", "billing_commercial_lead"].includes(actor.role)) fail("finance_role_denied", "Finance closeout requires Finance authority.", 403);
    if (!["Pending", "In review", "Closed"].includes(command.status ?? "") || reason.length < 10) fail("finance_incomplete", "Record a Finance status and reason.", 400);
    state.finance = { status: command.status as OperateState["finance"]["status"], owner: actor.name, note: reason, at: now }; addEvent("Finance closeout updated");
  } else if (command.action === "add-lesson") {
    requireManager(); if (!text(command.description) || !text(command.actionOwner) || !text(command.resolution)) fail("lesson_incomplete", "Record the lesson, action and owner.", 400);
    state.lessons.push({ id: crypto.randomUUID(), finding: text(command.description), owner: text(command.actionOwner), action: text(command.resolution), status: "Open" }); addEvent("Lesson and follow-through recorded");
  } else fail("invalid_command", "Unknown Operate action.", 400);
  return { work: { ...work, operate: state, history: [`${now} · Operate ${state.events[0].action} by ${actor.name}`, ...work.history] }, related, updatedRelated };
}

export function assertSnapshotOperateIntegrity(before: Record<string, unknown>[], after: Record<string, unknown>[]) {
  const next = new Map(after.map((item) => [item.id, item]));
  for (const prior of before) {
    const item = next.get(prior.id);
    if (!item && (prior.operate || prior.serviceSource)) fail("protected_operate_deleted", "A Work Record with Operate or service-job history cannot be removed.");
    if (!item) continue;
    if (!sameJsonValue(prior.operate, item.operate)) fail("protected_operate_changed", "Operate records require a governed server command.");
    if (!sameJsonValue(prior.serviceSource, item.serviceSource)) fail("protected_service_source_changed", "A service Work Record's source identity requires a governed server command.");
  }
  for (const item of after) if (!before.some((prior) => prior.id === item.id) && (item.operate || item.serviceSource)) fail("protected_operate_import", "A new Work Record cannot import governed Operate or service-job history.");
}
