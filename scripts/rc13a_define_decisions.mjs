// Genuine-session independent Define decisions on fictional Work only.
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const base = 'http://127.0.0.1:61643';
const actors = Object.fromEntries(JSON.parse(readFileSync('.rc13-actors.json', 'utf8')).map(x => [x.name, x]));
const work = JSON.parse(readFileSync('.rc13-synthetic-work.json', 'utf8'));
async function state() {
  const r = await fetch(`${base}/api/d5o-hosted/prototype-state?workspace=rybex&key=work`, { headers: { cookie: actors.rybex_pm.cookie } });
  const j = await r.json(), x = j.state?.records?.find(item => item.id === work.id);
  if (r.status !== 200 || !x) throw Error('fictional Define state unavailable');
  return { revision: j.revision, definition: x.definition };
}
async function command(actor, action, role, reason, commandId = randomUUID(), expected) {
  const s = expected ?? await state();
  const r = await fetch(`${base}/api/d5o-hosted/prototype-define-command?workspace=rybex`, {
    method: 'POST', headers: { cookie: actors[actor].cookie, origin: base,
      'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
    body: JSON.stringify({ workId: work.id, action, role, reason, commandId,
      expectedRevision: s.revision, expectedDecisionRevision: s.definition?.authorityRevision ?? 0 }) });
  const body = await r.json();
  return { status: r.status, error: body.error ?? null, authoritative: body.synthetic === false };
}
const ops = [];
const pre = await state();
ops.push({ action: 'wrong-role-commercial-review', actor: 'rybex_worker', ...await command('rybex_worker','approve-review','commercial','Fictional unauthorized review') });
const commercialId = randomUUID();
ops.push({ action: 'approve-commercial-review', actor: 'rybex_commercial', ...await command('rybex_commercial','approve-review','commercial','Independent fictional commercial review',commercialId) });
if (ops.at(-1).status === 200) {
  ops.push({ action: 'exact-commercial-replay', actor: 'rybex_commercial', ...await command('rybex_commercial','approve-review','commercial','Independent fictional commercial review',commercialId,pre) });
  ops.push({ action: 'conflicting-commercial-replay', actor: 'rybex_commercial', ...await command('rybex_commercial','approve-review','commercial','Different fictional reason',commercialId,pre) });
  ops.push({ action: 'approve-delivery-review', actor: 'rybex_ops', ...await command('rybex_ops','approve-review','delivery','Independent fictional delivery review') });
  if (ops.at(-1).status === 200) {
    ops.push({ action: 'submit-Define-handoff', actor: 'rybex_pm', ...await command('rybex_pm','submit-handoff',null,'Approved fictional baseline sent to Develop') });
    if (ops.at(-1).status === 200)
      ops.push({ action: 'accept-Define-handoff', actor: 'rybex_ops', ...await command('rybex_ops','accept-handoff',null,'Independent fictional Develop receipt') });
  }
}
const after = await state();
const out = { format: 'd5o-rc13a-define-decisions-v1', fictionalWorkOnly: true,
  auth: 'genuine fictional GoTrue sessions', operations: ops,
  finalDefinitionStatus: after.definition?.status ?? null,
  commercialReview: after.definition?.reviews?.commercial ?? null,
  deliveryReview: after.definition?.reviews?.delivery ?? null,
  developHandoffStatus: after.definition?.developHandoff?.status ?? null };
writeFileSync('docs/release/evidence/D5O_RC13A_DEFINE_DECISIONS.json', JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out));
