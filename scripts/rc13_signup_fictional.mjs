// Creates only fictional users through the disposable local GoTrue API.
// Session material is stored in an untracked file and must be deleted at cleanup.
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const base = 'http://127.0.0.1:56621/auth/v1';
const actors = [
  ['rybex_pm', 'rybex', 'project_manager'],
  ['rybex_ops', 'rybex', 'operations_leader'],
  ['rybex_commercial', 'rybex', 'billing_commercial_lead'],
  ['rybex_field', 'rybex', 'field_supervisor'],
  ['rybex_worker', 'rybex', 'field_worker'],
  ['rybex_admin', 'rybex', 'admin'],
  ['rybex_closeout', 'rybex', 'closeout_lead'],
  ['rotork_pm', 'rotork', 'project_manager'],
];
const suffix = randomBytes(5).toString('hex');
const output = [];
for (const [name, workspace, role] of actors) {
  const email = `${name}.${suffix}@example.invalid`;
  const password = randomBytes(32).toString('base64url');
  const signup = await fetch(`${base}/signup`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }) });
  if (signup.status !== 200) throw Error(`local signup failed for ${name}: ${signup.status}`);
  const login = await fetch(`${base}/token?grant_type=password`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }) });
  if (login.status !== 200) throw Error(`local login failed for ${name}: ${login.status}`);
  const session = await login.json();
  if (!session.user?.id || !session.access_token || !session.refresh_token) throw Error('incomplete genuine GoTrue session');
  const cookie = `sb-d5o-local-56621-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`;
  output.push({ name, workspace, role, id: session.user.id, email, password, accessToken: session.access_token, cookie });
}
writeFileSync('.rc13-actors.json', JSON.stringify(output), { mode: 0o600 });
console.log(JSON.stringify({ genuineGoTrueSessions: output.length, actors: output.map(({ name, workspace, role }) => ({ name, workspace, role })) }));
