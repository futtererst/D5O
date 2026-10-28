// Verify retained encrypted index against the disposable Storage volume, with no byte export.
import { createDecipheriv, createHash } from 'node:crypto';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadProtectedKey } from './rc6_dpapi_key.mjs';

const dir = realpathSync('C:/Users/futte/AppData/Local/D5O-RC6-Protected');
const key = loadProtectedKey(dir);
function decrypt(file) {
  const value = readFileSync(file);
  if (!value.subarray(0, 8).equals(Buffer.from('D5ORC6A1'))) throw Error('protected index format mismatch');
  const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(8, 20));
  decipher.setAuthTag(value.subarray(-16));
  return Buffer.concat([decipher.update(value.subarray(20, -16)), decipher.final()]);
}
try {
  const index = JSON.parse(decrypt(join(dir, 'rc7-storage-byte-index.json.aesgcm')).toString('utf8'));
  if (index.project !== 'fcawktdjoxvahhgvkebx' || index.objects.length !== 23) throw Error('protected index identity mismatch');
  let total = 0;
  for (const object of index.objects) {
    for (const segment of [object.bucket_id, ...object.name.split('/'), object.version])
      if (!segment || segment === '.' || segment === '..' || segment.includes('\\')) throw Error('unsafe protected path');
    const path = `/mnt/stub/stub/${object.bucket_id}/${object.name}/${object.version}`;
    const read = spawnSync('docker', ['exec', 'd5o-rc12-storage', 'cat', path], { maxBuffer: 12_000_000 });
    if (read.status !== 0 || read.stdout.length !== object.byteSize ||
      createHash('sha256').update(read.stdout).digest('hex') !== object.byteSha256)
      throw Error('disposable Storage byte mismatch');
    total += read.stdout.length;
    read.stdout.fill(0);
  }
  const result = { format: 'd5o-rc13-private-volume-integrity-v1', originalEncryptedIndexVerified: true,
    objects: 23, bytes: total, allVolumeByteHashesMatch: true, plaintextValuesDisclosed: false };
  writeFileSync('docs/release/evidence/D5O_RC13_PRIVATE_VOLUME_INTEGRITY.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally { key.fill(0); }
