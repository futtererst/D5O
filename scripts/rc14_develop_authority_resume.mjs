// Resume only the previously prepared fictional purchase authority after delegate setup.
import {randomUUID} from 'node:crypto';import {readFileSync,writeFileSync} from 'node:fs';
const base='http://127.0.0.1:61643',work=JSON.parse(readFileSync('.rc13-synthetic-work.json','utf8'));
const actors=Object.fromEntries(JSON.parse(readFileSync('.rc13-actors.json','utf8')).map(a=>[a.name,a]));
async function req(actor,kind,method,body){const r=await fetch(`${base}/api/d5o-hosted/${kind}-authority?workspace=rybex&workId=${work.id}`,{
  method,headers:{cookie:actors[actor].cookie,...(body?{origin:base,'sec-fetch-site':'same-origin','content-type':'application/json'}:{})},
  body:body?JSON.stringify(body):undefined});const b=await r.json();return {http:r.status,error:b.error??null,body:b};}
const operations=[];const purchase=await req('rybex_pm','purchase','GET');
if(purchase.http!==200||!purchase.body.source?.digest)throw Error('fictional purchase read unavailable');
const prepared=purchase.body.authorities?.filter(a=>a.status==='Prepared'&&a.prepared_by===actors.rybex_pm.id);
if(prepared?.length!==1)throw Error(`fictional prepared authority count=${prepared?.length??0}`);
const approve=await req('rybex_admin','purchase','POST',{action:'approve',input:{authorityId:prepared[0].id,
  reason:'Independent fictional labor only parent cap approval'},commandId:randomUUID(),
  expectedRevision:purchase.body.revision,expectedSourceDigest:purchase.body.source.digest});
operations.push({action:'approve-purchase',actor:'rybex_admin',http:approve.http,error:approve.error});
if(approve.http===200){const laborRead=await req('rybex_pm','labor','GET');
  if(laborRead.http!==200||!laborRead.body.source?.digest)throw Error('fictional labor source unavailable');
  const labor=await req('rybex_pm','labor','POST',{action:'prepare',input:{capMinor:'500000',rateMinor:'10000',
    rateVersion:'TEST-2026',rateSource:'Fictional labor rate card',rateBasis:'Hourly fictional technician rate',
    scope:'Fictional service restoration and inspection',conditions:'Only eligible crew and reviewed hours',
    validFrom:'2026-10-28',validUntil:'2027-01-04'},commandId:randomUUID(),
    expectedRevision:laborRead.body.revision,expectedSourceDigest:laborRead.body.source.digest});
  operations.push({action:'prepare-labor',actor:'rybex_pm',http:labor.http,error:labor.error});
  if(labor.http===200){const laborApproval=await req('rybex_admin','labor','POST',{action:'approve',
    input:{authorityId:labor.body.subjectId,reason:'Independent fictional qualified labor approval'},
    commandId:randomUUID(),expectedRevision:labor.body.revision,expectedSourceDigest:laborRead.body.source.digest});
    operations.push({action:'approve-labor',actor:'rybex_admin',http:laborApproval.http,error:laborApproval.error});}
}
const out={format:'d5o-rc14-develop-authority-resume-v1',source:'ef9bf423680c94fbbb41c4d9b7a5a5070ce6a10c',
  auth:'genuine fictional GoTrue sessions',syntheticWorkOnly:true,operations};
writeFileSync('docs/release/evidence/D5O_RC14_DEVELOP_AUTHORITY_RESUME.json',JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify(out));
