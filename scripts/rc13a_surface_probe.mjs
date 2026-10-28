// Bounded genuine-session read and denial checks; no historical Work mutation.
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const base = 'http://127.0.0.1:61643';
const api = 'http://127.0.0.1:56621';
const actors = Object.fromEntries(JSON.parse(readFileSync('.rc13-actors.json', 'utf8')).map(x => [x.name, x]));
const work = JSON.parse(readFileSync('.rc13-synthetic-work.json', 'utf8'));
const call = async (who, path, body) => {
  const r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: {
    ...(who ? { cookie: actors[who].cookie } : {}),
    ...(body ? { origin: base, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  const type = r.headers.get('content-type') ?? '';
  return { http: r.status, body: type.includes('json') ? await r.json() : null };
};
const pm = 'rybex_pm';
const queue = await call(pm, '/api/d5o-hosted/customer-work?workspace=rybex');
const foreign = await call('rotork_pm', '/api/d5o-hosted/customer-work?workspace=rybex');
const admin = await call('rybex_admin', '/api/d5o-hosted/admin-configuration?workspace=rybex');
const adminDenied = await call(pm, '/api/d5o-hosted/admin-configuration?workspace=rybex');
const organization = await call('rybex_admin', '/api/d5o-hosted/org-admin?workspace=rybex&kind=overview');
const phase = await call(pm, '/api/d5o-hosted/prototype-state?workspace=rybex&key=work');
const synthetic = phase.body?.state?.records?.find(x => x.id === work.id);
const cap = await call(pm, '/api/d5o-hosted/connected-work?workspace=rybex');
const invalidConfig = await call(pm, '/api/d5o-hosted/connected-work?workspace=rybex', {
  commandId: randomUUID(), configurationVersionId: randomUUID(), workTypeKey: 'technical-delivery',
  title: 'Rejected fictional wrong pin', customer: 'Example', site: 'Example', owner: 'Fictional PM' });
const privileged = await fetch(`${api}/rest/v1/rpc/d5o_hosted_design_document_evidence_read_v1`, {
  method: 'POST', headers: { 'content-type': 'application/json',
    apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    authorization: `Bearer ${actors.rybex_pm.accessToken}` },
  body: JSON.stringify({ p_workspace_key: 'rybex', p_presentation_id: work.id,
    p_document_id: randomUUID(), p_document_revision: 1 }) });
const out = { format: 'd5o-rc13a-surface-and-security-v1', auth: 'genuine fictional GoTrue sessions',
  queueHttp: queue.http, queueHasTasks: Array.isArray(queue.body?.tasks),
  foreignQueueHttp: foreign.http, adminConfigurationHttp: admin.http,
  wrongRoleAdminHttp: adminDenied.http, organizationOverviewHttp: organization.http,
  phaseReadHttp: phase.http, fictionalWorkPinPresent: Boolean(synthetic?.phaseConfigurationVersionId),
  publishedTypesHttp: cap.http, selectableTypeCount: cap.body?.workTypes?.length ?? null,
  invalidConfigurationCreateHttp: invalidConfig.http, invalidConfigurationError: invalidConfig.body?.error ?? null,
  directPrivilegedRpcHttp: privileged.status, productionModified: false };
writeFileSync('docs/release/evidence/D5O_RC13A_SURFACE_SECURITY.json', JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out));
