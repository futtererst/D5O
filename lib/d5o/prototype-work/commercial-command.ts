import type { ConfigurationInventory } from "@/lib/d5o/configuration/version-inventory";
import { sameJsonValue } from "./semantic-json";
import { phaseContractFromManifest } from "@/components/d5o/platform/published-phase-configuration";
import { assessCommercialAuthority, syntheticDemoCommercialProfiles } from "@/components/d5o/platform/commercial-authority";
import type { DesignHandoffBrief, WorkRecord, WorkspaceKey } from "@/components/d5o/platform/work-types";
import { evaluatePricing, type PricingInput, type PricingPolicyState } from "@/components/d5o/platform/develop-pricing";
import { PrototypeWorkError } from "./store-error";

export type CommercialCommand = {
  workId: string;
  expectedRevision: number;
  commandId?: string;
  expectedDecisionRevision?: number;
  packageRevision: number;
  action: "save-detailed-estimate" | "submit-solution" | "approve-solution" | "return-solution" | "submit-pricing" | "approve-margin-exception" | "approve-pricing" | "return-pricing" | "save-proposal-revision" | "submit-proposal" | "approve-proposal" | "return-proposal" | "record-customer-submission" | "record-customer-response" | "start-negotiated-revision" | "submit-design-handoff" | "accept-design-handoff" | "return-design-handoff";
  pricingInput?: PricingInput;
  offerInput?: { scope: string; assumptions: string; exclusions: string; commercialTerms: string; changeReason: string };
  dueDate?: string;
  note?: string;
  recipient?: string;
  method?: string;
  responseStatus?: "Clarification requested" | "Commercial negotiation" | "Decision deferred" | "Awarded" | "Not awarded";
  receivedAt?: string;
  sourceReference?: string;
  nextAction?: string;
  followUpDue?: string;
  handoffRevision?: number;
};

type Actor = { id: string; name: string; membershipId: string; role: string };
const invalid = (code: string, message: string, status = 409): never => { throw new PrototypeWorkError(code, status, message); };
const date = (value: string | undefined) => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value);
const same = sameJsonValue;

function requireApprovedDefinition(work: WorkRecord, inventory: ConfigurationInventory, requireEstimateSource = true) {
  const definition = work.definition;
  const source = work.discovery?.estimate.definitionSource;
  const pinned = inventory.versions.find((version) => version.id === work.phaseConfigurationVersionId);
  const contract = phaseContractFromManifest(pinned?.config_manifest_json, work.workspace);
  const configuredType = contract?.workTypes.find((type) => type.workTypeKey === definition?.configurationWorkTypeKey && type.workTypeLabel === work.type);
  if (inventory.status !== "ready") invalid("configuration_unavailable", "This workspace has no unique usable configuration mapping.");
  if (!definition) throw new PrototypeWorkError("definition_unapproved", 409, "The current Define baseline is unavailable.");
  if (definition.status !== "Approved") invalid("definition_unapproved", "The current Define baseline is not approved.");
  if (!pinned) throw new PrototypeWorkError("pinned_configuration_unavailable", 409, "The pinned configuration version is unavailable.");
  if (!["published", "superseded"].includes(pinned.status)) invalid("pinned_configuration_unavailable", "The pinned configuration version is unavailable.");
  if (!configuredType) throw new PrototypeWorkError("configured_work_type_unavailable", 409, "The pinned Work Type is unavailable in its published phase contract.");
  if (definition.configurationVersion !== pinned.id) invalid("definition_version_mismatch", "The approved Define version does not match the Work Record pin.");
  if ((configuredType.version === "prototype-v2" || definition.developHandoff) && (definition.developHandoff?.status !== "accepted" || definition.developHandoff.revision !== definition.revision))
    invalid("define_receipt_required", "Develop requires an accepted receipt for the current approved Define revision.");
  if (requireEstimateSource && (!source || source.revision !== definition.revision || source.configurationVersionId !== pinned.id || source.workTypeKey !== configuredType.workTypeKey))
    invalid("definition_source_unavailable", "The estimate is not bound to the current approved Define revision and pinned configuration.");
}

