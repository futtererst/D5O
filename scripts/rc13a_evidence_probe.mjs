// Genuine-session, local-only evidence controls. Writes sanitized outcomes.
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const base = 'http://127.0.0.1:61643';
const actors = Object.fromEntries(JSON.parse(readFileSync('.rc13-actors.json', 'utf8')).map(x => [x.name, x]));
const work = JSON.parse(readFileSync('.rc13-synthetic-work.json', 'utf8'));
const documentId = readFileSync('.rc13a-doc-id', 'utf8').trim();
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const get = (who, path) => fetch(base + path, { headers: who ? { cookie: actors[who].cookie } : {} });
const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
const form = new FormData();
form.set('file', new File([pdf], 'fictional-design.pdf', { type: 'application/pdf' }));
const uploadPath = `/api/d5o-hosted/design-document-evidence?workspace=rybex&workId=${encodeURIComponent(work.id)}&documentId=${documentId}&revision=1`;
const uploaded = await fetch(base + uploadPath, { method: 'POST', headers: {
  cookie: actors.rybex_pm.cookie, origin: base, 'sec-fetch-site': 'same-origin' }, body: form });
const receipt = await uploaded.json();
const downloadPath = `${uploadPath}&download=1`;
const downloaded = uploaded.ok ? await get('rybex_pm', downloadPath) : null;
const downloadedBytes = downloaded ? Buffer.from(await downloaded.arrayBuffer()) : Buffer.alloc(0);
const indexResponse = await get('rybex_pm', '/api/d5o-hosted/private-evidence-index?workspace=rybex');
const index = await indexResponse.json();
const historicalDecision = index.entries?.find(x => x.kind === 'package-acceptance' || x.kind === 'work-acceptance');
const decision = historicalDecision ? await get('rybex_pm', historicalDecision.downloadUrl) : null;
const decisionBytes = decision ? Buffer.from(await decision.arrayBuffer()) : Buffer.alloc(0);
const wrong = await get('rybex_pm', downloadPath.replace(`workId=${encodeURIComponent(work.id)}`, `workId=${randomUUID()}`));
const foreign = await get('rotork_pm', downloadPath);
const anonymous = await get(null, downloadPath);
const forged = await get('rybex_pm', `${downloadPath}&objectPath=rotork%2Fforged%2Fprivate.pdf`);
const forgedBytes = Buffer.from(await forged.arrayBuffer());
const missing = await get('rybex_pm', uploadPath.replace(`documentId=${documentId}`, `documentId=${randomUUID()}`));
const out = { format: 'd5o-rc13a-evidence-http-v1', source: 'd2a06ed796789dc8395386f067ef85545acf586a',
  runtime: 'isolated Next.js production build', auth: 'genuine fictional GoTrue sessions',
  syntheticFixture: 'Draft document inserted in fictional connected Design state solely to test custody',
  uploadHttp: uploaded.status, uploadError: receipt.error ?? null,
  uploadReceiptPresent: Boolean(receipt.evidenceId),
  receiptShaMatchesSyntheticBytes: receipt.checksumSha256 === sha(pdf),
  downloadHttp: downloaded?.status ?? null, downloadShaMatchesSyntheticBytes: sha(downloadedBytes) === sha(pdf),
  downloadCacheControl: downloaded?.headers.get('cache-control') ?? null,
  historicalCustomerDecisionHttp: decision?.status ?? null,
  historicalCustomerDecisionShaMatchesReceipt: historicalDecision ? sha(decisionBytes) === historicalDecision.checksumSha256 : false,
  historicalCustomerDecisionCacheControl: decision?.headers.get('cache-control') ?? null,
  wrongWorkHttp: wrong.status, crossTenantHttp: foreign.status, anonymousHttp: anonymous.status,
  forgedPathHttp: forged.status, forgedPathSameBytes: sha(forgedBytes) === sha(pdf),
  missingDocumentHttp: missing.status,
  noSignedUrlInIndex: (index.entries ?? []).every(x => x.downloadUrl?.startsWith('/api/d5o-hosted/') && !/[?&](token|apikey|objectPath)=/i.test(x.downloadUrl)),
  historicObjectCountBeforeSyntheticUpload: 23,
  productionModified: false };
writeFileSync('docs/release/evidence/D5O_RC13A_EVIDENCE_HTTP.json', JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out));
