// Decrypt authorized RC7 private bytes in memory into a disposable local Storage volume.
// No plaintext file or production credential is written to the host.
import { createDecipheriv, createHash } from 'node:crypto';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadProtectedKey } from './rc6_dpapi_key.mjs';

const dir = realpathSync('C:/Users/futte/AppData/Local/D5O-RC6-Protected');
const container = 'd5o-rc12-storage';
const db = 'd5o-rc7-historical-db';
const key = loadProtectedKey(dir);
const run = (args, input) => {
  const r = spawnSync('docker', args, { input, encoding: input ? undefined : 'utf8', maxBuffer: 3_000_000 });
  if (r.status !== 0) throw Error('isolated Docker operation failed');
  return r.stdout;
};
const decrypt = file => {
  const encrypted = readFileSync(file);
  if (!encrypted.subarray(0, 8).equals(Buffer.from('D5ORC6A1'))) throw Error('encrypted file header mismatch');
  const d = createDecipheriv('aes-256-gcm', key, encrypted.subarray(8, 20));
  d.setAuthTag(encrypted.subarray(-16));
  return { encrypted, plain: Buffer.concat([d.update(encrypted.subarray(20, -16)), d.final()]) };
};
try {
  const index = JSON.parse(decrypt(join(dir, 'rc7-storage-byte-index.json.aesgcm')).plain.toString('utf8'));
  if (index.project !== 'fcawktdjoxvahhgvkebx' || index.objects.length !== 23) throw Error('index identity mismatch');
  const query = "select row_to_json(t)::text from (select id,bucket_id,name,version from storage.objects order by id) t";
  const rows = String(run(['exec', db, 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-At', '-c', query])).trim().split(/\r?\n/).map(JSON.parse);
  const known = new Set(rows.map(r => `${r.id}\0${r.bucket_id}\0${r.name}\0${r.version}`));
  if (known.size !== 23) throw Error('restored metadata count mismatch');
  let total = 0;
  for (const row of index.objects) {
    if (!known.has(`${row.id}\0${row.bucket_id}\0${row.name}\0${row.version}`)) throw Error('metadata association mismatch');
    for (const segment of [row.bucket_id, ...row.name.split('/'), row.version]) {
      if (!segment || segment === '.' || segment === '..' || segment.includes('\\')) throw Error('unsafe Storage path');
    }
    const { encrypted, plain } = decrypt(join(dir, 'objects', row.filename));
    if (createHash('sha256').update(encrypted).digest('hex') !== row.encryptedSha256 || plain.length !== row.byteSize || createHash('sha256').update(plain).digest('hex') !== row.byteSha256) throw Error('byte hash mismatch');
    const target = `/mnt/stub/stub/${row.bucket_id}/${row.name}/${row.version}`;
    run(['exec', container, 'mkdir', '-p', target.slice(0, target.lastIndexOf('/'))]);
    run(['exec', '-i', container, 'sh', '-c', 'cat > "$1"', 'sh', target], plain);
    total += plain.length;
    plain.fill(0);
  }
  const out = { format: 'd5o-rc12-storage-byte-restore-v1', objects: 23, bytes: total, encrypted_and_plain_sha256_match: true, metadata_id_path_version_match: true, target: 'disposable local Storage volume', production_modified: false };
  writeFileSync('docs/release/evidence/D5O_RC12_PRIVATE_BYTES.json', JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify(out));
} finally { key.fill(0); }