export function applyCommercialCommand(work: WorkRecord, command: CommercialCommand, actor: Actor, inventory: ConfigurationInventory, pricingState?: PricingPolicyState): WorkRecord {
  if (!work.discovery?.pursuitControl) invalid("not_controlled_work", "This command applies to controlled pursuits only.", 400);
  requireApprovedDefinition(work, inventory, !["save-detailed-estimate", "submit-solution", "approve-solution", "return-solution"].includes(command.action));
  const discovery = work.discovery!;
  const estimate = discovery.estimate;
  const proposal = discovery.proposal;
  const now = new Date().toISOString();
  const note = command.note?.trim() ?? "";
  if (!Number.isInteger(command.packageRevision) || command.packageRevision < 1) invalid("invalid_revision", "Provide the exact revision under review.", 400);
  if (command.action.endsWith("solution")) {
    const plan = work.develop;
    if (!plan || plan.revision !== command.packageRevision || !plan.selectedOptionId || !plan.selectionRationale?.trim()) invalid("solution_unavailable", "Select and explain a current solution before review.");
    const selectedOption = plan!.options.find((item) => item.id === plan!.selectedOptionId);
    const required = work.definition?.scopeControl?.requirements.filter((item) => item.state === "Confirmed") ?? [];
    if (!selectedOption || selectedOption.status !== "Viable" || selectedOption.unmetRequirements.trim() || required.some((item) => !selectedOption.requirementIds.includes(item.id))) invalid("solution_infeasible", "The selected option must meet every confirmed requirement and have no unresolved mandatory gap.");
    if (!plan!.laborStrategy.trim() || !plan!.procurementStrategy.trim() || !plan!.scheduleStrategy.trim() || !plan!.safetyStrategy.trim() || !plan!.qualityStrategy.trim() || !plan!.riskMitigation.trim()) invalid("strategy_incomplete", "Record the resource, procurement, schedule, safety, quality, and risk basis before review.");
    if (command.action === "submit-solution") {
      if (!date(command.dueDate)) invalid("solution_due_required", "Set a valid solution review due date.", 400);
      if (plan!.review?.revision === plan!.revision) invalid("solution_revision_required", "Revise the returned solution before resubmitting, or wait for the current review.");
      const active = pricingState?.activePricingPolicy;
      const policy = pricingState?.pricingPolicies?.find((item) => item.id === active?.id && item.version === active.version && item.status === "published" && item.workspace === work.workspace);
      if (!policy) invalid("pricing_policy_unavailable", "Publish and activate a tenant Develop policy before routing solution review.");
      const review = { revision: plan!.revision, status: "Submitted" as const, dueDate: command.dueDate!, submittedAt: now, submittedByActorId: actor.id, submittedByMembershipId: actor.membershipId, approverRole: policy!.solutionApproverRole ?? "operations_leader" as const, policyId: policy!.id, policyVersion: policy!.version };
      return { ...work, owner: review.approverRole, nextAction: `Review solution revision ${plan!.revision}`, nextActionDue: command.dueDate, develop: { ...plan!, review, history: [...plan!.history, { at: now, event: "solution submitted", note: `Policy ${review.policyId} v${review.policyVersion}; actor ${actor.id}` }] }, history: [`${now} · Solution revision ${plan!.revision} submitted by ${actor.name} (${actor.id})`, ...work.history] };
    }
    if (plan!.review?.status !== "Submitted" || plan!.review.revision !== plan!.revision) invalid("solution_not_in_review", "Only the submitted current solution revision can be decided.");
    const pendingReview = plan!.review!;
    if (actor.id === pendingReview.submittedByActorId) invalid("solution_separation_required", "The solution preparer cannot decide their own review.", 403);
    if (actor.role !== pendingReview.approverRole) invalid("solution_approver_denied", "Your authenticated membership is not the routed solution reviewer.", 403);
    if (!note) invalid("decision_note_required", "Record the solution review basis.", 400);
    const status = command.action === "approve-solution" ? "Approved" as const : "Returned" as const;
    return { ...work, owner: status === "Approved" ? work.owner : "Solutions architect · workspace role", nextAction: status === "Approved" ? "Complete and submit detailed estimate" : "Revise the selected solution", nextActionDue: null, develop: { ...plan!, review: { ...pendingReview, status, decidedAt: now, decidedByActorId: actor.id, decidedByMembershipId: actor.membershipId, note }, history: [...plan!.history, { at: now, event: `solution ${status.toLowerCase()}`, note }] }, history: [`${now} · Solution revision ${plan!.revision} ${status.toLowerCase()} by ${actor.name} (${actor.id}) · ${note}`, ...work.history] };
  }
  if (command.action === "save-detailed-estimate") {
    if (command.packageRevision !== estimate.revision + 1 || !command.pricingInput || !work.develop?.selectedOptionId || !work.develop.selectionRationale?.trim()) invalid("solution_basis_required", "Select a solution with rationale and the next estimate revision.");
    const input = command.pricingInput!;
    const solution = work.develop!;
    if (input.definitionRevision !== work.definition?.revision || input.solutionRevision !== solution.revision || input.workType !== work.type || input.customer !== work.customer || !Array.isArray(input.lines) || input.lines.length > 100) invalid("estimate_basis_mismatch", "The estimate must use the current Define, solution, Work Type, and customer basis.", 400);
    if (typeof input.currency !== "string" || typeof input.pricedAt !== "string" || typeof input.region !== "string" || !Number.isFinite(input.discountPercent) || typeof input.riskBasis !== "string" || input.lines.some((line) => !line || typeof line !== "object" || !["labor", "material", "equipment", "subcontract", "travel", "mobilization", "setup", "recurring", "other"].includes(line.category) || [line.id, line.scopeRef, line.description, line.quantity, line.unit, line.source, line.assumption].some((value) => typeof value !== "string") || line.rateId !== undefined && typeof line.rateId !== "string" || line.manualRate !== undefined && typeof line.manualRate !== "string" || line.procurement && (typeof line.procurement !== "object" || typeof line.procurement.earliestOrderDate !== "string" || typeof line.procurement.requiredOnSite !== "string" || !["calendar", "working"].includes(line.procurement.calendar)))) invalid("invalid_estimate_input", "Each detailed line needs a supported category, unit, source, assumption and valid procurement fields.", 400);
    const active = pricingState?.activePricingPolicy;
    const policy = pricingState?.pricingPolicies?.find((item) => item.id === active?.id && item.version === active.version && item.status === "published" && item.workspace === work.workspace);
    if (!policy) invalid("pricing_policy_unavailable", "An active published tenant pricing policy is required.");
    const evaluation = evaluatePricing(policy!, input);
    if (evaluation.issues.some((item) => ["policy", "basis", "method", "ambiguous_rate", "overflow", "price"].includes(item.code))) invalid("invalid_estimate", evaluation.issues.map((item) => item.message).join(" "), 422);
    const major = (category: string) => evaluation.lines.filter((line) => line.category === category).reduce((sum, line) => sum + line.amountMinor, 0) / 10 ** (input.currency === "JPY" ? 0 : 2);
    const now = new Date().toISOString();
    const previous = estimate.revision > 0 ? { revision: estimate.revision, status: estimate.status, sellPrice: estimate.sellPrice, assumption: estimate.assumption, detailed: estimate.detailed ? structuredClone(estimate.detailed) : undefined, savedAt: estimate.detailed?.savedAt ?? now } : null;
    const next = { ...estimate, revision: command.packageRevision, status: "Draft" as const, labor: major("labor"), materials: major("material") + major("equipment"), subcontract: major("subcontract"), travel: major("travel") + major("mobilization") + major("setup") + major("other") + major("recurring"), contingency: (evaluation.contingencyMinor + evaluation.overheadMinor) / 10 ** (input.currency === "JPY" ? 0 : 2), targetMargin: policy!.targetMarginPercent, sellPrice: evaluation.proposedPriceMinor / 10 ** (input.currency === "JPY" ? 0 : 2), assumption: input.riskBasis, definitionSource: { revision: work.definition!.revision, configurationVersionId: work.phaseConfigurationVersionId!, workTypeKey: work.definition!.configurationWorkTypeKey!, capturedAt: now }, detailed: { input: structuredClone(input), evaluation, policySnapshot: structuredClone(policy!), savedAt: now }, revisionHistory: [...(estimate.revisionHistory ?? []), ...(previous ? [previous] : [])], review: undefined };
    return { ...work, value: `${input.currency} ${next.sellPrice.toFixed(input.currency === "JPY" ? 0 : 2)}`, nextAction: evaluation.issues.length ? "Resolve estimate inputs" : "Submit detailed estimate for pricing review", discovery: { ...discovery, phase: "Estimate", estimate: next }, history: [`${now} · Detailed estimate revision ${next.revision} saved from solution revision ${solution.revision}; ${evaluation.recommendation}; policy ${policy!.id} v${policy!.version}`, ...work.history] };
  }
  if (command.action === "approve-margin-exception") {
    const detail = estimate.detailed;
    if (!detail || estimate.revision !== command.packageRevision || estimate.status !== "Pricing review" || estimate.review?.revision !== estimate.revision) invalid("margin_exception_unavailable", "The current detailed estimate must be in pricing review.");
    if (!detail!.evaluation.issues.some((issue) => issue.code === "below_floor")) invalid("margin_exception_unavailable", "This estimate does not need a margin-floor exception.");
    if (detail!.evaluation.issues.some((issue) => issue.code !== "below_floor")) invalid("estimate_not_ready", "Resolve other estimate blockers before approving an exception.");
    if (actor.role !== (detail!.policySnapshot.marginExceptionRole ?? "admin") || actor.id === estimate.review!.submittedByActorId) invalid("margin_exception_denied", "The configured exception authority must be independent of the estimator.", 403);
    if (!note) invalid("decision_note_required", "Record the bounded exception basis.", 400);
    const exception = { revision: estimate.revision, policyId: detail!.evaluation.policyId, policyVersion: detail!.evaluation.policyVersion, actorId: actor.id, membershipId: actor.membershipId, role: actor.role, at: now, reason: note, marginPercent: detail!.evaluation.marginPercent ?? 0 };
    return { ...work, discovery: { ...discovery, estimate: { ...estimate, review: { ...estimate.review!, exception } } }, history: [`${now} · Margin-floor exception for estimate revision ${estimate.revision} authorized by ${actor.name} (${actor.id}) under ${exception.policyId} v${exception.policyVersion} · ${note}`, ...work.history] };
  }
  if (command.action.endsWith("pricing")) {
    if (estimate.revision !== command.packageRevision) invalid("stale_package", "The estimate revision changed; reopen the current revision.");
    if (command.action === "submit-pricing") {
      if (estimate.status !== "Draft" && estimate.status !== "Changes requested") invalid("invalid_transition", "Only a saved draft estimate can enter pricing review.");
      if (estimate.status === "Changes requested" && estimate.review?.revision === estimate.revision) invalid("revision_required", "Save a new estimate revision before resubmitting.");
      if (!date(command.dueDate) || !Number.isFinite(estimate.sellPrice) || estimate.sellPrice <= 0) invalid("invalid_pricing_submission", "A positive price and valid review due date are required.", 400);
      if (estimate.detailed) {
        const detail = estimate.detailed;
        if (work.develop?.review?.status !== "Approved" || work.develop.review.revision !== work.develop.revision) invalid("solution_approval_required", "The current solution revision needs a separate review decision before pricing review.");
        const recalculated = evaluatePricing(detail.policySnapshot, detail.input, detail.evaluation.calculatedAt);
        if (!same(recalculated, detail.evaluation) || recalculated.issues.some((issue) => issue.code !== "below_floor")) invalid("estimate_not_ready", "The saved detailed estimate has unresolved inputs or no longer matches its pinned calculation.");
        if (detail.input.solutionRevision !== work.develop?.revision || !work.develop.selectedOptionId) invalid("solution_changed", "The selected solution changed; prepare a new estimate revision.");
      }
      const updated = { ...estimate, status: "Pricing review" as const, review: { revision: estimate.revision, submittedAt: now, submittedBy: work.owner, submittedByActorId: actor.id, submittedByMembershipId: actor.membershipId, dueDate: command.dueDate }, pricingHistory: [...(estimate.pricingHistory ?? []), { revision: estimate.revision, state: "Submitted" as const, at: now, note: "Routed to synthetic pricing role queue", cost: estimate.labor + estimate.materials + estimate.subcontract + estimate.travel + estimate.contingency, sellPrice: estimate.sellPrice, targetMargin: estimate.targetMargin }] };
      return { ...work, owner: "Pricing authority · workspace role", nextAction: `Review estimate revision ${estimate.revision}`, nextActionDue: command.dueDate, nextActionImpact: "High", discovery: { ...discovery, phase: "Pricing review", estimate: updated }, history: [`${now} · Pricing revision ${estimate.revision} submitted by ${actor.name} (${actor.id}; membership ${actor.membershipId})`, ...work.history] };
    }
    if (!estimate.review) throw new PrototypeWorkError("invalid_transition", 409, "This estimate revision is not awaiting pricing review.");
    if (estimate.status !== "Pricing review" || estimate.review.revision !== estimate.revision) invalid("invalid_transition", "This estimate revision is not awaiting pricing review.");
    if (!note) invalid("decision_note_required", "Record the decision basis.", 400);
    if (actor.id === estimate.review.submittedByActorId) invalid("pricing_separation_required", "The estimator cannot decide their own pricing review.", 403);
    if (!["admin", "operations_leader"].includes(actor.role) || estimate.detailed && actor.role !== estimate.detailed.policySnapshot.pricingApproverRole) invalid("pricing_approver_denied", "Your authenticated workspace membership is not the routed pricing approver.", 403);
    if (command.action === "approve-pricing" && estimate.detailed?.evaluation.issues.some((issue) => issue.code === "below_floor") && (estimate.review.exception?.revision !== estimate.revision || estimate.review.exception.policyId !== estimate.detailed.evaluation.policyId || estimate.review.exception.policyVersion !== estimate.detailed.evaluation.policyVersion)) invalid("margin_exception_required", "The exact below-floor estimate needs an independent exception decision before pricing approval.");
    const approved = command.action === "approve-pricing";
    const state = approved ? "Approved" as const : "Changes requested" as const;
    const updated = { ...estimate, status: state, review: { ...estimate.review, decidedAt: now, decisionNote: note, decidedBy: actor.name, actorId: actor.id, membershipId: actor.membershipId }, pricingHistory: [...(estimate.pricingHistory ?? []), { revision: estimate.revision, state, at: now, note, cost: estimate.labor + estimate.materials + estimate.subcontract + estimate.travel + estimate.contingency, sellPrice: estimate.sellPrice, targetMargin: estimate.targetMargin }] };
    return { ...work, owner: estimate.review.submittedBy, nextAction: approved ? "Prepare customer proposal" : "Revise estimate and resubmit", nextActionDue: null, discovery: { ...discovery, phase: approved ? "Proposal" : "Estimate", estimate: updated }, history: [`${now} · Pricing revision ${estimate.revision} ${approved ? "approved" : "returned"} by ${actor.name} (${actor.id}; membership ${actor.membershipId}) · ${note}`, ...work.history] };
  }

  const offer = proposal.package;
  if (!offer) throw new PrototypeWorkError("stale_package", 409, "The proposal package is unavailable; reopen the current revision.");
  if (offer.revision !== command.packageRevision) invalid("stale_package", "The proposal package revision changed; reopen the current revision.");
  if (estimate.status !== "Approved" || estimate.review?.revision !== estimate.revision
      || offer.estimateRevision !== estimate.revision || offer.sellPrice !== estimate.sellPrice
      || !same(offer.definitionSource, estimate.definitionSource)) invalid("stale_estimate", "The offer must bind to the current approved estimate and Define source.");
  if (estimate.detailed && (!offer.pricingBasis || offer.pricingBasis.policyId !== estimate.detailed.evaluation.policyId || offer.pricingBasis.policyVersion !== estimate.detailed.evaluation.policyVersion || offer.pricingBasis.solutionRevision !== estimate.detailed.input.solutionRevision || offer.pricingBasis.currency !== estimate.detailed.input.currency || offer.pricingBasis.priceMinor !== estimate.detailed.evaluation.proposedPriceMinor)) invalid("offer_pricing_basis_mismatch", "The offer must copy the exact approved detailed pricing basis.");
  if (estimate.detailed && (work.develop?.review?.status !== "Approved" || work.develop.review.revision !== work.develop.revision || estimate.detailed.input.solutionRevision !== work.develop.revision || !work.develop.options.some((item) => item.id === work.develop!.selectedOptionId && item.status === "Viable"))) invalid("solution_changed", "The selected solution changed or is not approved; prepare a new estimate and obtain review before offer or handoff.");
  if (command.action.endsWith("design-handoff")) {
    const awarded = proposal.responseEvents?.at(-1);
    if (discovery.outcome !== "Won" || proposal.status !== "Submitted" || proposal.submission?.revision !== offer.revision || !same(proposal.submission.packageSnapshot, offer) || awarded?.status !== "Awarded" || awarded.revision !== offer.revision)
      invalid("award_unavailable", "An exact submitted and awarded offer is required before Design handoff.");
    const current = discovery.designHandoff;
    if (command.action === "submit-design-handoff") {
      if (current && current.status !== "returned") invalid("handoff_already_pending", "The current Design handoff must be accepted or returned before resubmission.");
      if (!date(command.dueDate)) invalid("handoff_due_required", "Set a valid Design receiver response due date.", 400);
      const definition = work.definition!;
      const brief: DesignHandoffBrief = { offerRevision: offer.revision, estimateRevision: offer.estimateRevision, definitionRevision: definition.revision, configurationVersionId: work.phaseConfigurationVersionId!, customerOutcome: definition.outcome, acceptance: definition.acceptance, offerScope: offer.scope, excludedScope: definition.excludedScope, deliveryApproach: definition.deliveryApproach, dependencies: definition.dependencies, risks: definition.risks, commercialTerms: offer.commercialTerms, awardBasis: awarded!.details, develop: estimate.detailed && work.develop?.selectedOptionId ? { solutionRevision: work.develop.revision, selectedOption: work.develop.selectedOptionId, selectedOptionSnapshot: structuredClone(work.develop.options.find((item) => item.id === work.develop!.selectedOptionId)!), selectionRationale: work.develop.selectionRationale ?? "", policyId: estimate.detailed.evaluation.policyId, policyVersion: estimate.detailed.evaluation.policyVersion, currency: estimate.detailed.input.currency, laborStrategy: work.develop.laborStrategy, procurementStrategy: work.develop.procurementStrategy, scheduleStrategy: work.develop.scheduleStrategy, safetyStrategy: work.develop.safetyStrategy, qualityStrategy: work.develop.qualityStrategy, riskMitigation: work.develop.riskMitigation, estimateSnapshot: structuredClone({ input: estimate.detailed.input, evaluation: estimate.detailed.evaluation, policySnapshot: estimate.detailed.policySnapshot }), offerSnapshot: structuredClone(offer) } : undefined };
      if (!brief.customerOutcome.trim() || !brief.acceptance.trim() || !brief.offerScope.trim() || !brief.deliveryApproach.trim()) invalid("handoff_brief_incomplete", "The approved outcome, acceptance, offer scope and delivery approach must be present before handoff.");
      const revision = (current?.revision ?? 0) + 1;
      const handoff = { revision, status: "submitted" as const, brief, responseDueDate: command.dueDate!, submittedAt: now, submittedBy: actor.name, submittedByActorId: actor.id, submittedByMembershipId: actor.membershipId };
      return { ...work, owner: "Design receiver queue · workspace role", nextAction: `Accept or return Design handoff revision ${revision}`, nextActionDue: command.dueDate, nextActionImpact: "High", discovery: { ...discovery, designHandoff: handoff, designHandoffHistory: [...(discovery.designHandoffHistory ?? []), { revision, state: "submitted" as const, at: now, actorId: actor.id, membershipId: actor.membershipId, note: "Award, approved Define and exact offer sent to Design receiver queue", brief }] }, history: [`${now} · Design handoff revision ${revision} submitted by ${actor.name} (${actor.id}; membership ${actor.membershipId}) from awarded proposal ${offer.revision}`, ...work.history] };
    }
    if (!current || current.status !== "submitted" || command.handoffRevision !== current.revision) invalid("stale_handoff", "Review the current submitted Design handoff revision.");
    const submittedHandoff = current!;
    if (actor.id === submittedHandoff.submittedByActorId) invalid("handoff_separation_required", "The submitting actor cannot accept or return their own Design handoff.", 403);
    if (!["admin", "operations_leader", "project_manager"].includes(actor.role)) invalid("handoff_role_denied", "This workspace role cannot respond to the Design handoff.", 403);
    if (!note || note.length < 20) invalid("handoff_decision_basis_required", "Record an acceptance or return basis of at least 20 characters.", 400);
    const accepted = command.action === "accept-design-handoff";
    const state = accepted ? "accepted" as const : "returned" as const;
    return { ...work, owner: accepted ? actor.name : submittedHandoff.submittedBy, nextAction: accepted ? "Prepare executable Work Packages in Design" : "Correct and resubmit the Design handoff", nextActionDue: null, nextActionImpact: "High", discovery: { ...discovery, designHandoff: { ...submittedHandoff, status: state, decidedAt: now, decidedBy: actor.name, decidedByActorId: actor.id, decidedByMembershipId: actor.membershipId, decisionNote: note }, designHandoffHistory: [...(discovery.designHandoffHistory ?? []), { revision: submittedHandoff.revision, state, at: now, actorId: actor.id, membershipId: actor.membershipId, note }] }, history: [`${now} · Design handoff revision ${submittedHandoff.revision} ${state} by ${actor.name} (${actor.id}; membership ${actor.membershipId}) · ${note}`, ...work.history] };
  }
  if (command.action === "record-customer-submission") {
    if (proposal.status !== "Approved" || proposal.review?.revision !== offer.revision || !proposal.review.decidedAt) invalid("offer_not_approved", "Approve this exact offer revision before recording customer submission.");
    const recipient = command.recipient?.trim() ?? "";
    const method = command.method?.trim() ?? "";
    if (!recipient || !["Customer portal", "Email", "Procurement platform", "Direct presentation"].includes(method) || !date(command.dueDate)) invalid("invalid_customer_submission", "A customer recipient, supported submission route and valid response due date are required.", 400);
    const submission = { revision: offer.revision, estimateRevision: offer.estimateRevision, recordedAt: now, recipient, method, responseDueDate: command.dueDate!, packageSnapshot: structuredClone(offer), recordedByActorId: actor.id, recordedByMembershipId: actor.membershipId };
    return { ...work, owner: proposal.review!.submittedBy, nextAction: "Track customer response", nextActionDue: command.dueDate, nextActionImpact: "High", discovery: { ...discovery, phase: "Submitted", proposal: { ...proposal, status: "Submitted", recipient, method, dueDate: command.dueDate!, submission, submissionHistory: [...(proposal.submissionHistory ?? (proposal.submission ? [proposal.submission] : [])), submission], history: [...(proposal.history ?? []), { revision: offer.revision, state: "Submitted to customer", at: now, note: `${method} · ${recipient}` }] } }, history: [`${now} · Proposal revision ${offer.revision} recorded as submitted by ${actor.name} (${actor.id}; membership ${actor.membershipId}) to ${recipient}; no external delivery`, ...work.history] };
  }
  if (command.action === "record-customer-response") {
    const submission = proposal.submission;
    if (proposal.status !== "Submitted" || !submission || submission.revision !== offer.revision || !same(submission.packageSnapshot, offer) || discovery.outcome) invalid("submitted_offer_unavailable", "Record a response against the exact submitted offer before an outcome is final.");
    const status = command.responseStatus;
    const details = command.note?.trim() ?? "";
    const nextAction = command.nextAction?.trim() ?? "";
    if (!status || !["Clarification requested", "Commercial negotiation", "Decision deferred", "Awarded", "Not awarded"].includes(status) || !date(command.receivedAt) || !details) invalid("invalid_customer_response", "A supported response, received date and customer basis are required.", 400);
    const isWon = status === "Awarded", isLost = status === "Not awarded";
    if (!isWon && !isLost && (!nextAction || !date(command.followUpDue))) invalid("follow_up_required", "A next action and valid follow-up date are required for an open customer response.", 400);
    const response = { revision: submission!.revision, status: status!, receivedAt: command.receivedAt!, details, nextAction: isWon || isLost ? undefined : nextAction, followUpDue: isWon || isLost ? undefined : command.followUpDue, recordedByActorId: actor.id, recordedByMembershipId: actor.membershipId };
    return { ...work, owner: isWon ? "Design receiver · unassigned" : proposal.review?.submittedBy ?? work.owner, ...(isWon ? { stage: "Authorize & Readiness", status: "moving" as const, nextAction: "Assign Design receiver and accept award handoff", nextActionDue: null } : isLost ? { stage: "Close & Lifecycle", status: "complete" as const, nextAction: "Review loss and capture learning", nextActionDue: null } : { nextAction, nextActionDue: command.followUpDue, nextActionImpact: "High" as const }), discovery: { ...discovery, phase: isWon || isLost ? "Outcome" as const : discovery.phase, outcome: isWon ? "Won" as const : isLost ? "Lost" as const : discovery.outcome, outcomeNote: isWon || isLost ? details : discovery.outcomeNote, proposal: { ...proposal, response: details, responseEvents: [...(proposal.responseEvents ?? []), response], history: [...(proposal.history ?? []), { revision: response.revision, state: `Customer response · ${status}`, at: now, note: details }] } }, history: [`${now} · Customer response to proposal revision ${response.revision}: ${status}, recorded by ${actor.name} (${actor.id}; membership ${actor.membershipId}) · ${details}`, ...work.history] };
  }
  if (command.action === "start-negotiated-revision") {
    const submission = proposal.submission;
    const latest = proposal.responseEvents?.at(-1);
    if (proposal.status !== "Submitted" || discovery.outcome || !submission || submission.revision !== offer.revision || !latest || latest.revision !== submission.revision || !["Clarification requested", "Commercial negotiation"].includes(latest.status)) invalid("negotiation_not_requested", "Record a customer clarification or negotiation against the current submitted offer first.");
    return { ...work, nextAction: `Prepare negotiated proposal revision ${offer.revision + 1}`, nextActionDue: latest!.followUpDue ?? work.nextActionDue, nextActionImpact: "High", discovery: { ...discovery, phase: "Proposal", proposal: { ...proposal, status: "Draft", history: [...(proposal.history ?? []), { revision: submission!.revision, state: "Negotiated revision started", at: now, note: `Customer ${latest!.status.toLowerCase()}: ${latest!.details}` }] } }, history: [`${now} · Negotiated proposal revision started from submitted revision ${submission!.revision} by ${actor.name} (${actor.id}; membership ${actor.membershipId})`, ...work.history] };
  }
  if (command.action === "submit-proposal") {
    if (proposal.status !== "Draft" && proposal.status !== "Changes requested") invalid("invalid_transition", "Only a saved proposal package can enter review.");
    if (proposal.status === "Changes requested" && proposal.review?.revision === offer.revision) invalid("revision_required", "Save a new proposal revision before resubmitting.");
    if (!date(command.dueDate) || !offer.scope.trim() || !offer.commercialTerms.trim()) invalid("invalid_proposal_submission", "A due date, customer scope and commercial terms are required.", 400);
    const prior = proposal.submissionHistory?.at(-1) ?? proposal.submission;
    const baseline = prior?.packageSnapshot ?? proposal.packageHistory?.find((entry) => entry.revision === prior?.revision);
    const assessment = assessCommercialAuthority(syntheticDemoCommercialProfiles[work.workspace], offer, baseline, estimate.detailed ? estimate.detailed.evaluation.includedCostMinor / 10 ** (estimate.detailed.input.currency === "JPY" ? 0 : 2) : estimate.labor + estimate.materials + estimate.subcontract + estimate.travel + estimate.contingency);
    if (!assessment.matchedProfile && !estimate.detailed) throw new PrototypeWorkError("authority_route_unavailable", 409, assessment.reasons[0] ?? "No synthetic commercial profile covers this offer.");
    if (estimate.detailed && estimate.detailed.evaluation.marginPercent !== null && estimate.detailed.evaluation.marginPercent < estimate.detailed.policySnapshot.floorMarginPercent && (estimate.review?.exception?.revision !== estimate.revision || estimate.review.exception.policyId !== estimate.detailed.evaluation.policyId || estimate.review.exception.policyVersion !== estimate.detailed.evaluation.policyVersion)) invalid("margin_floor", "The offer is below the pinned policy floor and needs an exception for this exact estimate revision.");
    const profile = estimate.detailed ? { id: `policy-${estimate.detailed.policySnapshot.id}-v${estimate.detailed.policySnapshot.version}`, role: estimate.detailed.policySnapshot.proposalApproverRole } : assessment.matchedProfile!;
    return { ...work, owner: profile.role, nextAction: `Review proposal revision ${offer.revision}`, nextActionDue: command.dueDate, nextActionImpact: "High", discovery: { ...discovery, phase: "Proposal", proposal: { ...proposal, status: "Internal review", review: { revision: offer.revision, submittedAt: now, submittedBy: work.owner, submittedByActorId: actor.id, submittedByMembershipId: actor.membershipId, dueDate: command.dueDate!, authorityProfileId: profile.id, authorityRole: profile.role, grossMarginPercent: assessment.grossMarginPercent ?? undefined, priceChangePercent: assessment.priceChangePercent, scopeChanged: assessment.scopeChanged, termsChanged: assessment.termsChanged }, history: [...(proposal.history ?? []), { revision: offer.revision, state: "Internal review", at: now, note: `Bound to estimate revision ${offer.estimateRevision}; synthetic route ${profile.role}` }] } }, history: [`${now} · Proposal revision ${offer.revision} routed by ${actor.name} (${actor.id}; membership ${actor.membershipId}) to synthetic ${profile.role}`, ...work.history] };
  }
  if (!proposal.review) throw new PrototypeWorkError("invalid_transition", 409, "This proposal revision is not awaiting approval.");
  if (proposal.status !== "Internal review" || proposal.review.revision !== offer.revision) invalid("invalid_transition", "This proposal revision is not awaiting approval.");
  if (!note) invalid("decision_note_required", "Record the decision basis.", 400);
  if (actor.id === proposal.review.submittedByActorId) invalid("proposal_separation_required", "The preparer cannot decide their own offer review.", 403);
  if (!["admin", "operations_leader"].includes(actor.role) || estimate.detailed && actor.role !== estimate.detailed.policySnapshot.proposalApproverRole) invalid("proposal_approver_denied", "Your authenticated workspace membership is not the routed proposal approver.", 403);
  const approved = command.action === "approve-proposal";
  const state = approved ? "Approved" as const : "Changes requested" as const;
  return { ...work, owner: proposal.review.submittedBy, nextAction: approved ? "Record customer proposal submission" : "Revise proposal package", nextActionDue: approved ? proposal.dueDate || null : null, discovery: { ...discovery, proposal: { ...proposal, status: state, review: { ...proposal.review, decidedAt: now, decisionNote: note, decidedBy: actor.name, actorId: actor.id, membershipId: actor.membershipId }, history: [...(proposal.history ?? []), { revision: offer.revision, state, at: now, note }] } }, history: [`${now} · Proposal revision ${offer.revision} ${approved ? "approved" : "returned"} by ${actor.name} (${actor.id}; membership ${actor.membershipId}) · ${note}`, ...work.history] };
}

