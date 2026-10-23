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
    if (!(key in dependencies)) throw new Error(`Unexpected dependency: ${key}`);
    return dependencies[key];
  }, structuredClone, crypto, console, Date, Set, Map }, { filename: relative });
  cache.set(relative, exports);
  return exports;
}
const policy = source("components/d5o/platform/design-policy.ts");
const model = source("components/d5o/platform/design-model.ts", { "./design-policy": policy });
const errors = source("lib/d5o/prototype-work/store-error.ts");
const serviceBasis = source("lib/d5o/prototype-work/service-execution-basis.ts");
const { applyDesignCommand, assertSnapshotDesignIntegrity } = source("lib/d5o/prototype-work/design-command.ts", { "@/components/d5o/platform/design-model": model, "@/components/d5o/platform/design-policy": policy, "./store-error": errors, "./service-execution-basis": serviceBasis });
const actors = {
  engineer: { id: "engineer", name: "Engineer", membershipId: "m-engineer", role: "project_manager" },
  reviewer: { id: "reviewer", name: "Reviewer", membershipId: "m-reviewer", role: "operations_leader" },
  receiver: { id: "receiver", name: "Receiver", membershipId: "m-receiver", role: "field_supervisor" }
};
assert.throws(() => applyDesignCommand({ id: "rybex-service", workspace: "rybex", title: "Service", type: "Lifecycle service", history: [], serviceSource: { parentWorkId: "rybex-parent", requestId: "request-1" } }, { action: "release-package", workId: "rybex-service", expectedRevision: 1, commandId: "missing-source", packageId: "p1", receivingOwner: "Receiver", dueDate: "2026-10-31" }, actors.engineer), (error) => error.code === "service_basis_blocked");
const pin = "configuration-v1";
let work = {
  id: "work-1", workspace: "rybex", type: "Technical delivery", title: "Synthetic data hall", customer: "Customer", site: "Site", owner: "Engineer", status: "moving", history: [],
  phaseConfigurationVersionId: pin,
  packages: [{ id: "p1", name: "Fiber trunk", owner: "Delivery", installed: 0, tested: 0, accepted: 0, status: "planned" }, { id: "p2", name: "Turnover", owner: "Delivery", installed: 0, tested: 0, accepted: 0, status: "planned" }],
  definition: { revision: 2, scopeControl: { requirements: [{ id: "R1", need: "Certification", source: "Customer", owner: "Engineering", state: "Confirmed" }] } },
  discovery: { outcome: "Won", pursuitControl: {}, designHandoff: { revision: 1, status: "accepted", brief: { configurationVersionId: pin, definitionRevision: 2 } } }
};
let serial = 0;
const crewDemand = { packageId: "p1", workId: work.id, qualification: "Fiber installation", minimumPeople: 3, estimatedPersonHours: 24, priority: "High", prerequisite: "Design release", crewSchedulable: true, requiredSlots: [{ date: "2026-11-02", shift: "07:00–15:30" }] };
function send(action, actor = actors.engineer) { work = applyDesignCommand(work, { workId: work.id, expectedRevision: ++serial, commandId: `cmd-${serial}`, ...action }, actor, crewDemand); return work; }
function rejects(action, code, actor) { assert.throws(() => send(action, actor), (error) => error.code === code, code); }

const unawarded = { ...work, discovery: { ...work.discovery, outcome: undefined, designHandoff: undefined } };
assert.throws(() => applyDesignCommand(unawarded, { action: "save-document", workId: work.id, expectedRevision: 1, commandId: "unawarded", document: { title: "Premature", type: "Drawing", source: "reference" } }, actors.engineer), (error) => error.code === "design_handoff_required");

