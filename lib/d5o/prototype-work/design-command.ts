import type { WorkRecord } from "@/components/d5o/platform/work-types";
import type { PackageCrewDemand } from "@/components/d5o/platform/schedule-model";
import { assessDesignPackage, designRequirementRefs, designState, documentRef, forecastDesignPackage, type DesignDocument, type DesignMaterial, type DesignPackage, type DesignReview, type DesignRelease } from "@/components/d5o/platform/design-model";
import { PrototypeWorkError } from "./store-error";
import { sameJsonValue } from "./semantic-json";
import { legacyDesignControlPolicy, type DesignControlPolicy } from "@/components/d5o/platform/design-policy";
import { serviceExecutionBasisIssue } from "./service-execution-basis";

export type DesignCommand = {
  action: "save-document" | "submit-document" | "return-document" | "approve-document" | "issue-document" | "save-package" | "save-demand" | "request-review" | "decide-review" | "record-customer-approval" | "record-change" | "resolve-change" | "acknowledge-hold" | "release-package" | "release-set" | "respond-receipt" | "withdraw-release" | "save-service-basis" | "revise-service-basis" | "submit-service-basis" | "accept-service-basis" | "return-service-basis";
  workId: string; expectedRevision: number; expectedDecisionRevision?: number; commandId: string; note?: string;
  expectedOperateRevision?: number; serviceBasis?: { scope: string; coveredScope?: string; uncoveredScope?: string; exclusions: string; completionCriteria: string; verification: string; coverageRationale: string; safety: string; access: string; resources: string; serviceCategory: string };
  document?: Partial<DesignDocument>; documentId?: string; documentRevision?: number; evidenceId?: string;
  package?: Partial<DesignPackage>; packageId?: string; packageIds?: string[];
  demand?: PackageCrewDemand;
  discipline?: DesignReview["discipline"]; assignee?: string; dueDate?: string;
  reviewId?: string; decision?: "Approved" | "Returned";
  releaseId?: string; response?: "Accepted" | "Returned"; receivingOwner?: string;
  customerParty?: string; authorityBasis?: string; source?: string; approvedAt?: string;
  changeId?: string; reason?: string; affectedRequirementIds?: string[]; affectedDocumentRefs?: string[]; technicalImpact?: string; commercialImpact?: string; scheduleImpact?: string;
};
export type DesignActor = { id: string; name: string; membershipId: string; role: string };
function fail(code: string, message: string, status = 409): never { throw new PrototypeWorkError(code, status, message); }
const editable = new Set(["admin", "operations_leader", "project_manager", "field_supervisor"]);
const engineering = new Set(["admin", "operations_leader", "project_manager"]);
const delivery = new Set(["admin", "operations_leader", "project_manager"]);
const same = sameJsonValue;
const clean = (value: unknown, max = 2000) => typeof value === "string" ? value.trim().slice(0, max) : "";
const list = (value: unknown) => Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string" && !!item.trim()).map((item) => item.trim()))] : [];
const date = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";

function requireReceived(work: WorkRecord) {
  if (work.discovery?.pursuitControl && (work.discovery.outcome !== "Won" || work.discovery.designHandoff?.status !== "accepted"))
    fail("design_handoff_required", "Accept the current exact Develop handoff before changing Design.");
  if (work.discovery?.pursuitControl && work.discovery.designHandoff?.brief.configurationVersionId !== work.phaseConfigurationVersionId)
    fail("design_source_stale", "The Design handoff does not match the Work Record configuration pin.");
  if (work.discovery?.pursuitControl && work.discovery.designHandoff?.brief.definitionRevision !== work.definition?.revision)
    fail("design_source_stale", "The current Define revision differs from the accepted Design source.");
}

function packageIds(work: WorkRecord) {
  return new Set(((work as WorkRecord & { packages?: Array<{ id: string }> }).packages ?? []).map((item) => item.id));
}

