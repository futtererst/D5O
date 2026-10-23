import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const cache = new Map();
function source(relative, dependencies = {}) {
  if (cache.has(relative)) return cache.get(relative);
  const compiled = ts.transpileModule(readFileSync(relative, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: (key) => {
    if (!(key in dependencies)) throw new Error(`Unexpected test dependency: ${key}`);
    return dependencies[key];
  }, structuredClone, crypto, console }, { filename: relative });
  cache.set(relative, exports);
  return exports;
}

const designPolicy = source("components/d5o/platform/design-policy.ts");
const deployPolicy = source("components/d5o/platform/deploy-policy.ts");
const operatePolicy = source("components/d5o/platform/operate-policy.ts");
const phase = source("components/d5o/platform/phase-configuration.ts", { "./design-policy": designPolicy, "./deploy-policy": deployPolicy, "./operate-policy": operatePolicy });
const published = source("components/d5o/platform/published-phase-configuration.ts", { "./phase-configuration": phase, "./design-policy": designPolicy, "./deploy-policy": deployPolicy, "./operate-policy": operatePolicy });
const authority = source("components/d5o/platform/commercial-authority.ts");
const pricing = source("components/d5o/platform/develop-pricing.ts");
const errors = source("lib/d5o/prototype-work/store-error.ts");
const semanticJson = source("lib/d5o/prototype-work/semantic-json.ts");
const { applyCommercialCommand, assertSnapshotCommercialIntegrity } = source("lib/d5o/prototype-work/commercial-command.ts", {
  "./semantic-json": semanticJson,
  "@/components/d5o/platform/published-phase-configuration": published,
  "@/components/d5o/platform/commercial-authority": authority,
  "@/components/d5o/platform/develop-pricing": pricing,
  "./store-error": errors,
});

const pinned = "00000000-0000-4000-8000-000000000001";
const actor = { id: "synthetic-actor", name: "Synthetic submitter", membershipId: "synthetic-membership", role: "project_manager" };
const reviewer = { id: "synthetic-reviewer", name: "Synthetic reviewer", membershipId: "synthetic-reviewer-membership", role: "operations_leader" };
const inventory = { status: "ready", versions: [{ id: pinned, status: "published", config_manifest_json: { d5oPresentation: { phaseContract: { schemaVersion: 1, workTypes: structuredClone(phase.stageAlignedPhaseConfigurationCatalog.rybex) } } } }] };
const work = {
  id: "synthetic-controlled", workspace: "rybex", type: "Technical delivery", phaseConfigurationVersionId: pinned,
  title: "Synthetic command guard", customer: "Synthetic", site: "Local", owner: "Originator", nextAction: "Prepare price", status: "moving", history: [],
  definition: { status: "Approved", revision: 1, configurationVersion: pinned, configurationWorkTypeKey: "technical-delivery", developHandoff: { status: "accepted", revision: 1 } },
  discovery: { phase: "Estimate", pursuitControl: { revision: 1, status: "qualified" }, estimate: {
    revision: 1, labor: 75, materials: 25, subcontract: 0, travel: 0, contingency: 0, targetMargin: 25, sellPrice: 133,
    status: "Draft", assumption: "Synthetic", definitionSource: { revision: 1, configurationVersionId: pinned, workTypeKey: "technical-delivery", capturedAt: "2026-10-06T00:00:00Z" }, pricingHistory: [],
  }, proposal: { status: "Not started", dueDate: "", method: "Customer portal", recipient: "", response: "" } },
};
const copy = (value) => JSON.parse(JSON.stringify(value));
const rejects = (fn, code) => assert.throws(fn, (error) => error.code === code, code);

const routed = applyCommercialCommand(work, { workId: work.id, packageRevision: 1, action: "submit-pricing", dueDate: "2026-10-22" }, actor, inventory);
assert.equal(routed.discovery.estimate.status, "Pricing review");
rejects(() => applyCommercialCommand(routed, { workId: work.id, packageRevision: 2, action: "approve-pricing", note: "Accepted" }, actor, inventory), "stale_package");
rejects(() => applyCommercialCommand(routed, { workId: work.id, packageRevision: 1, action: "approve-pricing" }, actor, inventory), "decision_note_required");
rejects(() => applyCommercialCommand(routed, { workId: work.id, packageRevision: 1, action: "approve-pricing", note: "Own work" }, actor, inventory), "pricing_separation_required");
const priced = applyCommercialCommand(routed, { workId: work.id, packageRevision: 1, action: "approve-pricing", note: "Synthetic price basis accepted" }, reviewer, inventory);
assert.equal(priced.discovery.estimate.review.actorId, reviewer.id);
assert.equal(priced.discovery.estimate.status, "Approved");
rejects(() => assertSnapshotCommercialIntegrity([routed], [priced]), "protected_estimate_changed");

