// Genuine-session Design package basis, crew demand, and independent reviews on fictional Work.
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const base='http://127.0.0.1:61643';
const actors=Object.fromEntries(JSON.parse(readFileSync('.rc13-actors.json','utf8')).map(a=>[a.name,a]));
const work=JSON.parse(readFileSync('.rc13-synthetic-work.json','utf8'));
const ids=JSON.parse(readFileSync('.rc14-design-ids.json','utf8'));
async function state(){const r=await fetch(`${base}/api/d5o-hosted/prototype-state?workspace=rybex&key=work`,
  {headers:{cookie:actors.rybex_pm.cookie}});const b=await r.json();const rec=b.state?.records?.find(x=>x.id===work.id);
  if(r.status!==200||!rec)throw Error('fictional Work unavailable');return {revision:b.revision,record:rec};}
async function command(actor,action,extra){const s=await state();const r=await fetch(`${base}/api/d5o-hosted/prototype-design-command?workspace=rybex`,{
  method:'POST',headers:{cookie:actors[actor].cookie,origin:base,'sec-fetch-site':'same-origin',
    'content-type':'application/json'},body:JSON.stringify({action,workId:work.id,commandId:randomUUID(),
      expectedRevision:s.revision,expectedDecisionRevision:s.record.design?.authorityRevision??0,...extra})});
  const b=await r.json();return {actor,action,http:r.status,error:b.error??null,authoritative:b.synthetic===false};}
const initial=await state();const reqs=initial.record.definition.scopeControl.requirements
  .filter(x=>x.state==='Confirmed').map(x=>x.id);
if(initial.record.design?.documents?.find(x=>x.id===ids.documentId)?.status!=='Issued for use'||!reqs.length)
  throw Error('issued fictional Design source absent');
const basis={packageId:ids.packageId,scope:'Restore and verify fictional service work',location:'Fictional service site',
  systems:'Fictional service control system',completionBasis:{kind:'Measured',plannedQuantity:1,unit:'service',
    criterion:'One restored and independently verified service'},requirementIds:reqs,predecessorIds:[],
  documentRefs:[`${ids.documentId}@1`],materials:'No physical material needed for fictional service restoration',
  materialLines:[],materialStatus:'Not required',materialRequiredDate:'',materialForecastDate:'',
  materialSource:'Fictional documented no-material assessment',
  access:'Escorted site access',permit:'Fictional customer permit confirmed',safetyControls:'Isolation and hazard review',
  equipment:'Test instrument',method:'Isolate, restore, inspect, test and return service',
  rollback:'Restore previous safe operating state',verification:'Independent functional check',proof:'Dated fictional test record',
  acceptingAuthority:'Operations receiver',windowStart:'2026-12-05',windowEnd:'2026-12-05',
  targetReleaseDate:'2026-12-05',crewDemandRequired:true,crewExemptionReason:'',commercialImpact:'',commercialDisposition:'None'};
const operations=[];
operations.push(await command('rybex_pm','save-package',{package:basis,note:'Fictional package engineering basis'}));
if(operations.at(-1).http===200){
  const demand={workId:work.id,packageId:ids.packageId,qualification:'Fictional qualified service crew',
    minimumPeople:1,estimatedPersonHours:100,priority:'High',prerequisite:'Accepted fictional Design package',
    crewSchedulable:true,requiredSlots:[{date:'2026-12-05',shift:'day'}]};
  operations.push(await command('rybex_pm','save-demand',{demand}));
}
if(operations.at(-1).http===200){
  for(const discipline of ['Engineering','Delivery','Safety','Quality','Procurement']){
    const request=await command('rybex_pm','request-review',{packageId:ids.packageId,discipline,
      assignee:`${discipline} review queue`,dueDate:'2026-12-01',note:`Independent ${discipline} review requested`});
    operations.push({...request,discipline});if(request.http!==200)break;
    const current=await state();const review=current.record.design?.reviews?.find(x=>x.packageId===ids.packageId
      && x.discipline===discipline&&x.status==='Requested');
    if(!review)throw Error('requested review missing');
    const decision=await command('rybex_ops','decide-review',{reviewId:review.id,decision:'Approved',
      note:`Independent fictional ${discipline} package approval`});
    operations.push({...decision,discipline});if(decision.http!==200)break;
  }
}
const final=await state();
const out={format:'d5o-rc14-design-basis-v1',source:'ef9bf423680c94fbbb41c4d9b7a5a5070ce6a10c',
  auth:'genuine fictional GoTrue sessions',syntheticWorkOnly:true,operations,
  finalPackageStatus:final.record.design?.packages?.find(x=>x.packageId===ids.packageId)?.status??null};
writeFileSync('docs/release/evidence/D5O_RC14_DESIGN_BASIS.json',JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify(out));
