// Authenticated fictional Work economic and labor authority, each independently approved.
import {randomUUID} from 'node:crypto';import {readFileSync,writeFileSync} from 'node:fs';
const base='http://127.0.0.1:61643';
const actors=Object.fromEntries(JSON.parse(readFileSync('.rc13-actors.json','utf8')).map(a=>[a.name,a]));
const work=JSON.parse(readFileSync('.rc13-synthetic-work.json','utf8'));
async function request(actor,kind,method,body){const url=`${base}/api/d5o-hosted/${kind}-authority?workspace=rybex&workId=${work.id}`;
  const r=await fetch(url,{method,headers:{cookie:actors[actor].cookie,
    ...(body?{origin:base,'sec-fetch-site':'same-origin','content-type':'application/json'}:{})},
    body:body?JSON.stringify(body):undefined});const b=await r.json();
  return {http:r.status,error:b.error??null,body:b};}
const operations=[];
const economic=await request('rybex_pm','purchase','GET');
if(economic.http!==200||!economic.body.source?.digest)throw Error(`fictional economic source unavailable:${economic.http}`);
const validFrom='2026-10-28',validUntil='2027-01-04';
const parentInput={parentCapMinor:'1000000',purchaseCapMinor:'0',subcontractEnabled:true,validFrom,validUntil,
  purchasingEntity:'Fictional procurement entity',graybarAccountReference:'SYNTH-RC14-NO-PURCHASE',
  scope:'Labor only fictional service restoration authorization',fundingSource:'Fictional customer award funding',
  sourceReference:'SYNTHETIC-RC14-AWARD',conditions:'No physical purchasing in this fictional test'};
const parent=await request('rybex_pm','purchase','POST',{action:'prepare',input:parentInput,commandId:randomUUID(),
  expectedRevision:economic.body.revision,expectedSourceDigest:economic.body.source.digest});
operations.push({action:'prepare-purchase',actor:'rybex_pm',http:parent.http,error:parent.error});
if(parent.http===200){const approved=await request('rybex_admin','purchase','POST',{action:'approve',
    input:{authorityId:parent.body.subjectId,reason:'Independent fictional labor only parent cap approval'},
    commandId:randomUUID(),expectedRevision:parent.body.revision,expectedSourceDigest:economic.body.source.digest});
  operations.push({action:'approve-purchase',actor:'rybex_admin',http:approved.http,error:approved.error});}
if(operations.at(-1).action==='approve-purchase'&&operations.at(-1).http===200){
  const laborRead=await request('rybex_pm','labor','GET');
  if(laborRead.http!==200||!laborRead.body.source?.digest)throw Error('fictional labor source unavailable');
  const labor=await request('rybex_pm','labor','POST',{action:'prepare',input:{capMinor:'500000',rateMinor:'10000',
    rateVersion:'TEST-2026',rateSource:'Fictional labor rate card',rateBasis:'Hourly fictional technician rate',
    scope:'Fictional service restoration and inspection',conditions:'Only eligible crew and reviewed hours',
    validFrom,validUntil},commandId:randomUUID(),expectedRevision:laborRead.body.revision,
    expectedSourceDigest:laborRead.body.source.digest});
  operations.push({action:'prepare-labor',actor:'rybex_pm',http:labor.http,error:labor.error});
  if(labor.http===200){const approved=await request('rybex_admin','labor','POST',{action:'approve',
    input:{authorityId:labor.body.subjectId,reason:'Independent fictional qualified labor approval'},
    commandId:randomUUID(),expectedRevision:labor.body.revision,expectedSourceDigest:laborRead.body.source.digest});
    operations.push({action:'approve-labor',actor:'rybex_admin',http:approved.http,error:approved.error});}
}
const out={format:'d5o-rc14-develop-authority-v1',source:'ef9bf423680c94fbbb41c4d9b7a5a5070ce6a10c',
  auth:'genuine fictional GoTrue sessions',syntheticWorkOnly:true,operations};
writeFileSync('docs/release/evidence/D5O_RC14_DEVELOP_AUTHORITY.json',JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify(out));
