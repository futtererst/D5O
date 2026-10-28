// Disposable local-only JWT material for RC13 service rehearsal. Never use in production.
import { createHmac, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const secret = randomBytes(48).toString('base64url');
const sign = (role) => {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const body = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role, iss: 'supabase', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 86400 })}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
};
const file = process.argv[2] ?? join(tmpdir(), `d5o-rc13-local-tokens-${process.pid}.json`);
writeFileSync(file, JSON.stringify({ secret, anon: sign('anon'), service: sign('service_role') }), { mode: 0o600 });
console.log(file);
