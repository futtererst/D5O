import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const base = 'http://127.0.0.1:61643';
const actors = Object.fromEntries(JSON.parse(readFileSync('.rc13-actors.json', 'utf8')).map(x => [x.name, x]));
const work = JSON.parse(readFileSync('.rc13-synthetic-work.json', 'utf8'));
const stateResponse = await fetch(`${base}/api/d5o-hosted/prototype-state?workspace=rybex&key=work`,
  { headers: { cookie: actors.rybex_pm.cookie } });
const state = await stateResponse.json();
const current = state.state?.records?.find(x => x.id === work.id);
if (stateResponse.status !== 200 || current?.develop?.review?.status !== 'Submitted') throw Error('submitted fictional solution unavailable');
async function review(actor, action) {
  const response = await fetch(`${base}/api/d5o-hosted/prototype-commercial-command?workspace=rybex`, {
    method: 'POST', headers: { cookie: actors[actor].cookie, origin: base,
      'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
    body: JSON.stringify({ workId: work.id, action, commandId: randomUUID(), expectedRevision: state.revision,
      expectedDecisionRevision: 1, packageRevision: 1, note: `Independent fictional ${action} decision` }) });
  const body = await response.json();
  return { action, actor, status: response.status, error: body.error ?? null, authoritative: body.synthetic === false };
}
const actions = [await review('rybex_worker', 'approve-solution'), await review('rybex_ops', 'approve-solution')];
const out = { format: 'd5o-rc13a-develop-review-v1', auth: 'genuine fictional GoTrue sessions',
  fictionalWorkOnly: true, actions };
writeFileSync('docs/release/evidence/D5O_RC13A_DEVELOP_REVIEW.json', JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out));
