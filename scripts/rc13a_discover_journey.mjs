// Actual authenticated Discover decisions on only the fictional Work.
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const base = 'http://127.0.0.1:61643';
const actors = Object.fromEntries(JSON.parse(readFileSync('.rc13-actors.json', 'utf8')).map(x => [x.name, x]));
const work = JSON.parse(readFileSync('.rc13-synthetic-work.json', 'utf8'));
async function state() {
  const r = await fetch(`${base}/api/d5o-hosted/prototype-state?workspace=rybex&key=work`, { headers: { cookie: actors.rybex_pm.cookie } });
  const body = await r.json();
  const record = body.state?.records?.find(x => x.id === work.id && x.canonicalWorkId === work.canonicalWorkId);
  if (r.status !== 200 || !record) throw Error('fictional Work unavailable');
  return { sourceRevision: body.revision, pursuit: record.discovery?.pursuitControl, record };
}
const steps = [
  ['rybex_pm','save-intake', s => ({ requester: 'Fictional requester', intendedOutcome: 'Restore fictional service component',
    roughValue: '1000', currency: 'USD', requiredDate: '2026-12-01', knownRisk: 'Controlled fictional outage',
    customer: s.record.customer, site: s.record.site, owner: s.record.owner, need: s.record.discovery.need })],
  ['rybex_pm','submit', () => ({})],
  ['rybex_commercial','decide', () => ({ outcome: 'qualified', reason: 'Independent fictional qualification' })],
  ['rybex_pm','submit-handoff', () => ({ brief: 'Fictional qualified Work ready for an independent Define receiving decision.' })],
  ['rybex_ops','respond-handoff', () => ({ outcome: 'accepted', reason: 'Independent fictional receiving decision' })]
];
const results = [];
for (const [actor, action, intent] of steps) {
  const s = await state();
  const decisionRevision = Number(s.pursuit?.revision ?? 0);
  const r = await fetch(`${base}/api/d5o-hosted/prototype-pursuit-command?workspace=rybex`, {
    method: 'POST', headers: { cookie: actors[actor].cookie, origin: base,
      'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
    body: JSON.stringify({ workId: work.id, action, intent: intent(s), commandId: randomUUID(),
      expectedRevision: s.sourceRevision, expectedDecisionRevision: decisionRevision }) });
  const body = await r.json();
  results.push({ action, actor, http: r.status, error: body.error ?? null,
    authoritative: body.synthetic === false });
  if (r.status !== 200) break;
}
const final = await state();
const out = { format: 'd5o-rc13a-discover-http-v1', auth: 'genuine fictional GoTrue sessions',
  fictionalWorkOnly: true, operations: results,
  finalPursuitStatus: final.pursuit?.status ?? null,
  finalHandoffStatus: final.pursuit?.handoff?.status ?? null };
writeFileSync('docs/release/evidence/D5O_RC13A_DISCOVER_JOURNEY.json', JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out));
