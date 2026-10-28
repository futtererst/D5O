// Emit SQL only for fictional local fixture memberships; pipe directly into isolated psql.
import { readFileSync } from 'node:fs';
const actors = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const roles = new Set(['project_manager','operations_leader','billing_commercial_lead',
  'field_supervisor','field_worker','admin','closeout_lead']);
if (actors.length !== 8 || actors.some(a => !a.email?.endsWith('@example.invalid') ||
  !/^[a-f0-9-]{36}$/.test(a.id) || !['rybex','rotork'].includes(a.workspace) || !roles.has(a.role)))
  throw Error('fictional actor set required');
console.log('BEGIN;');
for (const a of actors) console.log(`insert into d5o_hosted.memberships(workspace_id,actor_user_id,role,status)
  select id,'${a.id}'::uuid,'${a.role}','active' from d5o_hosted.workspaces where workspace_key='${a.workspace}';`);
console.log('COMMIT;');
