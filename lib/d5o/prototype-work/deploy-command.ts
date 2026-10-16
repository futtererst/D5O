import type { WorkRecord } from "@/components/d5o/platform/work-types";
import type { SharedSchedule } from "@/components/d5o/platform/schedule-model";
import { assessDeployReadiness, assessPackageCompletion, currentAcceptedRelease, currentReviewedCompletion, deployState, type DeployActor, type FieldReport } from "@/components/d5o/platform/deploy-model";
import { legacyDeployControlPolicy, type DeployControlPolicy } from "@/components/d5o/platform/deploy-policy";
import { PrototypeWorkError } from "./store-error";
import { sameJsonValue } from "./semantic-json";
import { serviceExecutionBasisIssue } from "./service-execution-basis";

export type DeployCommand = {
  action: "authorize-start" | "hold" | "resume" | "save-report" | "submit-report" | "review-report" | "review-completion" | "record-inspection" | "review-inspection" | "raise-prestart-concern" | "raise-issue" | "resolve-issue" | "attach-evidence" | "review-evidence" | "capture-customer-signoff" | "assemble-turnover" | "accept-client" | "accept-work" | "respond-operate" | "respond-operate-work";
  workId: string; packageId?: string; expectedRevision: number; commandId: string; note?: string;
  expectedDesignRevision?: number; expectedScheduleRevision?: number; expectedDecisionRevision?: number;
  permitId?: string; reportId?: string; inspectionId?: string; issueId?: string; turnoverId?: string;
  bookingId?: string; publicationId?: string; date?: string; quantity?: number; unit?: string; laborHours?: number; material?: string; summary?: string; evidenceIds?: string[]; capturedAt?: string;
  decision?: "Reviewed" | "Returned" | "Verified" | "Accepted" | "Declined";
  requirementId?: string; requirement?: string; method?: string; result?: "Pass" | "Fail"; supersedesId?: string;
  title?: string; impact?: string; owner?: string; resolution?: string;
  signerName?: string; signerOrganization?: string; signerRole?: string; authorityBasis?: string; source?: string; signatureEvidenceId?: string; conditions?: string;
  evidenceId?: string; purpose?: string; caption?: string; exclusions?: string;
  operateOwner?: string; obligations?: string;
};
const manager = new Set(["admin", "operations_leader", "project_manager", "field_supervisor"]);
const quality = new Set(["admin", "operations_leader", "project_manager"]);
function fail(code: string, message: string, status = 409): never { throw new PrototypeWorkError(code, status, message); }
const clean = (value: unknown, max = 2000) => typeof value === "string" ? value.trim().slice(0, max) : "";
const same = sameJsonValue;
const finite = (value: unknown, max = 1000000) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max;
const list = (value: unknown) => Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string" && !!item.trim()).map((item) => item.trim()))] : [];
export const deployCommandFingerprint = (command: DeployCommand) => JSON.stringify(Object.entries(command).sort(([left], [right]) => left.localeCompare(right)));
export type DeployUpload = { id: string; filename: string; mimeType: string; sizeBytes: number; checksumSha256: string };

