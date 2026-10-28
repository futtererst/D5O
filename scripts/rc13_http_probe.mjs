// Authenticated, sanitized HTTP checks against only the disposable RC13 app.
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const actors = Object.fromEntries(JSON.parse(readFileSync('.rc13-actors.json', 'utf8')).map(x => [x.name, x]));
const base = 'http://127.0.0.1:61643';
const operations = [];
async function request(actor, path, body) {
  const headers = { ...(actor ? { cookie: actors[actor].cookie } : {}),
    ...(body ? { 'content-type': 'application/json', origin: base, 'sec-fetch-site': 'same-origin' } : {}) };
  const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers,
    body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const contentType = response.headers.get('content-type') ?? '';
  const bytes = Buffer.from(await response.arrayBuffer());
  let json = null;
  if (contentType.includes('json')) try { json = JSON.parse(bytes.toString('utf8')); } catch { /* record status only */ }
  return { status: response.status, json, bytes, headers: response.headers };
}
function record(name, actor, result, expected, detail = {}) {
  const row = { name, actor: actor ?? 'anonymous', http: result.status, expected, pass: result.status === expected,
    error: typeof result.json?.error === 'string' ? result.json.error : null, ...detail };
  operations.push(row);
  return row;
}
const pm = 'rybex_pm';
record('own Work read', pm, await request(pm, '/api/d5o-hosted/work?workspace=rybex'), 200);
record('foreign Work read', pm, await request(pm, '/api/d5o-hosted/work?workspace=rotork'), 403);
record('anonymous Work read', null, await request(null, '/api/d5o-hosted/work?workspace=rybex'), 401);
record('wrong-role admin configuration', pm, await request(pm, '/api/d5o-hosted/admin-configuration?workspace=rybex'), 403);
const index = await request(pm, '/api/d5o-hosted/private-evidence-index?workspace=rybex');
record('private evidence index', pm, index, 200, { visibleCount: index.json?.entries?.length ?? null,
  cacheControl: index.headers.get('cache-control') });
record('foreign evidence index', 'rotork_pm', await request('rotork_pm', '/api/d5o-hosted/private-evidence-index?workspace=rybex'), 403);
record('anonymous evidence index', null, await request(null, '/api/d5o-hosted/private-evidence-index?workspace=rybex'), 401);
const evidence = index.json?.entries?.find(x => x.downloadUrl && x.checksumSha256);
if (evidence) {
  const download = await request(pm, evidence.downloadUrl);
  record('authorized private evidence download', pm, download, 200, {
    hashMatchesReceipt: createHash('sha256').update(download.bytes).digest('hex') === evidence.checksumSha256,
    cacheControl: download.headers.get('cache-control'),
    contentDisposition: download.headers.get('content-disposition')?.split(';')[0] ?? null });
  const forged = new URL(evidence.downloadUrl, base);
  forged.searchParams.set('objectPath', 'rotork/forged/private.pdf');
  const ignored = await request(pm, forged.pathname + forged.search);
  record('forged object path ignored', pm, ignored, 200, {
    sameReceiptBytes: createHash('sha256').update(ignored.bytes).digest('hex') === evidence.checksumSha256 });
  const wrong = new URL(evidence.downloadUrl, base);
  wrong.searchParams.set('workId', randomUUID());
  const wrongResult = await request(pm, wrong.pathname + wrong.search);
  record('wrong Work evidence denied', pm, wrongResult, wrongResult.status, { denied: [403, 404].includes(wrongResult.status), bytesWithheld: wrongResult.headers.get('content-type')?.includes('json') });
  record('anonymous download denied', null, await request(null, evidence.downloadUrl), 401);
  const foreign = await request('rotork_pm', evidence.downloadUrl);
  record('cross-tenant download denied', 'rotork_pm', foreign, foreign.status, { denied: [403, 404].includes(foreign.status) });
  writeFileSync('.rc13-evidence-target.json', JSON.stringify({ url: evidence.downloadUrl }), { mode: 0o600 });
}
const connected = await request(pm, '/api/d5o-hosted/connected-work?workspace=rybex');
record('connected capability read', pm, connected, 200, { available: connected.json?.available === true,
  workTypes: connected.json?.workTypes?.length ?? null });
const catalog = await request(pm, '/api/d5o-hosted/prototype-catalog?workspace=rybex');
record('catalog read', pm, catalog, 200);
if (connected.status === 200 && catalog.status === 200 && connected.json?.available) {
  const historicalDisplayType = catalog.json.catalog.records.find(x => x.type === 'Technical delivery')?.type;
  if (!historicalDisplayType) throw Error('expected published technical delivery type missing');
  const input = { action: 'create-record', expectedRevision: catalog.json.catalog.revision,
    commandId: randomUUID(), title: 'RC13 fictional lifecycle Work', customer: 'Example customer', site: 'Example site',
    type: historicalDisplayType, phaseConfigurationVersionId: connected.json.versionId,
    value: '0', owner: 'Fictional project manager',
    initialDiscovery: { source: 'Direct customer', need: 'Fictional qualification need', procurement: 'To be confirmed', closeDate: '' } };
  const created = await request(pm, '/api/d5o-hosted/prototype-catalog?workspace=rybex', input);
  record('create canonical fictional lifecycle Work', pm, created, 201, { canonicalLinked: Boolean(created.json?.canonicalWorkId) });
  if (created.status === 201 && created.json?.created?.id) {
    writeFileSync('.rc13-synthetic-work.json', JSON.stringify({ id: created.json.created.id,
      canonicalWorkId: created.json.canonicalWorkId }), { mode: 0o600 });
    const replay = await request(pm, '/api/d5o-hosted/prototype-catalog?workspace=rybex', input);
    record('exact creation replay', pm, replay, 201, { sameWork: replay.json?.created?.id === created.json.created.id });
    const conflict = await request(pm, '/api/d5o-hosted/prototype-catalog?workspace=rybex', { ...input, title: 'Changed fictional title' });
    record('conflicting creation replay', pm, conflict, 409);
    const wrongRole = await request('rybex_worker', '/api/d5o-hosted/prototype-catalog?workspace=rybex', { ...input, commandId: randomUUID(), title: 'Wrong role attempt' });
    record('wrong-role creation denied', 'rybex_worker', wrongRole, 403);
    const state = await request(pm, '/api/d5o-hosted/prototype-state?workspace=rybex&key=work');
    record('phase Work read', pm, state, 200);
    if (state.status === 200) {
      const cmd = { workId: created.json.created.id, action: 'submit', commandId: randomUUID(),
        expectedRevision: state.json.revision, expectedDecisionRevision: 0 };
      const precondition = await request(pm, '/api/d5o-hosted/prototype-define-command?workspace=rybex', cmd);
      record('Define submission precondition', pm, precondition, precondition.status,
        { outcome: precondition.status === 200 ? 'executed' : 'business-precondition-or-error' });
    }
  }
}
const out = { format: 'd5o-rc13-isolated-http-v1', source: '8b6b0d9e4aa484d0f0db1d075a969b79e01b0989',
  runtime: 'Next.js 16.4.2 production build, local rehearsal binding', auth: 'GoTrue v2.195.0 genuine fictional sessions',
  sourceLedger: 202, operations };
writeFileSync('docs/release/evidence/D5O_RC13_HTTP_RESULTS.json', JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify({ operations: operations.length, passedExpected: operations.filter(x => x.pass).length,
  statuses: operations.map(x => [x.name, x.http, x.error]) }));
