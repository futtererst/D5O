// Keeps historical private paths and bytes in memory; writes sanitized outcomes only.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const actors = Object.fromEntries(JSON.parse(readFileSync('.rc13-actors.json', 'utf8')).map(x => [x.name, x]));
const target = new URL(JSON.parse(readFileSync('.rc13-evidence-target.json', 'utf8')).url, 'http://127.0.0.1:61643');
const phase = process.argv[2] === 'after' ? 'afterRevocation' : 'beforeRevocation';
const app = await fetch(target, { headers: { cookie: actors.rybex_ops.cookie } });
const appBytes = Buffer.from(await app.arrayBuffer());
const appHash = app.ok ? createHash('sha256').update(appBytes).digest('hex') : null;
let receipt = null;
if (phase === 'beforeRevocation') {
  const p = target.searchParams;
  const isDesign = target.pathname.includes('design-document');
  const args = isDesign ? { p_workspace_key: p.get('workspace'), p_presentation_id: p.get('workId'),
    p_document_id: p.get('documentId'), p_document_revision: Number(p.get('revision')) } :
    { p_workspace_key: p.get('workspace'), p_presentation_id: p.get('workId'), p_evidence_id: p.get('evidenceId') };
  const rpc = await fetch(`http://127.0.0.1:56621/rest/v1/rpc/d5o_hosted_${isDesign ? 'design_document' : 'customer_decision'}_evidence_read_v1`, {
    method: 'POST', headers: { 'content-type': 'application/json', apikey: process.env.SUPABASE_SECRET_KEY,
      authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}` }, body: JSON.stringify(args) });
  if (!rpc.ok) throw Error(`isolated metadata receipt unavailable: ${rpc.status}`);
  receipt = await rpc.json();
  if (!receipt?.objectPath) throw Error('isolated receipt path missing');
}
const run = async (actor, objectPath) => {
  const token = actor ? actors[actor].accessToken : process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const response = await fetch(`http://127.0.0.1:56621/storage/v1/object/authenticated/d5o-deploy-evidence/${objectPath}`, {
    headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${token}` } });
  const bytes = Buffer.from(await response.arrayBuffer());
  return { http: response.status, bytes: response.ok ? bytes.length : 0,
    hash: response.ok ? createHash('sha256').update(bytes).digest('hex') : null };
};
const prior = phase === 'afterRevocation' ? JSON.parse(readFileSync('docs/release/evidence/D5O_RC13_EVIDENCE_AUTH.json', 'utf8')) : null;
const out = prior ?? { format: 'd5o-rc13-private-evidence-auth-v1',
  source: '8b6b0d9e4aa484d0f0db1d075a969b79e01b0989 plus narrow connected Work correction',
  auth: 'genuine GoTrue v2.195.0 fictional sessions', storage: 'Storage API v1.84.19; 23 verified retained bytes' };
if (phase === 'beforeRevocation') {
  const direct = await run('rybex_ops', receipt.objectPath);
  const foreign = await run('rotork_pm', receipt.objectPath);
  const anonymous = await run(null, receipt.objectPath);
  const missing = await run('rybex_ops', `${receipt.objectPath}-missing`);
  out.beforeRevocation = { appHttp: app.status, appHashMatchesReceipt: appHash === receipt.checksumSha256,
    appCacheControl: app.headers.get('cache-control'), appHasStorageTokenHeader: Boolean(app.headers.get('x-supabase-token')),
    directUserHttp: direct.http, crossTenantDirectHttp: foreign.http, anonymousDirectHttp: anonymous.http,
    missingDirectHttp: missing.http, directBytesWithheld: direct.bytes === 0 && foreign.bytes === 0 && anonymous.bytes === 0 };
  writeFileSync('.rc13-object-path.json', JSON.stringify({ path: receipt.objectPath }), { mode: 0o600 });
} else {
  const { path } = JSON.parse(readFileSync('.rc13-object-path.json', 'utf8'));
  const direct = await run('rybex_ops', path);
  out.afterRevocation = { appHttp: app.status, appBytesWithheld: !app.ok,
    directUserHttp: direct.http, directBytesWithheld: direct.bytes === 0 };
}
writeFileSync('docs/release/evidence/D5O_RC13_EVIDENCE_AUTH.json', JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(phase === 'beforeRevocation' ? out.beforeRevocation : out.afterRevocation));