function validatePredecessors(state: ReturnType<typeof designState>, id: string, predecessors: string[], valid: Set<string>) {
  if (predecessors.includes(id) || predecessors.some((item) => !valid.has(item))) fail("invalid_predecessor", "Predecessors must be other packages on this Work Record.", 400);
  const edges = new Map(state.packages.map((item) => [item.packageId, item.packageId === id ? predecessors : item.predecessorIds]));
  const visit = (current: string, seen: Set<string>): boolean => current === id ? true : (edges.get(current) ?? []).some((next) => !seen.has(next) && visit(next, new Set([...seen, next])));
  if (predecessors.some((item) => visit(item, new Set([item])))) fail("cyclic_dependency", "Package dependencies cannot form a cycle.", 400);
}

export function applyDesignCommand(work: WorkRecord, command: DesignCommand, actor: DesignActor, crewDemand: PackageCrewDemand | null = null, policy: DesignControlPolicy = legacyDesignControlPolicy, allDemands: PackageCrewDemand[] = [], relatedWork: WorkRecord[] = []): WorkRecord {
  if (!editable.has(actor.role) || !actor.id || !actor.membershipId) fail("design_role_denied", "This membership cannot edit Design.", 403);
  if (!(["record-change", "acknowledge-hold"] as string[]).includes(command.action)) requireReceived(work);
  if (!command.commandId || command.commandId.length > 100) fail("invalid_command", "A command identity is required.", 400);
  const now = new Date().toISOString(), state = structuredClone(designState(work));
  if (state.history.some((event) => event.action.endsWith(` · ${command.commandId}`))) return work;
  const note = clean(command.note);
  const record = (action: string, packageId?: string, revision?: number) => { state.history.unshift({ at: now, actorId: actor.id, membershipId: actor.membershipId, action: `${action} · ${command.commandId}`, note, packageId, revision }); };
  const document = () => state.documents.find((item) => item.id === command.documentId && item.revision === command.documentRevision);
  const pkg = () => state.packages.find((item) => item.packageId === command.packageId);
  if (command.action === "save-document") {
    const input = command.document;
    if (!input || !clean(input.title) || !clean(input.type) || !clean(input.source)) fail("document_incomplete", "Document type, title, and source reference are required.", 400);
    const ids = packageIds(work), affected = list(input.packageIds);
    if (affected.some((id) => !ids.has(id))) fail("invalid_package_reference", "A document references a package outside this Work Record.", 400);
    const requirements = list(input.requirementIds), validRequirements = new Set(designRequirementRefs(work).map((item) => item.id));
    if (requirements.some((id) => !validRequirements.has(id))) fail("invalid_requirement_reference", "Select requirement IDs in the received Define baseline.", 400);
    const id = clean(input.id, 100) || crypto.randomUUID();
    const revision = Math.max(0, ...state.documents.filter((item) => item.id === id).map((item) => item.revision)) + 1;
    state.documents.push({ id, revision, type: clean(input.type, 100), title: clean(input.title, 200), source: clean(input.source), owner: clean(input.owner, 120) || actor.name, packageIds: affected, requirementIds: requirements, status: "Draft", dueDate: date(input.dueDate), createdAt: now });
    record("Document draft saved", undefined, revision);
  } else if (["submit-document", "return-document", "approve-document", "issue-document"].includes(command.action)) {
    const target = document(); if (!target) fail("document_missing", "The exact document revision is unavailable.");
    if (command.action === "submit-document") { if (target.status !== "Draft") fail("document_not_draft", "Only a draft can enter review."); target.status = "In review"; target.submittedByActorId = actor.id; }
    if (command.action === "return-document") { if (target.status !== "In review" || !engineering.has(actor.role) || target.submittedByActorId === actor.id || note.length < 15) fail("document_return_denied", "A separate reviewer must give a reason for returning this exact revision.", 403); target.status = "Returned"; target.returnNote = note; }
    if (command.action === "approve-document") { if (target.status !== "In review" || !engineering.has(actor.role) || target.submittedByActorId === actor.id) fail("document_review_denied", "A separate authorized engineering reviewer must approve the submitted revision.", 403); target.status = "Approved"; target.approvedByActorId = actor.id; }
    if (command.action === "issue-document") {
      if (target.status !== "Approved" || !engineering.has(actor.role)) fail("document_not_approved", "Approve the exact document revision before issue.", 403);
      if (state.releases.some((release) => release.documentRefs.some((ref) => ref.startsWith(`${target.id}@`) && ref !== documentRef(target)) && ["Awaiting receipt", "Accepted"].includes(release.status))) fail("field_revision_active", "An existing release still governs the earlier revision. Resolve the field change before issuing its replacement.");
      for (const prior of state.documents) if (prior.id === target.id && prior.revision !== target.revision && prior.status === "Issued for use") prior.status = "Superseded";
      target.status = "Issued for use"; target.issuedAt = now; target.issuedBy = actor.id;
    }
    record(command.action, undefined, target.revision);
  } else if (command.action === "save-package") {
    const input = command.package, id = clean(input?.packageId, 100);
    if (!input || !packageIds(work).has(id)) fail("invalid_package_reference", "Select an existing shared Work Package.", 400);
    const shared = ((work as WorkRecord & { packages?: Array<{ id: string; status?: string; installed?: number; tested?: number; accepted?: number }> }).packages ?? []).find((item) => item.id === id);
    if (shared?.status === "accepted" || Number(shared?.installed ?? 0) > 0 || Number(shared?.tested ?? 0) > 0 || Number(shared?.accepted ?? 0) > 0) fail("executed_package_locked", "A package with recorded field execution or acceptance cannot be redesigned through a draft. Control a new scope revision or follow-on package.");
    const prior = state.packages.find((item) => item.packageId === id);
    if (state.releases.some((item) => item.packageId === id && !["Withdrawn", "Returned", "Held"].includes(item.status))) fail("released_package_locked", "Receive a field hold acknowledgment before revising the released basis.");
    const predecessors = list(input.predecessorIds); validatePredecessors(state, id, predecessors, packageIds(work));
    const refs = list(input.documentRefs);
    if (refs.some((ref) => !state.documents.some((item) => documentRef(item) === ref && item.packageIds.includes(id)))) fail("invalid_document_reference", "Select exact document revisions linked to this package.", 400);
    const requirements = list(input.requirementIds), validRequirements = new Set(designRequirementRefs(work).map((item) => item.id));
    if (requirements.some((ref) => !validRequirements.has(ref))) fail("invalid_requirement_reference", "Select requirement IDs in the received Define baseline.", 400);
    const status = input.materialStatus;
    if (status && !["Unknown", "Planned", "Ordered", "Supplier confirmed", "Received", "Available"].includes(status)) fail("invalid_material_status", "Select a supported material position.", 400);
    const materialLines: DesignMaterial[] = (input.materialLines ?? []).map((item) => ({ id: clean(item.id, 100) || crypto.randomUUID(), item: clean(item.item, 200), quantity: Number(item.quantity), unit: clean(item.unit, 40), source: clean(item.source), status: item.status, requiredDate: date(item.requiredDate), forecastDate: date(item.forecastDate), alternative: clean(item.alternative), quoteDate: date(item.quoteDate), quoteExpiry: date(item.quoteExpiry), receivedQuantity: item.receivedQuantity === undefined ? undefined : Number(item.receivedQuantity), availableQuantity: item.availableQuantity === undefined ? undefined : Number(item.availableQuantity), confidence: item.confidence }));
    if (materialLines.some((line) => !Number.isFinite(line.quantity) || line.quantity < 0 || line.receivedQuantity !== undefined && (!Number.isFinite(line.receivedQuantity) || line.receivedQuantity < 0) || line.availableQuantity !== undefined && (!Number.isFinite(line.availableQuantity) || line.availableQuantity < 0) || !["Unknown", "Planned", "Ordered", "Supplier confirmed", "Received", "Available"].includes(line.status) || line.confidence && !["Unknown", "Planning assumption", "Supplier confirmed", "Physically counted"].includes(line.confidence) || line.quoteDate && line.quoteExpiry && line.quoteExpiry < line.quoteDate) || new Set(materialLines.map((line) => line.id)).size !== materialLines.length) fail("invalid_material_line", "Material quantities, quote dates, confidence, IDs, or statuses are invalid.", 400);
    const disposition = input.commercialDisposition;
    if (disposition && !["None", "Assessment required", "Routed to Develop"].includes(disposition)) fail("invalid_commercial_disposition", "Design cannot mark a commercial change resolved. Record the revised approval in Develop and receive a new source handoff.", 400);
    if (input.crewDemandRequired === false && (!["admin", "operations_leader"].includes(actor.role) || clean(input.crewExemptionReason).length < 20)) fail("crew_exception_denied", "An authorized leader must explain why this package needs no crew demand.", 403);
    const next: DesignPackage = { packageId: id, revision: (prior?.revision ?? 0) + 1, scope: clean(input.scope), location: clean(input.location), systems: clean(input.systems), requirementIds: requirements, predecessorIds: predecessors, documentRefs: refs, materials: clean(input.materials), materialLines, materialStatus: status ?? "Unknown", materialRequiredDate: date(input.materialRequiredDate), materialForecastDate: date(input.materialForecastDate), materialSource: clean(input.materialSource), access: clean(input.access), permit: clean(input.permit), safetyControls: clean(input.safetyControls), equipment: clean(input.equipment), method: clean(input.method), rollback: clean(input.rollback), verification: clean(input.verification), proof: clean(input.proof), acceptingAuthority: clean(input.acceptingAuthority), windowStart: date(input.windowStart), windowEnd: date(input.windowEnd), targetReleaseDate: date(input.targetReleaseDate), crewDemandRequired: input.crewDemandRequired !== false, crewExemptionReason: input.crewDemandRequired === false ? clean(input.crewExemptionReason) : "", commercialImpact: clean(input.commercialImpact), commercialDisposition: disposition ?? "None", status: "Draft" };
    if (input.completionBasis?.kind === "Measured") {
      const plannedQuantity = Number(input.completionBasis.plannedQuantity);
      const unit = clean(input.completionBasis.unit, 40);
      if (!Number.isFinite(plannedQuantity) || plannedQuantity <= 0 || !unit) fail("invalid_completion_basis", "Enter a positive planned quantity and unit.", 400);
      next.completionBasis = { kind: "Measured", plannedQuantity, unit };
    } else if (input.completionBasis?.kind === "Qualitative") {
      const criterion = clean(input.completionBasis.criterion);
      if (criterion.length < 10) fail("invalid_completion_basis", "Describe the qualitative completion criterion.", 400);
      next.completionBasis = { kind: "Qualitative", criterion };
    } else if (input.completionBasis) fail("invalid_completion_basis", "Choose a supported completion basis.", 400);
    state.packages = [...state.packages.filter((item) => item.packageId !== id), next];
    record("Package design revision saved", id, next.revision);
  } else if (command.action === "request-review") {
    const target = pkg(); if (!target) fail("package_detail_missing", "Complete package detail before requesting reviews.");
    const discipline = command.discipline;
    if (!discipline || !["Engineering", "Delivery", "Safety", "Quality", "Procurement"].includes(discipline) || !date(command.dueDate)) fail("review_incomplete", "Review discipline and due date are required. Customer approval requires its own externally sourced record.", 400);
    if (clean(command.assignee) !== `${discipline} review queue`) fail("review_assignment_invalid", "Design prototype reviews route to the named discipline queue, not an unverified individual.", 400);
    if (state.reviews.some((item) => item.packageId === target.packageId && item.revision === target.revision && item.discipline === discipline && item.status === "Requested")) fail("review_pending", "That exact package review is already pending.");
    state.reviews.push({ id: crypto.randomUUID(), packageId: target.packageId, revision: target.revision, discipline, status: "Requested", assignee: clean(command.assignee), dueDate: command.dueDate!, requestedAt: now, requestedByActorId: actor.id });
    target.status = "In review"; record(`Review requested: ${discipline}`, target.packageId, target.revision);
  } else if (command.action === "decide-review") {
    const review = state.reviews.find((item) => item.id === command.reviewId && item.status === "Requested");
    if (!review || !command.decision || !note) fail("review_decision_incomplete", "Select a pending review and record the decision reason.", 400);
    if (review.requestedByActorId === actor.id) fail("review_separation_required", "The requester cannot decide their own review.", 403);
    if (review.discipline === "Safety" && !["admin", "operations_leader"].includes(actor.role) || review.discipline !== "Safety" && !engineering.has(actor.role)) fail("review_role_denied", "This membership cannot decide this discipline review.", 403);
    review.status = command.decision; review.decidedAt = now; review.decidedByActorId = actor.id; review.decidedByMembershipId = actor.membershipId; review.note = note;
    const target = state.packages.find((item) => item.packageId === review.packageId);
    if (target && target.revision === review.revision) target.status = command.decision === "Returned" ? "Returned" : "In review";
    record(`Review ${command.decision.toLowerCase()}: ${review.discipline}`, review.packageId, review.revision);
  } else if (command.action === "record-customer-approval") {
    const target = pkg();
    if (!target || !engineering.has(actor.role) || !clean(command.customerParty) || !clean(command.authorityBasis) || !clean(command.source) || !date(command.approvedAt) || note.length < 20)
      fail("customer_approval_incomplete", "Record the customer party, authority basis, exact package revision, dated external source, and a 20-character recording note.", 400);
    state.customerApprovals ??= [];
    state.customerApprovals.push({ id: crypto.randomUUID(), packageId: target.packageId, packageRevision: target.revision, customerParty: clean(command.customerParty), authorityBasis: clean(command.authorityBasis), source: clean(command.source), approvedAt: command.approvedAt!, recordedAt: now, recordedByActorId: actor.id, recordedByMembershipId: actor.membershipId, note });
    record("External customer technical approval recorded", target.packageId, target.revision);
  } else if (command.action === "record-change") {
    const target = pkg(), source = clean(command.source), reason = clean(command.reason), affectedRequirements = list(command.affectedRequirementIds), affectedDocs = list(command.affectedDocumentRefs);
    if (!target || !source || reason.length < 20 || !clean(command.technicalImpact) || !clean(command.scheduleImpact)) fail("design_change_incomplete", "Record the source, reason, technical impact, and schedule impact of this exact package change.", 400);
    if (affectedRequirements.some((id) => !target.requirementIds.includes(id)) || affectedDocs.some((ref) => !target.documentRefs.includes(ref))) fail("invalid_change_reference", "Change references must belong to this package revision.", 400);
    if (state.changes?.some((item) => item.packageId === target.packageId && item.status === "Open")) fail("change_already_open", "Resolve the existing package change before opening another.");
    state.changes ??= [];
    state.changes.push({ id: crypto.randomUUID(), packageId: target.packageId, openedRevision: target.revision, sourceHandoffRevision: work.discovery?.designHandoff?.revision ?? null, source, reason, affectedRequirementIds: affectedRequirements, affectedDocumentRefs: affectedDocs, technicalImpact: clean(command.technicalImpact), commercialImpact: clean(command.commercialImpact), scheduleImpact: clean(command.scheduleImpact), status: "Open", openedAt: now, openedByActorId: actor.id });
    const groups = new Set(state.releases.filter((item) => item.packageId === target.packageId && item.releaseGroupId && ["Awaiting receipt", "Accepted"].includes(item.status)).map((item) => item.releaseGroupId));
    for (const release of state.releases.filter((item) => (item.packageId === target.packageId || item.releaseGroupId && groups.has(item.releaseGroupId)) && ["Awaiting receipt", "Accepted"].includes(item.status))) {
      release.status = "Hold pending acknowledgment"; release.holdAt = now; release.holdByActorId = actor.id; release.holdReason = reason;
    }
    record("Design change opened and field basis held", target.packageId, target.revision);
  } else if (command.action === "acknowledge-hold") {
    const release = state.releases.find((item) => item.id === command.releaseId && item.status === "Hold pending acknowledgment");
    if (!release || !note || release.holdByActorId === actor.id || !["field_supervisor", "operations_leader"].includes(actor.role)) fail("hold_acknowledgment_denied", "A separate Deploy-side member must acknowledge the exact held release with a reason.", 403);
    release.status = "Held"; release.holdAcknowledgedAt = now; release.holdAcknowledgedByActorId = actor.id; release.responseNote = note;
    record("Deploy acknowledged Design field hold", release.packageId, release.packageRevision);
  } else if (command.action === "resolve-change") {
    const change = state.changes?.find((item) => item.id === command.changeId && item.status === "Open"), target = change && state.packages.find((item) => item.packageId === change.packageId);
    if (!change || !target || !engineering.has(actor.role) || note.length < 20) fail("change_resolution_denied", "An Engineering member must record a reasoned resolution on the revised package.", 403);
    if (target.revision <= change.openedRevision || state.releases.some((item) => item.packageId === change.packageId && item.status === "Hold pending acknowledgment")) fail("change_resolution_premature", "Revise the package and obtain Deploy acknowledgment of every field hold first.");
    if (change.commercialImpact && (work.discovery?.designHandoff?.status !== "accepted" || (work.discovery.designHandoff.revision ?? 0) <= (change.sourceHandoffRevision ?? 0))) fail("commercial_reapproval_required", "A commercial-impacting change requires a newer accepted Develop handoff.");
    change.status = "Resolved"; change.resolvedAt = now; change.resolvedByActorId = actor.id; change.resolution = note;
    record("Design change resolved against revised package", change.packageId, target.revision);
  } else if (command.action === "release-package" || command.action === "release-set") {
    const serviceIssue = serviceExecutionBasisIssue(work, relatedWork);
    if (serviceIssue) fail("service_basis_blocked", serviceIssue);
    if (!delivery.has(actor.role)) fail("release_role_denied", "Delivery release requires an authorized workspace membership.", 403);
    if (!date(command.dueDate) || !clean(command.receivingOwner)) fail("receiver_required", "Set the receiving owner and receipt deadline.", 400);
    const sharedIds = packageIds(work);
    const requestedIds = command.action === "release-package" ? [clean(command.packageId, 100)] : list(command.packageIds);
    if (!requestedIds.length || requestedIds.some((id) => !sharedIds.has(id))) fail("invalid_release_set", "Select existing packages on this Work Record.", 400);
    if (command.action === "release-package" && !policy.allowPartialRelease && sharedIds.size > 1) fail("release_set_required", "This Work Type requires one exact release set, not an individual package.");
    if (command.action === "release-set" && (requestedIds.length !== sharedIds.size || [...sharedIds].some((id) => !requestedIds.includes(id)))) fail("release_set_incomplete", "The release set must include every shared Work Package under this policy.");
    const releaseGroupId = command.action === "release-set" ? crypto.randomUUID() : undefined;
    const selectedSet = command.action === "release-set" ? new Set(requestedIds) : new Set<string>();
    const pending: DesignRelease[] = requestedIds.map((id) => {
      const target = state.packages.find((item) => item.packageId === id);
      if (!target) fail("package_detail_missing", `Complete Design detail for package ${id}.`);
      if (state.releases.some((item) => item.packageId === id && ["Awaiting receipt", "Accepted"].includes(item.status))) fail("already_released", "An active release already governs this package.");
      const demand = allDemands.find((item) => item.workId === work.id && item.packageId === id) ?? (crewDemand?.packageId === id ? crewDemand : null);
      const assessment = assessDesignPackage({ ...work, design: state }, id, now, demand, policy, selectedSet);
      if (assessment.recommendation !== "Ready for release") fail("readiness_blocked", `${id}: ${assessment.findings.map((item) => item.message).join(" ")}`);
      if (state.reviews.some((item) => item.packageId === id && item.revision === target.revision && item.discipline === "Engineering" && item.status === "Approved" && item.decidedByActorId === actor.id)) fail("release_separation_required", "The engineering approver cannot also authorize Delivery release.", 403);
      return { id: crypto.randomUUID(), releaseGroupId, packageId: id, packageRevision: target.revision, documentRefs: [...target.documentRefs], sourceHandoffRevision: work.discovery?.designHandoff?.revision ?? null, definitionRevision: work.definition?.revision ?? null, configurationVersionId: work.phaseConfigurationVersionId ?? "", assessment, issuedAt: now, issuedByActorId: actor.id, issuedByMembershipId: actor.membershipId, receivingOwner: clean(command.receivingOwner), responseDueDate: command.dueDate!, status: "Awaiting receipt" as const, snapshot: structuredClone(target), documentSnapshots: structuredClone(state.documents.filter((item) => target.documentRefs.includes(documentRef(item)))), sourceSnapshot: work.discovery?.designHandoff?.brief ? structuredClone(work.discovery.designHandoff.brief) : null, crewDemandSnapshot: demand ? structuredClone(demand) : null };
    });
    state.releases.push(...pending);
    for (const release of pending) { state.packages.find((item) => item.packageId === release.packageId)!.status = "Approved"; record(releaseGroupId ? "Package released in Design set" : "Package released to Deploy", release.packageId, release.packageRevision); }
  } else if (command.action === "respond-receipt") {
    const release = state.releases.find((item) => item.id === command.releaseId && item.status === "Awaiting receipt");
    if (!release || !command.response || !note) fail("receipt_incomplete", "Select the pending release and record a receipt response with a reason.", 400);
    if (release.issuedByActorId === actor.id) fail("receipt_separation_required", "The issuing actor cannot accept or return their own release.", 403);
    if (command.response === "Accepted") for (const predecessor of release.snapshot.predecessorIds ?? []) {
      const current = state.packages.find((item) => item.packageId === predecessor);
      if (!current || !state.releases.some((item) => item.packageId === predecessor && item.packageRevision === current.revision && item.status === "Accepted"))
        fail("predecessor_receipt_required", `Deploy must accept the current release for predecessor ${predecessor} before receiving this package.`);
    }
    release.status = command.response; release.receivedAt = now; release.receivedByActorId = actor.id; release.receivedByMembershipId = actor.membershipId; release.responseNote = note;
    record(`Deploy receipt ${command.response.toLowerCase()}`, release.packageId, release.packageRevision);
  } else if (command.action === "withdraw-release") {
    const release = state.releases.find((item) => item.id === command.releaseId && item.status === "Awaiting receipt");
    if (!release || !note || !delivery.has(actor.role)) fail("withdraw_denied", "An authorized delivery actor must record why the pending release is withdrawn.", 403);
    release.status = "Withdrawn"; release.responseNote = note; record("Release withdrawn", release.packageId, release.packageRevision);
  } else fail("invalid_command", "Unknown Design command.", 400);
  state.forecasts ??= [];
  for (const detail of state.packages) {
    const latest = forecastDesignPackage({ ...work, design: state }, detail.packageId, now, policy);
    const previous = [...state.forecasts].reverse().find((item) => item.packageId === detail.packageId);
    if (!previous || !same({ ...previous, at: "", packageRevision: 0 }, { ...latest, at: "", packageRevision: 0 })) state.forecasts.push(latest);
  }
  const registers = command.action === "save-package" && command.package?.packageId ? { ...work.phaseRegisters, "design.verification_plan": [ ...(work.phaseRegisters?.["design.verification_plan"] ?? []).filter((row) => row.package !== command.package!.packageId), ...(command.package.verification && command.package.proof && command.package.acceptingAuthority ? [{ package: command.package.packageId, method: command.package.verification, proof: command.package.proof, authority: command.package.acceptingAuthority }] : []) ] } : work.phaseRegisters;
  return { ...work, design: state, phaseRegisters: registers, history: [`${now} · Design ${state.history[0].action} by ${actor.name} · ${note}`, ...work.history] };
}