const forgedPrice = copy(priced);
forgedPrice.discovery.estimate.sellPrice = 999999;
rejects(() => assertSnapshotCommercialIntegrity([priced], [forgedPrice]), "protected_estimate_changed");
const forgedControl = copy(priced);
delete forgedControl.discovery.pursuitControl;
rejects(() => assertSnapshotCommercialIntegrity([priced], [forgedControl]), "protected_control_removed");
rejects(() => assertSnapshotCommercialIntegrity([priced], []), "protected_work_removed");

const draft = copy(priced);
draft.discovery.proposal.status = "Draft";
draft.discovery.proposal.package = { revision: 1, estimateRevision: 1, scope: "Synthetic scope", assumptions: "Synthetic", exclusions: "None", commercialTerms: "Synthetic terms", sellPrice: 133, preparedAt: "2026-10-06T00:00:00Z", definitionSource: copy(priced.discovery.estimate.definitionSource) };
draft.discovery.proposal.packageHistory = [copy(draft.discovery.proposal.package)];
assertSnapshotCommercialIntegrity([priced], [draft]);
const routedOffer = applyCommercialCommand(draft, { workId: work.id, packageRevision: 1, action: "submit-proposal", dueDate: "2026-10-22" }, actor, inventory);
assert.equal(routedOffer.discovery.proposal.status, "Internal review");
assert.ok(routedOffer.discovery.proposal.review.authorityProfileId.startsWith("demo-"));
const forgedApproval = copy(routedOffer);
forgedApproval.discovery.proposal.status = "Approved";
rejects(() => assertSnapshotCommercialIntegrity([routedOffer], [forgedApproval]), "protected_decision_changed");
const forgedOffer = copy(routedOffer);
forgedOffer.discovery.proposal.package.sellPrice = 999999;
rejects(() => assertSnapshotCommercialIntegrity([routedOffer], [forgedOffer]), "protected_offer_changed");
rejects(() => applyCommercialCommand(routedOffer, { workId: work.id, packageRevision: 1, action: "approve-proposal", note: "Own work" }, actor, inventory), "proposal_separation_required");
const approvedOffer = applyCommercialCommand(routedOffer, { workId: work.id, packageRevision: 1, action: "approve-proposal", note: "Synthetic offer accepted" }, reviewer, inventory);
assert.equal(approvedOffer.discovery.proposal.status, "Approved");
assert.equal(approvedOffer.discovery.proposal.review.actorId, reviewer.id);
const staleScope = copy(routedOffer);
staleScope.definition.revision = 2;
rejects(() => applyCommercialCommand(staleScope, { workId: work.id, packageRevision: 1, action: "approve-proposal", note: "Accepted" }, actor, inventory), "define_receipt_required");