export function assertSnapshotCommercialIntegrity(before: Record<string, unknown>[], after: Record<string, unknown>[]) {
  const nextById = new Map(after.map((record) => [record.id, record as WorkRecord]));
  for (const raw of before) {
    const prior = raw as WorkRecord;
    const next = nextById.get(prior.id);
    if (!prior.discovery?.pursuitControl) {
      const oldDiscovery = prior.discovery, newDiscovery = next?.discovery;
      const oldEstimate = oldDiscovery?.estimate, newEstimate = newDiscovery?.estimate;
      const oldOffer = oldDiscovery?.proposal, newOffer = newDiscovery?.proposal;
      const hasDecision = Boolean(oldDiscovery?.outcome || oldDiscovery?.designHandoff ||
        oldEstimate?.review || oldEstimate && !["Not started", "Draft"].includes(oldEstimate.status) ||
        oldOffer?.review || oldOffer && !["Not started", "Draft"].includes(oldOffer.status) || prior.develop?.review);
      if (!next && hasDecision) invalid("protected_work_removed", "A Work Record with a commercial decision cannot be removed through a snapshot.");
      if (!next) continue;
      if (!same(oldEstimate?.status, newEstimate?.status) || !same(oldEstimate?.review, newEstimate?.review) ||
        !same(oldEstimate?.pricingHistory, newEstimate?.pricingHistory) ||
        !same(oldOffer?.status, newOffer?.status) || !same(oldOffer?.review, newOffer?.review) ||
        !same(oldOffer?.submission, newOffer?.submission) || !same(oldOffer?.submissionHistory, newOffer?.submissionHistory) ||
        !same(oldOffer?.responseEvents, newOffer?.responseEvents) || !same(oldDiscovery?.outcome, newDiscovery?.outcome) ||
        !same(oldDiscovery?.designHandoff, newDiscovery?.designHandoff) || !same(prior.develop?.review, next.develop?.review) ||
        oldEstimate && !["Not started", "Draft"].includes(oldEstimate.status) && !same(oldEstimate, newEstimate) ||
        oldOffer && !["Not started", "Draft"].includes(oldOffer.status) && !same(oldOffer, newOffer))
        invalid("protected_decision_changed", "Legacy commercial decisions require an authenticated command, even without pursuit-control history.");
      continue;
    }
    if (!next) throw new PrototypeWorkError("protected_work_removed", 409, "A controlled Work Record cannot be removed through the prototype snapshot.");
    if (next.workspace !== prior.workspace) invalid("protected_work_removed", "A controlled Work Record cannot change workspace through the prototype snapshot.");
    if (!next.discovery?.pursuitControl) invalid("protected_control_removed", "Controlled pursuit history cannot be removed through the prototype snapshot.");
    const oldEstimate = prior.discovery.estimate, newEstimate = next.discovery?.estimate;
    if (prior.develop?.review && !same(prior.develop.review, next.develop?.review)) invalid("protected_solution_review_changed", "Solution review decisions require a server command.");
    if (prior.develop?.review && prior.develop.revision === next.develop?.revision && !same({ ...prior.develop, review: undefined, history: undefined }, { ...next.develop, review: undefined, history: undefined })) invalid("protected_solution_basis_changed", "A reviewed solution cannot change without a new solution revision.");
    if (prior.develop?.history && !same(prior.develop.history, next.develop?.history?.slice(0, prior.develop.history.length))) invalid("protected_solution_history_changed", "Prior solution history cannot be rewritten.");
    if (prior.develop?.revisionHistory && !same(prior.develop.revisionHistory, next.develop?.revisionHistory?.slice(0, prior.develop.revisionHistory.length))) invalid("protected_solution_history_changed", "Prior solution revision snapshots cannot be rewritten.");
    if (next.develop?.review && !prior.develop?.review) invalid("protected_solution_review_changed", "Solution review decisions require a server command.");
    if (!newEstimate) throw new PrototypeWorkError("protected_decision_changed", 409, "A controlled estimate cannot be removed through the prototype snapshot.");
    const newDraft = newEstimate.revision === oldEstimate.revision + 1 && newEstimate.status === "Draft" && !newEstimate.review && !newEstimate.detailed && !oldEstimate.detailed;
    if (oldEstimate.revisionHistory && !same(oldEstimate.revisionHistory, newEstimate.revisionHistory?.slice(0, oldEstimate.revisionHistory.length))) invalid("protected_estimate_history_changed", "Prior estimate revisions cannot be rewritten.");
    if (!newDraft && !same(oldEstimate, newEstimate)) invalid("protected_estimate_changed", "A reviewed estimate is immutable without a new revision or server decision.");
    if (!newDraft && (!same(oldEstimate.status, newEstimate.status) || !same(oldEstimate.review, newEstimate.review))) invalid("protected_decision_changed", "Pricing review decisions require a server command.");
    if (!same(oldEstimate.pricingHistory, newEstimate.pricingHistory)) invalid("protected_history_changed", "Pricing history cannot be changed through the prototype snapshot.");
    const oldProposal = prior.discovery.proposal, newProposal = next.discovery?.proposal;
    if (!newProposal) throw new PrototypeWorkError("protected_decision_changed", 409, "A controlled proposal cannot be removed through the prototype snapshot.");
    const newOffer = oldProposal.status !== "Submitted" && newProposal.package && newProposal.package.revision === (oldProposal.package?.revision ?? 0) + 1 && newProposal.status === "Draft" && !newProposal.review;
    if (!newOffer && !same(oldProposal.package, newProposal.package)) invalid("protected_offer_changed", "A saved offer package is immutable without a new revision.");
    if (oldProposal.packageHistory && !same(oldProposal.packageHistory, newProposal.packageHistory?.slice(0, oldProposal.packageHistory.length))) invalid("protected_offer_history_changed", "Prior offer revisions cannot be rewritten.");
    if (!newOffer && !same(oldProposal.packageHistory, newProposal.packageHistory)) invalid("protected_offer_history_changed", "Offer history cannot change without a new saved revision.");
    if (newOffer && !same(newProposal.packageHistory?.at(-1), newProposal.package)) invalid("protected_offer_history_changed", "The new offer revision must be present in its history.");
    if (!newOffer && (!same(oldProposal.status, newProposal.status) || !same(oldProposal.review, newProposal.review))) invalid("protected_decision_changed", "Proposal and customer status changes require a server command.");
    if (!same(oldProposal.submission, newProposal.submission) || !same(oldProposal.submissionHistory, newProposal.submissionHistory) || !same(oldProposal.responseEvents, newProposal.responseEvents) || !same(oldProposal.response, newProposal.response) || !same(prior.discovery.outcome, next.discovery!.outcome) || !same(prior.discovery.outcomeNote, next.discovery!.outcomeNote)) invalid("protected_customer_decision_changed", "Customer submission, response and award require a server command.");
    if (!same(prior.discovery.designHandoff, next.discovery!.designHandoff) || !same(prior.discovery.designHandoffHistory, next.discovery!.designHandoffHistory)) invalid("protected_design_handoff_changed", "Design handoff submission and decision require a server command.");
    if (prior.discovery.pursuitControl && (prior.discovery.outcome !== "Won" || prior.discovery.designHandoff?.status !== "accepted")) {
      const oldRecord = raw as Record<string, unknown>, newRecord = next as Record<string, unknown>;
      const oldRegisters = oldRecord.phaseRegisters as Record<string, unknown> | undefined;
      const newRegisters = newRecord.phaseRegisters as Record<string, unknown> | undefined;
      const designKeys = new Set([...Object.keys(oldRegisters ?? {}), ...Object.keys(newRegisters ?? {})].filter((key) => key.startsWith("design.")));
      if (!same(oldRecord.packages ?? [], newRecord.packages ?? []) || !same(oldRecord.design, newRecord.design) || [...designKeys].some((key) => !same(oldRegisters?.[key], newRegisters?.[key])))
        invalid("design_handoff_required", "An awarded Work Record requires an accepted Design handoff before package planning.");
    }
    if (["Approved", "Submitted"].includes(oldProposal.status) && !newOffer && (!same(prior.discovery.phase, next.discovery!.phase) || !same(oldProposal.history, newProposal.history))) invalid("protected_customer_decision_changed", "The controlled commercial phase and event history require a server command.");
    if (!prior.discovery.outcome && ["Approved", "Submitted"].includes(oldProposal.status) && next.stage !== prior.stage) invalid("protected_customer_decision_changed", "The controlled stage cannot advance before a server-recorded customer outcome.");
    if (newProposal.history && oldProposal.history && !same(newProposal.history.slice(0, oldProposal.history.length), oldProposal.history)) invalid("protected_history_changed", "Prior proposal history cannot be rewritten.");
  }
  for (const raw of after) {
    const next = raw as WorkRecord;
    if (before.some((record) => record.id === next.id)) continue;
    const discovery = next.discovery;
    if (!discovery) continue;
    if (discovery.estimate && !["Not started", "Draft"].includes(discovery.estimate.status) ||
        discovery.proposal && !["Not started", "Draft"].includes(discovery.proposal.status) ||
        discovery.estimate?.detailed || next.develop?.review || discovery.estimate?.review ||
        discovery.proposal?.review || discovery.estimate?.pricingHistory?.length ||
        discovery.proposal?.submission || discovery.proposal?.submissionHistory?.length ||
        discovery.proposal?.responseEvents?.length || discovery.outcome || discovery.designHandoff ||
        discovery.designHandoffHistory?.length || discovery.proposal?.history?.some((entry) =>
          ["Approved", "Internal review", "Submitted to customer"].includes(entry.state)))
      invalid("protected_decision_changed", "A new Work Record cannot import commercial decisions through a snapshot.");
  }
}
