import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../components/d5o/platform/design-model.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports = {};
vm.runInNewContext(compiled, {
  exports,
  require: (id) => {
    assert.equal(id, './design-policy');
    return { legacyDesignControlPolicy: {} };
  },
  Date,
  Set,
});

const packageId = 'wp-test';
const work = {
  id: 'work-test', canonicalWorkId: 'canonical-test', phaseConfigurationVersionId: 'policy-test',
  design: { documents: [], reviews: [], releases: [], history: [], packages: [{
    packageId, revision: 3, scope: 'Test', location: 'Site', systems: 'System',
    requirementIds: [], predecessorIds: [], documentRefs: [], materialLines: [],
    materialStatus: 'Unknown', materials: '', commercialImpact: '', commercialDisposition: 'None',
    safetyControls: 'Safety', access: 'Access', method: 'Method', rollback: 'Rollback',
    verification: 'Verify', proof: 'Proof', acceptingAuthority: 'Reviewer',
    completionBasis: { kind: 'Measured', plannedQuantity: 2, unit: 'zones' },
    windowStart: '2026-10-13', windowEnd: '2026-10-16', crewDemandRequired: true,
  }] },
};
const policy = {
  requireCrewDemand: true, requirePermit: false, requireAccess: true,
  requireMop: true, requireRollback: true, requireMaterialAvailability: false,
  requireCustomerTechnicalApproval: false, requiredReviews: [],
};
const demand = {
  workId: work.id, packageId, qualification: 'Controls service', minimumPeople: 2,
  estimatedPersonHours: 12, requiredSlots: [{ date: '2026-10-14', shift: '07:00–15:30' }],
};
const assess = (revision, canonical = true) => exports.assessDesignPackage(
  { ...work, canonicalWorkId: canonical ? work.canonicalWorkId : undefined },
  packageId, '2026-10-13T20:00:00Z', { ...demand, designPackageRevision: revision }, policy,
);
assert.equal(assess(2).findings.find((finding) => finding.key === 'crew_demand_revision')?.severity, 'blocker');
assert.equal(assess(undefined).findings.find((finding) => finding.key === 'crew_demand_revision')?.severity, 'blocker');
assert.equal(assess(3).findings.some((finding) => finding.key === 'crew_demand_revision'), false);
assert.equal(assess(undefined, false).findings.some((finding) => finding.key === 'crew_demand_revision'), false);
console.log('Design demand revision projection: stale and missing canonical pins block; current and legacy paths retain their expected behavior.');
