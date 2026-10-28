import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const actor = JSON.parse(readFileSync('.rc13-actors.json', 'utf8')).find(x => x.name === 'rybex_pm');
if (!actor) throw Error('fictional project manager missing');
const base = 'http://127.0.0.1:61643';
const path = '/api/d5o-hosted/connected-work?workspace=rybex';
const get = await fetch(base + path, { headers: { cookie: actor.cookie } });
const listing = await get.json();
if (get.status !== 200 || !listing.workTypes?.some(x => x.key === 'technical-delivery') ||
  listing.workTypes?.some(x => x.key === 'beta-config-install')) throw Error('published Work Type classification failed');
const input = { commandId: randomUUID(), configurationVersionId: listing.versionId,
  workTypeKey: 'technical-delivery', title: 'RC13 fictional connected Work', customer: 'Example customer',
  site: 'Example site', owner: 'Fictional project manager',
  initialDiscovery: { source: 'Direct customer', need: 'Fictional qualification need', procurement: 'To be confirmed', closeDate: '' } };
async function post(body) {
  const response = await fetch(base + path, { method: 'POST', headers: { cookie: actor.cookie,
    origin: base, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
const created = await post(input);
const replay = await post(input);
const conflict = await post({ ...input, title: 'Changed fictional title' });
const disabled = await post({ ...input, commandId: randomUUID(), workTypeKey: 'beta-config-install' });
const out = { format: 'd5o-rc13-connected-compatibility-v1', baseline: '8b6b0d9e4aa484d0f0db1d075a969b79e01b0989',
  correction: 'only explicitly disabled published Work Types excluded',
  preCorrection: { getHttp: 200, available: true, selectableTypes: 0, validTypePostHttp: 409, validTypeError: 'configuration_changed' },
  postCorrection: { getHttp: get.status, selectableTypes: listing.workTypes.map(x => x.key),
    createHttp: created.status, presentationIdPresent: Boolean(created.body.result?.presentationId),
    exactReplayHttp: replay.status, samePresentationId: replay.body.result?.presentationId === created.body.result?.presentationId,
    conflictingReplayHttp: conflict.status, conflictingReplayError: conflict.body.error ?? null,
    disabledTypeHttp: disabled.status, disabledTypeError: disabled.body.error ?? null } };
writeFileSync('docs/release/evidence/D5O_RC13_CONNECTED_COMPATIBILITY.json', JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out));