export function applyDeployCommand(work: WorkRecord, command: DeployCommand, actor: DeployActor, schedule: SharedSchedule | null, upload?: DeployUpload, policy: DeployControlPolicy = legacyDeployControlPolicy, relatedWork: WorkRecord[] = []): WorkRecord {
  if (!actor.id || !actor.membershipId || !command.commandId || command.commandId.length > 100) fail("invalid_command", "An authenticated actor and command identity are required.", 400);
  const state = structuredClone(deployState(work)), now = new Date().toISOString(), note = clean(command.note);
  state.evidence ??= [];
  const duplicate = state.events.find((event) => event.commandId === command.commandId);
  if (duplicate) {
    if (duplicate.actorId !== actor.id || duplicate.membershipId !== actor.membershipId || duplicate.fingerprint !== deployCommandFingerprint(command)) fail("command_reuse_conflict", "A command identity was reused for a different actor or action.", 409);
    return work;
  }
  const pkg = clean(command.packageId, 100), release = currentAcceptedRelease(work, pkg);
  const event = (action: string) => state.events.unshift({ id: crypto.randomUUID(), commandId: command.commandId, fingerprint: deployCommandFingerprint(command), at: now, actorId: actor.id, membershipId: actor.membershipId, action, packageId: pkg || undefined, note });
  const requireManager = () => { if (!manager.has(actor.role)) fail("deploy_role_denied", "This membership cannot authorize or review field work.", 403); };
  const booking = () => {
    const publication = schedule?.publications.findLast((item) => (!command.publicationId || item.id === command.publicationId) && item.assignments.some((assignment) => assignment.id === command.bookingId && assignment.workId === work.id && assignment.packageId === pkg));
    const assignment = publication?.assignments.find((item) => item.id === command.bookingId);
    if (!publication || !assignment) fail("booking_required", "Select a published booking for this exact Work Record and package.");
    if (actor.person && !assignment.people.includes(actor.person)) fail("assignment_required", "This worker is not assigned to the selected booking.", 403);
    if (!actor.person && !manager.has(actor.role)) fail("assignment_required", "Only the assigned crew or field supervisor can record this package.", 403);
    return { publication, assignment };
  };
  const requireAssignedPackage = () => {
    if (manager.has(actor.role)) return;
    if (!actor.person || !schedule?.publications.some((publication) => publication.assignments.some((assignment) => assignment.workId === work.id && assignment.packageId === pkg && assignment.people.includes(actor.person!))))
      fail("assignment_required", "This worker is not assigned to the package.", 403);
  };
  const evidenceIds = () => { const ids = list(command.evidenceIds); if (ids.some((id) => !state.evidence.some((item) => item.id === id && item.packageId === pkg && (manager.has(actor.role) || item.uploaderId === actor.id)))) fail("evidence_scope_invalid", "Evidence must belong to this package and be available to the reporting actor.", 400); return ids; };
  const unresolvedFailures = (packageId: string, releaseId: string) => state.inspections.filter((item) => item.packageId === packageId && item.releaseId === releaseId && item.result === "Fail" && item.status === "Verified" && !state.inspections.some((retest) => retest.supersedesId === item.id && retest.releaseId === releaseId && retest.requirementId === item.requirementId && retest.result === "Pass" && retest.status === "Verified"));
  const currentPermit = () => state.permits.filter((item) => item.packageId === pkg).at(-1);
  const requireStart = () => {
    if (!release) fail("release_unavailable", "An accepted, current Design release is required.");
    const permit = currentPermit();
    if (!permit || permit.status !== "Authorized" || permit.releaseId !== release.id) fail("start_required", "A current authorized start or resume is required.");
    if (assessDeployReadiness(work, pkg, schedule, policy).recommendation !== "Ready for authorized start") fail("readiness_changed", "Field conditions changed. Reassess before further authorized execution.");
    return permit;
  };
  if (["authorize-start", "resume"].includes(command.action)) {
    const serviceIssue = serviceExecutionBasisIssue(work, relatedWork);
    if (serviceIssue) fail("service_basis_blocked", serviceIssue);
    requireManager();
    const readiness = assessDeployReadiness(work, pkg, schedule, policy);
    if (readiness.recommendation !== "Ready for authorized start" || !readiness.releaseId || (release?.snapshot.crewDemandRequired !== false && !readiness.publicationId)) fail("start_blocked", readiness.findings[0]?.fact ?? "Field readiness is incomplete.");
    if (command.action === "resume" && currentPermit()?.status !== "Held") fail("hold_required", "Resume requires a recorded hold.");
    if (command.action === "authorize-start" && currentPermit()?.status === "Authorized") fail("already_authorized", "This package already has an active start authorization.");
    if (note.length < 10) fail("reason_required", "Record the start or resume basis in at least 10 characters.", 400);
    state.permits.push({ id: crypto.randomUUID(), packageId: pkg, releaseId: readiness.releaseId, packageRevision: release!.packageRevision, publicationId: readiness.publicationId ?? "crew-exempt", scheduleRevision: schedule?.revision ?? 0, policyVersionId: work.phaseConfigurationVersionId ?? "legacy-deploy", status: "Authorized", at: now, actorId: actor.id, reason: note });
    event(command.action === "resume" ? "Work resumed" : "Field start authorized");
  } else if (command.action === "hold") {
    if (!actor.person && !manager.has(actor.role)) fail("hold_role_denied", "An assigned worker or field leader must report a stop.", 403);
    if (actor.person && !schedule?.publications.some((publication) => publication.assignments.some((assignment) => assignment.workId === work.id && assignment.packageId === pkg && assignment.people.includes(actor.person!)))) fail("assignment_required", "This worker is not assigned to the package.", 403);
    const permit = currentPermit(); if (!permit || permit.status !== "Authorized" || note.length < 10) fail("hold_incomplete", "An active start and a reason are required to hold work.", 400);
    permit.status = "Held"; permit.heldAt = now; event("Field work held");
  } else if (command.action === "save-report") {
    const { assignment } = booking();
    const factualRelease = release ?? work.design?.releases.filter((item) => item.packageId === pkg && ["Held", "Hold pending acknowledgment", "Withdrawn"].includes(item.status)).at(-1);
    if (!factualRelease) fail("release_unavailable", "The historical released execution basis is unavailable.");
    if (!finite(command.quantity) || !finite(command.laborHours, policy.maxActualHoursPerShift) || !clean(command.unit, 40) || !clean(command.summary, 1000)) fail("report_incomplete", "Record a valid quantity, unit, hours and summary within the configured shift limit.", 400);
    const prior = command.reportId ? state.reports.find((item) => item.id === command.reportId && item.packageId === pkg) : null;
    if (command.reportId && !prior) fail("report_missing", "The report to correct is unavailable.");
    if (prior && !manager.has(actor.role) && (prior.authorId !== actor.id || prior.bookingId !== assignment.id)) fail("report_scope_denied", "A worker can correct only their own report for this booking.", 403);
    if (prior && !["Draft", "Returned"].includes(prior.status)) fail("report_locked", "Submitted and signed reports cannot be overwritten. Return one for correction first.");
    const data: FieldReport = { id: prior?.id ?? crypto.randomUUID(), revision: (prior?.revision ?? 0) + 1, packageId: pkg, releaseId: factualRelease.id, bookingId: assignment.id, date: clean(command.date, 10) || assignment.date || now.slice(0, 10), quantity: command.quantity!, unit: clean(command.unit, 40), laborHours: command.laborHours!, material: clean(command.material), summary: clean(command.summary, 1000), evidenceIds: evidenceIds(), capturedAt: clean(command.capturedAt, 40) || now, receivedAt: now, authorId: actor.id, status: "Draft", history: [...(prior?.history ?? []), { revision: (prior?.revision ?? 0) + 1, at: now, reason: note || (release ? "Field draft saved" : "Factual report during release hold; authorization requires review") }] };
    if (prior) state.reports = state.reports.map((item) => item.id === prior.id ? data : item); else state.reports.push(data);
    event("Field report draft saved");
  } else if (command.action === "submit-report") {
    const serviceIssue = serviceExecutionBasisIssue(work, relatedWork);
    if (serviceIssue) fail("service_basis_blocked", serviceIssue);
    const report = state.reports.find((item) => item.id === command.reportId && item.packageId === pkg);
    if (!report || report.status !== "Draft" || report.authorId !== actor.id) fail("report_submit_denied", "Only the report author can submit their draft.", 403);
    requireStart(); report.status = "Submitted"; event("Field report submitted");
  } else if (command.action === "review-report") {
    requireManager(); const report = state.reports.find((item) => item.id === command.reportId && item.packageId === pkg);
    if (!report || report.status !== "Submitted" || report.authorId === actor.id || !["Reviewed", "Returned"].includes(command.decision ?? "") || note.length < 10) fail("report_review_denied", "An independent supervisor must review the submitted report with a reason.", 403);
    report.status = command.decision as "Reviewed" | "Returned"; report.reviewerId = actor.id; report.reviewNote = note; event(`Field report ${report.status.toLowerCase()}`);
  } else if (command.action === "review-completion") {
    if (!quality.has(actor.role)) fail("completion_role_denied", "An independent quality reviewer is required.", 403);
    const assessed = assessPackageCompletion(work, pkg);
    if (!assessed.ready || !assessed.release || !assessed.basis) fail("completion_blocked", assessed.blockers[0] ?? "Completion is not supported by current facts.");
    if (note.length < 10) fail("reason_required", "Explain the completion review against planned scope and verification.", 400);
    const reports = state.reports.filter((item) => assessed.reportIds.includes(item.id));
    if (reports.some((item) => item.authorId === actor.id)) fail("completion_separation_required", "The field author cannot approve completion.", 403);
    state.completions ??= [];
    if (currentReviewedCompletion(work, pkg)) fail("completion_already_reviewed", "This exact scope and evidence already have a current completion review.");
    state.completions.push({ id: crypto.randomUUID(), packageId: pkg, releaseId: assessed.release.id,
      packageRevision: assessed.release.packageRevision, basis: structuredClone(assessed.basis),
      reviewedQuantity: assessed.reviewedQuantity, unit: assessed.basis.kind === "Measured" ? assessed.basis.unit : null,
      reportIds: assessed.reportIds, inspectionIds: assessed.inspectionIds, reviewedAt: now,
      reviewerId: actor.id, membershipId: actor.membershipId, reason: note });
    event("Package completion reviewed against released scope");
  } else if (command.action === "record-inspection") {
    requireAssignedPackage();
    if (!release) fail("release_unavailable", "An accepted release is required.");
    const report = state.reports.find((item) => item.id === command.reportId && item.packageId === pkg && item.status === "Reviewed");
    if (!report || !clean(command.requirement) || !clean(command.method) || !["Pass", "Fail"].includes(command.result ?? "")) fail("inspection_incomplete", "Select a reviewed report, requirement, method and result.", 400);
    if (!manager.has(actor.role) && (report.authorId !== actor.id || report.bookingId !== command.bookingId)) fail("inspection_report_scope_denied", "A worker can inspect only their own reviewed report for this booking.", 403);
    const requirementIds = release.snapshot.requirementIds ?? [];
    if (requirementIds.length && !requirementIds.includes(clean(command.requirementId, 100))) fail("inspection_requirement_invalid", "Select a requirement from the released package basis.", 400);
    const superseded = command.supersedesId ? state.inspections.find((item) => item.id === command.supersedesId && item.packageId === pkg && item.result === "Fail") : null;
    if (command.supersedesId && !superseded) fail("retest_reference_invalid", "Retests must reference a failed inspection on this package.");
    if (superseded && (superseded.releaseId !== release.id || (superseded.requirementId && superseded.requirementId !== clean(command.requirementId, 100)))) fail("retest_basis_invalid", "A retest must use the same released requirement and execution basis as the failed result.");
    state.inspections.push({ id: crypto.randomUUID(), packageId: pkg, releaseId: release.id, reportId: report.id, requirementId: clean(command.requirementId, 100) || undefined, requirement: clean(command.requirement), method: clean(command.method), result: command.result!, note, evidenceIds: evidenceIds(), at: now, actorId: actor.id, status: "Submitted", supersedesId: superseded?.id }); event("Inspection result submitted");
  } else if (command.action === "review-inspection") {
    if (!quality.has(actor.role)) fail("quality_role_denied", "A quality reviewer is required.", 403);
    const inspection = state.inspections.find((item) => item.id === command.inspectionId && item.packageId === pkg && item.status === "Submitted");
    if (!inspection || inspection.actorId === actor.id || !["Verified", "Returned"].includes(command.decision ?? "") || note.length < 10) fail("inspection_review_denied", "A separate quality reviewer must decide the exact test result with a reason.", 403);
    if (command.decision === "Verified" && inspection.result === "Pass" && policy.requireReviewedEvidence && (!inspection.evidenceIds.length || inspection.evidenceIds.some((id) => !state.evidence.some((item) => item.id === id && item.packageId === pkg && item.state === "Reviewed")))) fail("inspection_evidence_required", "A passing inspection requires independently reviewed evidence linked to this exact package.");
    inspection.status = command.decision as "Verified" | "Returned"; inspection.reviewerId = actor.id; inspection.reviewNote = note; event(`Inspection ${inspection.status.toLowerCase()}`);
  } else if (command.action === "raise-prestart-concern") {
    const { publication, assignment } = booking();
    if (!actor.person || !command.publicationId || schedule?.publications.filter((item) => item.week === publication.week).at(-1)?.id !== publication.id)
      fail("current_assignment_required", "Only a worker on the current published booking may report a pre-start concern.", 403);
    if (release || work.design?.releases?.some((item) => item.packageId === pkg && ["Held", "Hold pending acknowledgment", "Withdrawn"].includes(item.status)))
      fail("prestart_concern_unavailable", "Use the released package issue workflow for this assignment.");
    const title = clean(command.title, 200), impact = clean(command.impact, 1000);
    if (title.length < 8 || impact.length < 10) fail("concern_incomplete", "Describe the concern and its impact before sending it to the Delivery Lead.", 400);
    state.issues.push({ id: crypto.randomUUID(), kind: "Pre-start concern", packageId: pkg, releaseId: null, bookingId: assignment.id, title, impact,
      owner: "Delivery Lead", status: "Open", evidenceIds: [], raisedAt: now, raisedBy: actor.id });
    event("Pre-start concern reported");
  } else if (command.action === "raise-issue") {
    requireAssignedPackage();
    const factualRelease = release ?? work.design?.releases.filter((item) => item.packageId === pkg && ["Held", "Hold pending acknowledgment", "Withdrawn"].includes(item.status)).at(-1);
    if (!factualRelease || !clean(command.title) || !clean(command.owner)) fail("issue_incomplete", "A historical released basis, issue and owner are required.", 400);
    state.issues.push({ id: crypto.randomUUID(), kind: "Field issue", packageId: pkg, releaseId: factualRelease.id, title: clean(command.title, 200), impact: clean(command.impact), owner: clean(command.owner, 100), status: "Open", evidenceIds: evidenceIds(), raisedAt: now, raisedBy: actor.id });
    const permit = currentPermit(); if (permit?.status === "Authorized") { permit.status = "Held"; permit.heldAt = now; }
    event("Field issue raised and active work held");
  } else if (command.action === "resolve-issue") {
    requireManager(); const issue = state.issues.find((item) => item.id === command.issueId && item.packageId === pkg && item.status === "Open");
    if (!issue || issue.raisedBy === actor.id || clean(command.resolution).length < 10) fail("issue_resolution_denied", "An independent leader must record the issue resolution.", 403);
    issue.status = "Resolved"; issue.resolution = clean(command.resolution); issue.resolvedAt = now; issue.resolvedBy = actor.id; event("Field issue resolved; resume remains separate");
  } else if (command.action === "attach-evidence") {
    requireAssignedPackage();
    if (!upload || !release || !clean(command.purpose) || !clean(command.caption)) fail("upload_incomplete", "A scoped uploaded file, purpose and caption are required.", 400);
    state.evidence.push({ ...upload!, packageId: pkg, releaseId: release.id, purpose: clean(command.purpose, 100), caption: clean(command.caption, 500), uploadedAt: now, uploaderId: actor.id, state: "Uploaded" }); event("Field file uploaded; content review pending");
  } else if (command.action === "review-evidence") {
    if (!quality.has(actor.role)) fail("evidence_review_denied", "An independent quality reviewer is required.", 403);
    const target = state.evidence.find((item) => item.id === command.evidenceId && item.packageId === pkg && item.state === "Uploaded");
    if (!target || target.uploaderId === actor.id || !["Reviewed", "Returned"].includes(command.decision ?? "") || note.length < 10) fail("evidence_review_incomplete", "Review the actual file with a reason; the uploader cannot approve it.", 403);
    target.state = command.decision === "Reviewed" ? "Reviewed" : "Rejected"; target.reviewerId = actor.id; target.reviewNote = note; target.reviewedAt = now; event(`Field evidence ${target.state.toLowerCase()}`);
  } else if (command.action === "capture-customer-signoff") {
    const captured = !!command.signatureEvidenceId;
    if (captured) requireAssignedPackage(); else requireManager();
    const report = state.reports.find((item) => item.id === command.reportId && item.packageId === pkg && item.status === "Reviewed");
    if (captured && report && (report.authorId !== actor.id || report.bookingId !== command.bookingId)) fail("signature_report_scope_denied", "A crew member may capture acknowledgment only for their own assigned report.", 403);
    const signature = captured ? state.evidence.find((item) => item.id === command.signatureEvidenceId && item.packageId === pkg && item.releaseId === report?.releaseId && item.uploaderId === actor.id && item.purpose === "Customer signature" && item.caption === `Captured for reviewed report ${report?.id}` && item.mimeType === "image/png" && item.state === "Uploaded" && !state.signoffs.some((signoff) => signoff.source === `evidence:${item.id}`)) : undefined;
    if (!report || (captured && !signature) || !clean(command.signerName) || !clean(command.signerOrganization) || !clean(command.signerRole) || !clean(command.authorityBasis) || (!captured && !clean(command.source))) fail("signoff_incomplete", "Select a reviewed report and record the customer identity, authority basis and valid signature source.", 400);
    if (state.signoffs.some((item) => item.recordId === report.id && item.recordRevision === report.revision)) fail("already_signed", "This exact report revision already has a customer record.");
    state.signoffs.push({ id: crypto.randomUUID(), kind: "Customer report acknowledgment", recordId: report.id, recordRevision: report.revision, releaseIds: [report.releaseId], scope: `${work.title} / ${pkg}`, statement: `Customer acknowledges field report ${report.id} revision ${report.revision}; this does not accept the entire Work Record.`, signerName: clean(command.signerName), signerOrganization: clean(command.signerOrganization), signerRole: clean(command.signerRole), method: captured ? "Captured on device" : "External source recorded", authorityBasis: clean(command.authorityBasis), source: captured ? `evidence:${signature!.id}` : clean(command.source), capturedByActorId: actor.id, at: now, outcome: "Acknowledged", conditions: clean(command.conditions), snapshot: structuredClone({ report, signature: signature ?? null }) }); event("Exact report customer acknowledgment recorded");
  } else if (command.action === "assemble-turnover") {
    requireManager(); if (!release) fail("release_unavailable", "The accepted release is unavailable.");
    if (!currentReviewedCompletion(work, pkg)) fail("completion_required", "Review complete planned scope and verification before assembling turnover.");
    const reports = state.reports.filter((item) => item.packageId === pkg && item.releaseId === release.id && item.status === "Reviewed");
    if (!reports.length) fail("turnover_incomplete", "Review field reports before assembling turnover.", 400);
    state.turnovers.push({ id: crypto.randomUUID(), revision: state.turnovers.filter((item) => item.releaseIds.includes(release.id)).length + 1, releaseIds: [release.id], reportIds: reports.map((item) => item.id), inspectionIds: state.inspections.filter((item) => item.packageId === pkg && item.releaseId === release.id && item.status === "Verified" && item.result === "Pass").map((item) => item.id), issueIds: state.issues.filter((item) => item.packageId === pkg).map((item) => item.id), signoffIds: state.signoffs.filter((item) => reports.some((report) => report.id === item.recordId)).map((item) => item.id), assembledAt: now, assembledByActorId: actor.id, status: "Draft", operateOwner: "Configured Operations receiver queue", obligations: clean(command.obligations), receipt: "Awaiting" }); event("Turnover draft assembled");
  } else if (command.action === "accept-client") {
    if (!["admin", "operations_leader", "project_manager"].includes(actor.role)) fail("acceptance_role_denied", "Client acceptance requires a project authority.", 403);
    const turnover = state.turnovers.find((item) => item.id === command.turnoverId && item.status === "Draft" && item.releaseIds.includes(release?.id ?? ""));
    if (!turnover || turnover.assembledByActorId === actor.id || !release || !clean(command.signerName) || !clean(command.signerOrganization) || !clean(command.authorityBasis) || !clean(command.source)) fail("acceptance_incomplete", "An independent authority must record the exact turnover, customer identity and external acceptance source.", 403);
    if (!currentReviewedCompletion(work, pkg)) fail("completion_required", "Current reviewed completion is required before scoped customer acceptance.");
    if (state.issues.some((item) => item.packageId === pkg && item.status === "Open") || unresolvedFailures(pkg, release.id).length || !turnover.inspectionIds.length || !turnover.reportIds.length) fail("acceptance_blocked", "Resolve open issues and failed tests, then verify passing inspections and completion reports before acceptance.");
    if ((release.snapshot.requirementIds ?? []).some((id) => !turnover.inspectionIds.some((inspectionId) => state.inspections.some((item) => item.id === inspectionId && item.requirementId === id)))) fail("acceptance_coverage_missing", "Every released requirement needs a verified passing inspection in this turnover.");
    if (turnover.reportIds.some((id) => !state.reports.some((item) => item.id === id && item.status === "Reviewed" && item.releaseId === release.id)) || turnover.inspectionIds.some((id) => !state.inspections.some((item) => item.id === id && item.status === "Verified" && item.result === "Pass" && item.releaseId === release.id))) fail("turnover_stale", "The turnover references changed or unreviewed source records.");
    const conditional = !!clean(command.conditions);
    state.signoffs.push({ id: crypto.randomUUID(), kind: "Customer scope acceptance", recordId: turnover.id, recordRevision: turnover.revision, releaseIds: [...turnover.releaseIds], scope: `${work.title} / ${pkg}`, statement: `Customer ${conditional ? "conditionally accepts" : "accepts"} only turnover ${turnover.id} revision ${turnover.revision} and its listed package scope; this is not whole Work Record acceptance.`, signerName: clean(command.signerName), signerOrganization: clean(command.signerOrganization), signerRole: clean(command.signerRole), method: "External source recorded", authorityBasis: clean(command.authorityBasis), source: clean(command.source), capturedByActorId: actor.id, at: now, outcome: conditional ? "Conditional" : "Accepted", conditions: clean(command.conditions), snapshot: structuredClone(turnover) }); turnover.status = conditional ? "Conditionally accepted" : "Client accepted"; event(conditional ? "Conditional package acceptance recorded" : "Scoped package acceptance recorded");
  } else if (command.action === "accept-work") {
    if (!["admin", "operations_leader", "project_manager"].includes(actor.role)) fail("acceptance_role_denied", "Whole-work acceptance requires a project authority.", 403);
    if (state.workAcceptance || !clean(command.signerName) || !clean(command.signerOrganization) || !clean(command.signerRole) || !clean(command.authorityBasis) || !clean(command.source) || clean(command.conditions)) fail("work_acceptance_incomplete", "Whole-work Client Accepted requires an identified customer authority, source and no unresolved acceptance conditions.", 400);
    const packageIds = [...new Set([...(work.packages ?? []).map((item) => item.id), ...(work.design?.packages ?? []).map((item) => item.packageId)])];
    if (!packageIds.length) fail("work_acceptance_incomplete", "No Work Packages are available for whole-work acceptance.");
    const accepted = packageIds.map((id) => { const current = currentAcceptedRelease(work, id); return current && state.turnovers.find((item) => item.status === "Client accepted" && item.releaseIds.includes(current.id)); });
    if (accepted.some((item) => !item) || packageIds.some((id) => !currentReviewedCompletion(work, id)) || state.issues.some((item) => item.status === "Open")) fail("work_acceptance_blocked", "Every package needs current reviewed completion, scoped customer acceptance, and no open issues.");
    const turnovers = accepted.filter((item): item is NonNullable<typeof item> => !!item);
    if (turnovers.some((item) => item.assembledByActorId === actor.id)) fail("acceptance_independence", "The whole-work acceptance recorder must be independent of package turnover assembly.", 403);
    const releaseIds = turnovers.flatMap((item) => item.releaseIds);
    const id = crypto.randomUUID();
    state.workAcceptance = { id, revision: 1, turnoverIds: turnovers.map((item) => item.id), releaseIds, acceptedAt: now, recordedByActorId: actor.id, signerName: clean(command.signerName), signerOrganization: clean(command.signerOrganization), signerRole: clean(command.signerRole), authorityBasis: clean(command.authorityBasis), source: clean(command.source), conditions: clean(command.conditions), receipt: "Awaiting", operateOwner: turnovers.map((item) => item.operateOwner).join("; ") };
    state.signoffs.push({ id: crypto.randomUUID(), kind: "Final client acceptance", recordId: id, recordRevision: 1, releaseIds, scope: work.title, statement: `Customer accepts Work Record ${work.id} through package turnover revisions ${turnovers.map((item) => `${item.id}:${item.revision}`).join(", ")}; Operate receipt is independent.`, signerName: clean(command.signerName), signerOrganization: clean(command.signerOrganization), signerRole: clean(command.signerRole), method: "External source recorded", authorityBasis: clean(command.authorityBasis), source: clean(command.source), capturedByActorId: actor.id, at: now, outcome: "Accepted", conditions: clean(command.conditions), snapshot: structuredClone({ workId: work.id, turnovers, releaseIds }) });
    event("Whole Work Record Client Accepted");
  } else if (command.action === "respond-operate") {
    if (!["admin", "operations_leader"].includes(actor.role)) fail("operate_role_denied", "An independent receiving authority is required.", 403);
    const turnover = state.turnovers.find((item) => item.id === command.turnoverId && item.status === "Client accepted" && item.receipt === "Awaiting");
    if (!turnover || turnover.assembledByActorId === actor.id || !["Accepted", "Declined"].includes(command.decision ?? "") || note.length < 10) fail("operate_receipt_incomplete", "A separate receiver must accept or return the exact turnover with a reason.", 403);
    turnover.receipt = command.decision === "Accepted" ? "Accepted" : "Returned"; event(`Operate handoff ${turnover.receipt.toLowerCase()}`);
  } else if (command.action === "respond-operate-work") {
    if (!["admin", "operations_leader"].includes(actor.role)) fail("operate_role_denied", "An independent Operate receiver is required.", 403);
    const acceptance = state.workAcceptance;
    if (!acceptance || acceptance.receipt !== "Awaiting" || acceptance.recordedByActorId === actor.id || !["Accepted", "Declined"].includes(command.decision ?? "") || note.length < 10) fail("operate_receipt_incomplete", "A separate receiver must accept or return the exact whole-work handoff with a reason.", 403);
    if ((work.packages ?? []).some((item) => !acceptance.releaseIds.includes(currentAcceptedRelease(work, item.id)?.id ?? ""))) fail("operate_basis_stale", "The accepted Design release basis changed. Review the whole-work handoff before receipt.");
    acceptance.receipt = command.decision === "Accepted" ? "Accepted" : "Returned"; acceptance.receiptNote = note; acceptance.receivedByActorId = actor.id; acceptance.receivedAt = now; event(`Whole-work Operate handoff ${acceptance.receipt.toLowerCase()}`);
  } else fail("invalid_command", "Unknown Deploy action.", 400);
  return { ...work, deploy: state, history: [`${now} · Deploy ${state.events[0].action} by ${actor.name} · ${note}`, ...work.history] };
}

