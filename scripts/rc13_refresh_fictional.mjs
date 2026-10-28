import { readFileSync, writeFileSync } from 'node:fs';

const actors = JSON.parse(readFileSync('.rc13-actors.json', 'utf8'));
for (const actor of actors) {
  const response = await fetch('http://127.0.0.1:56621/auth/v1/token?grant_type=password', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: actor.email, password: actor.password })
  });
  if (response.status !== 200) throw Error(`fictional login failed: ${actor.name}: ${response.status}`);
  const session = await response.json();
  if (session.user?.id !== actor.id || !session.access_token) throw Error('fictional identity changed');
  actor.accessToken = session.access_token;
  actor.cookie = `sb-d5o-local-56621-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`;
}
writeFileSync('.rc13-actors.json', JSON.stringify(actors), { mode: 0o600 });
console.log(JSON.stringify({ genuineSessionsRefreshed: actors.length }));
