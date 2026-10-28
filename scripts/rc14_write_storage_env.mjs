// Disposable Storage API binding. No values are printed or committed.
import { readFileSync, writeFileSync } from 'node:fs';
const password=readFileSync('.rc14-dbpass','utf8').trim();
const {secret,anon,service}=JSON.parse(readFileSync('.rc14-tokens.json','utf8'));
if(!/^[a-f0-9]{64}$/.test(password)||!secret||!anon||!service)throw Error('local credential missing');
const env={DATABASE_URL:`postgres://supabase_admin:${password}@d5o-rc7-historical-db:5432/postgres`,
  AUTH_JWT_SECRET:secret,ANON_KEY:anon,SERVICE_KEY:service,STORAGE_BACKEND:'file',
  FILE_STORAGE_BACKEND_PATH:'/mnt',TENANT_ID:'stub',STORAGE_S3_REGION:'local',
  FILE_SIZE_LIMIT:'52428800',GLOBAL_S3_BUCKET:'stub',ENABLE_IMAGE_TRANSFORMATION:'false'};
writeFileSync('.rc14-storage.env',Object.entries(env).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{mode:0o600,flag:'wx'});
console.log('disposable_storage_env_ready');
