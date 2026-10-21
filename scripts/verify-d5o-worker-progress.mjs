import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file, dependencies = {}) {
  const compiled = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: (key) => {
    if (!(key in dependencies)) throw new Error(`Unexpected dependency: ${key}`);
    return dependencies[key];
  }, Date, Set, Map }, { filename: file });
  return exports;
}
const policy = load('components/d5o/platform/deploy-policy.ts');
const model = load('components/d5o/platform/deploy-model.ts', { './deploy-policy': policy });
const { deployWorkerProjection, workerPackageProgress } = load('lib/d5o/prototype-work/deploy-worker-projection.ts', {
  'server-only': {}, '@/components/d5o/platform/deploy-model': model,
});
const release = { id: 'release-1', packageId: 'package-1', packageRevision: 1, status: 'Accepted', snapshot: { completionBasis: { kind: 'Measured', plannedQuantity: 12, unit: 'links' } } };
const report = (id, authorId, status, quantity, revision = 1) => ({ id, authorId, status, quantity, revision, packageId: 'package-1', releaseId: 'release-1', bookingId: 'booking-1', unit: 'links', evidenceIds: [] });
const work = { id: 'fictional-progress', workspace: 'rybex', title: 'Fictional progress', type: 'Technical delivery', customer: 'Fictional customer', site: 'Training room', stage: 'Deploy', owner: 'PM', nextAction: '', progress: 0, value: 'private commercial value', status: 'moving', proof: [], blockers: [], history: [],
  design: { releases: [release], packages: [{ packageId: 'package-1', revision: 1 }], documents: [], reviews: [], history: [] },
  deploy: { permits: [], reports: [report('first', 'worker-a', 'Reviewed', 4), report('second', 'worker-b', 'Submitted', 8)], inspections: [], issues: [], evidence: [], signoffs: [], turnovers: [], events: [] } };

assert.deepEqual(JSON.parse(JSON.stringify(workerPackageProgress(work, 'package-1'))), { releaseId: 'release-1', plannedQuantity: 12, reviewedQuantity: 4, remainingQuantity: 8, unit: 'links' });
const worker = deployWorkerProjection(work, 'package-1', 'booking-1', 'worker-a');
assert.equal(worker.deploy.reports.length, 1);
assert.equal(worker.deploy.reports[0].authorId, 'worker-a');
assert.equal(worker.value, '');
assert.equal(worker.workerProgress.reviewedQuantity, 4);
work.deploy.reports[1].status = 'Returned';
assert.equal(workerPackageProgress(work, 'package-1').reviewedQuantity, 4);
work.deploy.reports[1] = report('second', 'worker-b', 'Reviewed', 8, 2);
assert.equal(workerPackageProgress(work, 'package-1').reviewedQuantity, 12, 'corrected revision replaces, rather than adds to, the prior report');
assert.equal(workerPackageProgress(work, 'package-1').remainingQuantity, 0);
assert.equal(model.currentReviewedCompletion(work, 'package-1'), null, 'zero remaining does not authorize package completion');
work.deploy.reports[1].releaseId = 'superseded-release';
assert.equal(workerPackageProgress(work, 'package-1').reviewedQuantity, 4, 'only the current accepted release contributes');
console.log('Worker package progress, release binding, privacy and correction arithmetic passed.');