export function assertSnapshotDeployIntegrity(before: Record<string, unknown>[], after: Record<string, unknown>[]) {
  const nextById = new Map(after.map((item) => [item.id, item]));
  for (const prior of before) {
    const next = nextById.get(prior.id);
    if (!next) fail("protected_deploy_deleted", "A Work Record containing governed Deploy history cannot be removed.");
    if (!same(prior.deploy, next.deploy)) fail("protected_deploy_changed", "Deploy decisions and field records require a server command.");
    const priorPackages = Array.isArray(prior.packages) ? prior.packages as Array<Record<string, unknown>> : [];
    const nextPackages = Array.isArray(next.packages) ? next.packages as Array<Record<string, unknown>> : [];
    if ((prior.deploy || (prior.design as { releases?: unknown[] } | undefined)?.releases?.length) && !same(priorPackages.map((item) => [item.id, item.installed, item.tested, item.accepted, item.status]), nextPackages.map((item) => [item.id, item.installed, item.tested, item.accepted, item.status])))
      fail("protected_execution_changed", "Package execution facts require governed Deploy commands.");
  }
  for (const next of after) if (!before.some((item) => item.id === next.id) && next.deploy) fail("protected_deploy_import", "New Work Records cannot import Deploy decisions through a snapshot.");
}
