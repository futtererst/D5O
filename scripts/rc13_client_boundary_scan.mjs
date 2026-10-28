import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const secret = process.env.SUPABASE_SECRET_KEY;
if (!secret || secret.length < 40) throw Error('synthetic local service key missing');
const root = '.next/static';
let scanned = 0;
let secretFound = false;
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else {
      scanned++;
      if (readFileSync(path).includes(Buffer.from(secret))) secretFound = true;
    }
  }
}
walk(root);
const actor = JSON.parse(readFileSync('.rc13-actors.json', 'utf8')).find(x => x.name === 'rybex_pm');
const response = await fetch('http://127.0.0.1:61643/api/d5o-hosted/private-evidence-index?workspace=rybex',
  { headers: { cookie: actor.cookie } });
const data = await response.json();
const entries = data.entries ?? [];
const allAppRelative = entries.every(x => typeof x.downloadUrl === 'string' &&
  x.downloadUrl.startsWith('/api/d5o-hosted/') && !/[?&](token|apikey|objectPath)=/i.test(x.downloadUrl));
const out = { format: 'd5o-rc13-client-storage-boundary-v1', clientStaticFilesScanned: scanned,
  syntheticServiceKeyInStatic: secretFound, indexHttp: response.status,
  indexedDownloadLinks: entries.length, allLinksAppRelativeWithoutStorageTokenOrPath: allAppRelative };
writeFileSync('docs/release/evidence/D5O_RC13_CLIENT_BOUNDARY.json', JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out));
