// Authenticated Design package and controlled-document preparation on fictional Work only.
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const base='http://127.0.0.1:61643';
const actors=Object.fromEntries(JSON.parse(readFileSync('.rc13-actors.json','utf8')).map(a=>[a.name,a]));
const work=JSON.parse(readFileSync('.rc13-synthetic-work.json','utf8'));
async function read(key){const r=await fetch(`${base}/api/d5o-hosted/prototype-state?workspace=rybex&key=${key}`,
  {headers:{cookie:actors.rybex_pm.cookie}});const b=await r.json();if(r.status!==200)throw Error(`${key}:${r.status}`);return b;}
async function post(actor,path,body){const r=await fetch(base+path,{method:'POST',headers:{cookie:actors[actor].cookie,
  origin:base,'sec-fetch-site':'same-origin','content-type':'application/json'},body:JSON.stringify(body)});
  const b=await r.json();return {http:r.status,error:b.error??null,authoritative:b.synthetic===false,result:b};}
const results=[];
let ws=await read('work'),cat=await read('catalog');
let record=ws.state.records.find(x=>x.id===work.id&&x.canonicalWorkId===work.canonicalWorkId);
if(record?.discovery?.designHandoff?.status!=='accepted')throw Error('accepted Design handoff absent');
const created=await post('rybex_pm','/api/d5o-hosted/prototype-catalog?workspace=rybex',{
  action:'create-package',workId:work.id,name:'Fictional service restoration package',owner:'Fictional Design Lead',
  commandId:randomUUID(),expectedRevision:cat.revision,expectedWorkRevision:ws.revision,
  expectedHandoffRevision:record.discovery.designHandoff.revision,
  expectedPackageCount:cat.state.packages.filter(p=>p.workId===work.id).length});
results.push({action:'create-package',actor:'rybex_pm',http:created.http,error:created.error,authoritative:created.authoritative});
const packageId=created.result?.created?.id;
if(created.http===201&&packageId){
  ws=await read('work');record=ws.state.records.find(x=>x.id===work.id);
  const documentId=`doc-${randomUUID()}`;
  const requirementIds=record.definition.scopeControl.requirements.filter(x=>x.state==='Confirmed').map(x=>x.id);
  const doc=await post('rybex_pm','/api/d5o-hosted/prototype-design-command?workspace=rybex',{
    action:'save-document',workId:work.id,commandId:randomUUID(),expectedRevision:ws.revision,
    expectedDecisionRevision:record.design?.authorityRevision??0,
    document:{id:documentId,type:'Method statement',title:'Fictional service restoration method',
      source:'SYNTHETIC-RC14-DESIGN',packageIds:[packageId],requirementIds,dueDate:'2026-12-05'},
    note:'Fictional controlled Design document'});
  results.push({action:'save-document',actor:'rybex_pm',http:doc.http,error:doc.error,authoritative:doc.authoritative});
  if(doc.http===200)writeFileSync('.rc14-design-ids.json',JSON.stringify({packageId,documentId}),{mode:0o600});
}
const out={format:'d5o-rc14-design-prepare-v1',source:'ef9bf423680c94fbbb41c4d9b7a5a5070ce6a10c',
  auth:'genuine fictional GoTrue session',syntheticWorkOnly:true,operations:results};
writeFileSync('docs/release/evidence/D5O_RC14_DESIGN_PREPARE.json',JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify(out));
