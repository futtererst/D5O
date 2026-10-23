import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync("lib/d5o/prototype-work/service-execution-basis.ts", "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports = {};
vm.runInNewContext(compiled, { exports, require: () => { throw new Error("Unexpected runtime dependency"); } });
const { serviceExecutionBasisIssue: issue } = exports;
const request = { id: "request-1", status: "In progress", coverage: "Chargeable", reportedAt: "2026-10-08T09:00:00Z", jobIds: ["job-1"], currentCycleJobIds: ["job-1"] };
const parent = { id: "rybex-parent", workspace: "rybex", operate: { activation: { status: "Active" }, requests: [request], jobs: [{ id: "job-1", workId: "rybex-service", requestId: "request-1" }], maintenance: [] } };
const work = { id: "rybex-service", workspace: "rybex", serviceSource: { parentWorkId: parent.id, requestId: request.id, requestCycleAt: request.reportedAt, coverage: "Chargeable" } };
const records = [parent, work];
assert.match(issue(work, records), /approved pricing/);
request.serviceEstimate = { status: "Approved", revision: 2, requestCycleAt: request.reportedAt };
request.serviceAuthorization = { estimateRevision: 2, source: "Customer authorization A" };
work.serviceSource.pricing = { estimateRevision: 2, customerAuthorizationSource: "Customer authorization A" };
assert.equal(issue(work, records), null);
request.reopenedAt = "2026-10-09T09:00:00Z";
request.currentCycleJobIds = [];
assert.match(issue(work, records), /current cycle/);
request.reopenedAt = undefined;
request.currentCycleJobIds = ["job-1"];
request.coverage = "Covered";
assert.match(issue(work, records), /Coverage changed/);
assert.match(issue(work, [{ ...parent, workspace: "rotork" }, work]), /support is not active/);
const revisedRequest = { ...request, reopenedAt: undefined, currentCycleJobIds: ["job-1"], coverage: "Partially covered", assetId: "asset-1", serviceCategory: "Monitoring", agreementId: "agreement-1",
  serviceEstimate: { status: "Approved", revision: 2, requestCycleAt: request.reportedAt },
  serviceAuthorization: { estimateRevision: 2, source: "evidence:revised-document" } };
const revisedParent = { ...parent, operate: { ...parent.operate, requests: [revisedRequest], agreements: [{ id: "agreement-1", revision: 1, status: "Active" }] } };
const revisedWork = { ...work, canonicalWorkId: "canonical-1", serviceSource: { ...work.serviceSource, coverage: "Partially covered", pricing: { estimateRevision: 1, customerAuthorizationSource: "historical-document" } },
  serviceExecutionBasis: { status: "accepted", brief: { source: { requestId: "request-1", requestCycleAt: request.reportedAt, assetId: "asset-1", request: { serviceCategory: "Monitoring" }, agreement: { id: "agreement-1", revision: 1 }, pricing: { estimateRevision: "2", customerAuthorizationSource: "evidence:revised-document" } } } } };
assert.equal(issue(revisedWork, [revisedParent, revisedWork]), null);
revisedRequest.serviceAuthorization.source = "evidence:newer-document";
assert.match(issue(revisedWork, [revisedParent, revisedWork]), /exact approved pricing/);
console.log("Service execution source, pricing, cycle, coverage and tenant checks passed.");
