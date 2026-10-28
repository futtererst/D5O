// An actual fictional-admin configuration action only in the disposable historical copy.
import {randomUUID} from 'node:crypto';import {readFileSync,writeFileSync} from 'node:fs';
const base='http://127.0.0.1:61643';
const actors=Object.fromEntries(JSON.parse(readFileSync('.rc13-actors.json','utf8')).map(a=>[a.name,a]));
const path='/api/d5o-hosted/spending-delegation?workspace=rybex';
const before=await fetch(base+path,{headers:{cookie:actors.rybex_admin.cookie}});
const state=await before.json();if(before.status!==200)throw Error(`local delegate read ${before.status}`);
const response=await fetch(base+path,{method:'POST',headers:{cookie:actors.rybex_admin.cookie,origin:base,
  'sec-fetch-site':'same-origin','content-type':'application/json'},
  body:JSON.stringify({action:'add',commandId:randomUUID(),expectedRevision:state.revision,input:{
    category:'work_authority',kind:'delegate',actorId:actors.rybex_admin.id,role:'admin',currency:'USD',
    maxMinor:'1000000',validFrom:'2026-10-28',validUntil:'2027-12-31',
    sourceReference:'SYNTHETIC-RC14-LOCAL-DELEGATE'}})});
const body=await response.json();
const out={format:'d5o-rc14-spending-delegate-v1',source:'ef9bf423680c94fbbb41c4d9b7a5a5070ce6a10c',
  isolatedHistoricalCopyOnly:true,fictionalAdmin:true,existingHistoricalRuleModified:false,
  readHttp:before.status,addHttp:response.status,error:body.error??null};
writeFileSync('docs/release/evidence/D5O_RC14_SPENDING_DELEGATE.json',JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify(out));