export function assertSnapshotDesignIntegrity(before: Record<string, unknown>[], after: Record<string, unknown>[]) {
  const nextById = new Map(after.map((item) => [item.id, item]));
  for (const prior of before) {
    const next = nextById.get(prior.id);
    if (!next) continue;
    if (!same(prior.design, next.design)) fail("protected_design_changed", "Design detail, reviews, and releases require a server command.");
    const oldRegisters = prior.phaseRegisters as Record<string, unknown> | undefined;
    const newRegisters = next.phaseRegisters as Record<string, unknown> | undefined;
    for (const key of new Set([...Object.keys(oldRegisters ?? {}), ...Object.keys(newRegisters ?? {})].filter((key) => key.startsWith("design."))))
      if (!same(oldRegisters?.[key], newRegisters?.[key])) fail("protected_design_register_changed", "Design register changes require a controlled command.");
    const work = next as unknown as WorkRecord;
    if (work.discovery?.pursuitControl && (work.discovery.outcome !== "Won" || work.discovery.designHandoff?.status !== "accepted")) {
      if (!same(prior.packages ?? [], next.packages ?? []) || !same(oldRegisters?.["design.verification_plan"], newRegisters?.["design.verification_plan"])) fail("design_handoff_required", "Accept the Develop handoff before package planning.");
    }
    if (work.discovery?.pursuitControl && work.discovery.outcome === "Won") {
      const oldPackages = Array.isArray(prior.packages) ? prior.packages as Array<Record<string, unknown>> : [];
      const nextPackages = Array.isArray(next.packages) ? next.packages as Array<Record<string, unknown>> : [];
      for (const entry of nextPackages) {
        const original = oldPackages.find((item) => item.id === entry.id);
        const factsChanged = original ? ["installed", "tested", "accepted", "status"].some((key) => !same(original[key], entry[key])) : ["installed", "tested", "accepted"].some((key) => Number(entry[key] ?? 0) !== 0) || entry.status !== "planned";
        if (!factsChanged) continue;
        const detail = work.design?.packages.find((item) => item.packageId === entry.id);
        if (!detail || !work.design?.releases.some((item) => item.packageId === entry.id && item.packageRevision === detail.revision && item.status === "Accepted")) fail("deploy_receipt_required", "An accepted exact Design release is required before execution facts change.");
        for (const predecessor of detail.predecessorIds ?? []) {
          const current = work.design?.packages.find((item) => item.packageId === predecessor);
          if (!current || !work.design?.releases.some((item) => item.packageId === predecessor && item.packageRevision === current.revision && item.status === "Accepted"))
            fail("predecessor_receipt_required", `Accept the current release for predecessor ${predecessor} before recording dependent execution.`);
        }
      }
    }
  }
  for (const next of after) if (!before.some((item) => item.id === next.id) && next.design) fail("protected_design_changed", "New Work Records cannot import Design decisions through a snapshot.");
}
