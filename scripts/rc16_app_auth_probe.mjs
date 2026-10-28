// Bounded fictional session probe against the isolated candidate application.
import {readFileSync,writeFileSync} from 'node:fs';
const credential=JSON.parse(readFileSync('.rc16-fictional-auth.json','utf8'));
if(!credential.email?.endsWith('@example.invalid'))throw Error('fictional identity required');
const base='http://127.0.0.1:61643';
const tokenResponse=await fetch('http://127.0.0.1:56621/auth/v1/token?grant_type=password',{
  method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(credential),signal:AbortSignal.timeout(8000)});
if(tokenResponse.status!==200)throw Error(`local fictional sign-in ${tokenResponse.status}`);
const session=await tokenResponse.json();
if(!session.access_token||!session.user?.id)throw Error('incomplete fictional session');
const cookie=`sb-d5o-local-56621-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`;
const cases=[
  {path:'/api/d5o-hosted/workspaces',name:'workspace-directory',method:'GET'},
  {path:'/api/d5o-platform/provisioning',name:'platform-provisioning-boundary',method:'GET'},
  {path:'/api/d5o-hosted/prototype-design-command?workspace=rc16fiction',name:'fictional-design-target',method:'POST'},
  {path:'/api/d5o-hosted/prototype-commercial-command?workspace=rc16fiction',name:'fictional-commercial-target',method:'POST'},
  {path:'/api/d5o-hosted/purchase-authority?workspace=rc16fiction&workId=fictional-work',name:'fictional-purchase-target',method:'POST'}
];
const results=[];
for(const {path,name,method} of cases){const r=await fetch(base+path,{method,
  headers:{cookie,...(method==='POST'?{'content-type':'application/json',origin:base,'sec-fetch-site':'same-origin'}:{})},
  body:method==='POST'?'{}':undefined,signal:AbortSignal.timeout(8000)});
  const body=await r.json().catch(()=>({}));
  results.push({name,http:r.status,contentType:r.headers.get('content-type'),
    error:typeof body.error==='string'?body.error:null,bodyKeys:Object.keys(body).slice(0,8)});}
const out={format:'d5o-rc16-authenticated-app-boundary-v1',candidate:'ef9bf423680c94fbbb41c4d9b7a5a5070ce6a10c',
  runtime:'isolated production build',auth:'genuine fictional GoTrue session',results,valuesOrTokensDisclosed:false};
writeFileSync('docs/release/evidence/D5O_RC16_APP_AUTH_BOUNDARY.json',JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify(out));