rejects(() => applyCommercialCommand(routedOffer, { workId: work.id, packageRevision: 1, action: "record-customer-submission", recipient: "Synthetic customer", method: "Email", dueDate: "2026-10-22" }, actor, inventory), "offer_not_approved");
rejects(() => applyCommercialCommand(approvedOffer, { workId: work.id, packageRevision: 1, action: "record-customer-submission", recipient: "", method: "Email", dueDate: "2026-10-22" }, actor, inventory), "invalid_customer_submission");
const submitted = applyCommercialCommand(approvedOffer, { workId: work.id, packageRevision: 1, action: "record-customer-submission", recipient: "Synthetic customer", method: "Email", dueDate: "2026-10-22" }, actor, inventory);
assert.equal(submitted.discovery.proposal.status, "Submitted");
assert.equal(submitted.discovery.proposal.submission.packageSnapshot.sellPrice, approvedOffer.discovery.proposal.package.sellPrice);
assert.equal(submitted.discovery.proposal.submission.recordedByActorId, actor.id);
rejects(() => applyCommercialCommand(submitted, { workId: work.id, packageRevision: 1, action: "record-customer-submission", recipient: "Synthetic customer", method: "Email", dueDate: "2026-10-22" }, actor, inventory), "offer_not_approved");
const forgedSubmission = copy(approvedOffer);
forgedSubmission.discovery.proposal.status = "Submitted";
forgedSubmission.discovery.proposal.submission = copy(submitted.discovery.proposal.submission);
rejects(() => assertSnapshotCommercialIntegrity([approvedOffer], [forgedSubmission]), "protected_decision_changed");
const forgedResponse = copy(submitted);
forgedResponse.discovery.proposal.responseEvents = [{ revision: 1, status: "Awarded", receivedAt: "2026-10-06", details: "Forged" }];
rejects(() => assertSnapshotCommercialIntegrity([submitted], [forgedResponse]), "protected_customer_decision_changed");
const forgedAward = copy(submitted);
forgedAward.discovery.outcome = "Won";
rejects(() => assertSnapshotCommercialIntegrity([submitted], [forgedAward]), "protected_customer_decision_changed");
const forgedPhase = copy(submitted);
forgedPhase.discovery.phase = "Outcome";
rejects(() => assertSnapshotCommercialIntegrity([submitted], [forgedPhase]), "protected_customer_decision_changed");
const forgedResponseText = copy(submitted);
forgedResponseText.discovery.proposal.response = "Awarded";
rejects(() => assertSnapshotCommercialIntegrity([submitted], [forgedResponseText]), "protected_customer_decision_changed");
rejects(() => applyCommercialCommand(submitted, { workId: work.id, packageRevision: 1, action: "record-customer-response", responseStatus: "Commercial negotiation", receivedAt: "2026-10-06", note: "Revise terms" }, actor, inventory), "follow_up_required");
rejects(() => applyCommercialCommand(submitted, { workId: work.id, packageRevision: 2, action: "record-customer-response", responseStatus: "Awarded", receivedAt: "2026-10-06", note: "Accepted" }, actor, inventory), "stale_package");
const negotiating = applyCommercialCommand(submitted, { workId: work.id, packageRevision: 1, action: "record-customer-response", responseStatus: "Commercial negotiation", receivedAt: "2026-10-06", note: "Revise terms", nextAction: "Prepare revised offer", followUpDue: "2026-10-20" }, actor, inventory);
assert.equal(negotiating.discovery.outcome, undefined);
assert.equal(negotiating.discovery.proposal.responseEvents.at(-1).recordedByMembershipId, actor.membershipId);
rejects(() => assertSnapshotCommercialIntegrity([submitted], [negotiating]), "protected_customer_decision_changed");
const reopened = applyCommercialCommand(negotiating, { workId: work.id, packageRevision: 1, action: "start-negotiated-revision" }, actor, inventory);
assert.equal(reopened.discovery.proposal.status, "Draft");
assert.equal(reopened.discovery.proposal.submission.packageSnapshot.sellPrice, 133);
rejects(() => assertSnapshotCommercialIntegrity([negotiating], [reopened]), "protected_decision_changed");
const awarded = applyCommercialCommand(submitted, { workId: work.id, packageRevision: 1, action: "record-customer-response", responseStatus: "Awarded", receivedAt: "2026-10-06", note: "Customer award received" }, actor, inventory);
assert.equal(awarded.id, submitted.id);
assert.equal(awarded.discovery.outcome, "Won");
assert.match(awarded.nextAction, /Design receiver and accept award handoff/);
assert.equal(awarded.owner, "Design receiver · unassigned");
rejects(() => applyCommercialCommand(awarded, { workId: work.id, packageRevision: 1, action: "record-customer-response", responseStatus: "Not awarded", receivedAt: "2026-10-07", note: "Reversed" }, actor, inventory), "submitted_offer_unavailable");
rejects(() => applyCommercialCommand(submitted, { workId: work.id, packageRevision: 1, action: "submit-design-handoff", dueDate: "2026-10-23" }, actor, inventory), "award_unavailable");
const awardReady = copy(awarded);
Object.assign(awardReady.definition, { outcome: "Synthetic customer outcome", acceptance: "Documented acceptance", excludedScope: "Excluded remedial work", deliveryApproach: "Controlled package plan", dependencies: "Customer access", risks: "Access risk" });
const handoff = applyCommercialCommand(awardReady, { workId: work.id, packageRevision: 1, action: "submit-design-handoff", dueDate: "2026-10-23" }, actor, inventory);
assert.equal(handoff.discovery.designHandoff.status, "submitted");
assert.equal(handoff.discovery.designHandoff.brief.offerRevision, 1);
assert.equal(handoff.discovery.designHandoff.brief.definitionRevision, 1);
assert.equal(handoff.owner, "Design receiver queue · workspace role");
const prematurePackage = copy(handoff);
prematurePackage.packages = [{ id: "wp-premature", name: "Not received", status: "planned" }];
rejects(() => assertSnapshotCommercialIntegrity([handoff], [prematurePackage]), "design_handoff_required");
const prematureDesignRegister = copy(handoff);
prematureDesignRegister.phaseRegisters = { "design.verification_plan": [{ package: "Not received" }] };
rejects(() => assertSnapshotCommercialIntegrity([handoff], [prematureDesignRegister]), "design_handoff_required");
const forgedHandoff = copy(awardReady);
forgedHandoff.discovery.designHandoff = copy(handoff.discovery.designHandoff);
rejects(() => assertSnapshotCommercialIntegrity([awardReady], [forgedHandoff]), "protected_design_handoff_changed");
rejects(() => applyCommercialCommand(handoff, { workId: work.id, packageRevision: 1, handoffRevision: 1, action: "accept-design-handoff", note: "I accept this complete design brief" }, actor, inventory), "handoff_separation_required");
const receiver = { id: "synthetic-receiver", name: "Synthetic Design receiver", membershipId: "receiver-membership", role: "project_manager" };
rejects(() => applyCommercialCommand(handoff, { workId: work.id, packageRevision: 1, handoffRevision: 2, action: "accept-design-handoff", note: "I accept this complete design brief" }, receiver, inventory), "stale_handoff");
const returnedHandoff = applyCommercialCommand(handoff, { workId: work.id, packageRevision: 1, handoffRevision: 1, action: "return-design-handoff", note: "Clarify the site access dependency before planning" }, receiver, inventory);
assert.equal(returnedHandoff.discovery.designHandoff.status, "returned");
const revisedHandoff = applyCommercialCommand(returnedHandoff, { workId: work.id, packageRevision: 1, action: "submit-design-handoff", dueDate: "2026-10-24" }, actor, inventory);
assert.equal(revisedHandoff.discovery.designHandoff.revision, 2);
const acceptedHandoff = applyCommercialCommand(revisedHandoff, { workId: work.id, packageRevision: 1, handoffRevision: 2, action: "accept-design-handoff", note: "I accept this scope and will plan controlled packages" }, receiver, inventory);
assert.equal(acceptedHandoff.discovery.designHandoff.status, "accepted");
assert.equal(acceptedHandoff.owner, receiver.name);
assert.equal(acceptedHandoff.id, awarded.id);
assert.equal(acceptedHandoff.stage, awarded.stage);
assert.equal(acceptedHandoff.discovery.designHandoffHistory.length, 4);
const receivedPackage = copy(acceptedHandoff);
receivedPackage.packages = [{ id: "wp-received", name: "Received scope", status: "planned" }];
assertSnapshotCommercialIntegrity([acceptedHandoff], [receivedPackage]);

