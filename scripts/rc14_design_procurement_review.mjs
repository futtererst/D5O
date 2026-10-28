import {randomUUID} from 'node:crypto';import {readFileSync,writeFileSync} from 'node:fs';
const base='http://127.0.0.1:61643';
const actors=Object.fromEntries(JSON.parse(readFileSync('.rc13-actors.json','utf8')).map(a=>[a.name,a]));
const work=JSON.parse(readFileSync('.rc13-synthetic-work.json','utf8'));
const ids=JSON.parse(readFileSync('.rc14-design-ids.json','utf8'));
async function state(){const r=await fetch(`${base}/api/d5o-hosted/prototype-state?workspace=rybex&key=work`,{headers:{cookie:actors.rybex_pm.cookie}});
  const b=await r.json(),record=b.state?.records?.find(x=>x.id===work.id);if(r.status!==200||!record)throw Error('fictional Work unavailable');
  return {revision:b.revision,record};}
async function send(actor,action,extra){const s=await state();const r=await fetch(`${base}/api/d5o-hosted/prototype-design-command?workspace=rybex`,{
  method:'POST',headers:{cookie:actors[actor].cookie,origin:base,'sec-fetch-site':'same-origin','content-type':'application/json'},
  body:JSON.stringify({action,workId:work.id,commandId:randomUUID(),expectedRevision:s.revision,
    expectedDecisionRevision:s.record.design?.authorityRevision??0,...extra})});const b=await r.json();
  return {actor,action,http:r.status,error:b.error??null,authoritative:b.synthetic===false};}
const operations=[];
operations.push(await send('rybex_pm','request-review',{packageId:ids.packageId,discipline:'Procurement',
  assignee:'Procurement review queue',dueDate:'2026-12-01',note:'Independent fictional Procurement review requested'}));
if(operations.at(-1).http===200){const s=await state();const review=s.record.design?.reviews?.find(x=>x.packageId===ids.packageId
  &&x.discipline==='Procurement'&&x.status==='Requested');if(!review)throw Error('Procurement review absent');
  operations.push(await send('rybex_ops','decide-review',{reviewId:review.id,decision:'Approved',
    note:'Independent fictional Procurement package approval'}));}
const out={format:'d5o-rc14-procurement-review-v1',source:'ef9bf423680c94fbbb41c4d9b7a5a5070ce6a10c',
  auth:'genuine fictional GoTrue sessions',syntheticWorkOnly:true,operations};
writeFileSync('docs/release/evidence/D5O_RC14_PROCUREMENT_REVIEW.json',JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify(out));
