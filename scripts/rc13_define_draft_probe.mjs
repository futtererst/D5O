// Draft/decision checks are restricted to the fictional Work created in RC13.
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const actors = Object.fromEntries(JSON.parse(readFileSync('.rc13-actors.json', 'utf8')).map(x => [x.name, x]));
const synthetic = JSON.parse(readFileSync('.rc13-synthetic-work.json', 'utf8'));
const base = 'http://127.0.0.1:61643';
async function get(actor) {
  const r = await fetch(`${base}/api/d5o-hosted/prototype-state?workspace=rybex&key=work`, { headers: { cookie: actors[actor].cookie } });
  return { status: r.status, body: await r.json() };
}
async function post(actor, path, body) {
  const r = await fetch(base + path, { method: 'POST', headers: { cookie: actors[actor].cookie,
    origin: base, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}
const before = await get('rybex_pm');
if (before.status !== 200) throw Error('fictional Work state unavailable');
const work = before.body.state.records.find(x => x.id === synthetic.id);
if (!work?.canonicalWorkId || work.definition) throw Error('unexpected fictional Work starting state');
const draft = { revision: 1, status: 'Draft', outcome: '', acceptance: '', includedScope: '', excludedScope: '',
  deliveryApproach: '', milestones: '', dependencies: '', estimateBasis: '', commercialTerms: '',
  risks: '', owner: work.owner, history: [] };
const next = { ...before.body.state, revision: before.body.revision + 1,
  records: before.body.state.records.map(x => x.id === synthetic.id ? { ...x, definition: draft } : x) };
const saved = await post('rybex_pm', '/api/d5o-hosted/prototype-state?workspace=rybex', {
  workspace: 'rybex', key: 'work', expectedRevision: before.body.revision, state: next });
const after = await get('rybex_pm');
const savedWork = after.body.state?.records?.find(x => x.id === synthetic.id);
const command = { workId: synthetic.id, action: 'submit', commandId: randomUUID(),
  expectedRevision: after.body.revision, expectedDecisionRevision: 0 };
const incomplete = await post('rybex_pm', '/api/d5o-hosted/prototype-define-command?workspace=rybex', command);
const wrongRole = await post('rybex_worker', '/api/d5o-hosted/prototype-define-command?workspace=rybex',
  { ...command, commandId: randomUUID() });
const stale = await post('rybex_pm', '/api/d5o-hosted/prototype-state?workspace=rybex', {
  workspace: 'rybex', key: 'work', expectedRevision: before.body.revision, state: next });
const out = { format: 'd5o-rc13-define-draft-http-v1', auth: 'genuine fictional GoTrue sessions',
  syntheticWorkOnly: true, saveDraftHttp: saved.status, draftPersisted: savedWork?.definition?.status === 'Draft',
  submitIncompleteHttp: incomplete.status, submitIncompleteError: incomplete.body.error ?? null,
  wrongRoleHttp: wrongRole.status, wrongRoleError: wrongRole.body.error ?? null,
  staleDraftHttp: stale.status, staleDraftError: stale.body.error ?? null };
writeFileSync('docs/release/evidence/D5O_RC13_DEFINE_DRAFT.json', JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out));
