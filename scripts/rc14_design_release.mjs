import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
const base='http://127.0.0.1:61643';
const actors=Object.fromEntries(JSON.parse(readFileSync('.rc13-actors.json','utf8')).map(a=>[a.name,a]));
const work=JSON.parse(readFileSync('.rc13-synthetic-work.json','utf8'));
const ids=JSON.parse(readFileSync('.rc14-design-ids.json','utf8'));
async function state(){const r=await fetch(`${base}/api/d5o-hosted/prototype-state?workspace=rybex&key=work`,
  {headers:{cookie:actors.rybex_pm.cookie}});const b=await r.json();const rec=b.state?.records?.find(x=>x.id===work.id);
  if(r.status!==200||!rec)throw Error('fictional Work missing');return {revision:b.revision,record:rec};}
async function command(actor,action,extra){const s=await state();const r=await fetch(`${base}/api/d5o-hosted/prototype-design-command?workspace=rybex`,{
  method:'POST',headers:{cookie:actors[actor].cookie,origin:base,'sec-fetch-site':'same-origin',
    'content-type':'application/json'},body:JSON.stringify({action,workId:work.id,commandId:randomUUID(),
      expectedRevision:s.revision,expectedDecisionRevision:s.record.design?.authorityRevision??0,...extra})});
  const b=await r.json();return {actor,action,http:r.status,error:b.error??null,authoritative:b.synthetic===false};}
const operations=[];
operations.push(await command('rybex_pm','release-package',{packageId:ids.packageId,dueDate:'2026-12-05',
  note:'Fictional package approved for independent receipt'}));
if(operations.at(-1).http===200){const s=await state();const release=s.record.design?.releases?.find(x=>x.packageId===ids.packageId&&x.status==='Awaiting receipt');
  if(!release)throw Error('fictional release absent');
  operations.push(await command('rybex_ops','respond-receipt',{releaseId:release.id,response:'Accepted',
    receivingOwner:'Fictional Operations Leader',note:'Independently accepted fictional Design release'}));}
const final=await state();const out={format:'d5o-rc14-design-release-v1',source:'ef9bf423680c94fbbb41c4d9b7a5a5070ce6a10c',
  auth:'genuine fictional GoTrue sessions',syntheticWorkOnly:true,operations,
  finalReleaseStatus:final.record.design?.releases?.find(x=>x.packageId===ids.packageId)?.status??null};
writeFileSync('docs/release/evidence/D5O_RC14_DESIGN_RELEASE.json',JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify(out));
