// Authenticated HTTP commercial qualification on fictional Work only.
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const actors = Object.fromEntries(JSON.parse(readFileSync('.rc13-actors.json','utf8')).map(a => [a.name,a]));
const work = JSON.parse(readFileSync('.rc13-synthetic-work.json','utf8'));
const base = 'http://127.0.0.1:61643';
const get = async () => {
  const response = await fetch(`${base}/api/d5o-hosted/prototype-state?workspace=rybex&key=work`,
    { headers: { cookie: actors.rybex_pm.cookie } });
  const body = await response.json();
  const record = body.state?.records?.find(r => r.id === work.id && r.canonicalWorkId === work.canonicalWorkId);
  if (response.status !== 200 || !record) throw Error('fictional Work missing');
  return { revision: body.revision, record };
};
const send = async (actor, action, revision, decisionRevision, extra = {}) => {
  const response = await fetch(`${base}/api/d5o-hosted/prototype-commercial-command?workspace=rybex`, {
    method: 'POST', headers: { cookie: actors[actor].cookie, origin: base,
      'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
    body: JSON.stringify({ workId: work.id, action, commandId: randomUUID(), expectedRevision: revision,
      expectedDecisionRevision: decisionRevision, packageRevision: 1, ...extra }) });
  const body = await response.json();
  return { actor, action, http: response.status, error: body.error ?? null, authoritative: body.synthetic === false };
};
const initial = await get();
if (initial.record.develop?.review?.status !== 'Approved') throw Error('fictional solution not approved');
const r = initial.record;
const pricingInput = { currency: 'USD', workType: r.type, customer: r.customer, region: r.site,
  pricedAt: '2026-10-28', lines: [{ id: 'service-labor', scopeRef: 'service-option', category: 'labor',
    description: 'Controlled fictional inspection and repair', quantity: '100', unit: 'hour',
    manualRate: '10.00', source: 'Fictional dated quote',
    assumption: 'Qualified crew completes fictional repair' }], discountPercent: 0,
  riskBasis: 'Synthetic bounded contingency', estimateMaturity: 'Budgetary',
  definitionRevision: r.definition.revision, solutionRevision: r.develop.revision };
const steps = [
  ['rybex_pm','save-detailed-estimate',0,{pricingInput}],
  ['rybex_pm','submit-pricing',1,{dueDate:'2026-12-01'}],
  ['rybex_ops','approve-pricing',2,{note:'Independent fictional detailed pricing review'}]
];
const operations = [];
for (const [actor, action, decision, extra] of steps) {
  const source = await get();
  const result = await send(actor, action, source.revision, decision, extra);
  operations.push(result);
  if (result.http !== 200) break;
}
const final = await get();
const output = { format:'d5o-rc14-commercial-http-v1', source:'ef9bf423680c94fbbb41c4d9b7a5a5070ce6a10c',
  auth:'genuine fictional GoTrue session', syntheticWorkOnly:true, operations,
  finalEstimateStatus: final.record.discovery?.estimate?.status ?? null };
writeFileSync('docs/release/evidence/D5O_RC14_COMMERCIAL_HTTP.json', JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify(output));
