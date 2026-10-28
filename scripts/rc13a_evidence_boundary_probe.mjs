// Run after each fictional membership-state transition in the isolated DB.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const stage = process.argv[2];
if (!['active', 'suspended', 'removed', 'missing-object'].includes(stage)) throw Error('invalid local stage');
const base = 'http://127.0.0.1:61643';
const actors = Object.fromEntries(JSON.parse(readFileSync('.rc13-actors.json', 'utf8')).map(x => [x.name, x]));
const get = (who, path) => fetch(base + path, { headers: who ? { cookie: actors[who].cookie } : {} });
const indexResponse = await get('rybex_pm', '/api/d5o-hosted/private-evidence-index?workspace=rybex');
const index = await indexResponse.json();
const decision = index.entries?.find(x => x.kind === 'package-acceptance' || x.kind === 'work-acceptance');
if (!decision) throw Error('historical customer-decision fixture missing');
const ops = await get('rybex_ops', decision.downloadUrl);
const opsBytes = Buffer.from(await ops.arrayBuffer());
const pm = await get('rybex_pm', decision.downloadUrl);
const pmBytes = Buffer.from(await pm.arrayBuffer());
const result = { stage, opsHttp: ops.status,
  opsBytesMatchReceipt: ops.ok ? createHash('sha256').update(opsBytes).digest('hex') === decision.checksumSha256 : null,
  opsBytesWithheldOnDenial: ops.ok ? null : opsBytes.length < 256,
  pmHttp: pm.status, pmBytesMatchReceipt: pm.ok ? createHash('sha256').update(pmBytes).digest('hex') === decision.checksumSha256 : false };
if (stage === 'missing-object') {
  const work = JSON.parse(readFileSync('.rc13-synthetic-work.json', 'utf8'));
  const documentId = readFileSync('.rc13a-doc-id', 'utf8').trim();
  const admin = createClient('http://127.0.0.1:56621', process.env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false } });
  const { data: receipt, error } = await admin.rpc('d5o_hosted_design_document_evidence_read_v1', {
    p_workspace_key: 'rybex', p_presentation_id: work.id, p_document_id: documentId, p_document_revision: 1 });
  if (error || !receipt?.objectPath) throw Error('synthetic receipt unavailable');
  const deletion = await admin.storage.from('d5o-deploy-evidence').remove([receipt.objectPath]);
  result.syntheticDeleteSucceeded = !deletion.error;
  const missing = await get('rybex_pm', `/api/d5o-hosted/design-document-evidence?workspace=rybex&workId=${encodeURIComponent(work.id)}&documentId=${documentId}&revision=1&download=1`);
  result.syntheticMissingObjectHttp = missing.status;
  result.syntheticMissingObjectBytesWithheld = !(missing.headers.get('content-type') ?? '').includes('pdf');
}
const file = 'docs/release/evidence/D5O_RC13A_EVIDENCE_BOUNDARIES.json';
const prior = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { format: 'd5o-rc13a-evidence-boundaries-v1', results: [] };
prior.results.push(result);
writeFileSync(file, JSON.stringify(prior, null, 2) + '\n');
console.log(JSON.stringify(result));
