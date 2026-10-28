// Synthetic Develop source fixture followed by genuine-session authoritative review.
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const base = 'http://127.0.0.1:61643';
const actors = Object.fromEntries(JSON.parse(readFileSync('.rc13-actors.json', 'utf8')).map(x => [x.name, x]));
const work = JSON.parse(readFileSync('.rc13-synthetic-work.json', 'utf8'));
async function read() {
  const r = await fetch(`${base}/api/d5o-hosted/prototype-state?workspace=rybex&key=work`, { headers: { cookie: actors.rybex_pm.cookie } });
  const body = await r.json();
  if (r.status !== 200) throw Error(`state ${r.status}`);
  return body;
}
async function post(actor, path, body) {
  const r = await fetch(base + path, { method: 'POST', headers: { cookie: actors[actor].cookie,
    origin: base, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const result = await r.json();
  return { status: r.status, error: result.error ?? null, authoritative: result.synthetic === false };
}
const before = await read();
const old = before.state.records.find(x => x.id === work.id && x.canonicalWorkId === work.canonicalWorkId);
if (!old || old.definition?.developHandoff?.status !== 'accepted') throw Error('fictional Define handoff absent');
const option = { id: 'service-option', revision: 1, name: 'Controlled repair', approach: 'Inspect then repair',
  requirementIds: ['requirement-1'], unmetRequirements: '', deliveryModel: 'Self-perform', materials: 'Existing stock',
  resourceBasis: 'Qualified crew', scheduleBasis: 'Confirmed window', safetyQuality: 'Permit and inspection',
  risks: 'Managed outage', evidence: 'Synthetic inspected option assessment', owner: 'Project manager', status: 'Viable' };
const develop = { revision: 1, options: [option], selectedOptionId: option.id,
  selectionRationale: 'Bounded repair addresses fictional accepted scope', laborStrategy: 'Qualified service team',
  procurementStrategy: 'Existing stock', scheduleStrategy: 'Confirmed site window', safetyStrategy: 'Permit before work',
  qualityStrategy: 'Independent inspection', riskMitigation: 'Rollback plan', targetDate: '2026-12-01',
  designOwner: 'Project manager', history: [] };
const next = { ...before.state, revision: before.revision + 1,
  records: before.state.records.map(x => x.id === work.id ? { ...x, develop } : x) };
const fixture = await post('rybex_pm', '/api/d5o-hosted/prototype-state?workspace=rybex',
  { workspace: 'rybex', key: 'work', expectedRevision: before.revision, state: next });
const actions = [];
if (fixture.status === 200) {
  async function command(actor, action, decisionRevision, packageRevision, expectedRevision) {
    return post(actor, '/api/d5o-hosted/prototype-commercial-command?workspace=rybex',
      { workId: work.id, action, commandId: randomUUID(), expectedRevision,
        expectedDecisionRevision: decisionRevision, packageRevision,
        ...(action === 'submit-solution' ? { dueDate: '2026-12-01' } : {}),
        note: `Fictional ${action} review` });
  }
  const current = await read();
  actions.push({ action: 'submit-solution', actor: 'rybex_pm', ...await command('rybex_pm', 'submit-solution', 0, 1, current.revision) });
  if (actions.at(-1).status === 200) {
    actions.push({ action: 'wrong-role-approve-solution', actor: 'rybex_worker',
      ...await command('rybex_worker', 'approve-solution', 1, 1, current.revision) });
    actions.push({ action: 'approve-solution', actor: 'rybex_ops',
      ...await command('rybex_ops', 'approve-solution', 1, 1, current.revision) });
  }
}
const after = await read();
const updated = after.state.records.find(x => x.id === work.id);
const out = { format: 'd5o-rc13a-develop-solution-v1', auth: 'genuine fictional GoTrue sessions',
  fictionalWorkOnly: true, fixtureSetupHttp: fixture.status, fixtureSetupError: fixture.error,
  actions, finalReview: updated?.develop?.review?.status ?? null };
writeFileSync('docs/release/evidence/D5O_RC13A_DEVELOP_SOLUTION.json', JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out));