const draft = { packageId: "p1", scope: "Install and certify fiber", location: "Hall A", systems: "Fiber", requirementIds: ["R1"], predecessorIds: [], documentRefs: [], completionBasis: { kind: "Measured", plannedQuantity: 12, unit: "m" }, materials: "3 cable reels", materialStatus: "Planned", materialRequiredDate: "2026-11-01", materialForecastDate: "2026-11-10", materialSource: "Supplier planning", access: "Approved window", permit: "Permit approved", safetyControls: "Isolation and fall protection", equipment: "Lift", method: "MOP-1", rollback: "Restore route", verification: "Certify every strand", proof: "Test results", acceptingAuthority: "Quality lead", windowStart: "2026-11-02", windowEnd: "2026-11-03", targetReleaseDate: "2026-10-30", commercialImpact: "", commercialDisposition: "None" };
assert(model.assessDesignPackage({ ...work, design: { packages: [{ ...draft, completionBasis: undefined, revision: 1 }], documents: [], reviews: [], releases: [], history: [] } }, "p1").findings.some((item) => item.key === "completion_basis"), "An undefined completion baseline blocks a new release");
assert.equal(model.assessDesignPackage({ ...unawarded, design: { packages: [{ ...draft, revision: 1 }], documents: [], reviews: [], releases: [], history: [] } }, "p1").findings[0].key, "handoff");
const legacyBasis = { ...work, definition: { revision: 2, status: "Approved", acceptance: "Signed certification results", scopeControl: { requirements: [] } } };
assert.equal(model.designRequirementRefs(legacyBasis)[0].id, "legacy-define-acceptance@2");
assert.throws(() => applyDesignCommand({ ...work, packages: [{ ...work.packages[0], status: "accepted" }] }, { action: "save-package", workId: work.id, expectedRevision: 1, commandId: "executed", package: draft }, actors.engineer), (error) => error.code === "executed_package_locked");
assert.throws(() => applyDesignCommand(work, { action: "save-package", workId: work.id, expectedRevision: 1, commandId: "no-crew", package: { ...draft, crewDemandRequired: false, crewExemptionReason: "No crew needed for this package" } }, actors.engineer), (error) => error.code === "crew_exception_denied");
send({ action: "save-package", package: draft });
send({ action: "save-package", package: { ...draft, packageId: "p2", predecessorIds: ["p1"] } });
assert(model.assessDesignPackage(work, "p2").findings.some((item) => item.key === "predecessor:p1"), "A downstream package cannot inherit an unreleased predecessor");
assert.equal(model.assessDesignPackage(work, "p1").recommendation, "Hold for resolution");
assert(model.assessDesignPackage(work, "p1").findings.some((item) => item.key === "material_late"));
const materialLine = { id: "m1", item: "Fiber reel", quantity: 3, unit: "reel", source: "Supplier quote Q1", status: "Supplier confirmed", requiredDate: "2026-11-01", forecastDate: "2026-11-10", alternative: "Approved alternative reel" };
assert(model.assessDesignPackage({ ...work, design: { ...work.design, packages: work.design.packages.map((item) => item.packageId === "p1" ? { ...item, materialLines: [materialLine], materialStatus: "Available" } : item) } }, "p1", undefined, crewDemand).findings.some((item) => item.key === "material_late:m1"), "A structured late supplier line remains an exact blocker");
const shortMaterial = { ...materialLine, status: "Available", confidence: "Physically counted", receivedQuantity: 2, availableQuantity: 1, quoteExpiry: "2026-10-01" };
const shortage = model.assessDesignPackage({ ...work, design: { ...work.design, packages: work.design.packages.map((item) => item.packageId === "p1" ? { ...item, materialLines: [shortMaterial] } : item) } }, "p1", "2026-10-07T00:00:00Z", crewDemand);
assert(shortage.findings.some((item) => item.key === "material_short:m1"));
assert(shortage.findings.some((item) => item.key === "material_unavailable:m1"));
assert(model.assessDesignPackage({ ...work, design: { ...work.design, packages: work.design.packages.map((item) => item.packageId === "p1" ? { ...item, materialLines: [{ ...materialLine, quoteExpiry: "2026-10-01" }] } : item) } }, "p1", "2026-10-07T00:00:00Z", crewDemand).findings.some((item) => item.key === "quote_expired:m1"));
rejects({ action: "release-package", packageId: "p1", receivingOwner: "Receiver", dueDate: "2026-10-31" }, "readiness_blocked", actors.reviewer);
rejects({ action: "save-package", package: { ...draft, predecessorIds: ["p1"] } }, "invalid_predecessor");
send({ action: "save-document", document: { title: "Fiber route", type: "IFC drawing", source: "proof-1", packageIds: ["p1"], requirementIds: ["R1"] } });
const doc = work.design.documents[0];
send({ action: "submit-document", documentId: doc.id, documentRevision: 1 });
rejects({ action: "approve-document", documentId: doc.id, documentRevision: 1 }, "document_review_denied");
send({ action: "approve-document", documentId: doc.id, documentRevision: 1 }, actors.reviewer);
send({ action: "issue-document", documentId: doc.id, documentRevision: 1 });
send({ action: "save-document", document: { id: doc.id, title: "Fiber route revised", type: "IFC drawing", source: "proof-2", packageIds: ["p1"], requirementIds: ["R1"] } });
assert.equal(work.design.documents.find((item) => item.revision === 1).status, "Issued for use", "A later draft leaves the issued revision intact");
send({ action: "save-package", package: { ...draft, documentRefs: [`${doc.id}@1`], materialStatus: "Available", materialForecastDate: "2026-10-29" } });
for (const discipline of ["Engineering", "Delivery", "Safety", "Quality"]) {
  send({ action: "request-review", packageId: "p1", discipline, assignee: `${discipline} review queue`, dueDate: "2026-10-29" });
  const review = work.design.reviews.at(-1);
  send({ action: "decide-review", reviewId: review.id, decision: "Approved", note: "Reviewed exact package and evidence" }, actors.reviewer);
}
assert(model.assessDesignPackage(work, "p1").findings.some((item) => item.key === "crew_demand"), "Missing crew demand remains unknown");
assert.equal(model.assessDesignPackage(work, "p1", undefined, crewDemand).recommendation, "Ready for release");
const revised = applyDesignCommand(work, { action: "save-package", workId: work.id, expectedRevision: 999, commandId: "revision-check", package: { ...draft, documentRefs: [`${doc.id}@1`], materialStatus: "Available", materialForecastDate: "2026-10-29" } }, actors.engineer);
assert(model.assessDesignPackage(revised, "p1").findings.some((item) => item.key === "review:Engineering"), "A material package revision requires a new review");
rejects({ action: "release-package", packageId: "p1", receivingOwner: "Receiver", dueDate: "2026-10-31" }, "release_separation_required", actors.reviewer);
send({ action: "release-package", packageId: "p1", receivingOwner: "Receiver", dueDate: "2026-10-31" });
const release = work.design.releases[0];
assert.equal(release.documentRefs[0], `${doc.id}@1`);
assert.equal(release.documentSnapshots[0].source, "proof-1");
assert.equal(release.sourceSnapshot.definitionRevision, 2);
assert.equal(release.crewDemandSnapshot.minimumPeople, 3);
rejects({ action: "respond-receipt", releaseId: release.id, response: "Accepted", note: "Received" }, "receipt_separation_required");
send({ action: "respond-receipt", releaseId: release.id, response: "Accepted", note: "Received exact revision" }, actors.receiver);
assert.equal(work.design.releases[0].status, "Accepted");
assert(model.assessDesignPackage(work, "p1", undefined, crewDemand, { ...policy.legacyDesignControlPolicy, requireCustomerTechnicalApproval: true }).findings.some((item) => item.key === "customer_technical"));
send({ action: "record-customer-approval", packageId: "p2", customerParty: "Customer engineer", authorityBasis: "Technical review delegation", source: "review-letter-1", approvedAt: "2026-10-29", note: "External customer approval recorded against package revision" });
assert(!model.assessDesignPackage(work, "p2").findings.some((item) => item.key === "predecessor:p1"), "An independently accepted predecessor clears only that dependency");
const stalePredecessor = structuredClone(work);
stalePredecessor.design.packages.find((item) => item.packageId === "p1").revision++;
assert(model.assessDesignPackage(stalePredecessor, "p2").findings.some((item) => item.key === "predecessor:p1"), "An accepted older predecessor revision does not clear a current dependency");
rejects({ action: "save-package", package: draft }, "released_package_locked");
rejects({ action: "issue-document", documentId: doc.id, documentRevision: 2 }, "document_not_approved");
assert.throws(() => assertSnapshotDesignIntegrity([work], [{ ...work, design: { ...work.design, releases: [] } }]), (error) => error.code === "protected_design_changed");
assert.throws(() => assertSnapshotDesignIntegrity([work], [{ ...work, packages: work.packages.map((item) => item.id === "p2" ? { ...item, installed: 50 } : item) }]), (error) => error.code === "deploy_receipt_required");
const wholeSet = structuredClone(work);
wholeSet.design.releases = [];
const first = wholeSet.design.packages.find((item) => item.packageId === "p1");
wholeSet.design.packages = [first, { ...structuredClone(first), packageId: "p2", revision: 1, predecessorIds: ["p1"] }];
wholeSet.design.documents.find((item) => item.revision === 1).packageIds.push("p2");
wholeSet.design.reviews.push(...wholeSet.design.reviews.filter((item) => item.packageId === "p1" && item.revision === first.revision).map((item) => ({ ...structuredClone(item), id: crypto.randomUUID(), packageId: "p2", revision: 1 })));
const wholeSetPolicy = { ...policy.legacyDesignControlPolicy, allowPartialRelease: false };
assert.throws(() => applyDesignCommand(wholeSet, { action: "release-package", workId: work.id, expectedRevision: 88, commandId: "partial-denied", packageId: "p1", receivingOwner: "Receiver", dueDate: "2026-10-31" }, actors.engineer, crewDemand, wholeSetPolicy), (error) => error.code === "release_set_required");
const secondDemand = { ...crewDemand, packageId: "p2" };
const releasedSet = applyDesignCommand(wholeSet, { action: "release-set", workId: work.id, expectedRevision: 89, commandId: "whole-set", packageIds: ["p1", "p2"], receivingOwner: "Receiver", dueDate: "2026-10-31" }, actors.engineer, null, wholeSetPolicy, [crewDemand, secondDemand]);
assert.equal(releasedSet.design.releases.length, 2);
assert.equal(releasedSet.design.releases[0].releaseGroupId, releasedSet.design.releases[1].releaseGroupId);
assert.throws(() => applyDesignCommand(releasedSet, { action: "respond-receipt", workId: work.id, expectedRevision: 90, commandId: "premature-dependent-receipt", releaseId: releasedSet.design.releases[1].id, response: "Accepted", note: "Receive dependent package" }, actors.receiver), (error) => error.code === "predecessor_receipt_required");
const firstReceived = applyDesignCommand(releasedSet, { action: "respond-receipt", workId: work.id, expectedRevision: 91, commandId: "first-receipt", releaseId: releasedSet.design.releases[0].id, response: "Accepted", note: "Receive predecessor" }, actors.receiver);
const bothReceived = applyDesignCommand(firstReceived, { action: "respond-receipt", workId: work.id, expectedRevision: 92, commandId: "dependent-receipt", releaseId: releasedSet.design.releases[1].id, response: "Accepted", note: "Receive dependent package" }, actors.receiver);
assert.equal(bothReceived.design.releases[1].status, "Accepted");
const withdrawnPredecessor = structuredClone(bothReceived);
withdrawnPredecessor.design.releases[0].status = "Held";
assert.throws(() => assertSnapshotDesignIntegrity([withdrawnPredecessor], [{ ...withdrawnPredecessor, packages: withdrawnPredecessor.packages.map((item) => item.id === "p2" ? { ...item, installed: 50 } : item) }]), (error) => error.code === "predecessor_receipt_required");
assert.equal(policy.validateDesignControlPolicy({ ...wholeSetPolicy, requiredReviews: ["Delivery"] }).length, 1);
send({ action: "record-change", packageId: "p1", source: "Site RFI 42", reason: "Field route conflicts with an active system and needs revision", affectedRequirementIds: ["R1"], affectedDocumentRefs: [`${doc.id}@1`], technicalImpact: "Revise cable pathway", scheduleImpact: "Shift installation window by one day" });
assert.equal(work.design.releases[0].status, "Hold pending acknowledgment");
assert.throws(() => assertSnapshotDesignIntegrity([work], [{ ...work, packages: work.packages.map((item) => item.id === "p1" ? { ...item, installed: 50 } : item) }]), (error) => error.code === "deploy_receipt_required");
rejects({ action: "save-package", package: draft }, "released_package_locked");
send({ action: "acknowledge-hold", releaseId: release.id, note: "Field team received revised stop instructions" }, actors.receiver);
assert.equal(work.design.releases[0].status, "Held");
send({ action: "save-package", package: { ...draft, documentRefs: [`${doc.id}@1`], materialStatus: "Available", materialForecastDate: "2026-10-29" } });
send({ action: "resolve-change", changeId: work.design.changes[0].id, note: "Engineering revision reviewed after field hold acknowledgment" });
assert.equal(work.design.changes[0].status, "Resolved");
assert(model.assessDesignPackage(work, "p1", undefined, crewDemand).findings.some((item) => item.key === "review:Engineering"), "Changed package requires new review");
console.log("Design command, document revision, review, readiness, release, receipt, and direct-snapshot guards passed.");
