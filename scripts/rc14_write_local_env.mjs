// Create disposable local-only runtime bindings. Never print or commit generated files.
import { readFileSync, writeFileSync } from 'node:fs';
const password = readFileSync('.rc14-dbpass', 'utf8').trim();
const { secret, anon, service } = JSON.parse(readFileSync('.rc14-tokens.json', 'utf8'));
if (!/^[a-f0-9]{64}$/.test(password) || !secret || !anon || !service) throw Error('local credentials missing');
const db = `postgres://supabase_admin:${password}@d5o-rc7-historical-db:5432/postgres`;
const files = {
  '.rc14-rest.env': {
    PGRST_DB_URI: db, PGRST_DB_SCHEMAS: 'public,d5o_hosted,storage',
    PGRST_DB_ANON_ROLE: 'anon', PGRST_JWT_SECRET: secret,
    PGRST_SERVER_HOST: '0.0.0.0', PGRST_SERVER_PORT: '3000'
  },
  '.rc14-auth.env': {
    GOTRUE_DB_DRIVER: 'postgres', GOTRUE_DB_DATABASE_URL: `${db}?search_path=auth`,
    GOTRUE_DB_NAMESPACE: 'auth', GOTRUE_JWT_SECRET: secret,
    GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated', GOTRUE_JWT_EXP: '3600',
    GOTRUE_API_HOST: '0.0.0.0', GOTRUE_API_PORT: '9999',
    GOTRUE_SITE_URL: 'http://127.0.0.1:61643',
    API_EXTERNAL_URL: 'http://127.0.0.1:56621',
    GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true', GOTRUE_MAILER_AUTOCONFIRM: 'true',
    GOTRUE_DISABLE_SIGNUP: 'false'
  },
  '.rc14-app.env': {
    NODE_ENV: 'production', D5O_HOSTED_ENABLED: '1', D5O_COMMAND_RUNTIME: 'rehearsal',
    D5O_REHEARSAL_TARGET_URL: 'http://127.0.0.1:56621',
    RYBEXOS_RUNTIME_MODE: 'production', RYBEXOS_AUTH_MODE: 'supabase',
    RYBEXOS_DATA_SOURCE: 'database', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:56621',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: anon, SUPABASE_SECRET_KEY: service
  }
};
for (const [path, vars] of Object.entries(files))
  writeFileSync(path, Object.entries(vars).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600, flag: 'wx' });
console.log(JSON.stringify({ disposableEnvFiles: Object.keys(files), secretValuesPrinted: false }));