const developPolicy = { id: "synthetic-pricing", version: 1, status: "published", workspace: "rybex", name: "Synthetic GBP", currency: "GBP", effectiveFrom: "2026-10-01", rates: [{ id: "labor", category: "labor", label: "Labor", unit: "hour", amount: "50.00", scope: { kind: "default", value: "" }, effectiveFrom: "2026-10-01", source: "Tenant catalog" }], targetMarginPercent: 25, floorMarginPercent: 15, overheadPercent: 0, contingencyPercent: 5, maxDiscountPercent: 10, method: "target-margin", solutionApproverRole: "operations_leader", pricingApproverRole: "operations_leader", proposalApproverRole: "operations_leader" };
const policyState = { pricingPolicies: [developPolicy], activePricingPolicy: { id: developPolicy.id, version: 1 } };
const planning = copy(work);
planning.develop = { revision: 1, options: [{ id: "option-a", revision: 1, name: "Approved option", approach: "Qualified technical approach", requirementIds: [], unmetRequirements: "", deliveryModel: "Self-perform", materials: "Customer supplied", resourceBasis: "Qualified labor", scheduleBasis: "Site window confirmed", safetyQuality: "Site method review", risks: "Access risk", evidence: "Survey", owner: "Solutions lead", status: "Viable" }], selectedOptionId: "option-a", selectionRationale: "Fits the accepted basis", laborStrategy: "Qualified staff available", procurementStrategy: "No critical purchase", scheduleStrategy: "Site window", safetyStrategy: "Risk assessment", qualityStrategy: "Independent check", riskMitigation: "Access plan", targetDate: "2026-12-01", designOwner: "Design lead", history: [] };
const submittedSolution = applyCommercialCommand(planning, { workId: work.id, packageRevision: 1, action: "submit-solution", dueDate: "2026-10-21" }, actor, inventory, policyState);
assert.equal(submittedSolution.develop.review.status, "Submitted");
rejects(() => applyCommercialCommand(submittedSolution, { workId: work.id, packageRevision: 1, action: "approve-solution", note: "Own review" }, actor, inventory, policyState), "solution_separation_required");
const approvedSolution = applyCommercialCommand(submittedSolution, { workId: work.id, packageRevision: 1, action: "approve-solution", note: "Requirements and delivery basis verified" }, reviewer, inventory, policyState);
assert.equal(approvedSolution.develop.review.status, "Approved");
const forgedSolution = copy(approvedSolution);
forgedSolution.develop.options[0].approach = "Changed after approval without revision";
rejects(() => assertSnapshotCommercialIntegrity([approvedSolution], [forgedSolution]), "protected_solution_basis_changed");
const pricingInput = { currency: "GBP", workType: work.type, customer: work.customer, region: work.site, pricedAt: "2026-10-07", lines: [{ id: "line-1", scopeRef: "Accepted scope", category: "labor", description: "Installation", quantity: "10", unit: "hour", rateId: "labor", source: "Tenant catalog", assumption: "Ten verified hours" }], discountPercent: 0, riskBasis: "Site access", estimateMaturity: "Budgetary", definitionRevision: 1, solutionRevision: 1 };
rejects(() => applyCommercialCommand(approvedSolution, { workId: work.id, packageRevision: 2, action: "save-detailed-estimate", pricingInput: { ...pricingInput, lines: [{ ...pricingInput.lines[0], manualRate: 50 }] } }, actor, inventory, policyState), "invalid_estimate_input");
const detailedDraft = applyCommercialCommand(approvedSolution, { workId: work.id, packageRevision: 2, action: "save-detailed-estimate", pricingInput }, actor, inventory, policyState);
assert.equal(detailedDraft.discovery.estimate.detailed.input.currency, "GBP");
assert.equal(detailedDraft.discovery.estimate.revisionHistory[0].revision, 1);
rejects(() => assertSnapshotCommercialIntegrity([approvedSolution], [detailedDraft]), "protected_estimate_changed");
const submittedDetailed = applyCommercialCommand(detailedDraft, { workId: work.id, packageRevision: 2, action: "submit-pricing", dueDate: "2026-10-23" }, actor, inventory, policyState);
assert.equal(submittedDetailed.discovery.estimate.status, "Pricing review");
const floorPolicy = { ...developPolicy, floorMarginPercent: 22 };
const floorPolicyState = { pricingPolicies: [floorPolicy], activePricingPolicy: { id: floorPolicy.id, version: 1 } };
const belowFloorDraft = applyCommercialCommand(approvedSolution, { workId: work.id, packageRevision: 2, action: "save-detailed-estimate", pricingInput: { ...pricingInput, discountPercent: 10 } }, actor, inventory, floorPolicyState);
const belowFloorReview = applyCommercialCommand(belowFloorDraft, { workId: work.id, packageRevision: 2, action: "submit-pricing", dueDate: "2026-10-23" }, actor, inventory, floorPolicyState);
rejects(() => applyCommercialCommand(belowFloorReview, { workId: work.id, packageRevision: 2, action: "approve-pricing", note: "Accept" }, reviewer, inventory, floorPolicyState), "margin_exception_required");
rejects(() => applyCommercialCommand(belowFloorReview, { workId: work.id, packageRevision: 2, action: "approve-margin-exception", note: "Own margin" }, actor, inventory, floorPolicyState), "margin_exception_denied");
const administrator = { id: "synthetic-administrator", name: "Synthetic administrator", membershipId: "administrator-membership", role: "admin" };
const excepted = applyCommercialCommand(belowFloorReview, { workId: work.id, packageRevision: 2, action: "approve-margin-exception", note: "Bounded price exception for customer budget ceiling" }, administrator, inventory, floorPolicyState);
assert.equal(excepted.discovery.estimate.review.exception.policyVersion, 1);
const pricedException = applyCommercialCommand(excepted, { workId: work.id, packageRevision: 2, action: "approve-pricing", note: "Approved with recorded exception" }, reviewer, inventory, floorPolicyState);
assert.equal(pricedException.discovery.estimate.status, "Approved");
rejects(() => assertSnapshotCommercialIntegrity([belowFloorReview], [excepted]), "protected_estimate_changed");
const detailedOffer = copy(pricedException);
detailedOffer.discovery.proposal.status = "Draft";
detailedOffer.discovery.proposal.package = { revision: 1, estimateRevision: 2, scope: "Accepted synthetic solution", assumptions: "Customer access", exclusions: "Unrelated work", commercialTerms: "Customer approval required", sellPrice: pricedException.discovery.estimate.sellPrice, preparedAt: "2026-10-07T00:00:00Z", definitionSource: copy(pricedException.discovery.estimate.definitionSource), pricingBasis: { policyId: floorPolicy.id, policyVersion: floorPolicy.version, solutionRevision: 1, currency: "GBP", includedCostMinor: pricedException.discovery.estimate.detailed.evaluation.includedCostMinor, priceMinor: pricedException.discovery.estimate.detailed.evaluation.proposedPriceMinor } };
const detailedReview = applyCommercialCommand(detailedOffer, { workId: work.id, packageRevision: 1, action: "submit-proposal", dueDate: "2026-10-24" }, actor, inventory, floorPolicyState);
const detailedApproved = applyCommercialCommand(detailedReview, { workId: work.id, packageRevision: 1, action: "approve-proposal", note: "Exact solution, price, and exception accepted" }, reviewer, inventory, floorPolicyState);
const detailedSent = applyCommercialCommand(detailedApproved, { workId: work.id, packageRevision: 1, action: "record-customer-submission", recipient: "Synthetic customer", method: "Customer portal", dueDate: "2026-10-25" }, actor, inventory, floorPolicyState);
const detailedAward = applyCommercialCommand(detailedSent, { workId: work.id, packageRevision: 1, action: "record-customer-response", responseStatus: "Awarded", receivedAt: "2026-10-26", note: "Customer approved exact submitted offer" }, actor, inventory, floorPolicyState);
Object.assign(detailedAward.definition, { outcome: "Accepted outcome", acceptance: "Witness test", excludedScope: "Unrelated work", deliveryApproach: "Selected option", dependencies: "Customer access", risks: "Controlled access" });
const detailedHandoff = applyCommercialCommand(detailedAward, { workId: work.id, packageRevision: 1, action: "submit-design-handoff", dueDate: "2026-10-28" }, actor, inventory, floorPolicyState);
assert.equal(detailedHandoff.discovery.designHandoff.brief.develop.estimateSnapshot.evaluation.proposedPriceMinor, pricedException.discovery.estimate.detailed.evaluation.proposedPriceMinor);
assert.equal(detailedHandoff.discovery.designHandoff.brief.develop.selectedOptionSnapshot.id, "option-a");
assert.equal(detailedHandoff.discovery.designHandoff.brief.develop.offerSnapshot.pricingBasis.currency, "GBP");
const staleSolution = copy(detailedDraft);
staleSolution.develop.revision = 2;
rejects(() => applyCommercialCommand(staleSolution, { workId: work.id, packageRevision: 2, action: "submit-pricing", dueDate: "2026-10-23" }, actor, inventory, policyState), "solution_approval_required");
const importedWithoutPursuit = { id: "synthetic-import", workspace: "rybex", discovery: { estimate: { status: "Approved" }, proposal: { status: "Not started" } } };
rejects(() => assertSnapshotCommercialIntegrity([], [importedWithoutPursuit]), "protected_decision_changed");
assertSnapshotCommercialIntegrity([], [{ ...importedWithoutPursuit, discovery: { estimate: { status: "Draft" }, proposal: { status: "Not started" } } }]);
const legacyApproved = { ...importedWithoutPursuit, discovery: { estimate: { status: "Approved", sellPrice: 100 }, proposal: { status: "Not started" } } };
rejects(() => assertSnapshotCommercialIntegrity([legacyApproved], [{ ...legacyApproved, discovery: { ...legacyApproved.discovery, estimate: { status: "Approved", sellPrice: 1 } } }]), "protected_decision_changed");
rejects(() => assertSnapshotCommercialIntegrity([legacyApproved], []), "protected_work_removed");
const legacyDraft = { ...legacyApproved, discovery: { estimate: { status: "Draft", sellPrice: 100 }, proposal: { status: "Not started" } } };
assertSnapshotCommercialIntegrity([legacyDraft], [{ ...legacyDraft, discovery: { ...legacyDraft.discovery, estimate: { status: "Draft", sellPrice: 110 } } }]);

console.log("Controlled Develop solution, pricing, offer, customer response, Design handoff and snapshot bypass checks: PASS");
