// Synthetic source fixture, followed by genuine-session authoritative Define commands.
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const base = 'http://127.0.0.1:61643';
const actors = Object.fromEntries(JSON.parse(readFileSync('.rc13-actors.json', 'utf8')).map(x => [x.name, x]));
const work = JSON.parse(readFileSync('.rc13-synthetic-work.json', 'utf8'));
const read = async () => {
  const r = await fetch(`${base}/api/d5o-hosted/prototype-state?workspace=rybex&key=work`, { headers: { cookie: actors.rybex_pm.cookie } });
  return { status: r.status, body: await r.json() };
};
const post = async (who, path, body) => {
  const r = await fetch(base + path, { method: 'POST', headers: { cookie: actors[who].cookie,
    origin: base, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const before = await read();
const existing = before.body.state.records.find(x => x.id === work.id && x.canonicalWorkId === work.canonicalWorkId);
if (!existing) throw Error('fictional Work not found');
const definition = { revision: 1, status: 'Draft', outcome: 'Fictional service restored',
  acceptance: 'Fictional customer witnesses operation', includedScope: 'Inspect and repair fictional component',
  excludedScope: 'Unrelated systems', deliveryApproach: 'Controlled visit and verification',
  milestones: 'Inspect then test', dependencies: 'Approved fictional site access',
  estimateBasis: 'Synthetic cost basis', commercialTerms: 'Subject to fictional authorization',
  risks: 'Controlled service outage', owner: 'Fictional project manager', history: [],
  project: { customerContact: 'Fictional representative', siteArea: 'Fictional site',
    affectedSystems: 'Fictional service component', accessConstraints: 'Escorted access', requiredDate: '2026-12-01' },
  findings: [{ id: 'finding-1', kind: 'Customer input', status: 'Confirmed',
    detail: 'Fictional component needs inspection', source: 'Synthetic briefing' }], clarifications: [],
  scopeControl: { requirements: [{ id: 'requirement-1', need: 'Restore fictional component',
    source: 'Synthetic scope', owner: 'Fictional project manager', state: 'Confirmed' }],
    interfaces: [{ id: 'interface-1', kind: 'Technical', boundary: 'Fictional component',
      owner: 'Fictional project manager', counterparty: 'Fictional customer', agreement: 'Escorted inspection' }],
    assumptions: [], customerAgreement: { representative: 'Fictional representative',
      agreedAt: '2026-10-28', basis: 'Synthetic accepted scope' } },
  registers: { scope_items: [{ id: 'scope-1', requirementId: 'requirement-1',
    deliverable: 'Inspected component', boundary: 'Fictional component', owner: 'Fictional project manager' }],
    acceptance_criteria: [{ id: 'accept-1', scopeId: 'scope-1', result: 'Operational',
      method: 'Functional test', proof: 'Synthetic test record', authority: 'Fictional representative' }] } };
const nextWork = { ...existing, definition };
const next = { ...before.body.state, revision: before.body.revision + 1,
  records: before.body.state.records.map(x => x.id === work.id ? nextWork : x) };
const saved = await post('rybex_pm', '/api/d5o-hosted/prototype-state?workspace=rybex', {
  workspace: 'rybex', key: 'work', expectedRevision: before.body.revision, state: next });
const after = await read();
const submit = saved.status === 200 ? await post('rybex_pm', '/api/d5o-hosted/prototype-define-command?workspace=rybex', {
  workId: work.id, action: 'submit', commandId: randomUUID(), expectedRevision: after.body.revision,
  expectedDecisionRevision: 0 }) : null;
const out = { format: 'd5o-rc13a-define-progress-v1', fixtureSetupHttp: saved.status,
  fixtureSetupError: saved.body.error ?? null, syntheticWorkOnly: true,
  submitHttp: submit?.status ?? null, submitError: submit?.body.error ?? null,
  submitAuthoritative: submit?.body.synthetic === false };
writeFileSync('docs/release/evidence/D5O_RC13A_DEFINE_PROGRESS.json', JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out));
